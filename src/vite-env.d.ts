/// <reference types="vite/client" />

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>;
}

interface Window {
  showDirectoryPicker?(options?: { mode?: string }): Promise<FileSystemDirectoryHandle>;
}
