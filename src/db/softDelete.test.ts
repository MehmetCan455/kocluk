import JSZip from 'jszip';
import { beforeEach, expect, test } from 'vitest';
import type { ActivityLog, Photo, Subject } from '@/domain/types';
import { searchAll } from '@/features/search/searchAll';
import { resetDb } from '@/test/fixtures';
import { importBackup, exportBackup, readBackupSummary } from './backup';
import { toPhotoSearch } from './photoSearch';
import { db } from './db';
import {
  addCustomTopic,
  deleteCustomTopicCascade,
  deleteExamUnlinkPhotos,
  getExam,
  getNote,
  getTopic,
  listAllExamResults,
  listAllTopics,
  listExamResults,
  listExams,
  listTopics,
  saveExam,
  saveNote,
} from './repositories';
import {
  getTopicDone,
  listAllTopicProgress,
  listTopicReviews,
  setTopicDone,
} from './topicProgressRepository';

const NOW = '2026-11-20T10:00:00.000Z';

async function seedSubject(id = 'subject-1'): Promise<Subject> {
  const subject: Subject = {
    id,
    seedKey: `seed-${id}`,
    exam: 'TYT',
    name: 'Matematik',
    slug: 'matematik',
    icon: 'calculator',
    order: 1,
    updatedAt: NOW,
  };
  await db.subjects.add(subject);
  return subject;
}

function photo(id: string, examId: string | undefined, subjectId: string, topicId?: string): Photo {
  return {
    id,
    examId,
    examType: 'TYT',
    subjectId,
    topicId,
    note: `${id} notu`,
    blob: new Blob(['buyuk']),
    thumbBlob: new Blob(['kucuk']),
    width: 10,
    height: 10,
    mastered: false,
    practiceCount: 0,
    createdAt: NOW,
  };
}

function review(id: string, topicId: string): ActivityLog {
  return {
    id,
    type: 'topic_review',
    topicId,
    source: 'manual',
    createdAt: NOW,
  };
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Blob okunamadı'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('Blob okunamadı'));
    reader.readAsArrayBuffer(blob);
  });
}

beforeEach(async () => {
  await resetDb();
});

