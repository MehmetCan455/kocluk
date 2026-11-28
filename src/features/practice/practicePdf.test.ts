import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import type { CorrectOption, Photo, PracticeSession } from '@/domain/types';
import {
  buildPracticePdf,
  downloadPracticePdf,
  layoutPracticePdf,
  loadPracticePdfQuestions,
} from './practicePdf';
import { loadRobotoFont } from './practicePdfFont';

const pdfMock = vi.hoisted(() => {
  const state = {
    docs: [] as FakeDoc[],
    options: [] as unknown[],
    images: [] as Array<Record<string, unknown>>,
    texts: [] as Array<{ text: string; x: number; y: number }>,
    pages: 1,
  };
  class FakeDoc {
    constructor(options?: unknown) {
      state.docs.push(this);
      state.options.push(options);
    }
    text(text: string, x: number, y: number) {
      state.texts.push({ text, x, y });
    }
    addImage(
      dataUrl: string,
      format: string,
      x: number,
      y: number,
      width: number,
      height: number,
    ) {
      state.images.push({ dataUrl, format, x, y, width, height });
    }
    addPage() {
      state.pages += 1;
    }
    setPage() {}
    getNumberOfPages() {
      return state.pages;
    }
    output(type: string) {
      if (type !== 'blob') {
        throw new Error(`beklenmeyen çıktı: ${type}`);
      }
      return new Blob(['%PDF-1.4 sahte'], { type: 'application/pdf' });
    }
  }
  return { state, jsPDF: FakeDoc };
});

vi.mock('jspdf', () => ({ jsPDF: pdfMock.jsPDF }));
vi.mock('./practicePdfFont', () => ({
  loadRobotoFont: vi.fn().mockResolvedValue(undefined),
}));

function fakeDoc() {
  const texts: Array<{ text: string; x: number; y: number }> = [];
  const images: Array<Record<string, unknown>> = [];
  let pages = 1;
  return {
    texts,
    images,
    get pages() { return pages; },
    text(text: string, x: number, y: number) { texts.push({ text, x, y }); },
    addImage(dataUrl: string, format: string, x: number, y: number, width: number, height: number) {
      images.push({ dataUrl, format, x, y, width, height });
    },
    addPage() { pages += 1; },
    setPage() {},
    getNumberOfPages() { return pages; },
  };
}

const PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function photoRow(id: string, correctOption: CorrectOption = 'A'): Photo {
  return {
    id,
    examType: 'TYT',
    subjectId: 'tyt-mat',
    note: '',
    correctOption,
    blob: new Blob([PHOTO_BYTES], { type: 'image/jpeg' }),
    thumbBlob: new Blob([PHOTO_BYTES], { type: 'image/jpeg' }),
    width: 800,
    height: 1200,
    mastered: false,
    practiceCount: 0,
    createdAt: '2026-11-28T09:00:00.000Z',
  };
}

// Local time on purpose: the file name and date label use local getters.
const CREATED_AT = new Date(2026, 10, 28, 18, 15).toISOString();

function makeSession(photoIds: string[]): PracticeSession {
  return {
    id: 'session-1',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    filters: {},
    photoIds,
    results: {},
  };
}

beforeEach(() => {
  pdfMock.state.docs.length = 0;
  pdfMock.state.options.length = 0;
  pdfMock.state.images.length = 0;
  pdfMock.state.texts.length = 0;
  pdfMock.state.pages = 1;
  vi.mocked(loadRobotoFont).mockClear();
});

test('beş soru üç soru sayfası ve bir cevap anahtarı üretir', () => {
  const doc = fakeDoc();
  layoutPracticePdf(doc, {
    title: 'Rastgele Test',
    dateLabel: '28.11.2026',
    questions: Array.from({ length: 5 }, (_, index) => ({
      number: index + 1,
      imageDataUrl: `data:image/jpeg;base64,${index}`,
      width: 800,
      height: 1200,
      answer: index === 4 ? undefined : 'C',
    })),
  });
  expect(doc.pages).toBe(4);
  expect(doc.images).toHaveLength(5);
  // Odd question count: the fifth question sits in the left column.
  expect((doc.images[4] as { x: number }).x).toBeCloseTo(
    (doc.images[0] as { x: number }).x,
    1,
  );
  expect(doc.texts).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: 'Soru 1', x: 12 }),
    expect.objectContaining({ text: 'Soru 2', x: 152.5 }),
    expect.objectContaining({ text: '1 · C', x: 12 }),
    expect.objectContaining({ text: '5 · —' }),
    expect.objectContaining({ text: '1 / 4', x: 285 }),
  ]));
});

