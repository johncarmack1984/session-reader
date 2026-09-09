import {
  DriftCollector,
  isKnownBlock,
  isRecord,
  parseTranscript,
  type AssistantLine,
  type DriftReport,
  type Envelope,
  type SystemLine,
  type ToolResultBlock,
  type UserLine,
} from './transcript/index.ts';
import { stripAnsi } from './text.ts';

export interface SessionMetadata {
  startTime?: string;
  endTime?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  sessionId?: string;
  entrypoint?: string;
  permissionMode?: string;
  title?: string;
}

/** Something the human typed. */
export interface UserMessageEntry {
  type: 'user-message';
  content: string;
  timestamp?: string;
}

export interface AssistantTextEntry {
  type: 'assistant-text';
  content: string;
  timestamp?: string;
}

export interface ToolCallEntry {
  type: 'tool-call';
  id: string;
  name: string;
  input: Record<string, unknown>;
  timestamp?: string;
}

export interface ThinkingEntry {
  type: 'thinking';
  content: string;
  timestamp?: string;
}

/** A context compaction: the boundary marker, the summary that replaced the earlier conversation, or both. */
export interface CompactionEntry {
  type: 'compaction';
  summary?: string;
  trigger?: string;
  preTokens?: number;
  postTokens?: number;
  timestamp?: string;
}

/** A slash command or `!` shell command run locally, with its output. Not part of the conversation with the model. */
export interface LocalCommandEntry {
  type: 'local-command';
  source: 'slash' | 'bash';
  command?: string;
  args?: string;
  output?: string;
  isError?: boolean;
  timestamp?: string;
}

/** Text carried on a user line that the human did not type: caveats, task notifications, skill preambles. */
export interface MetaEntry {
  type: 'meta';
  label: string;
  content: string;
  timestamp?: string;
}

export type Entry =
  | UserMessageEntry
  | AssistantTextEntry
  | ToolCallEntry
  | ThinkingEntry
  | CompactionEntry
  | LocalCommandEntry
  | MetaEntry;

export interface ToolResult {
  content: string;
  isError: boolean;
}

export interface ParsedSession {
  entries: Entry[];
  toolResults: Map<string, ToolResult>;
  metadata: SessionMetadata;
  drift: DriftReport;
}

export function parseSession(text: string): ParsedSession {
  const drift = new DriftCollector();
  const results = parseTranscript(text, drift);
  const entries: Entry[] = [];
  const toolResults = new Map<string, ToolResult>();
  const metadata: SessionMetadata = {};
  let generatedTitle: string | undefined;

  for (const result of results) {
    if (result.status !== 'known') continue;
    const line = result.line;
    switch (line.type) {
      case 'user':
      case 'assistant':
      case 'system':
      case 'attachment':
        noteEnvelope(line, metadata);
        break;
      case 'permission-mode':
        metadata.permissionMode = line.permissionMode;
        break;
      case 'custom-title':
        metadata.title = line.customTitle;
        break;
      case 'ai-title':
        generatedTitle = line.aiTitle;
        break;
      case 'summary':
        generatedTitle ??= line.summary;
        break;
    }
    if (line.type === 'user') collectUser(line, entries, toolResults, metadata);
    else if (line.type === 'assistant') collectAssistant(line, entries);
    else if (line.type === 'system') collectSystem(line, entries);
  }

  metadata.title ??= generatedTitle;
  return { entries, toolResults, metadata, drift: drift.report() };
}

function noteEnvelope(line: Envelope, metadata: SessionMetadata): void {
  if (!metadata.startTime) metadata.startTime = line.timestamp;
  metadata.endTime = line.timestamp;
  if (!metadata.cwd && line.cwd) {
    metadata.cwd = line.cwd;
    metadata.version = line.version;
    metadata.gitBranch = line.gitBranch;
    metadata.sessionId = line.sessionId;
    metadata.entrypoint = line.entrypoint;
  }
}

function collectUser(
  line: UserLine,
  entries: Entry[],
  toolResults: Map<string, ToolResult>,
  metadata: SessionMetadata,
): void {
  metadata.permissionMode ??= line.permissionMode;
  const { content } = line.message;
  const timestamp = line.timestamp;
  const texts: string[] = [];
  if (typeof content === 'string') {
    texts.push(content);
  } else {
    for (const block of content) {
      if (!isKnownBlock(block)) continue;
      if (block.type === 'text') {
        texts.push(block.text);
      } else if (block.type === 'tool_result') {
        toolResults.set(block.tool_use_id, { content: toolResultText(block), isError: block.is_error === true });
      }
    }
  }
  if (!texts.length) return;
  const text = texts.join('\n\n');
  if (line.isCompactSummary) {
    pushCompactionSummary(entries, text, timestamp);
    return;
  }
  if (pushInjected(text, timestamp, line.isMeta === true, entries)) return;
  entries.push({ type: 'user-message', content: text, timestamp });
}

function toolResultText(block: ToolResultBlock): string {
  const { content } = block;
  if (typeof content === 'string') return content;
  if (!content) return '';
  return content.map((b) => (isKnownBlock(b) && b.type === 'text' ? b.text : '')).join('\n');
}