test('özel konu silme senkron satırları tombstone bırakır, listelerden gizler', async () => {
  const subject = await seedSubject();
  const topic = await addCustomTopic(subject.id, 'Limit');
  await saveNote(topic.id, '<p>Limit notu</p>', 'Limit notu');
  await setTopicDone(topic.id, true);
  await db.activityLogs.add(review('review-1', topic.id));
  await db.topicBooks.add({
    id: 'tb-1',
    topicId: topic.id,
    bookId: 'book-1',
    totalTests: 5,
    solvedTests: 2,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.attachments.add({
    id: 'attachment-1',
    topicId: topic.id,
    name: 'cozum.png',
    mime: 'image/png',
    size: 3,
    blob: new Blob(['abc']),
    createdAt: NOW,
  });
  const linkedPhoto = photo('photo-1', undefined, subject.id, topic.id);
  await db.photos.add(linkedPhoto);
  await db.photoSearch.put(toPhotoSearch(linkedPhoto));

  await deleteCustomTopicCascade(topic.id);

  const storedTopic = await db.topics.get(topic.id);
  expect(storedTopic?.deletedAt).toEqual(expect.any(String));
  expect(storedTopic?.updatedAt).toEqual(expect.any(String));

  const storedNote = await db.notes.get(topic.id);
  expect(storedNote?.deletedAt).toEqual(expect.any(String));
  expect(storedNote?.updatedAt).toEqual(expect.any(String));

  const storedProgress = await db.topicProgress.where('topicId').equals(topic.id).toArray();
  expect(storedProgress).toHaveLength(1);
  expect(storedProgress[0].deletedAt).toEqual(expect.any(String));

  // Legacy, non-synced rows keep their current hard-delete/unlink behaviour.
  expect(await db.topicBooks.where('topicId').equals(topic.id).count()).toBe(0);
  expect(await db.attachments.where('topicId').equals(topic.id).count()).toBe(0);
  expect((await db.photos.get('photo-1'))?.topicId).toBeUndefined();
  expect((await db.photoSearch.get('photo-1'))?.topicId).toBeUndefined();

  expect(await getTopic(topic.id)).toBeUndefined();
  expect(await listTopics(subject.id)).toEqual([]);
  expect(await listAllTopics()).toEqual([]);
  expect(await getNote(topic.id)).toBeUndefined();
  expect(await getTopicDone(topic.id)).toBe(false);
  expect(await listAllTopicProgress()).toEqual([]);
  expect(await listTopicReviews(topic.id)).toEqual([]);

  // Review history is append-only: the row stays, only a tombstone is added.
  expect((await db.activityLogs.get('review-1'))?.deletedAt).toEqual(expect.any(String));

  // Search reads topics and notes directly, so it must filter tombstones too.
  expect(await searchAll('Limit')).toEqual([]);
});

test('tombstone durum satırı setTopicDone(true) ile yeniden etkinleşir', async () => {
  const subject = await seedSubject();
  const topic = await addCustomTopic(subject.id, 'Limit');
  await setTopicDone(topic.id, true);
  await deleteCustomTopicCascade(topic.id);

  expect(await getTopicDone(topic.id)).toBe(false);

  const revived = await setTopicDone(topic.id, true);

  expect(revived.deletedAt).toBeUndefined();
  expect(await getTopicDone(topic.id)).toBe(true);
  const stored = await db.topicProgress.get(revived.id);
  expect(stored?.deletedAt).toBeUndefined();
  expect(stored?.done).toBe(true);
});

test('aynı adla yeni özel konu eklenince yeni satır oluşur, eski tombstone kalır', async () => {
  const subject = await seedSubject();
  const first = await addCustomTopic(subject.id, 'Limit');
  await deleteCustomTopicCascade(first.id);

  const second = await addCustomTopic(subject.id, 'Limit');

  expect(second.id).not.toBe(first.id);
  expect(second.updatedAt).toEqual(expect.any(String));
  expect(await listTopics(subject.id)).toEqual([second]);
  expect((await db.topics.get(first.id))?.deletedAt).toEqual(expect.any(String));
});

test('deneme silme deneme ve sonuçları tombstone bırakır, fotoğraf bağını çözer', async () => {
  const subject = await seedSubject();
  const exam = await saveExam({
    type: 'TYT',
    name: 'Silinecek Deneme',
    date: '2026-11-17',
    results: [{ subjectId: subject.id, correct: 10, wrong: 2, blank: 1 }],
  });
  const linkedPhoto = photo('photo-1', exam.id, subject.id);
  await db.photos.add(linkedPhoto);
  await db.photoSearch.put(toPhotoSearch(linkedPhoto));

  await deleteExamUnlinkPhotos(exam.id);

  expect((await db.exams.get(exam.id))?.deletedAt).toEqual(expect.any(String));
  const storedResults = await db.examResults.where('examId').equals(exam.id).toArray();
  expect(storedResults).toHaveLength(1);
  expect(storedResults[0].deletedAt).toEqual(expect.any(String));

  expect(await getExam(exam.id)).toBeUndefined();
  expect(await listExams()).toEqual([]);
  expect(await listExamResults(exam.id)).toEqual([]);
  expect(await listAllExamResults()).toEqual([]);

  expect((await db.photos.get('photo-1'))?.examId).toBeUndefined();
  expect((await db.photoSearch.get('photo-1'))?.examId).toBeUndefined();
});

test('silinen deneme aynı kimlikle yeniden kaydedilince ve sonuç yeniden eklenince canlanır', async () => {
  const subject = await seedSubject();
  const exam = await saveExam({
    type: 'TYT',
    name: 'Eski Deneme',
    date: '2026-11-17',
    results: [{ subjectId: subject.id, correct: 10, wrong: 2, blank: 1 }],
  });
  await deleteExamUnlinkPhotos(exam.id);

  const revived = await saveExam({
    id: exam.id,
    type: 'TYT',
    name: 'Canlanan Deneme',
    date: '2026-11-18',
    results: [{ subjectId: subject.id, correct: 12, wrong: 1, blank: 0 }],
  });

  expect(revived.id).toBe(exam.id);
  const storedExam = await db.exams.get(exam.id);
  expect(storedExam?.deletedAt).toBeUndefined();
  expect(storedExam?.updatedAt).toEqual(expect.any(String));
  expect(await getExam(exam.id)).toMatchObject({ name: 'Canlanan Deneme' });

  const results = await listExamResults(exam.id);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ subjectId: subject.id, correct: 12, net: 11.75 });
  expect((await db.examResults.get(results[0].id))?.deletedAt).toBeUndefined();
});

