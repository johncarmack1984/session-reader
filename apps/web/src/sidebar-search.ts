import { flattenFiles, type ScanResult, type SessionFile } from './explorer.ts';
import type { SearchRequest, SearchResponse } from './search-worker.ts';

// The sidebar's search box. Typing filters the tree by path. Enter searches file contents in a
// worker, which reads each file once and reports a match count; the tree keeps only the hits.

type Mode = 'idle' | 'filter' | 'content';

export interface SidebarSearch {
  /** A folder was opened and its trees rendered: index the file buttons and clear any search. */
  setFolder(result: ScanResult): void;
  /** The query whose content hits the tree is showing, or null when it is not filtered by content. */
  readonly contentQuery: string | null;
}

export interface SidebarSearchOptions {
  input: HTMLInputElement;
  status: HTMLElement;
  trees: HTMLElement[];
}

export function createSidebarSearch(opts: SidebarSearchOptions): SidebarSearch {
  const { input, status, trees } = opts;
  const statusText = document.createElement('span');
  const statusButton = document.createElement('button');
  statusButton.type = 'button';
  status.append(statusText, statusButton);

  let files: SessionFile[] = [];
  let buttons = new Map<string, HTMLElement>();
  let mode: Mode = 'idle';
  let query = '';
  let worker: Worker | null = null;
  let requestId = 0;
  let results = new Map<string, number>();
  let processed = 0;
  let done = false;

  function cancel(): void {
    worker?.terminate();
    worker = null;
  }

  function visible(path: string): boolean {
    switch (mode) {
      case 'idle':
        return true;
      case 'filter':
        return path.toLowerCase().includes(query.toLowerCase());
      case 'content': {
        // Files the worker has not reached stay visible until the search ends.
        const n = results.get(path);
        return n === undefined ? !done : n > 0;
      }
    }
  }

  function setHits(btn: HTMLElement, n: number | undefined): void {
    let hits = btn.querySelector<HTMLElement>('.tree-file-hits');
    if (!n) {
      hits?.remove();
      return;
    }
    if (!hits) {
      hits = document.createElement('span');
      hits.className = 'tree-file-hits';
      btn.appendChild(hits);
    }
    hits.textContent = `${n} match${n === 1 ? '' : 'es'}`;
  }

  function applyFile(path: string, btn: HTMLElement): void {
    btn.hidden = !visible(path);
    setHits(btn, mode === 'content' ? results.get(path) : undefined);
  }

  function applyFolders(): void {
    for (const tree of trees) {
      for (const folder of tree.querySelectorAll<HTMLElement>('.tree-folder')) {
        folder.hidden = !folder.querySelector('.tree-file:not([hidden])');
      }
      const hasFiles = tree.querySelector('.tree-file') !== null;
      const none = hasFiles && !tree.querySelector('.tree-file:not([hidden])');
      let empty = tree.querySelector<HTMLElement>('.tree-empty--search');
      if (none && !empty) {
        empty = document.createElement('div');
        empty.className = 'tree-empty tree-empty--search';
        empty.textContent = 'No matches';
        tree.appendChild(empty);
      } else if (!none && empty) {
        empty.remove();
      }
    }
  }

  function renderStatus(): void {
    if (mode === 'idle') {
      status.hidden = true;
      return;
    }
    status.hidden = false;
    if (mode === 'filter') {
      let shown = 0;
      for (const path of buttons.keys()) if (visible(path)) shown++;
      statusText.textContent = `${shown} of ${buttons.size} · Enter searches contents`;
      statusButton.textContent = '×';
      statusButton.title = 'Clear filter';
      return;
    }
    if (!done) {
      statusText.textContent = `Searching… ${processed} / ${files.length}`;
      statusButton.textContent = 'Cancel';
      statusButton.title = 'Cancel search';
      return;
    }
    const hit = (kind: SessionFile['fileType']) =>
      files.filter((f) => f.fileType === kind && (results.get(f.relativePath) ?? 0) > 0).length;
    const sessions = hit('session');
    const memories = hit('memory');
    const parts: string[] = [];
    if (sessions) parts.push(`${sessions} session${sessions === 1 ? '' : 's'}`);
    if (memories) parts.push(`${memories} memor${memories === 1 ? 'y' : 'ies'}`);
    statusText.textContent = parts.length ? parts.join(' · ') : 'No matches';
    statusButton.textContent = '×';
    statusButton.title = 'Clear search';
  }

  function apply(): void {
    for (const [path, btn] of buttons) applyFile(path, btn);
    applyFolders();
    renderStatus();
  }

  function reset(): void {
    cancel();
    input.value = '';
    mode = 'idle';
    query = '';
    results = new Map();
    apply();
  }

  function setFolder(result: ScanResult): void {
    files = [...flattenFiles(result.sessions), ...flattenFiles(result.memories)];
    buttons = new Map();
    for (const tree of trees) {
      for (const btn of tree.querySelectorAll<HTMLElement>('.tree-file')) {
        if (btn.dataset.path) buttons.set(btn.dataset.path, btn);
      }
    }
    reset();
  }

  function startContentSearch(q: string): void {
    cancel();
    mode = 'content';
    query = q;
    results = new Map();
    processed = 0;
    done = false;
    const id = ++requestId;
    const w = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    w.addEventListener('message', (event: MessageEvent<SearchResponse>) => {
      const msg = event.data;
      if (msg.id !== id) return;
      if ('done' in msg) {
        done = true;
        cancel();
        apply();
        return;
      }
      results.set(msg.path, msg.count);
      processed = msg.index + 1;
      const btn = buttons.get(msg.path);
      if (btn) applyFile(msg.path, btn);
      if (msg.count === 0) applyFolders();
      renderStatus();
    });
    w.addEventListener('error', (event) => {
      console.error('[session-reader] search worker failed', event.message);
      done = true;
      cancel();
      apply();
    });
    const request: SearchRequest = {
      id,
      query: q,
      files: files.map((f) => ({ path: f.relativePath, kind: f.fileType, source: f.source })),
    };
    w.postMessage(request);
    apply();
  }

  input.addEventListener('input', () => {
    cancel();
    results = new Map();
    query = input.value.trim();
    mode = query ? 'filter' : 'idle';
    apply();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = input.value.trim();
      if (q) startContentSearch(q);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      reset();
    }
  });
  statusButton.addEventListener('click', reset);

  return {
    setFolder,
    get contentQuery() {
      return mode === 'content' ? query : null;
    },
  };
}