function collectAssistant(line: AssistantLine, entries: Entry[]): void {
  const timestamp = line.timestamp;
  for (const block of line.message.content) {
    if (!isKnownBlock(block)) continue;
    switch (block.type) {
      case 'text':
        if (block.text) entries.push({ type: 'assistant-text', content: block.text, timestamp });
        break;
      case 'tool_use':
        entries.push({ type: 'tool-call', id: block.id, name: block.name, input: block.input, timestamp });
        break;
      case 'thinking':
        if (block.thinking) entries.push({ type: 'thinking', content: block.thinking, timestamp });
        break;
      default:
        break;
    }
  }
}

function collectSystem(line: SystemLine, entries: Entry[]): void {
  const timestamp = line.timestamp;
  if (line.subtype === 'compact_boundary') {
    const meta = isRecord(line.compactMetadata) ? line.compactMetadata : {};
    entries.push({
      type: 'compaction',
      trigger: typeof meta.trigger === 'string' ? meta.trigger : undefined,
      preTokens: numberOrUndefined(meta.preTokens),
      postTokens: numberOrUndefined(meta.postTokens),
      timestamp,
    });
  } else if (line.subtype === 'local_command' && line.content) {
    pushInjected(line.content, timestamp, false, entries);
  }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function pushCompactionSummary(entries: Entry[], summary: string, timestamp: string | undefined): void {
  const last = entries.at(-1);
  if (last?.type === 'compaction' && last.summary === undefined) {
    last.summary = summary;
    return;
  }
  entries.push({ type: 'compaction', summary, timestamp });
}

// User-role text that the human did not type. Local commands and their output
// are wrapped in tags; other injected text is flagged `isMeta` on the line.

const LEADING_TAG = /^\s*<([a-z-]+)>/;

function leadingTag(text: string): string | undefined {
  return LEADING_TAG.exec(text)?.[1];
}

function tagContent(text: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return match ? match[1]!.trim() : undefined;
}

const META_LABELS: ReadonlyArray<[RegExp, string]> = [
  [/^\[Image:/, 'Image'],
  [/^Base directory for this skill/, 'Skill'],
  [/^\[SYSTEM NOTIFICATION/, 'Notification'],
];

/** Returns true when the text was recorded as something other than a user message. */
function pushInjected(text: string, timestamp: string | undefined, isMeta: boolean, entries: Entry[]): boolean {
  const tag = leadingTag(text);
  switch (tag) {
    case 'command-name':
    case 'command-message': {
      const command = tagContent(text, 'command-name') ?? tagContent(text, 'command-message');
      const args = tagContent(text, 'command-args');
      entries.push({ type: 'local-command', source: 'slash', command, args: args || undefined, timestamp });
      attachInlineOutput(text, 'local-command', 'slash', entries, timestamp);
      return true;
    }
    case 'local-command-stdout':
    case 'local-command-stderr':
      attachOutput(entries, 'slash', tagContent(text, tag) ?? '', tag.endsWith('stderr'), timestamp);
      return true;
    case 'bash-input':
      entries.push({ type: 'local-command', source: 'bash', command: tagContent(text, tag), timestamp });
      attachInlineOutput(text, 'bash', 'bash', entries, timestamp);
      return true;
    case 'bash-stdout':
    case 'bash-stderr':
      attachOutput(entries, 'bash', tagContent(text, tag) ?? '', tag.endsWith('stderr'), timestamp);
      return true;
    case 'local-command-caveat':
      entries.push({ type: 'meta', label: 'Caveat', content: tagContent(text, tag) ?? text, timestamp });
      return true;
    case 'task-notification':
      entries.push({ type: 'meta', label: 'Task notification', content: text, timestamp });
      return true;
    case 'fork-boilerplate':
      entries.push({ type: 'meta', label: 'Fork', content: tagContent(text, tag) ?? text, timestamp });
      return true;
    default:
      break;
  }
  if (!isMeta) return false;
  const label = META_LABELS.find(([pattern]) => pattern.test(text))?.[1] ?? 'System';
  entries.push({ type: 'meta', label, content: text, timestamp });
  return true;
}

/** Output tags that share a line with their command. */
function attachInlineOutput(
  text: string,
  tagBase: string,
  source: LocalCommandEntry['source'],
  entries: Entry[],
  timestamp: string | undefined,
): void {
  const stdout = tagContent(text, `${tagBase}-stdout`);
  const stderr = tagContent(text, `${tagBase}-stderr`);
  if (stdout !== undefined) attachOutput(entries, source, stdout, false, timestamp);
  if (stderr !== undefined) attachOutput(entries, source, stderr, true, timestamp);
}

function attachOutput(
  entries: Entry[],
  source: LocalCommandEntry['source'],
  raw: string,
  isError: boolean,
  timestamp: string | undefined,
): void {
  const output = stripAnsi(raw).trim();
  const last = entries.at(-1);
  if (last?.type === 'local-command' && last.source === source) {
    if (output) {
      last.output = last.output ? `${last.output}\n${output}` : output;
      if (isError) last.isError = true;
    }
    return;
  }
  if (!output) return;
  entries.push({ type: 'local-command', source, output, isError: isError || undefined, timestamp });
}
