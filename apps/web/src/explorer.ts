export interface SessionFile {
  name: string;
  relativePath: string;
  lastModified: number;
  size: number;
  fileType: 'session' | 'memory';
  startTime?: string;
  endTime?: string;
  read(): Promise<string>;
}

async function peekTimestamps(blob: Blob): Promise<{ start?: string; end?: string }> {
  const headText = await blob.slice(0, 512).text();
  const tailText = await blob.slice(Math.max(0, blob.size - 2048)).text();

  const extractTs = (text: string, last: boolean): string | undefined => {
    const re = /"timestamp"\s*:\s*"([^"]+)"/g;
    let match;
    let found: string | undefined;
    while ((match = re.exec(text)) !== null) {
      found = match[1];
      if (!last) return found;
    }
    return found;
  };

  return { start: extractTs(headText, false), end: extractTs(tailText, true) };
}

export interface FolderNode {
  name: string;
  files: SessionFile[];
  folders: FolderNode[];
}

export interface ScanResult {
  sessions: FolderNode;
  memories: FolderNode;
}

export const supportsDirectoryPicker = 'showDirectoryPicker' in window;

const EXTENSIONS: Record<string, 'session' | 'memory'> = {
  '.jsonl': 'session',
  '.md': 'memory',
};

function matchExt(name: string): { ext: string; type: 'session' | 'memory' } | null {
  for (const [ext, type] of Object.entries(EXTENSIONS)) {
    if (name.endsWith(ext)) return { ext, type };
  }
  return null;
}

async function scanHandle(handle: FileSystemDirectoryHandle, basePath: string): Promise<ScanResult> {
  const sessions: FolderNode = { name: handle.name, files: [], folders: [] };
  const memories: FolderNode = { name: handle.name, files: [], folders: [] };

  for await (const entry of handle.values()) {
    const m = entry.kind === 'file' ? matchExt(entry.name) : null;
    if (entry.kind === 'file' && m) {
      const fh = entry as FileSystemFileHandle;
      const file = await fh.getFile();
      const ts = m.type === 'session' ? await peekTimestamps(file) : undefined;
      const item: SessionFile = {
        name: entry.name.replace(new RegExp(`\\${m.ext}$`), ''),
        relativePath: basePath ? `${basePath}/${entry.name}` : entry.name,
        lastModified: file.lastModified,
        size: file.size,
        fileType: m.type,
        startTime: ts?.start,
        endTime: ts?.end,
        read: async () => (await fh.getFile()).text(),
      };
      if (m.type === 'session') sessions.files.push(item);
      else memories.files.push(item);
    } else if (entry.kind === 'directory') {
      const sub = await scanHandle(
        entry as FileSystemDirectoryHandle,
        basePath ? `${basePath}/${entry.name}` : entry.name,
      );
      if (sub.sessions.files.length > 0 || sub.sessions.folders.length > 0) {
        sessions.folders.push(sub.sessions);
      }
      if (sub.memories.files.length > 0 || sub.memories.folders.length > 0) {
        memories.folders.push(sub.memories);
      }
    }
  }
  sortNode(sessions);
  sortNode(memories);
  return { sessions, memories };
}

function sortNode(node: FolderNode) {
  node.files.sort((a, b) => a.lastModified - b.lastModified);
  node.folders.sort((a, b) => a.name.localeCompare(b.name));
  node.folders.forEach(sortNode);
}

export function countFiles(node: FolderNode): number {
  return node.files.length + node.folders.reduce((sum, f) => sum + countFiles(f), 0);
}

