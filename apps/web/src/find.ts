import { compileQuery, segmentAt } from './search-core.ts';
import { revealTail } from './renderer.ts';

// Find in the rendered session. Matching runs over the transcript's text, so it reaches collapsed
// blocks, folded system reminders, and the hidden tail of a truncated tool result, none of which
// the browser's own find can see. Derived UI text (previews, labels, counters) is skipped, so a
// match counts once, where the content is.

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

const INLINE_TAGS = new Set([
  'A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DEL', 'DFN', 'EM', 'I', 'INS',
  'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'WBR',
]);

const SKIP_SELECTOR = [
  '.find-badge',
  '.turn-marker',
  '.stats',
  '.entry__role',
  '.entry__time',
  '.tool-summary-text',
  '.local-command__preview',
  '.thinking-block > summary',
  '.turn-activity > summary',
  '.system-block > summary',
  '.compaction > summary',
].join(', ');

interface TextIndex {
  /** Every searchable text node's data, concatenated, with a newline between blocks. */
  text: string;
  nodes: Text[];
  /** Offset of each node's data in `text`. */
  starts: number[];
}

/** One match's slice of one text node. A match that crosses inline elements has several. */
interface Piece {
  node: Text;
  from: number;
  to: number;
}

/** The nearest ancestor that starts a new line: text in different blocks never joins into one match. */
function blockOf(node: Text): Element | null {
  let el = node.parentElement;
  while (el && INLINE_TAGS.has(el.tagName)) el = el.parentElement;
  return el;
}

function indexText(root: HTMLElement): TextIndex {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  const nodes: Text[] = [];
  const starts: number[] = [];
  let length = 0;
  let lastBlock: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || !node.data) continue;
    if (node.parentElement?.closest(SKIP_SELECTOR)) continue;
    const block = blockOf(node);
    if (lastBlock && block !== lastBlock) {
      parts.push('\n');
      length += 1;
    }
    lastBlock = block;
    nodes.push(node);
    starts.push(length);
    parts.push(node.data);
    length += node.data.length;
  }
  return { text: parts.join(''), nodes, starts };
}

function piecesFor(index: TextIndex, start: number, end: number): Piece[] {
  const pieces: Piece[] = [];
  let i = Math.max(0, segmentAt(index.starts, start));
  for (; i < index.nodes.length && index.starts[i]! < end; i++) {
    const node = index.nodes[i]!;
    const base = index.starts[i]!;
    const from = Math.max(0, start - base);
    const to = Math.min(node.data.length, end - base);
    if (to > from) pieces.push({ node, from, to });
  }
  return pieces;
}

interface Highlighter {
  /** True when highlighting rewrites text nodes, which invalidates the text index. */
  readonly mutatesDom: boolean;
  apply(matches: Piece[][]): void;
  setCurrent(i: number): void;
  /** An element at the start of match `i`, for opening its ancestors and scrolling. */
  anchor(i: number): Element | null;
  rect(i: number): DOMRect | null;
  clear(): void;
}

/** CSS Custom Highlight API: the browser paints ranges, and the DOM is untouched. */
class RangeHighlighter implements Highlighter {
  readonly mutatesDom = false;
  private ranges: Range[] = [];

  apply(matches: Piece[][]): void {
    const hits = new Highlight();
    this.ranges = matches.map((pieces) => {
      const first = pieces[0]!;
      const last = pieces[pieces.length - 1]!;
      const range = new Range();
      range.setStart(first.node, first.from);
      range.setEnd(last.node, last.to);
      hits.add(range);
      return range;
    });
    CSS.highlights.set('find-hit', hits);
  }

  setCurrent(i: number): void {
    const range = this.ranges[i];
    if (!range) return;
    const current = new Highlight(range);
    current.priority = 1;
    CSS.highlights.set('find-current', current);
  }

  anchor(i: number): Element | null {
    return this.ranges[i]?.startContainer.parentElement ?? null;
  }

