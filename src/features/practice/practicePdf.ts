import type { CorrectOption } from '@/domain/types';

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
