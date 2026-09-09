import { createReadStream } from 'node:fs';

/**
 * Stream a file line by line, splitting on `\n` only (a trailing `\r` is dropped).
 *
 * `node:readline` is the obvious tool and the wrong one: it also breaks on
 * U+2028 and U+2029, which JSON allows unescaped inside strings, so a transcript
 * that quotes those characters gets torn into unparseable fragments.
 */
export async function* readLines(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path, { encoding: 'utf8' });
  let carry = '';
  for await (const chunk of stream) {
    const parts = (carry + (chunk as string)).split('\n');
    carry = parts.pop() ?? '';
    for (const part of parts) yield part.endsWith('\r') ? part.slice(0, -1) : part;
  }
  if (carry) yield carry.endsWith('\r') ? carry.slice(0, -1) : carry;
}
