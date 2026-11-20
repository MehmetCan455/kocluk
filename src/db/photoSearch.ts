import type { Photo, PhotoSearch } from '@/domain/types';

/**
 * Copies only the fields the gallery-independent flows need: global search and
 * the random practice wizard/session. Photo blobs stay in the `photos` table so
 * these queries never deserialize (and especially never decompress) image data.
 *
 * Backup/import (Task 15) must rebuild or include this derived table from the
 * restored `photos` rows; it is not an independent source of truth.
 */
export function toPhotoSearch(photo: Photo): PhotoSearch {
  return {
    id: photo.id,
    examId: photo.examId,
    examType: photo.examType,
    subjectId: photo.subjectId,
    topicId: photo.topicId,
    note: photo.note,
    mastered: photo.mastered,
    createdAt: photo.createdAt,
  };
}

export const PHOTO_SEARCH_SCHEMA = 'id, examId, examType, subjectId, topicId, createdAt';
