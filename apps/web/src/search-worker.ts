import { compileQuery, countMatches, countTranscriptMatches } from './search-core.ts';

// Content search over a dropped folder. Runs off the main thread: a folder of transcripts can be
// gigabytes, and each file is read once, scanned, and released before the next.

/** One file to search. Both sources survive structured cloning into the worker. */
export interface SearchFile {
  path: string;
  kind: 'session' | 'memory';
  source: File | FileSystemFileHandle;
}

export interface SearchRequest {
  id: number;
  query: string;
  files: SearchFile[];
}

export type SearchResponse =
  | { id: number; path: string; count: number; index: number; total: number }
  | { id: number; done: true };

async function readSource(source: File | FileSystemFileHandle): Promise<string> {
  // A handle is re-read at search time, so a session the CLI is still appending to is seen whole.
  const file = 'getFile' in source ? await source.getFile() : source;
  return file.text();
}

addEventListener('message', async (event: MessageEvent<SearchRequest>) => {
  const { id, query, files } = event.data;
  const re = compileQuery(query);
  for (let index = 0; index < files.length; index++) {
    const { path, kind, source } = files[index]!;
    let count = 0;
    if (re) {
      try {
        const text = await readSource(source);
        count = kind === 'session' ? countTranscriptMatches(text, query) : countMatches(text, re);
      } catch (e) {
        console.warn('[session-reader] search skipped an unreadable file', path, e);
      }
    }
    const response: SearchResponse = { id, path, count, index, total: files.length };
    postMessage(response);
  }
  const done: SearchResponse = { id, done: true };
  postMessage(done);
});
