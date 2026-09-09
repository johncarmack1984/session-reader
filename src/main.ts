import './style.css';
import { parseSession } from './parser.ts';
import { renderSession } from './renderer.ts';
import { openDirectory, scanDroppedFolder, renderFileTree, countFiles, supportsDirectoryPicker, type SessionFile, type FolderNode } from './explorer.ts';

const appLayout = document.getElementById('app-layout')!;
const sidebar = document.getElementById('sidebar')!;
const landing = document.getElementById('landing')!;
const session = document.getElementById('session')!;
const dropZone = document.getElementById('drop-zone')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const browseBtn = document.getElementById('browse-btn')!;
const backBtn = document.getElementById('back-btn')!;
const errorDiv = document.getElementById('error')!;
const changeFolderBtn = document.getElementById('change-folder')!;
const closeSidebarBtn = document.getElementById('close-sidebar')!;
const folderNameEl = document.getElementById('folder-name')!;
const fileCountEl = document.getElementById('file-count')!;
const fileTree = document.getElementById('file-tree')!;

function showError(msg: string) {
  errorDiv.textContent = msg;
  errorDiv.hidden = false;
}

function clearError() {
  errorDiv.hidden = true;
}

function showSession() {
  landing.hidden = true;
  session.hidden = false;
}

function showLanding() {
  session.hidden = true;
  landing.hidden = false;
  fileTree.querySelectorAll('.tree-file.active').forEach(el => el.classList.remove('active'));
}

function loadText(text: string) {
  const parsed = parseSession(text);
  if (parsed.entries.length === 0) {
    showError('No conversation entries found in this file.');
    return;
  }
  renderSession(parsed);
  showSession();
  window.scrollTo(0, 0);
}

function handleFile(file: File) {
  clearError();
  if (!file.name.endsWith('.jsonl')) {
    showError('Expected a .jsonl file');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadText(reader.result as string);
    } catch (e) {
      showError('Failed to parse session: ' + (e as Error).message);
    }
  };
  reader.onerror = () => showError('Failed to read file');
  reader.readAsText(file);
}

async function handleFileSelect(file: SessionFile) {
  clearError();
  try {
    const text = await file.read();
    loadText(text);
  } catch (e) {
    showError('Failed to read session: ' + (e as Error).message);
  }
}

function showFolder(folder: FolderNode) {
  const count = countFiles(folder);
  folderNameEl.textContent = folder.name || 'Sessions';
  fileCountEl.textContent = `${count} session${count !== 1 ? 's' : ''}`;
  renderFileTree(folder, fileTree, handleFileSelect);
  sidebar.hidden = false;
  appLayout.classList.add('has-sidebar');
}

async function handleOpenFolder() {
  try {
    const folder = await openDirectory();
    if (!folder) return;
    showFolder(folder);
  } catch (e) {
    showError('Failed to open folder: ' + (e as Error).message);
  }
}

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (!e.dataTransfer) return;

  const folder = await scanDroppedFolder(e.dataTransfer);
  if (folder) {
    showFolder(folder);
    return;
  }

  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
browseBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  if (supportsDirectoryPicker) {
    await handleOpenFolder();
  } else {
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) handleFile(fileInput.files[0]);
  fileInput.value = '';
});

backBtn.addEventListener('click', showLanding);
if (supportsDirectoryPicker) {
  changeFolderBtn.addEventListener('click', handleOpenFolder);
}
closeSidebarBtn.addEventListener('click', () => {
  sidebar.hidden = true;
  appLayout.classList.remove('has-sidebar');
});