test('görsel iki sütuna en-boy oranı korunarak sığar', () => {
  const doc = fakeDoc();
  layoutPracticePdf(doc, {
    title: 'Test', dateLabel: '28.11.2026',
    questions: [
      { number: 1, imageDataUrl: 'a', width: 800, height: 1200, answer: 'A' },
      { number: 2, imageDataUrl: 'b', width: 800, height: 1200, answer: 'B' },
    ],
  });
  const [left, right] = doc.images;
  expect(left).toMatchObject({ format: 'JPEG', y: 30, height: 166 });
  expect((left as { width: number }).width).toBeCloseTo(110.67, 1);
  expect((left as { x: number }).x).toBeCloseTo(22.92, 1);
  expect((right as { x: number }).x).toBeCloseTo(163.42, 1);
});

test('cevap anahtarı 128 kaydı aşınca yeni sayfaya geçer', () => {
  const doc = fakeDoc();
  layoutPracticePdf(doc, {
    title: 'Uzun Test',
    dateLabel: '28.11.2026',
    questions: Array.from({ length: 129 }, (_, index) => ({
      number: index + 1,
      imageDataUrl: `data:image/jpeg;base64,${index}`,
      width: 800,
      height: 1200,
      answer: 'E',
    })),
  });
  // 65 question pages plus 2 answer-key pages.
  expect(doc.pages).toBe(67);
  expect(doc.texts).toContainEqual({ text: '129 · E', x: 12, y: 36 });
  expect(doc.texts).toContainEqual({ text: '67 / 67', x: 285, y: 204 });
});

test('fotoğrafları oturum sırasıyla yükler, silinmişleri atlar', async () => {
  await db.photos.bulkPut([photoRow('first', 'A'), photoRow('second', 'B')]);

  const questions = await loadPracticePdfQuestions(['first', 'missing', 'second']);

  expect(questions.map((question) => question.number)).toEqual([1, 2]);
  expect(questions[0].imageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(questions[0].answer).toBe('A');
  expect(questions[1]).toMatchObject({ width: 800, height: 1200, answer: 'B' });
});

test('buildPracticePdf iki soruyu layout motoruna verir', async () => {
  const blob = await buildPracticePdf({
    title: 'Rastgele Test',
    dateLabel: '28.11.2026',
    questions: [
      { number: 1, imageDataUrl: 'data:image/jpeg;base64,1', width: 800, height: 1200, answer: 'A' },
      { number: 2, imageDataUrl: 'data:image/jpeg;base64,2', width: 800, height: 1200, answer: 'B' },
    ],
  });

  expect(blob).toBeInstanceOf(Blob);
  expect(pdfMock.state.images).toHaveLength(2);
  expect(pdfMock.state.options[0]).toMatchObject({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });
  expect(loadRobotoFont).toHaveBeenCalledWith(pdfMock.state.docs[0]);
});

test('indirme dosya adı ve blob URL üretir', async () => {
  await db.photos.put(photoRow('photo-1', 'C'));
  const session = makeSession(['photo-1']);

  let createdBlob: Blob | undefined;
  const createObjectURL = vi
    .spyOn(URL, 'createObjectURL')
    .mockImplementation((blob: Blob | MediaSource) => {
      createdBlob = blob as Blob;
      return 'blob:kocluk/pdf-1';
    });
  const revokeObjectURL = vi
    .spyOn(URL, 'revokeObjectURL')
    .mockImplementation(() => undefined);
  let anchor: HTMLAnchorElement | undefined;
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(function (this: HTMLAnchorElement) {
      anchor = this;
    });

  try {
    await downloadPracticePdf(session);

    expect(anchor?.download ?? '').toMatch(
      /^rastgele-test-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/,
    );
    expect(anchor?.href).toBe('blob:kocluk/pdf-1');
    expect(createdBlob).toBeInstanceOf(Blob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:kocluk/pdf-1');
  } finally {
    click.mockRestore();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  }
});

test('görünür fotoğraf yoksa indirme hata verir', async () => {
  await expect(
    downloadPracticePdf(makeSession(['missing-photo'])),
  ).rejects.toThrow('PDF oluşturulacak soru yok.');
});
