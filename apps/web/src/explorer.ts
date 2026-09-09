export interface SessionFile {
  name: string;
  relativePath: string;
  lastModified: number;
  size: number;
  read(): Promise<string>;
}

export interface FolderNode {
  name: string;
  files: SessionFile[];
  folders: FolderNode[];
}

export const supportsDirectoryPicker = 'showDirectoryPicker' in window;

async function scanHandle(handle: FileSystemDirectoryHandle, basePath: string): Promise<FolderNode> {
  const node: FolderNode = { name: handle.name, files: [], folders: [] };
  for await (const entry of handle.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.jsonl')) {
      const fh = entry as FileSystemFileHandle;
      const file = await fh.getFile();
      node.files.push({
        name: entry.name.replace(/\.jsonl$/, ''),
        relativePath: basePath ? `${basePath}/${entry.name}` : entry.name,
        lastModified: file.lastModified,
        size: file.size,
        read: async () => (await fh.getFile()).text(),
      });
    } else if (entry.kind === 'directory') {
      const sub = await scanHandle(
        entry as FileSystemDirectoryHandle,
        basePath ? `${basePath}/${entry.name}` : entry.name,
      );
      if (sub.files.length > 0 || sub.folders.length > 0) {
        node.folders.push(sub);
      }
    }
  }
  sortNode(node);
  return node;
}

function sortNode(node: FolderNode) {
  node.files.sort((a, b) => a.lastModified - b.lastModified);
  node.folders.sort((a, b) => a.name.localeCompare(b.name));
  node.folders.forEach(sortNode);
}

export function countFiles(node: FolderNode): number {
  return node.files.length + node.folders.reduce((sum, f) => sum + countFiles(f), 0);
}

export async function openDirectory(): Promise<FolderNode | null> {
  if (!supportsDirectoryPicker) return null;
  try {
    const handle = await window.showDirectoryPicker!({ mode: 'read' });
    return scanHandle(handle, '');
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return null;
    throw e;
  }
}

async function scanFileSystemEntry(entry: FileSystemEntry, basePath: string): Promise<FolderNode> {
  const node: FolderNode = { name: entry.name, files: [], folders: [] };
  if (!entry.isDirectory) return node;

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
    if (child.isFile && child.name.endsWith('.jsonl')) {
      const file = await new Promise<File>((resolve, reject) =>
        (child as FileSystemFileEntry).file(resolve, reject),
      );
      const f = file;
      node.files.push({
        name: child.name.replace(/\.jsonl$/, ''),
        relativePath: childPath,
        lastModified: file.lastModified,
        size: file.size,
        read: () => f.text(),
      });
    } else if (child.isDirectory) {
      const sub = await scanFileSystemEntry(child, childPath);
      if (sub.files.length > 0 || sub.folders.length > 0) {
        node.folders.push(sub);
      }
    }
  }
  sortNode(node);
  return node;
}

export async function scanDroppedFolder(dataTransfer: DataTransfer): Promise<FolderNode | null> {
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
    const d = new Date(file.lastModified);
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const sizeStr = file.size < 1024 * 1024
      ? Math.round(file.size / 1024) + ' KB'
      : (file.size / (1024 * 1024)).toFixed(1) + ' MB';
    meta.textContent = `${dateStr} · ${sizeStr}`;

    btn.append(nameEl, meta);
    btn.addEventListener('click', () => {
      container.querySelectorAll('.tree-file.active').forEach(el => el.classList.remove('active'));
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
    empty.textContent = 'No .jsonl files found';
    container.appendChild(empty);
  }
}
