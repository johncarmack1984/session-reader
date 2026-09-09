export function escapeHtml(str: string): string {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max);
}

export function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export function formatDate(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function formatDateRange(start?: string, end?: string): string | undefined {
  if (!start) return undefined;
  const startDate = formatDate(start);
  if (!end) return startDate;
  const endDate = formatDate(end);
  if (startDate === endDate) return startDate;
  return `${startDate} – ${endDate}`;
}

export function shortPath(p: string): string {
  if (!p) return '';
  const home = p.indexOf('/Users/');
  if (home >= 0) {
    return p.slice(home).replace(/^\/Users\/[^/]+/, '~');
  }
  return p;
}

interface TextPart {
  type: 'text';
  content: string;
}

interface SystemPart {
  type: 'system';
  content: string;
}

export type ContentPart = TextPart | SystemPart;

export function splitSystemReminders(text: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const re = /<system-reminder>\s*([\s\S]*?)\s*<\/system-reminder>/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index).trim();
    if (before) parts.push({ type: 'text', content: before });
    parts.push({ type: 'system', content: m[1]! });
    last = m.index + m[0].length;
  }
  const after = text.slice(last).trim();
  if (after) parts.push({ type: 'text', content: after });
  return parts.length ? parts : [{ type: 'text', content: text }];
}

import { marked } from 'marked';

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }: { text: string; lang?: string }) =>
  `<pre class="code-block"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(text)}</pre>`;
renderer.codespan = ({ text }: { text: string }) =>
  `<code class="inline-code">${text}</code>`;

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true,
});

export function renderMarkdown(text: string): string {
  return marked.parse(text) as string;
}

export function toolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return input.file_path ? shortPath(input.file_path as string) : '';
    case 'Bash':
      return ((input.command as string) || '').slice(0, 80);
    case 'WebFetch':
      return ((input.url as string) || '').slice(0, 80);
    case 'WebSearch':
      return ((input.query as string) || '').slice(0, 60);
    case 'Agent':
      return (input.description as string) || (input.prompt as string)?.slice(0, 60) || '';
    case 'Workflow':
      return (input.name as string) || (input.description as string) || '';
    case 'Artifact':
      return (input.action as string) || (input.file_path as string) || '';
    default: {
      const vals = Object.values(input);
      const first = vals.find((v): v is string => typeof v === 'string');
      return first ? first.slice(0, 60) : '';
    }
  }
}