  rect(i: number): DOMRect | null {
    return this.ranges[i]?.getBoundingClientRect() ?? null;
  }

  clear(): void {
    CSS.highlights.delete('find-hit');
    CSS.highlights.delete('find-current');
    this.ranges = [];
  }
}

/** Fallback for browsers without the Highlight API: each match is wrapped in a <mark>. */
class MarkHighlighter implements Highlighter {
  readonly mutatesDom = true;
  private marks: HTMLElement[][] = [];

  constructor(private readonly root: HTMLElement) {}

  apply(matches: Piece[][]): void {
    this.marks = matches.map(() => []);
    // Last match first: splitting a text node only moves the text after the split, so the
    // offsets of everything before it stay valid.
    for (let i = matches.length - 1; i >= 0; i--) {
      const pieces = matches[i]!;
      for (let p = pieces.length - 1; p >= 0; p--) {
        const { node, from, to } = pieces[p]!;
        if (to < node.data.length) node.splitText(to);
        const target = from > 0 ? node.splitText(from) : node;
        const mark = document.createElement('mark');
        mark.className = 'find-hit';
        target.replaceWith(mark);
        mark.appendChild(target);
        this.marks[i]!.unshift(mark);
      }
    }
  }

  setCurrent(i: number): void {
    for (const mark of this.root.querySelectorAll('mark.find-current')) mark.classList.remove('find-current');
    for (const mark of this.marks[i] ?? []) mark.classList.add('find-current');
  }

  anchor(i: number): Element | null {
    return this.marks[i]?.[0] ?? null;
  }

  rect(i: number): DOMRect | null {
    return this.marks[i]?.[0]?.getBoundingClientRect() ?? null;
  }

  clear(): void {
    for (const mark of this.root.querySelectorAll('mark.find-hit')) mark.replaceWith(...mark.childNodes);
    this.root.normalize();
    this.marks = [];
  }
}

export interface FindOptions {
  /** The transcript container. Its contents may be replaced; the element itself must stay. */
  root: HTMLElement;
  bar: HTMLElement;
  input: HTMLInputElement;
  count: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  close: HTMLButtonElement;
  /** The Find button in the meta bar. */
  button: HTMLButtonElement;
  /** Whether the session view is on screen, so the keyboard shortcut applies. */
  isActive(): boolean;
}

export interface Find {
  /** Show the bar and search. With a query, it replaces whatever was typed. */
  open(query?: string): void;
  close(): void;
  /** The transcript was re-rendered: drop stale highlights and, if the bar is open, search again. */
  onRender(): void;
}

