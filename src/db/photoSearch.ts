import type { Photo, PhotoSearch } from '@/domain/types';

/**
 * Copies only the fields global search needs. Photo blobs stay in the `photos`
 * table so search queries never deserialize (and especially never decompress)
 * image data.
 *
 * Backup/import (Task 15) must rebuild or include this derived table from the
 * restored `photos` rows; it is not an independent source of truth.
 */
export function toPhotoSearch(photo: Photo): PhotoSearch {
  return {
    id: photo.id,
    examType: photo.examType,
    subjectId: photo.subjectId,
    topicId: photo.topicId,
    note: photo.note,
    createdAt: photo.createdAt,
  };
}

export const PHOTO_SEARCH_SCHEMA = 'id, examType, subjectId, topicId, createdAt';
