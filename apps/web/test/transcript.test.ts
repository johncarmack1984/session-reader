import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DriftCollector,
  KNOWN_BLOCK_TYPES,
  KnownBlock,
  LINE_SCHEMAS,
  LINE_SCHEMA_BY_TYPE,
  formatPath,
  parseLine,
  parseTranscript,
} from '../src/transcript/index.ts';
import { parseSession } from '../src/parser.ts';

// Synthetic fixtures only. Real transcripts carry private content and never belong in the repo.

const VERSION = '2.1.266';

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
    version: VERSION,
    gitBranch: 'main',
    ...over,
  };
}

function userLine(content: unknown, over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...envelope(), type: 'user', message: { role: 'user', content }, ...over };
}

function assistantLine(content: unknown[], over: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...over,
  };
}

const J = (o: unknown) => JSON.stringify(o);

function observe(...lines: unknown[]) {
  const drift = new DriftCollector();
  const results = lines.map((l) => {
    const r = parseLine(typeof l === 'string' ? l : J(l));
    drift.observe(r);
    return r;
  });
  return { results, report: drift.report() };
}

test('registry has one schema per discriminant and matches the block type set', () => {
  assert.equal(LINE_SCHEMA_BY_TYPE.size, LINE_SCHEMAS.length);
  const blockLiterals = new Set(KnownBlock.def.options.map((o) => o.shape.type.def.values[0]));
  assert.deepEqual([...blockLiterals].sort(), [...KNOWN_BLOCK_TYPES].sort());
});

test('formatPath collapses array indices', () => {
  assert.equal(formatPath(['message', 'content', 3, 'text']), 'message.content[].text');
  assert.equal(formatPath([]), '');
});

test('a plain user line parses as known with no drift', () => {
  const { results, report } = observe(userLine('hello'));
  const r = results[0]!;
  assert.equal(r.status, 'known');
  if (r.status !== 'known') return;
  assert.equal(r.line.type, 'user');
  assert.equal(report.lines, 1);
  assert.deepEqual(report.versions, [VERSION]);
  assert.equal(report.unknownKeys.length + report.unknownLineTypes.length + report.invalid.length, 0);
});

test('an unknown line type is kept whole and reported', () => {
  const { results, report } = observe({ type: 'brand-new', sessionId: 's1', payload: { a: 1 } });
  const r = results[0]!;
  assert.equal(r.status, 'unknown');
  if (r.status !== 'unknown') return;
  assert.deepEqual(r.line.payload, { a: 1 });
  assert.equal(report.unknownLineTypes.length, 1);
  assert.equal(report.unknownLineTypes[0]!.name, 'brand-new');
  assert.deepEqual(report.unknownLineTypes[0]!.sample, ['type', 'sessionId', 'payload']);
});

test('an unknown top-level key is stripped from the typed line and reported with its path', () => {
  const { results, report } = observe(assistantLine([{ type: 'text', text: 'hi' }], { zzz: true }));
  const r = results[0]!;
  assert.equal(r.status, 'known');
  if (r.status !== 'known') return;
  assert.equal('zzz' in r.line, false);
  assert.deepEqual(
    report.unknownKeys.map((f) => f.name),
    ['assistant.zzz'],
  );
});