export function createFind(opts: FindOptions): Find {
  const { root, bar, input, count, button } = opts;
  const highlighter: Highlighter = 'highlights' in CSS ? new RangeHighlighter() : new MarkHighlighter(root);
  let index: TextIndex | null = null;
  let matches: Piece[][] = [];
  let current = -1;
  let timer: ReturnType<typeof setTimeout> | undefined;

  button.title = `Find in session (${IS_MAC ? '⌘F' : 'Ctrl+F'})`;

  function clearHighlights(): void {
    highlighter.clear();
    if (highlighter.mutatesDom) index = null;
    for (const badge of root.querySelectorAll('.find-badge')) badge.remove();
    matches = [];
    current = -1;
  }

  function detailsChain(el: Element | null): HTMLDetailsElement[] {
    const chain: HTMLDetailsElement[] = [];
    for (let d = el?.closest('details') ?? null; d; d = d.parentElement?.closest('details') ?? null) {
      chain.push(d);
    }
    return chain;
  }

  /** Each collapsible block gets a count of the matches inside it, so a closed block is not a blind spot. */
  function addBadges(): void {
    const counts = new Map<HTMLDetailsElement, number>();
    for (let i = 0; i < matches.length; i++) {
      for (const d of detailsChain(highlighter.anchor(i))) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    for (const [details, n] of counts) {
      const summary = details.querySelector(':scope > summary');
      if (!summary) continue;
      const badge = document.createElement('span');
      badge.className = 'find-badge';
      badge.dataset.label = `${n} match${n === 1 ? '' : 'es'}`;
      summary.appendChild(badge);
    }
  }

  function run(): void {
    clearHighlights();
    const re = compileQuery(input.value);
    if (!re) {
      count.textContent = '';
      input.classList.remove('is-empty');
      return;
    }
    index ??= indexText(root);
    const found: Piece[][] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(index.text)) !== null) {
      const pieces = piecesFor(index, m.index, m.index + m[0].length);
      if (pieces.length) found.push(pieces);
    }
    matches = found;
    if (!matches.length) {
      count.textContent = 'No matches';
      input.classList.add('is-empty');
      return;
    }
    input.classList.remove('is-empty');
    highlighter.apply(matches);
    addBadges();
    goTo(0);
  }

  function reveal(el: Element): void {
    const tail = el.closest('.result-tail');
    if (tail instanceof HTMLElement && tail.hidden) revealTail(tail);
    for (const d of detailsChain(el)) d.open = true;
  }

  function scrollTo(i: number): void {
    const el = highlighter.anchor(i);
    if (!el) return;
    reveal(el);
    // Inner scroll containers first (a tall tool result, a thinking block), then the page.
    for (let a: Element | null = el; a; a = a.parentElement) {
      if (a.scrollHeight <= a.clientHeight) continue;
      const overflow = getComputedStyle(a).overflowY;
      if (overflow !== 'auto' && overflow !== 'scroll') continue;
      const rect = highlighter.rect(i);
      if (!rect) return;
      const box = a.getBoundingClientRect();
      a.scrollTop += rect.top - box.top - box.height / 2 + rect.height / 2;
    }
    const rect = highlighter.rect(i);
    if (rect) window.scrollBy({ top: rect.top - window.innerHeight / 2 + rect.height / 2 });
  }

  function goTo(i: number): void {
    if (!matches.length) return;
    current = ((i % matches.length) + matches.length) % matches.length;
    highlighter.setCurrent(current);
    count.textContent = `${current + 1} / ${matches.length}`;
    scrollTo(current);
  }

  function cancelPending(): boolean {
    if (timer === undefined) return false;
    clearTimeout(timer);
    timer = undefined;
    return true;
  }

  function open(query?: string): void {
    bar.hidden = false;
    if (query !== undefined) input.value = query;
    input.focus();
    input.select();
    cancelPending();
    run();
  }

  function close(): void {
    cancelPending();
    bar.hidden = true;
    clearHighlights();
    count.textContent = '';
    input.classList.remove('is-empty');
    if (document.activeElement === input) input.blur();
  }

  function onRender(): void {
    clearHighlights();
    index = null;
    if (!bar.hidden && input.value) run();
  }

  input.addEventListener('input', () => {
    cancelPending();
    timer = setTimeout(() => {
      timer = undefined;
      run();
    }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (cancelPending()) run();
      else goTo(current + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  opts.prev.addEventListener('click', () => goTo(current - 1));
  opts.next.addEventListener('click', () => goTo(current + 1));
  opts.close.addEventListener('click', close);
  button.addEventListener('click', () => open(selectionQuery()));
  document.addEventListener('keydown', (e) => {
    const mod = IS_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (!mod || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return;
    // A second press while the bar has focus falls through to the browser's own find.
    if (!opts.isActive() || document.activeElement === input) return;
    e.preventDefault();
    open(selectionQuery());
  });

  return { open, close, onRender };
}

/** A short single-line selection seeds the query, as the browser's own find does. */
function selectionQuery(): string | undefined {
  const text = window.getSelection()?.toString().trim() ?? '';
  return text && !text.includes('\n') && text.length <= 200 ? text : undefined;
}