test('deneme düzenlenince çıkarılan sonuç tombstone alır, aktif sonuçlar görünür', async () => {
  const subject = await seedSubject();
  const secondSubject = await seedSubject('subject-2');
  const exam = await saveExam({
    type: 'TYT',
    name: 'Düzenlenecek',
    date: '2026-11-17',
    results: [
      { subjectId: subject.id, correct: 10, wrong: 2, blank: 1 },
      { subjectId: secondSubject.id, correct: 5, wrong: 0, blank: 5 },
    ],
  });
  const firstResult = (await db.examResults.where('examId').equals(exam.id).toArray()).find(
    (row) => row.subjectId === subject.id,
  );
  expect(firstResult).toBeDefined();

  await saveExam({
    id: exam.id,
    type: 'TYT',
    name: 'Düzenlenecek',
    date: '2026-11-17',
    results: [{ subjectId: secondSubject.id, correct: 8, wrong: 1, blank: 1 }],
  });

  expect((await db.examResults.get(firstResult!.id))?.deletedAt).toEqual(expect.any(String));
  const active = await listExamResults(exam.id);
  expect(active).toHaveLength(1);
  expect(active[0].subjectId).toBe(secondSubject.id);
});

test('yedek tombstone satırları taşır, sayaçlar yalnızca aktif satırları sayar', async () => {
  const subject = await seedSubject();
  const keptTopic = await addCustomTopic(subject.id, 'Türev');
  const removedTopic = await addCustomTopic(subject.id, 'Limit');
  await saveNote(removedTopic.id, '<p>Silinen not</p>', 'Silinen not');
  await setTopicDone(removedTopic.id, true);
  await deleteCustomTopicCascade(removedTopic.id);

  const keptExam = await saveExam({
    type: 'TYT',
    name: 'Kalacak Deneme',
    date: '2026-11-17',
    results: [{ subjectId: subject.id, correct: 10, wrong: 0, blank: 0 }],
  });
  const removedExam = await saveExam({
    type: 'TYT',
    name: 'Silinecek Deneme',
    date: '2026-11-18',
    results: [{ subjectId: subject.id, correct: 5, wrong: 0, blank: 5 }],
  });
  await deleteExamUnlinkPhotos(removedExam.id);

  const exported = await exportBackup();
  const zip = await JSZip.loadAsync(await blobToArrayBuffer(exported));
  const data = JSON.parse((await zip.file('veri.json')!.async('string')) as string) as Record<
    string,
    Array<Record<string, unknown>>
  >;
  const manifest = JSON.parse(
    (await zip.file('manifest.json')!.async('string')) as string,
  ) as { counts: Record<string, number> };

  expect(data.topics.find((row) => row.id === removedTopic.id)?.deletedAt).toEqual(
    expect.any(String),
  );
  expect(data.notes.find((row) => row.topicId === removedTopic.id)?.deletedAt).toEqual(
    expect.any(String),
  );
  expect(
    data.topicProgress.find((row) => row.topicId === removedTopic.id)?.deletedAt,
  ).toEqual(expect.any(String));
  expect(data.exams.find((row) => row.id === removedExam.id)?.deletedAt).toEqual(
    expect.any(String),
  );
  expect(
    data.examResults
      .filter((row) => row.examId === removedExam.id)
      .every((row) => row.deletedAt !== undefined),
  ).toBe(true);

  expect(data.topics).toHaveLength(2);
  expect(manifest.counts.topics).toBe(1);
  expect(manifest.counts.notes).toBe(0);
  expect(manifest.counts.topicProgress).toBe(0);
  expect(data.exams).toHaveLength(2);
  expect(manifest.counts.exams).toBe(1);
  expect(manifest.counts.examResults).toBe(1);

  const summary = await readBackupSummary(new File([exported], 'tombstone.zip'));
  expect(summary.counts).toMatchObject({
    topics: 1,
    notes: 0,
    topicProgress: 0,
    exams: 1,
    examResults: 1,
  });

  await resetDb();
  await importBackup(new File([exported], 'tombstone.zip'));

  expect(await listTopics(subject.id)).toEqual([keptTopic]);
  expect(await getTopic(removedTopic.id)).toBeUndefined();
  expect(await getNote(removedTopic.id)).toBeUndefined();
  expect(await listExams()).toEqual([keptExam]);
  expect(await getExam(removedExam.id)).toBeUndefined();
  expect(await listExamResults(removedExam.id)).toEqual([]);
  expect((await db.topics.get(removedTopic.id))?.deletedAt).toEqual(expect.any(String));
  expect((await db.notes.get(removedTopic.id))?.deletedAt).toEqual(expect.any(String));
  expect((await db.exams.get(removedExam.id))?.deletedAt).toEqual(expect.any(String));
});
