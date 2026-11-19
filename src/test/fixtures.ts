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
}
