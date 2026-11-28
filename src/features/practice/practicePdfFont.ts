import fontUrl from '@/assets/fonts/Roboto-Regular.ttf?url';
import type { PdfDocLike } from './practicePdf';

/** The subset of jsPDF's font API used to register the embedded Roboto face. */
export type PdfFontDoc = PdfDocLike & {
  addFileToVFS(name: string, data: string): void;
  addFont(name: string, id: string, style: string): void;
  setFont(name: string): void;
};

const FONT_FILE = 'Roboto-Regular.ttf';
const FONT_ID = 'Roboto';

let cachedBase64: string | undefined;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)),
    );
  }
  return btoa(chunks.join(''));
}

/**
 * Fetches the bundled Roboto TTF once per page load and registers it in the
 * document's virtual file system so jsPDF can embed Turkish glyphs.
 */
export async function loadRobotoFont(doc: PdfFontDoc): Promise<void> {
  if (cachedBase64 === undefined) {
    const response = await fetch(fontUrl);
    if (!response.ok) {
      throw new Error('PDF yazı tipi yüklenemedi.');
    }
    cachedBase64 = toBase64(await response.arrayBuffer());
  }
  doc.addFileToVFS(FONT_FILE, cachedBase64);
  doc.addFont(FONT_FILE, FONT_ID, 'normal');
  doc.setFont(FONT_ID);
}
