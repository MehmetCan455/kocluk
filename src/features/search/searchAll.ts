import { db } from '@/db/db';
import {
  listAllExamResults,
  listAllTopics,
  listBooks,
  listExams,
  listSubjects,
} from '@/db/repositories';
import type { Book, Exam, ExamType, Subject, Topic } from '@/domain/types';
import { formatAlan, formatExamDate } from '@/features/exams/examFormat';
import { resolveAytAlan } from '@/features/exams/examConfig';
import { examBasePath } from '@/features/subjects/exam';
import { formatNet } from '@/lib/format';
import { matchesTokens, tokenizeTr } from '@/lib/normalize';

export type SearchKind = 'topic' | 'book' | 'exam' | 'photo' | 'note';

export interface SearchResult {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** Hard cap for one search; the modal groups the results by kind. */
export const SEARCH_RESULT_LIMIT = 20;

/**
 * Per-kind guard so one large group (for example many matching topics) cannot
 * push every other kind out of the palette.
 */
export const SEARCH_RESULT_LIMIT_PER_KIND = 5;

const EXAM_ORDER: Record<ExamType, number> = { TYT: 0, AYT: 1 };
const NOTE_EXCERPT_LENGTH = 90;

function excerpt(text: string, maxLength: number = NOTE_EXCERPT_LENGTH): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function compareTopics(left: Topic, right: Topic, subjectById: Map<string, Subject>): number {
  const leftSubject = subjectById.get(left.subjectId);
  const rightSubject = subjectById.get(right.subjectId);

  return (
    (leftSubject ? EXAM_ORDER[leftSubject.exam] : Number.MAX_SAFE_INTEGER) -
      (rightSubject ? EXAM_ORDER[rightSubject.exam] : Number.MAX_SAFE_INTEGER) ||
    (leftSubject?.order ?? Number.MAX_SAFE_INTEGER) -
      (rightSubject?.order ?? Number.MAX_SAFE_INTEGER) ||
    left.order - right.order ||
    left.name.localeCompare(right.name, 'tr-TR') ||
    left.id.localeCompare(right.id)
  );
}

function bookSubtitle(book: Book): string {
  return book.publisher ? `Yayınevi: ${book.publisher}` : 'Kitap';
}

function examSubtitle(
  exam: Exam,
  totalNet: number | undefined,
  alan: ReturnType<typeof resolveAytAlan> | undefined,
): string {
  const parts = [exam.type, formatExamDate(exam.date)];
  const alanLabel = alan ? formatAlan(alan) : null;
  if (alanLabel) {
    parts.push(alanLabel);
  }
  if (totalNet !== undefined) {
    parts.push(`${formatNet(totalNet)} net`);
  }
  return parts.join(' · ');
}

/**
 * Searches topics, notes, books, exams and wrong-answer photos in IndexedDB.
 * Only IndexedDB is read; nothing is persisted and no network request is made.
 * An empty/whitespace query returns an empty list, every other query requires
 * all of its tokens to appear in the matching field(s) in any order.
 */
export async function searchAll(query: string): Promise<SearchResult[]> {
  const tokens = tokenizeTr(query);
  if (tokens.length === 0) {
    return [];
  }

  const [subjects, topics, notes, books, exams, examResults, photoSearch] = await Promise.all([
    listSubjects(),
    listAllTopics(),
    db.notes.toArray(),
    listBooks(),
    listExams(),
    listAllExamResults(),
    db.photoSearch.toArray(),
  ]);

  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));

  const netByExam = new Map<string, number>();
  const resultsByExam = new Map<string, typeof examResults>();
  for (const result of examResults) {
    netByExam.set(result.examId, (netByExam.get(result.examId) ?? 0) + result.net);
    const grouped = resultsByExam.get(result.examId);
    if (grouped) {
      grouped.push(result);
    } else {
      resultsByExam.set(result.examId, [result]);
    }
  }

  const topicResults: SearchResult[] = [];
  const sortedTopics = [...topics].sort((left, right) =>
    compareTopics(left, right, subjectById),
  );
  for (const topic of sortedTopics) {
    if (topicResults.length >= SEARCH_RESULT_LIMIT_PER_KIND) {
      break;
    }
    if (!matchesTokens(topic.name, tokens)) {
      continue;
    }
    const subject = subjectById.get(topic.subjectId);
    if (!subject) {
      continue;
    }
    topicResults.push({
      kind: 'topic',
      id: topic.id,
      title: topic.name,
      subtitle: `${subject.name} · ${subject.exam}`,
      href: `${examBasePath(subject.exam)}/${subject.id}/${topic.id}`,
    });
  }

  const noteResults: SearchResult[] = [];
  const sortedNotes = [...notes].sort(
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.topicId.localeCompare(right.topicId),
  );
  for (const note of sortedNotes) {
    if (noteResults.length >= SEARCH_RESULT_LIMIT_PER_KIND) {
      break;
    }
    if (!matchesTokens(note.plainText, tokens)) {
      continue;
    }
    const topic = topicById.get(note.topicId);
    const subject = topic ? subjectById.get(topic.subjectId) : undefined;
    if (!topic || !subject) {
      continue;
    }
    noteResults.push({
      kind: 'note',
      id: note.topicId,
      title: excerpt(note.plainText),
      subtitle: `${topic.name} · ${subject.name}`,
      href: `${examBasePath(subject.exam)}/${subject.id}/${topic.id}`,
    });
  }

  const bookResults: SearchResult[] = [];
  for (const book of books) {
    if (bookResults.length >= SEARCH_RESULT_LIMIT_PER_KIND) {
      break;
    }
    if (!matchesTokens(`${book.name} ${book.publisher ?? ''}`, tokens)) {
      continue;
    }
    bookResults.push({
      kind: 'book',
      id: book.id,
      title: book.name,
      subtitle: bookSubtitle(book),
      href: `/kitaplar/${book.id}`,
    });
  }

  const examResultsList: SearchResult[] = [];
  for (const exam of exams) {
    if (examResultsList.length >= SEARCH_RESULT_LIMIT_PER_KIND) {
      break;
    }
    if (!matchesTokens(`${exam.name} ${exam.note}`, tokens)) {
      continue;
    }
    const alan =
      exam.type === 'AYT'
        ? resolveAytAlan(exam, resultsByExam.get(exam.id) ?? [], subjects)
        : undefined;
    examResultsList.push({
      kind: 'exam',
      id: exam.id,
      title: exam.name,
      subtitle: examSubtitle(exam, netByExam.get(exam.id), alan),
      href: `/denemeler/${exam.id}`,
    });
  }

  const photoResults: SearchResult[] = [];
  const sortedPhotos = [...photoSearch].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
  );
  for (const photo of sortedPhotos) {
    if (photoResults.length >= SEARCH_RESULT_LIMIT_PER_KIND) {
      break;
    }
    if (!matchesTokens(photo.note, tokens)) {
      continue;
    }
    const subject = subjectById.get(photo.subjectId);
    if (!subject) {
      continue;
    }
    const topic = photo.topicId ? topicById.get(photo.topicId) : undefined;
    photoResults.push({
      kind: 'photo',
      id: photo.id,
      title: excerpt(photo.note) || 'Yanlış fotoğrafı',
      subtitle: topic ? `${subject.name} · ${topic.name}` : subject.name,
      href: '/yanlislar',
    });
  }

  return [
    ...topicResults,
    ...noteResults,
    ...bookResults,
    ...examResultsList,
    ...photoResults,
  ].slice(0, SEARCH_RESULT_LIMIT);
}
