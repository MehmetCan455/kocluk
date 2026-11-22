import { saveAs } from 'file-saver';

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** Local-time file name used by the download button. */
export function backupFileName(date = new Date()): string {
  return `zirve-akademi-yedek-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}-${pad(date.getHours())}${pad(date.getMinutes())}.zip`;
}

export function saveBlob(blob: Blob, fileName: string): void {
  saveAs(blob, fileName);
}

/**
 * FileReader is used first because jsdom and older mobile browsers support it
 * even when their Blob implementation has no `arrayBuffer()` method.
 */
export function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Dosya okunamadı'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Dosya okunamadı'));
    reader.readAsArrayBuffer(blob);
  });
}
