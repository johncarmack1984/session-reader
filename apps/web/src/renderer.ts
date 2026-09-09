import type { ParsedSession, Entry, UserMessageEntry, AssistantTextEntry, ToolCallEntry, ThinkingEntry, ToolResult } from './parser.ts';
import { escapeHtml, formatDateRange, formatTime, renderMarkdown, shortPath, splitSystemReminders, toolSummary, truncate } from './utils.ts';
import { driftTotal } from './transcript/index.ts';

interface Turn {
  userMessage: UserMessageEntry | null;
  assistantEntries: Entry[];
}

function groupIntoTurns(entries: Entry[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const entry of entries) {
    if (entry.type === 'user-message') {
      current = { userMessage: entry, assistantEntries: [] };
      turns.push(current);
    } else {
      if (!current) {
        current = { userMessage: null, assistantEntries: [] };
        turns.push(current);
      }
      current.assistantEntries.push(entry);
    }
  }
  return turns;
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
    const full = result.content;
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
  }
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

  const turns = groupIntoTurns(entries);
  let turnNum = 0;
  const totalToolCalls = entries.filter(e => e.type === 'tool-call').length;

  for (const turn of turns) {
    if (turn.userMessage) {
      turnNum++;
      const marker = document.createElement('div');
      marker.className = 'turn-marker';
      marker.textContent = 'Turn ' + turnNum;
      frag.appendChild(marker);
      frag.appendChild(renderUserEntry(turn.userMessage));
    }

    const leadIdx = turn.assistantEntries.findIndex(e => e.type === 'assistant-text');
    const rest: Entry[] = [];

    for (let i = 0; i < turn.assistantEntries.length; i++) {
      const entry = turn.assistantEntries[i]!;
      if (i === leadIdx) {
        frag.appendChild(renderAssistantEntry(entry as AssistantTextEntry));
      } else {
        rest.push(entry);
      }
    }

    if (rest.length > 0) {
      const details = document.createElement('details');
      details.className = 'turn-activity';
      const summary = document.createElement('summary');
      summary.textContent = activitySummary(rest);
      details.appendChild(summary);

      const content = document.createElement('div');
      content.className = 'turn-activity-content';
      for (const entry of rest) {
        content.appendChild(renderEntry(entry, toolResults));
      }
      details.appendChild(content);
      frag.appendChild(details);
    }
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
