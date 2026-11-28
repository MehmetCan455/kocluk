import { db } from '@/db/db';
import type { CorrectOption, PracticeSession } from '@/domain/types';
import { loadRobotoFont } from './practicePdfFont';

export interface PdfDocLike {
  text(
    text: string,
    x: number,
    y: number,
    options?: Record<string, unknown>,
  ): void;
  addImage(
    dataUrl: string,
    format: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
  addPage(): void;
  setPage(page: number): void;
  getNumberOfPages(): number;
}

export interface PracticePdfQuestion {
  number: number;
  imageDataUrl: string;
  width: number;
  height: number;
  answer?: CorrectOption;
}

export interface PracticePdfInput {
  title: string;
  dateLabel: string;
  questions: PracticePdfQuestion[];
}

export interface PracticePdfBuildInput {
  title: string;
  dateLabel: string;
  questions: PracticePdfQuestion[];
}

const PDF_TITLE = 'Rastgele Test';
const EMPTY_QUESTIONS_MESSAGE = 'PDF oluşturulacak soru yok.';

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 12;
const HEADER_Y = 16;
const CONTENT_TOP = 24;
const CONTENT_BOTTOM = 198;
const COL_W = 132.5;
const GAP = 8;
const LABEL_H = 6;
const IMG_H = 166;
const ANSWER_TOP = 36;
const ANSWER_COLS = 8;
const ANSWER_COL_W = 34.125;
const ANSWER_ROW_H = 10;

const QUESTIONS_PER_PAGE = 2;
const ANSWER_ROWS = Math.floor((CONTENT_BOTTOM - ANSWER_TOP) / ANSWER_ROW_H);
const ANSWERS_PER_PAGE = ANSWER_COLS * ANSWER_ROWS;

function columnX(index: number): number {
  return MARGIN + index * (COL_W + GAP);
}

function drawPageHeader(doc: PdfDocLike, input: PracticePdfInput): void {
  doc.text(input.title, MARGIN, HEADER_Y);
  doc.text(input.dateLabel, PAGE_W - MARGIN, HEADER_Y, { align: 'right' });
}

function drawQuestion(
  doc: PdfDocLike,
  question: PracticePdfQuestion,
  columnIndex: number,
): void {
  const x = columnX(columnIndex);
  doc.text(`Soru ${question.number}`, x, CONTENT_TOP + 4);

  const scale = Math.min(COL_W / question.width, IMG_H / question.height);
  const width = question.width * scale;
  const height = question.height * scale;
  doc.addImage(
    question.imageDataUrl,
    'JPEG',
    x + (COL_W - width) / 2,
    CONTENT_TOP + LABEL_H,
    width,
    height,
  );
}

function drawAnswerKey(
  doc: PdfDocLike,
  questions: PracticePdfQuestion[],
): void {
  doc.addPage();
  doc.text('Cevap Anahtarı', MARGIN, CONTENT_TOP + 4);

  questions.forEach((question, index) => {
    if (index > 0 && index % ANSWERS_PER_PAGE === 0) {
      doc.addPage();
    }
    const slot = index % ANSWERS_PER_PAGE;
    const column = slot % ANSWER_COLS;
    const row = Math.floor(slot / ANSWER_COLS);
    doc.text(
      `${question.number} · ${question.answer ?? '—'}`,
      MARGIN + column * ANSWER_COL_W,
      ANSWER_TOP + row * ANSWER_ROW_H,
    );
  });
}

function two(value: number): string {
  return String(value).padStart(2, '0');
}

function formatPdfDate(isoDate: string): string {
  const date = new Date(isoDate);
  const day = `${two(date.getDate())}.${two(date.getMonth() + 1)}`;
  return `${day}.${date.getFullYear()}`;
}

/** Local `rastgele-test-YYYY-MM-DD-HHmm.pdf` name for a session export. */
function practicePdfFileName(createdAt: string): string {
  const date = new Date(createdAt);
  const yearMonthDay = [
    date.getFullYear(),
    two(date.getMonth() + 1),
    two(date.getDate()),
  ].join('-');
  const hoursMinutes = `${two(date.getHours())}${two(date.getMinutes())}`;
  return `rastgele-test-${yearMonthDay}-${hoursMinutes}.pdf`;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error('Fotoğraf okunamadı.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Loads the session's photo blobs in order and turns them into PDF questions.
 * Hard-deleted photos are simply absent from the bulk read and are skipped.
 */
export async function loadPracticePdfQuestions(
  photoIds: readonly string[],
): Promise<PracticePdfQuestion[]> {
  if (photoIds.length === 0) {
    return [];
  }
  const photos = await db.photos.bulkGet([...photoIds]);
  const questions: PracticePdfQuestion[] = [];
  for (const photo of photos) {
    if (!photo) {
      continue;
    }
    questions.push({
      number: questions.length + 1,
      imageDataUrl: await readBlobAsDataUrl(photo.blob),
      width: photo.width,
      height: photo.height,
      answer: photo.correctOption,
    });
  }
  return questions;
}

/** Renders the questions into an A4 landscape PDF with the embedded font. */
export async function buildPracticePdf(
  input: PracticePdfBuildInput,
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  await loadRobotoFont(doc);
  layoutPracticePdf(doc, input);
  return doc.output('blob');
}

/** Builds the session PDF and saves it through a temporary object URL. */
export async function downloadPracticePdf(
  session: PracticeSession,
): Promise<void> {
  const questions = await loadPracticePdfQuestions(session.photoIds);
  if (questions.length === 0) {
    throw new Error(EMPTY_QUESTIONS_MESSAGE);
  }
  const blob = await buildPracticePdf({
    title: PDF_TITLE,
    dateLabel: formatPdfDate(session.createdAt),
    questions,
  });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = practicePdfFileName(session.createdAt);
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Draws two questions per A4 landscape page, starting on the document's
 * current page, and appends an answer key with page-number footers.
 */
export function layoutPracticePdf(
  doc: PdfDocLike,
  input: PracticePdfInput,
): void {
  for (
    let start = 0;
    start < input.questions.length;
    start += QUESTIONS_PER_PAGE
  ) {
    if (start > 0) {
      doc.addPage();
    }
    drawPageHeader(doc, input);
    input.questions
      .slice(start, start + QUESTIONS_PER_PAGE)
      .forEach((question, columnIndex) => {
        drawQuestion(doc, question, columnIndex);
      });
  }

  drawAnswerKey(doc, input.questions);

  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    doc.text(`${page} / ${total}`, PAGE_W - MARGIN, PAGE_H - 6, {
      align: 'right',
    });
  }
}
