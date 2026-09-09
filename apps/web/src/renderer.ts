import type {
  ParsedSession,
  Entry,
  UserMessageEntry,
  AssistantTextEntry,
  ToolCallEntry,
  ThinkingEntry,
  CompactionEntry,
  LocalCommandEntry,
  MetaEntry,
  ToolResult,
} from './parser.ts';
import { escapeHtml, formatDateRange, formatTime, renderMarkdown, shortPath, splitSystemReminders, toolSummary, truncate } from './utils.ts';
import { driftTotal } from './transcript/index.ts';
import { stripAnsi } from './text.ts';

/** What opens a segment: the human, or something injected in the human's slot. */
type Opener = UserMessageEntry | CompactionEntry | LocalCommandEntry | MetaEntry;

interface Segment {
  opener: Opener | null;
  assistantEntries: Entry[];
}

function isOpener(entry: Entry): entry is Opener {
  return (
    entry.type === 'user-message' ||
    entry.type === 'compaction' ||
    entry.type === 'local-command' ||
    entry.type === 'meta'
  );
}

function groupIntoSegments(entries: Entry[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  for (const entry of entries) {
    if (isOpener(entry)) {
      current = { opener: entry, assistantEntries: [] };
      segments.push(current);
    } else {
      if (!current) {
        current = { opener: null, assistantEntries: [] };
        segments.push(current);
      }
      current.assistantEntries.push(entry);
    }
  }
  return segments;
}

function timeEl(timestamp: string | undefined): HTMLElement | null {
  if (!timestamp) return null;
  const time = document.createElement('span');
  time.className = 'entry__time';
  time.textContent = formatTime(timestamp);
  return time;
}

function firstLine(text: string, max: number): string {
  const line = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return line.length > max ? line.slice(0, max - 1) + '…' : line;
}

function formatTokens(n: number): string {
  return n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
}

function renderCompactionEntry(entry: CompactionEntry): HTMLElement {
  const det = document.createElement('details');
  det.className = 'compaction interlude';
  const sum = document.createElement('summary');
  const parts = ['Context compacted'];
  if (entry.trigger) parts.push(entry.trigger);
  if (entry.preTokens != null) {
    parts.push(
      entry.postTokens != null
        ? formatTokens(entry.preTokens) + ' → ' + formatTokens(entry.postTokens) + ' tokens'
        : formatTokens(entry.preTokens) + ' tokens',
    );
  }
  if (entry.summary) parts.push('summary');
  sum.textContent = parts.join(' · ');
  const time = timeEl(entry.timestamp);
  if (time) sum.appendChild(time);
  det.appendChild(sum);
  if (entry.summary) {
    const c = document.createElement('div');
    c.className = 'compaction__content entry__content';
    c.innerHTML = renderMarkdown(entry.summary);
    det.appendChild(c);
  }
  return det;
}

function renderLocalCommandEntry(entry: LocalCommandEntry): HTMLElement {
  const commandText = [entry.command, entry.args].filter(Boolean).join(' ');
  const chip = document.createElement('code');
  chip.className = 'local-command__cmd';
  chip.textContent = (entry.source === 'bash' ? '! ' : '') + (commandText || 'output');

  if (!entry.output) {
    const div = document.createElement('div');
    div.className = 'local-command interlude';
    const row = document.createElement('div');
    row.className = 'local-command__row';
    row.appendChild(chip);
    const time = timeEl(entry.timestamp);
    if (time) row.appendChild(time);
    div.appendChild(row);
    return div;
  }

  const det = document.createElement('details');
  det.className = 'local-command interlude';
  const sum = document.createElement('summary');
  sum.appendChild(chip);
  const preview = document.createElement('span');
  preview.className = 'local-command__preview';
  preview.textContent = firstLine(entry.output, 80);
  sum.appendChild(preview);
  const time = timeEl(entry.timestamp);
  if (time) sum.appendChild(time);
  det.appendChild(sum);
  const out = document.createElement('div');
  out.className = 'local-command__output' + (entry.isError ? ' is-error' : '');
  out.textContent = entry.output;
  det.appendChild(out);
  return det;
}

function renderMetaEntry(entry: MetaEntry): HTMLElement {
  const det = document.createElement('details');
  det.className = 'system-block interlude';
  const sum = document.createElement('summary');
  sum.textContent = entry.label + ' · ' + firstLine(entry.content, 80);
  det.appendChild(sum);
  const pre = document.createElement('div');
  pre.className = 'system-content';
  pre.textContent = entry.content;
  det.appendChild(pre);
  return det;
}

function renderUserEntry(entry: UserMessageEntry): HTMLElement {
  const div = document.createElement('div');
  div.className = 'entry entry--user';

  const role = document.createElement('div');
  role.className = 'entry__role';
  role.textContent = 'User';
  div.appendChild(role);

  if (entry.timestamp) {
    const time = document.createElement('div');
    time.className = 'entry__time';
    time.textContent = formatTime(entry.timestamp);
    div.appendChild(time);
  }

  const parts = splitSystemReminders(entry.content);
  for (const part of parts) {
    if (part.type === 'text') {
      const c = document.createElement('div');
      c.className = 'entry__content';
      c.innerHTML = renderMarkdown(part.content);
      div.appendChild(c);
    } else {
      const det = document.createElement('details');
      det.className = 'system-block';
      const sum = document.createElement('summary');
      sum.textContent = 'System';
      det.appendChild(sum);
      const pre = document.createElement('div');
      pre.className = 'system-content';
      pre.textContent = part.content;
      det.appendChild(pre);
      div.appendChild(det);
    }
  }
  return div;
}

function renderAssistantEntry(entry: AssistantTextEntry): HTMLElement {
  const div = document.createElement('div');
  div.className = 'entry entry--assistant';
  const role = document.createElement('div');
  role.className = 'entry__role';
  role.textContent = 'Claude';
  div.appendChild(role);
  const c = document.createElement('div');
  c.className = 'entry__content';
  c.innerHTML = renderMarkdown(entry.content);
  div.appendChild(c);
  return div;
}

function renderToolEntry(entry: ToolCallEntry, toolResults: Map<string, ToolResult>): HTMLElement {
  const result = toolResults.get(entry.id);
  const det = document.createElement('details');
  det.className = 'tool-block';
  const sum = document.createElement('summary');
  const nameSpan = document.createElement('span');
  nameSpan.className = 'tool-name';
  nameSpan.textContent = entry.name;
  const summarySpan = document.createElement('span');
  summarySpan.className = 'tool-summary-text';
  summarySpan.textContent = toolSummary(entry.name, entry.input);
  sum.append(nameSpan, summarySpan);
  det.appendChild(sum);

  const body = document.createElement('div');
  body.className = 'tool-body';

  const keys = Object.keys(entry.input);
  if (keys.length > 0) {
    const inputDiv = document.createElement('div');
    inputDiv.className = 'tool-input';
    for (const key of keys) {
      const val = entry.input[key];
      const valStr = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
      const paramDiv = document.createElement('div');
      paramDiv.className = 'tool-param';
      paramDiv.innerHTML = '<span class="tool-param-key">' + escapeHtml(key) +
        ':</span> ' + escapeHtml(truncate(valStr, 1000));
      inputDiv.appendChild(paramDiv);
    }
    body.appendChild(inputDiv);
  }

  if (result) {
    const resDiv = document.createElement('div');
    resDiv.className = 'tool-result-content' + (result.isError ? ' is-error' : '');
    const full = stripAnsi(result.content);
    const MAX = 6000;
    resDiv.textContent = full.length > MAX ? full.slice(0, MAX) : full;
    body.appendChild(resDiv);
    if (full.length > MAX) {
      const more = document.createElement('div');
      more.className = 'truncated-notice';
      const remaining = full.length - MAX;
      more.textContent = `+ ${(remaining / 1000).toFixed(1)}k more characters`;
      more.addEventListener('click', () => {
        resDiv.textContent = full;
        more.hidden = true;
      });
      body.appendChild(more);
    }
  }
  det.appendChild(body);
  return det;
}

function renderThinkingEntry(entry: ThinkingEntry): HTMLElement {
  const det = document.createElement('details');
  det.className = 'thinking-block';
  const sum = document.createElement('summary');
  const preview = entry.content.slice(0, 100).replace(/\n/g, ' ');
  sum.textContent = 'Thinking: ' + preview + (entry.content.length > 100 ? '…' : '');
  det.appendChild(sum);
  const pre = document.createElement('div');
  pre.className = 'thinking-content';
  pre.textContent = entry.content;
  det.appendChild(pre);
  return det;
}

function renderEntry(entry: Entry, toolResults: Map<string, ToolResult>): HTMLElement {
  switch (entry.type) {
    case 'user-message': return renderUserEntry(entry);
    case 'assistant-text': return renderAssistantEntry(entry);
    case 'tool-call': return renderToolEntry(entry, toolResults);
    case 'thinking': return renderThinkingEntry(entry);
    case 'compaction': return renderCompactionEntry(entry);
    case 'local-command': return renderLocalCommandEntry(entry);
    case 'meta': return renderMetaEntry(entry);
  }
}

interface TurnLayout {
  /** Text before the first tool call or thinking block: "let me check…" */
  preamble: AssistantTextEntry[];
  /** Everything between: tool calls, thinking, and interstitial text. Collapsed. */
  activity: Entry[];
  /** Text after the last tool call or thinking block: the answer. Part of the chat. */
  final: AssistantTextEntry[];
}

function layoutTurn(entries: Entry[]): TurnLayout {
  let start = 0;
  while (start < entries.length && entries[start]!.type === 'assistant-text') start++;
  let end = entries.length;
  while (end > start && entries[end - 1]!.type === 'assistant-text') end--;
  if (start >= end) return { preamble: [], activity: [], final: entries as AssistantTextEntry[] };
  return {
    preamble: entries.slice(0, start) as AssistantTextEntry[],
    activity: entries.slice(start, end),
    final: entries.slice(end) as AssistantTextEntry[],
  };
}

function activitySummary(entries: Entry[]): string {
  const tools = entries.filter(e => e.type === 'tool-call').length;
  const thinking = entries.filter(e => e.type === 'thinking').length;
  const text = entries.filter(e => e.type === 'assistant-text').length;
  const parts: string[] = [];
  if (tools > 0) parts.push(`${tools} tool call${tools !== 1 ? 's' : ''}`);
  if (thinking > 0) parts.push('thinking');
  if (text > 0) parts.push(`${text} text block${text !== 1 ? 's' : ''}`);
  return parts.join(' · ') || 'activity';
}

export function renderSession({ entries, toolResults, metadata, drift }: ParsedSession): void {
  const mf = document.getElementById('meta-fields')!;
  mf.innerHTML = '';
  const addMeta = (label: string, val: string | undefined) => {
    if (!val) return;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = val;
    mf.append(dt, dd);
  };
  addMeta('date', formatDateRange(metadata.startTime, metadata.endTime));
  addMeta('cwd', metadata.cwd ? shortPath(metadata.cwd) : undefined);
  addMeta('branch', metadata.gitBranch);
  addMeta('version', metadata.version);
  addMeta('mode', metadata.permissionMode);

  const transcript = document.getElementById('transcript')!;
  transcript.innerHTML = '';
  const frag = document.createDocumentFragment();

  const segments = groupIntoSegments(entries);
  let turnNum = 0;
  const totalToolCalls = entries.filter(e => e.type === 'tool-call').length;

  for (const segment of segments) {
    const opener = segment.opener;
    if (opener?.type === 'user-message') {
      turnNum++;
      const marker = document.createElement('div');
      marker.className = 'turn-marker';
      marker.textContent = 'Turn ' + turnNum;
      frag.appendChild(marker);
      frag.appendChild(renderUserEntry(opener));
    } else if (opener) {
      frag.appendChild(renderEntry(opener, toolResults));
    }

    const layout = layoutTurn(segment.assistantEntries);

    for (const entry of layout.preamble) frag.appendChild(renderAssistantEntry(entry));

    if (layout.activity.length > 0) {
      const details = document.createElement('details');
      details.className = 'turn-activity';
      const summary = document.createElement('summary');
      summary.textContent = activitySummary(layout.activity);
      details.appendChild(summary);

      const content = document.createElement('div');
      content.className = 'turn-activity-content';
      for (const entry of layout.activity) {
        content.appendChild(renderEntry(entry, toolResults));
      }
      details.appendChild(content);
      frag.appendChild(details);
    }

    for (const entry of layout.final) frag.appendChild(renderAssistantEntry(entry));
  }

  const stats = document.createElement('div');
  stats.className = 'stats';
  const duration = metadata.startTime && metadata.endTime
    ? Math.round((new Date(metadata.endTime).getTime() - new Date(metadata.startTime).getTime()) / 1000)
    : null;
  const durationStr = duration != null
    ? (duration >= 60 ? Math.floor(duration / 60) + 'm ' + (duration % 60) + 's' : duration + 's')
    : '';
  const driftCount = driftTotal(drift);
  stats.textContent = [
    turnNum + ' turns',
    totalToolCalls + ' tool calls',
    durationStr ? durationStr + ' duration' : '',
    driftCount ? driftCount + ' schema drift finding' + (driftCount !== 1 ? 's' : '') + ' (see console)' : '',
  ].filter(Boolean).join('  ·  ');
  frag.appendChild(stats);

  transcript.appendChild(frag);
}
