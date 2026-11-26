import { resolveBookTotalPages } from '@/domain/bookProgress';
import { validateTaskPages } from '@/domain/schedule';
import type { ScheduleTaskType } from '@/domain/types';
import { db } from './db';
import type {
  CreateScheduleTaskInput,
  UpdateScheduleTaskInput,
} from './scheduleRepository';
import { isActiveRow } from './softDelete';

/** The validated, type-specific fields stored on a task. */
export interface TaskFields {
  type: ScheduleTaskType;
  userBookId?: string;
  fromPage?: number;
  toPage?: number;
  topicId?: string;
  title?: string;
}

function invalidPageNumber(value: number | undefined): boolean {
  return value !== undefined && !Number.isInteger(value);
}

/**
 * Validates and normalizes the type-specific fields. Blank page inputs must
 * arrive as `undefined`, never `NaN`.
 */
export async function validateTaskFields(
  input: CreateScheduleTaskInput | UpdateScheduleTaskInput,
): Promise<TaskFields> {
  switch (input.type) {
    case 'book': {
      if (!input.userBookId) {
        throw new Error('Kitap seçilmeli.');
      }
      const userBook = await db.userBooks.get(input.userBookId);
      if (!userBook || userBook.deletedAt) {
        throw new Error('Raf kitabı bulunamadı');
      }
      const catalogBook = await db.catalogBooks.get(userBook.bookId);
      if (!catalogBook || catalogBook.deletedAt) {
        throw new Error('Kitap bulunamadı');
      }
      if (invalidPageNumber(input.fromPage) || invalidPageNumber(input.toPage)) {
        throw new Error('Sayfa numaraları tam sayı olmalı.');
      }
      const error = validateTaskPages(
        input.fromPage,
        input.toPage,
        resolveBookTotalPages(userBook, catalogBook),
      );
      if (error) {
        throw new Error(error);
      }
      const title = input.title?.trim();
      return {
        type: 'book',
        userBookId: input.userBookId,
        fromPage: input.fromPage,
        toPage: input.toPage,
        ...(title ? { title } : {}),
      };
    }
    case 'topic': {
      if (!input.topicId) {
        throw new Error('Konu seçilmeli.');
      }
      const topic = await db.topics.get(input.topicId);
      if (!topic || !isActiveRow(topic)) {
        throw new Error('Konu bulunamadı');
      }
      return { type: 'topic', topicId: input.topicId };
    }
    case 'free': {
      const title = input.title?.trim();
      if (!title) {
        throw new Error('Görev adı boş olamaz.');
      }
      return { type: 'free', title };
    }
  }
}
