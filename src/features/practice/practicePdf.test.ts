import { expect, test } from 'vitest';
import { layoutPracticePdf } from './practicePdf';

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
