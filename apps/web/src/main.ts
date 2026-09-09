import './style.css';
import { parseSession } from './parser.ts';
import { driftTotal } from './transcript/index.ts';
import { renderSession } from './renderer.ts';
import { parseMemory, renderMemory } from './memory-viewer.ts';
import { openDirectory, scanDroppedFolder, renderFileTree, countFiles, supportsDirectoryPicker, type SessionFile, type ScanResult } from './explorer.ts';

const appLayout = document.getElementById('app-layout')!;
const sidebar = document.getElementById('sidebar')!;
const landing = document.getElementById('landing')!;
const session = document.getElementById('session')!;
const memoryView = document.getElementById('memory-view')!;
const memoryContent = document.getElementById('memory-content')!;
const dropZone = document.getElementById('drop-zone')!;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const browseBtn = document.getElementById('browse-btn')!;
const backBtn = document.getElementById('back-btn')!;
const memoryBackBtn = document.getElementById('memory-back-btn')!;
const errorDiv = document.getElementById('error')!;
const changeFolderBtn = document.getElementById('change-folder')!;
const closeSidebarBtn = document.getElementById('close-sidebar')!;
const folderNameEl = document.getElementById('folder-name')!;
const fileCountEl = document.getElementById('file-count')!;
const fileTree = document.getElementById('file-tree')!;
const memoryTree = document.getElementById('memory-tree')!;
const sidebarTabs = sidebar.querySelectorAll<HTMLButtonElement>('.sidebar-tab');

function showError(msg: string) {
  errorDiv.textContent = msg;
  errorDiv.hidden = false;
}

function clearError() {
  errorDiv.hidden = true;
}

function hideAllSections() {
  landing.hidden = true;
  session.hidden = true;
  memoryView.hidden = true;
}

function showLanding() {
  hideAllSections();
  landing.hidden = false;
  sidebar.querySelectorAll('.tree-file.active').forEach(el => el.classList.remove('active'));
}

function loadText(text: string) {
  const parsed = parseSession(text);
  if (driftTotal(parsed.drift) > 0) console.info('[session-reader] schema drift', parsed.drift);
  if (parsed.entries.length === 0) {
    showError('No conversation entries found in this file.');
    return;
  }
  renderSession(parsed);
  hideAllSections();
  session.hidden = false;
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
    if (file.fileType === 'memory') {
      const parsed = parseMemory(text);
      renderMemory(parsed, memoryContent);
      hideAllSections();
      memoryView.hidden = false;
      window.scrollTo(0, 0);
    } else {
      loadText(text);
    }
  } catch (e) {
    showError('Failed to read file: ' + (e as Error).message);
  }
}

function showFolder(result: ScanResult) {
  const sessionCount = countFiles(result.sessions);
  const memoryCount = countFiles(result.memories);
  folderNameEl.textContent = result.sessions.name || 'Sessions';
  fileCountEl.textContent = `${sessionCount} session${sessionCount !== 1 ? 's' : ''}` +
    (memoryCount > 0 ? ` · ${memoryCount} memor${memoryCount !== 1 ? 'ies' : 'y'}` : '');

  renderFileTree(result.sessions, fileTree, handleFileSelect);
  renderFileTree(result.memories, memoryTree, handleFileSelect);

  const memoryTab = sidebar.querySelector<HTMLButtonElement>('.sidebar-tab[data-tab="memories"]')!;
  memoryTab.hidden = memoryCount === 0;

  sidebar.hidden = false;
  appLayout.classList.add('has-sidebar');
}

async function handleOpenFolder() {
  try {
    const result = await openDirectory();
    if (!result) return;
    showFolder(result);
  } catch (e) {
    showError('Failed to open folder: ' + (e as Error).message);
  }
}

sidebarTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    sidebarTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    const target = tab.dataset.tab;
    fileTree.hidden = target !== 'sessions';
    memoryTree.hidden = target !== 'memories';
  });
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (!e.dataTransfer) return;

  const result = await scanDroppedFolder(e.dataTransfer);
  if (result) {
    showFolder(result);
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
memoryBackBtn.addEventListener('click', showLanding);
if (supportsDirectoryPicker) {
  changeFolderBtn.addEventListener('click', handleOpenFolder);
}
closeSidebarBtn.addEventListener('click', () => {
  sidebar.hidden = true;
  appLayout.classList.remove('has-sidebar');
});
