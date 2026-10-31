import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compileQuery,
  compileRawQuery,
  countMatches,
  countSessionMatches,
  countTranscriptMatches,
  rawHitLines,
  segmentAt,
} from '../src/search-core.ts';
import { parseSession } from '../src/parser.ts';

// Synthetic fixtures only. Real transcripts carry private content and never belong in the repo.

function envelope(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: 'u1',
    parentUuid: null,
    timestamp: '2026-09-09T12:00:00.000Z',
    sessionId: 's1',
    isSidechain: false,
    userType: 'external',
    entrypoint: 'cli',
    cwd: '/work/repo',
    version: '2.1.266',
    gitBranch: 'main',
    ...over,
  };
}

function userLine(content: unknown, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...envelope(), type: 'user', message: { role: 'user', content }, ...over };
}

function assistantLine(content: unknown[]): Record<string, unknown> {
  return {
    ...envelope(),
    type: 'assistant',
    requestId: 'req_1',
    message: {
      role: 'assistant',
      type: 'message',
      id: 'msg_1',
      model: 'claude-fable-5-1',
      content,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  };
}

const jsonl = (...lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n');

test('compileQuery is a case-insensitive literal: regex metacharacters are escaped', () => {
  assert.equal(compileQuery(''), null);
  const re = compileQuery('a.b(c)')!;
  assert.equal(countMatches('A.B(C) axb(c) a.b(c)', re), 2);
  assert.equal(countMatches('aaa', compileQuery('aa')!), 1, 'matches do not overlap');
});

test('compileRawQuery matches the JSON-escaped form a transcript line carries', () => {
  const query = 'say "hi"\\now';
  const raw = JSON.stringify({ text: `please ${query} please` });
  assert.equal(countMatches(raw, compileQuery(query)!), 0, 'the plain query misses the escaped line');
  assert.equal(countMatches(raw, compileRawQuery(query)!), 1);
  assert.equal(countMatches(raw.toUpperCase(), compileRawQuery(query)!), 1, 'case-insensitive');
});

test('rawHitLines returns each hit line once, split on newline only', () => {
  const l1 = JSON.stringify({ t: 'needle one, needle two' });
  const l2 = JSON.stringify({ t: 'hay' });
  const l3 = JSON.stringify({ t: 'before NEEDLE after' });
  const text = `${l1}\n${l2}\r\n${l3}`;
  const lines = rawHitLines(text, compileRawQuery('needle')!);
  assert.deepEqual(lines, [l1, l3]);
  assert.deepEqual(rawHitLines(text, compileRawQuery('absent')!), []);
});

test('countSessionMatches counts what the reader shows: entries and tool results', () => {
  const text = jsonl(
    userLine('Find the needle in the <system-reminder>a needle reminder</system-reminder>'),
    assistantLine([
      { type: 'thinking', thinking: 'where is the needle', signature: 'sig' },
      { type: 'text', text: 'Looking for the Needle.' },
      { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'grep needle src', description: 'Search' } },
    ]),
    userLine([{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'src/a.ts: needle\nsrc/b.ts: NEEDLE' }]),
  );
  const parsed = parseSession(text);
  assert.equal(countSessionMatches(parsed, compileQuery('needle')!), 7);
  assert.equal(countSessionMatches(parsed, compileQuery('toolu_1')!), 0, 'ids are not content');
});

test('countTranscriptMatches parses only hit lines and ignores lines the reader does not show', () => {
  const snapshot = {
    type: 'file-history-snapshot',
    messageId: 'm1',
    snapshot: { messageId: 'm1', trackedFileBackups: { 'a.ts': { backupFileName: 'needle.bak', version: 1, backupTime: '2026-09-09T12:00:00.000Z' } }, timestamp: '2026-09-09T12:00:00.000Z' },
    isSnapshotUpdate: false,
  };
  const text = jsonl(
    snapshot,
    userLine('no hit here'),
    assistantLine([{ type: 'text', text: 'needle, and a second needle' }]),
    userLine([{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'Needle' }]),
  );
  assert.equal(countTranscriptMatches(text, 'needle'), 3);
  assert.equal(countTranscriptMatches(text, 'NEEDLE'), 3);
  assert.equal(countTranscriptMatches(text, 'no hit here'), 1);
  assert.equal(countTranscriptMatches(text, 'messageId'), 0, 'keys of lines the reader skips never count');
  assert.equal(countTranscriptMatches(text, ''), 0);
});

test('countTranscriptMatches agrees with a full parse', () => {
  const text = jsonl(
    userLine('alpha beta'),
    assistantLine([{ type: 'text', text: 'beta gamma' }, { type: 'text', text: 'delta' }]),
    userLine('beta again'),
  );
  const full = countSessionMatches(parseSession(text), compileQuery('beta')!);
  assert.equal(countTranscriptMatches(text, 'beta'), full);
  assert.equal(full, 3);
});

test('segmentAt finds the segment containing an offset', () => {
  const starts = [0, 5, 12];
  assert.equal(segmentAt(starts, 0), 0);
  assert.equal(segmentAt(starts, 4), 0);
  assert.equal(segmentAt(starts, 5), 1);
  assert.equal(segmentAt(starts, 11), 1);
  assert.equal(segmentAt(starts, 12), 2);
  assert.equal(segmentAt(starts, 100), 2);
  assert.equal(segmentAt([], 3), -1);
  assert.equal(segmentAt([4], 3), -1);
});
