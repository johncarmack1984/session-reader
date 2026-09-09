import {
  DriftCollector,
  isKnownBlock,
  parseTranscript,
  type AssistantLine,
  type DriftReport,
  type Envelope,
  type ToolResultBlock,
  type UserLine,
} from './transcript/index.ts';

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

export type Entry = UserMessageEntry | AssistantTextEntry | ToolCallEntry | ThinkingEntry;

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
  if (typeof content === 'string') {
    entries.push({ type: 'user-message', content, timestamp });
    return;
  }
  const texts: string[] = [];
  for (const block of content) {
    if (!isKnownBlock(block)) continue;
    if (block.type === 'text') {
      texts.push(block.text);
    } else if (block.type === 'tool_result') {
      toolResults.set(block.tool_use_id, { content: toolResultText(block), isError: block.is_error === true });
    }
  }
  if (texts.length) entries.push({ type: 'user-message', content: texts.join('\n\n'), timestamp });
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
