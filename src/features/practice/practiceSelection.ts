import type { ExamType, PracticeFilters } from '@/domain/types';

/**
 * The subset of photo metadata the practice filters need. `photos` rows and
 * the blob-free `photoSearch` projection are both assignable to it.
 */
export interface PracticeCandidate {
  id: string;
  examType: ExamType;
  subjectId: string;
  topicId?: string;
  examId?: string;
  mastered: boolean;
}

/**
 * Applies the practice filters, shuffles the matching photos and takes at most
 * `filters.count`. Conventions shared with the wizard and stored sessions:
 *
 * - `examType` absent means a mixed TYT/AYT test; explicitly set narrows it.
 * - `subjectIds`/`topicIds` absent or empty mean "all"; every listed id must be
 *   present on the photo.
 * - `examId` absent means no exam restriction.
 * - `onlyUnmastered` defaults to `true`; only `false` includes solved photos.
 * - `count` absent means "all matching photos"; a smaller available pool is
 *   returned as-is instead of failing.
 *
 * Photos are deduplicated by id, so a deleted/re-added row or a duplicated
 * input entry can never appear twice in one session. The input array is never
 * mutated and `shuffle` is injectable for deterministic tests.
 */
export function selectPracticePhotos<T extends PracticeCandidate>(
  photos: readonly T[],
  filters: PracticeFilters,
  shuffle: () => number = Math.random,
): T[] {
  const seen = new Set<string>();
  const matching = photos.filter((photo) => {
    if (seen.has(photo.id)) {
      return false;
    }
    if (filters.examType && photo.examType !== filters.examType) {
      return false;
    }
    if (
      filters.subjectIds &&
      filters.subjectIds.length > 0 &&
      !filters.subjectIds.includes(photo.subjectId)
    ) {
      return false;
    }
    if (
      filters.topicIds &&
      filters.topicIds.length > 0 &&
      (!photo.topicId || !filters.topicIds.includes(photo.topicId))
    ) {
      return false;
    }
    if (filters.examId && photo.examId !== filters.examId) {
      return false;
    }
    // The default (absent) is "only unmastered". Explicit false keeps solved
    // photos in the pool, which is how the wizard can repeat a photo.
    if (filters.onlyUnmastered !== false && photo.mastered) {
      return false;
    }
    seen.add(photo.id);
    return true;
  });

  const shuffled = shufflePhotos(matching, shuffle);
  if (filters.count === undefined) {
    return shuffled;
  }
  return shuffled.slice(0, Math.max(0, Math.floor(filters.count)));
}

/** Fisher–Yates; the random callback is clamped so test doubles returning 1 are safe. */
function shufflePhotos<T>(photos: T[], random: () => number): T[] {
  const result = [...photos];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.max(0, Math.min(index, Math.floor(random() * (index + 1))));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