export async function openDirectory(): Promise<ScanResult | null> {
  if (!supportsDirectoryPicker) return null;
  try {
    const handle = await window.showDirectoryPicker!({ mode: 'read' });
    return scanHandle(handle, '');
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
}

async function scanFileSystemEntry(entry: FileSystemEntry, basePath: string): Promise<ScanResult> {
  const sessions: FolderNode = { name: entry.name, files: [], folders: [] };
  const memories: FolderNode = { name: entry.name, files: [], folders: [] };
  if (!entry.isDirectory) return { sessions, memories };

  const dirReader = (entry as FileSystemDirectoryEntry).createReader();
  const readAll = (): Promise<FileSystemEntry[]> => new Promise((resolve, reject) => {
    const results: FileSystemEntry[] = [];
    const readBatch = () => {
      dirReader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(results);
        } else {
          results.push(...entries);
          readBatch();
        }
      }, reject);
    };
    readBatch();
  });

  const children = await readAll();
  for (const child of children) {
    const childPath = basePath ? `${basePath}/${child.name}` : child.name;
    const m = child.isFile ? matchExt(child.name) : null;
    if (child.isFile && m) {
      const file = await new Promise<File>((resolve, reject) =>
        (child as FileSystemFileEntry).file(resolve, reject),
      );
      const f = file;
      const ts = m.type === 'session' ? await peekTimestamps(file) : undefined;
      const item: SessionFile = {
        name: child.name.replace(new RegExp(`\\${m.ext}$`), ''),
        relativePath: childPath,
        lastModified: file.lastModified,
        size: file.size,
        fileType: m.type,
        startTime: ts?.start,
        endTime: ts?.end,
        read: () => f.text(),
      };
      if (m.type === 'session') sessions.files.push(item);
      else memories.files.push(item);
    } else if (child.isDirectory) {
      const sub = await scanFileSystemEntry(child, childPath);
      if (sub.sessions.files.length > 0 || sub.sessions.folders.length > 0) {
        sessions.folders.push(sub.sessions);
      }
      if (sub.memories.files.length > 0 || sub.memories.folders.length > 0) {
        memories.folders.push(sub.memories);
      }
    }
  }
  sortNode(sessions);
  sortNode(memories);
  return { sessions, memories };
}

export async function scanDroppedFolder(dataTransfer: DataTransfer): Promise<ScanResult | null> {
  const items = dataTransfer.items;
  for (let i = 0; i < items.length; i++) {
    const entry = items[i]?.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      return scanFileSystemEntry(entry, '');
    }
  }
  return null;
}

export function renderFileTree(
  root: FolderNode,
  container: HTMLElement,
  onSelect: (file: SessionFile) => void,
): void {
  container.innerHTML = '';

  function makeFileBtn(file: SessionFile): HTMLElement {
    const btn = document.createElement('button');
    btn.className = 'tree-file';
    btn.dataset.path = file.relativePath;

    const nameEl = document.createElement('span');
    nameEl.className = 'tree-file-name';
    nameEl.textContent = file.name;

    const meta = document.createElement('span');
    meta.className = 'tree-file-meta';
    const fmt = (ts: string) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
    let dateStr: string;
    if (file.startTime) {
      const start = fmt(file.startTime);
      const end = file.endTime ? fmt(file.endTime) : start;
      dateStr = start === end ? start : `${start} – ${end}`;
    } else {
      dateStr = new Date(file.lastModified).toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
    const sizeStr = file.size < 1024 * 1024
      ? Math.round(file.size / 1024) + ' KB'
      : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
    meta.textContent = `${dateStr} · ${sizeStr}`;

    btn.append(nameEl, meta);
    btn.addEventListener('click', () => {
      container.closest('#sidebar')?.querySelectorAll('.tree-file.active').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      onSelect(file);
    });
    return btn;
  }

  function renderContents(node: FolderNode, target: HTMLElement): void {
    for (const folder of node.folders) {
      const details = document.createElement('details');
      details.className = 'tree-folder';
      details.open = true;

      const summary = document.createElement('summary');
      summary.className = 'tree-folder-name';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = folder.name;
      const countSpan = document.createElement('span');
      countSpan.className = 'tree-folder-count';
      countSpan.textContent = String(countFiles(folder));
      summary.append(nameSpan, countSpan);
      details.appendChild(summary);

      const content = document.createElement('div');
      content.className = 'tree-folder-content';
      renderContents(folder, content);
      details.appendChild(content);
      target.appendChild(details);
    }
    for (const file of node.files) {
      target.appendChild(makeFileBtn(file));
    }
  }

  renderContents(root, container);

  if (countFiles(root) === 0) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.textContent = 'No files found';
    container.appendChild(empty);
  }
}