test('an unknown key inside a known block is reported with the block type tagged', () => {
  const { report } = observe(
    assistantLine([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' }, zzz: 1 }]),
  );
  assert.deepEqual(
    report.unknownKeys.map((f) => f.name),
    ['assistant.message.content[]<tool_use>.zzz'],
  );
});

test('an unknown block type keeps the line, is reported once, and its keys are not "unknown keys"', () => {
  const { results, report } = observe(
    assistantLine([
      { type: 'text', text: 'ok' },
      { type: 'shiny', glow: 3, hue: 'red' },
    ]),
  );
  assert.equal(results[0]!.status, 'known');
  assert.deepEqual(
    report.unknownBlockTypes.map((f) => [f.name, f.sample]),
    [['shiny', ['type', 'glow', 'hue']]],
  );
  assert.equal(report.unknownKeys.length, 0);
});

test('a known block type with a bad shape fails the line with an informative issue', () => {
  const { results, report } = observe(assistantLine([{ type: 'text' }]));
  const r = results[0]!;
  assert.equal(r.status, 'invalid');
  if (r.status !== 'invalid') return;
  assert.equal(r.type, 'assistant');
  assert.ok(r.issues.some((i) => i.path === 'message.content[].text' && i.code === 'invalid_type'), J(r.issues));
  assert.equal(report.invalid.length, 1);
  assert.match(report.invalid[0]!.name, /^assistant: message\.content\[\]\.text invalid_type$/);
});

test('a known line missing a required field is invalid, not unknown', () => {
  const { results, report } = observe({ ...envelope(), type: 'user' });
  assert.equal(results[0]!.status, 'invalid');
  assert.equal(report.invalid[0]!.name, 'user: message invalid_type');
});

test('unparseable lines are counted and never throw', () => {
  const { results, report } = observe('{not json', '[1,2]');
  assert.equal(results[0]!.status, 'unparseable');
  assert.equal(results[1]!.status, 'unparseable');
  assert.equal(report.unparseable, 2);
});

test('loose sub-objects are opaque to the key walker', () => {
  const { report } = observe(userLine('x', { origin: { kind: 'human', weird: 1 } }));
  assert.equal(report.unknownKeys.length, 0);
});

test('system subtypes and attachment types outside the known sets are reported', () => {
  const { report } = observe(
    { ...envelope(), type: 'system', subtype: 'turn_duration', durationMs: 5, isMeta: true },
    { ...envelope(), type: 'system', subtype: 'new_subtype' },
    { ...envelope(), type: 'attachment', attachment: { type: 'task_reminder' } },
    { ...envelope(), type: 'attachment', attachment: { type: 'new_attachment', body: 'x' } },
  );
  assert.deepEqual(report.unknownSystemSubtypes.map((f) => f.name), ['new_subtype']);
  assert.deepEqual(report.unknownAttachmentTypes.map((f) => f.name), ['new_attachment']);
  assert.equal(report.invalid.length, 0);
});

test('legacy shapes parse without drift', () => {
  const { results, report } = observe(
    { type: 'summary', summary: 'Old style title', leafUuid: 'u9' },
    assistantLine([{ type: 'text', text: 'a' }], { costUSD: 0.01, durationMs: 1200, version: '2.0.40' }),
    { ...envelope({ version: '1.0.50', gitBranch: undefined, entrypoint: undefined }), type: 'user', message: { role: 'user', content: 'old' } },
  );
  assert.deepEqual(results.map((r) => r.status), ['known', 'known', 'known']);
  assert.equal(report.unknownKeys.length + report.invalid.length, 0);
  assert.deepEqual(report.versions, ['1.0.50', '2.0.40']);
});

test('findings record the version range they were seen under, regardless of order', () => {
  const { report } = observe(
    assistantLine([{ type: 'text', text: 'a' }], { zzz: 1, version: '2.1.266' }),
    assistantLine([{ type: 'text', text: 'b' }], { zzz: 2, version: '2.1.153' }),
    assistantLine([{ type: 'text', text: 'c' }], { zzz: 3, version: '2.1.200' }),
  );
  const f = report.unknownKeys[0]!;
  assert.equal(f.count, 3);
  assert.equal(f.firstVersion, '2.1.153');
  assert.equal(f.lastVersion, '2.1.266');
});

test('metadata lines inherit the last version seen in the stream', () => {
  const { report } = observe(
    userLine('x', { version: '2.1.180' }),
    { type: 'never-seen', sessionId: 's1' },
  );
  assert.equal(report.unknownLineTypes[0]!.firstVersion, '2.1.180');
});

test('parseTranscript skips blank lines and feeds the collector', () => {
  const drift = new DriftCollector();
  const results = parseTranscript(`${J(userLine('a'))}\n\n${J(userLine('b'))}\n`, drift);
  assert.equal(results.length, 2);
  assert.equal(drift.report().lines, 2);
});

test('parseSession builds entries, tool results, and metadata from a synthetic transcript', () => {
  const lines = [
    { type: 'permission-mode', permissionMode: 'auto', sessionId: 's1' },
    { type: 'ai-title', aiTitle: 'Generated title', sessionId: 's1' },
    { type: 'custom-title', customTitle: 'My title', sessionId: 's1' },
    userLine('Please list files', { timestamp: '2026-09-09T12:00:00.000Z' }),
    assistantLine(
      [
        { type: 'thinking', thinking: 'plan', signature: 'sig' },
        { type: 'tool_use', id: 'tool_1', name: 'Bash', input: { command: 'ls' } },
      ],
      { timestamp: '2026-09-09T12:00:01.000Z' },
    ),
    userLine(
      [{ type: 'tool_result', tool_use_id: 'tool_1', content: [{ type: 'text', text: 'a.txt' }, { type: 'text', text: 'b.txt' }] }],
      { timestamp: '2026-09-09T12:00:01.500Z' },
    ),
    assistantLine([{ type: 'text', text: 'Two files.' }], { timestamp: '2026-09-09T12:00:02.000Z' }),
    userLine(
      [
        { type: 'text', text: 'Here is a screenshot' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      ],
      { timestamp: '2026-09-09T12:00:03.000Z' },
    ),
    userLine([{ type: 'tool_result', tool_use_id: 'tool_2', content: 'boom', is_error: true }], {
      timestamp: '2026-09-09T12:00:04.000Z',
    }),
    { type: 'last-prompt', leafUuid: 'u1', sessionId: 's1' },
  ];
  const parsed = parseSession(lines.map(J).join('\n'));

  assert.deepEqual(
    parsed.entries.map((e) => e.type),
    ['user-message', 'thinking', 'tool-call', 'assistant-text', 'user-message'],
  );
  const screenshotEntry = parsed.entries[4]!;
  assert.equal(screenshotEntry.type === 'user-message' ? screenshotEntry.content : undefined, 'Here is a screenshot');
  assert.deepEqual(parsed.toolResults.get('tool_1'), { content: 'a.txt\nb.txt', isError: false });
  assert.deepEqual(parsed.toolResults.get('tool_2'), { content: 'boom', isError: true });
  assert.equal(parsed.metadata.cwd, '/work/repo');
  assert.equal(parsed.metadata.version, VERSION);
  assert.equal(parsed.metadata.gitBranch, 'main');
  assert.equal(parsed.metadata.permissionMode, 'auto');
  assert.equal(parsed.metadata.title, 'My title');
  assert.equal(parsed.metadata.startTime, '2026-09-09T12:00:00.000Z');
  assert.equal(parsed.metadata.endTime, '2026-09-09T12:00:04.000Z');
  assert.equal(parsed.drift.lines, lines.length);
  assert.equal(
    parsed.drift.unknownKeys.length + parsed.drift.unknownLineTypes.length + parsed.drift.invalid.length,
    0,
  );
});

test('parseSession falls back to the generated title when there is no custom one', () => {
  const parsed = parseSession([{ type: 'ai-title', aiTitle: 'Generated', sessionId: 's1' }, userLine('x')].map(J).join('\n'));
  assert.equal(parsed.metadata.title, 'Generated');
});
