import type { AppSettings } from '@/domain/types';
import { db } from '@/db/db';
import { patchSettings, seedCurriculum, type CurriculumSeed } from '@/db/repositories';

export async function resetDb(): Promise<void> {
  await db.delete();
  await db.open();
}

export async function seedOnboarded(seed: CurriculumSeed, patch: Partial<AppSettings> = {}): Promise<void> {
  await resetDb();
  await seedCurriculum(seed);
  await patchSettings({ onboardingDone: true, ...patch });
  // Simulate a database that already ran the one-time startup migrations, so
  // tests seed their own tasks/legacy rows without an implicit repair pass.
  // Migration tests remove these markers explicitly.
  await db.settings.bulkPut([
    { key: 'scheduleDayIndexVersion', value: 1 },
    { key: 'legacyShelfMigrated', value: true },
  ]);
}
