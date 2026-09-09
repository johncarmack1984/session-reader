import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLines } from '../scripts/jsonl.ts';

async function collect(path: string): Promise<string[]> {
  const out: string[] = [];
  for await (const line of readLines(path)) out.push(line);
  return out;
}

test('readLines splits on newline only and keeps U+2028/U+2029 inside a line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-reader-'));
  try {
    const path = join(dir, 'a.jsonl');
    const withSeparators = JSON.stringify({ text: 'before middle after' });
    writeFileSync(path, `${withSeparators}\r\n{"b":1}\n{"trailing":true}`);
    const lines = await collect(path);
    assert.equal(lines.length, 3);
    assert.deepEqual(JSON.parse(lines[0]!), { text: 'before middle after' });
    assert.deepEqual(JSON.parse(lines[1]!), { b: 1 });
    assert.deepEqual(JSON.parse(lines[2]!), { trailing: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readLines reassembles a line that straddles stream chunks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'session-reader-'));
  try {
    const path = join(dir, 'big.jsonl');
    const big = JSON.stringify({ pad: 'é'.repeat(200_000) });
    writeFileSync(path, `${big}\n${big}\n`);
    const lines = await collect(path);
    assert.equal(lines.length, 2);
    assert.equal(lines[0], big);
    assert.equal(lines[1], big);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
