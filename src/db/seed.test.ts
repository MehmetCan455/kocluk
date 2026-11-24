import Dexie from 'dexie';
import { expect, test } from 'vitest';
import type { Subject, Topic } from '@/domain/types';
import { KoclukDB, db, getActiveDbOrNull, setActiveDb } from '@/db/db';
import { seedCurriculum, type CurriculumSeed } from '@/db/repositories';
import { deterministicId } from '@/lib/deterministicId';
import { SUBJECT_NAMESPACE, TOPIC_NAMESPACE } from '@/lib/namespaces';

const CURRICULUM: CurriculumSeed = {
  version: 1,
  subjects: [
    {
      seedKey: 'tyt-mat',
      exam: 'TYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 1,
      topics: [
        { seedKey: 'tyt-mat-turev', name: 'Türev', order: 1 },
        { seedKey: 'tyt-mat-integral', name: 'İntegral', order: 2 },
      ],
    },
    {
      seedKey: 'tyt-fiz',
      exam: 'TYT',
      name: 'Fizik',
      slug: 'fizik',
      icon: 'atom',
      order: 2,
      topics: [{ seedKey: 'tyt-fiz-kuvvet', name: 'Kuvvet', order: 1 }],
    },
  ],
};

interface SeededRows {
  subjects: Subject[];
  topics: Topic[];
}

/**
 * Seeds a named database as if it were another device, then restores the
 * shared test database so the next test starts from the same place.
 */
async function seedDevice(name: string): Promise<SeededRows> {
  const home = getActiveDbOrNull();
  const database = new KoclukDB(name);
  try {
    await database.open();
    setActiveDb(database);
    await seedCurriculum(CURRICULUM);
    return {
      subjects: await database.subjects.toArray(),
      topics: await database.topics.toArray(),
    };
  } finally {
    setActiveDb(home);
    await database.close();
    await Dexie.delete(name);
  }
}

function idsBySeedKey(rows: Array<{ seedKey?: string; id: string }>): Map<string, string> {
  return new Map(
    rows
      .filter((row): row is { seedKey: string; id: string } => row.seedKey !== undefined)
      .map((row) => [row.seedKey, row.id]),
  );
}

test('iki cihaz aynı seedKey için aynı ders ve konu kimliklerini üretir', async () => {
  const first = await seedDevice('kocluk-seed-device-a');
  const second = await seedDevice('kocluk-seed-device-b');

  expect(idsBySeedKey(second.subjects)).toEqual(idsBySeedKey(first.subjects));
  expect(idsBySeedKey(second.topics)).toEqual(idsBySeedKey(first.topics));
  expect(idsBySeedKey(first.subjects).get('tyt-mat')).toBe(
    deterministicId(SUBJECT_NAMESPACE, 'tyt-mat'),
  );
  expect(idsBySeedKey(first.topics).get('tyt-mat-turev')).toBe(
    deterministicId(TOPIC_NAMESPACE, 'tyt-mat-turev'),
  );
});

test('yeni ders ve konu satırlarına updatedAt yazar', async () => {
  await seedCurriculum(CURRICULUM);

  const subjects = await db.subjects.toArray();
  const topics = await db.topics.toArray();
  expect(subjects).toHaveLength(2);
  expect(topics).toHaveLength(3);
  for (const row of [...subjects, ...topics]) {
    expect(row.updatedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(row.updatedAt ?? ''))).toBe(false);
  }
});

test('mevcut ders ve konu kimliklerini korur', async () => {
  await db.subjects.add({
    id: 'legacy-subject',
    seedKey: 'tyt-mat',
    exam: 'TYT',
    name: 'Matematik (elle)',
    slug: 'matematik',
    icon: 'calculator',
    order: 1,
  });
  await db.topics.add({
    id: 'legacy-topic',
    seedKey: 'tyt-mat-turev',
    subjectId: 'legacy-subject',
    name: 'Türev (elle)',
    order: 1,
    isCustom: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  });

  await seedCurriculum(CURRICULUM);

  expect(await db.subjects.count()).toBe(2);
  expect(await db.topics.count()).toBe(3);
  expect(await db.subjects.get('legacy-subject')).toMatchObject({
    seedKey: 'tyt-mat',
    name: 'Matematik (elle)',
  });
  expect(await db.topics.get('legacy-topic')).toMatchObject({
    seedKey: 'tyt-mat-turev',
    subjectId: 'legacy-subject',
    name: 'Türev (elle)',
  });

  // New rows still get deterministic ids, and their subject links point at
  // the preserved legacy subject id.
  const integral = await db.topics.where('seedKey').equals('tyt-mat-integral').first();
  expect(integral).toMatchObject({
    id: deterministicId(TOPIC_NAMESPACE, 'tyt-mat-integral'),
    subjectId: 'legacy-subject',
  });
  expect((await db.subjects.where('seedKey').equals('tyt-fiz').first())?.id).toBe(
    deterministicId(SUBJECT_NAMESPACE, 'tyt-fiz'),
  );
});
