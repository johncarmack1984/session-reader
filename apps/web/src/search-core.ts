import { parseSession, type Entry, type ParsedSession } from './parser.ts';
import { stripAnsi } from './text.ts';

// Matching that both the in-session find and the folder search share. DOM-free, so it
// runs in the page, in the search worker, and under node:test.

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive literal matcher for `query`, or null when there is nothing to look for. */
export function compileQuery(query: string): RegExp | null {
  return query ? new RegExp(escapeRegExp(query), 'gi') : null;
}

/**
 * The query as it appears inside a raw JSONL line: JSON string escaping applied, quotes dropped.
 * Claude Code writes transcripts with JSON.stringify, so any match in decoded content is present
 * in the raw line in exactly this form. That makes a raw scan a safe pre-filter before parsing.
 */
export function compileRawQuery(query: string): RegExp | null {
  return query ? new RegExp(escapeRegExp(JSON.stringify(query).slice(1, -1)), 'gi') : null;
}

export function countMatches(text: string, re: RegExp): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) n++;
  return n;
}

/**
 * The distinct lines of `text` that contain a match, in file order. Splits on `\n` only, for
 * the reason given in scripts/jsonl.ts: JSON permits U+2028 and U+2029 unescaped inside strings.
 */
export function rawHitLines(text: string, rawRe: RegExp): string[] {
  const lines: string[] = [];
  rawRe.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rawRe.exec(text)) !== null) {
    const start = text.lastIndexOf('\n', m.index) + 1;
    let end = text.indexOf('\n', m.index);
    if (end === -1) end = text.length;
    lines.push(text.slice(start, end));
    rawRe.lastIndex = end;
  }
  return lines;
}

/** Every string the reader shows for an entry, in the form it shows it. */
export function entryTexts(entry: Entry): string[] {
  switch (entry.type) {
    case 'user-message':
    case 'assistant-text':
    case 'thinking':
    case 'meta':
      return [entry.content];
    case 'tool-call':
      return [
        entry.name,
        ...Object.entries(entry.input).map(
          ([key, val]) => `${key}: ${typeof val === 'string' ? val : JSON.stringify(val, null, 2)}`,
        ),
      ];
    case 'compaction':
      return entry.summary ? [entry.summary] : [];
    case 'local-command':
      return [entry.command, entry.args, entry.output].filter((s): s is string => typeof s === 'string');
  }
}

export function countSessionMatches(parsed: ParsedSession, re: RegExp): number {
  let n = 0;
  for (const entry of parsed.entries) {
    for (const text of entryTexts(entry)) n += countMatches(text, re);
  }
  for (const result of parsed.toolResults.values()) n += countMatches(stripAnsi(result.content), re);
  return n;
}

/**
 * Match count for a whole transcript. Only the lines a raw scan flags are parsed, so a 100 MB
 * session costs one regex pass plus the parse of its few hit lines. Lines the reader does not
 * show, such as file-history snapshots, parse to no entries and count nothing.
 */
export function countTranscriptMatches(text: string, query: string): number {
  const rawRe = compileRawQuery(query);
  const re = compileQuery(query);
  if (!rawRe || !re) return 0;
  const lines = rawHitLines(text, rawRe);
  if (lines.length === 0) return 0;
  return countSessionMatches(parseSession(lines.join('\n')), re);
}

/** Index of the last segment whose start is at or before `offset`; -1 before the first. */
export function segmentAt(starts: ReadonlyArray<number>, offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! <= offset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
