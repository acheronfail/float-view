/**
 * Required in order to save the chosen directory across reloads, etc.
 * Only IndexedDB supports this.
 */

const OUTPUT_HANDLE_DB = 'float-renderer-output';
const OUTPUT_HANDLE_KEY = 'outputDirectory';

export function saveOutputHandle(handle: FileSystemDirectoryHandle): void {
  try {
    const req = indexedDB.open(OUTPUT_HANDLE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => {
      req.result.transaction('handles', 'readwrite').objectStore('handles').put(handle, OUTPUT_HANDLE_KEY);
    };
  } catch (e) {
    console.warn('Could not save output folder:', e);
  }
}

export function loadOutputHandle(): Promise<FileSystemDirectoryHandle | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(OUTPUT_HANDLE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('handles');
      req.onsuccess = () => {
        const tx = req.result.transaction('handles', 'readonly');
        const get = tx.objectStore('handles').get(OUTPUT_HANDLE_KEY);
        get.onsuccess = () => resolve(get.result ?? null);
        get.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function chooseOutputFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!window.showDirectoryPicker) return null;

    const dir = await window.showDirectoryPicker({
      id: 'output',
      mode: 'readwrite',
      startIn: 'videos',
    });
    saveOutputHandle(dir);
    return dir;
  } catch (e) {
    if ((e as Error).name !== 'AbortError') console.error(e);
    return null;
  }
}

export async function getOutputDirectory(
  outputDirectoryHandle: FileSystemDirectoryHandle | null,
): Promise<FileSystemDirectoryHandle | null> {
  if (outputDirectoryHandle) {
    try {
      if (outputDirectoryHandle.requestPermission) {
        const perm = await outputDirectoryHandle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          return await chooseOutputFolder();
        }
      }
      return outputDirectoryHandle;
    } catch {
      return await chooseOutputFolder();
    }
  }

  return await chooseOutputFolder();
}
