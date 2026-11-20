import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';
import { SettingsProvider } from '@/app/SettingsProvider';
import { CURRICULUM } from '@/data/curriculum';
import type { BackupProgress } from '@/db/backup';
import { BackupPanel } from '@/features/settings/BackupPanel';
import { resetDb, seedOnboarded } from '@/test/fixtures';

vi.mock('file-saver', () => ({ saveAs: vi.fn() }));

const backupMocks = vi.hoisted(() => ({
  resolveExport: undefined as undefined | ((blob: Blob) => void),
}));

vi.mock('@/db/backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/backup')>();
  return {
    ...actual,
    exportBackup: vi.fn(async (onProgress?: (progress: BackupProgress) => void) => {
      onProgress?.({ phase: 'reading', percent: 0 });
      onProgress?.({ phase: 'blobs', percent: 40, current: 1, total: 3 });
      return new Promise<Blob>((resolve) => {
        backupMocks.resolveExport = resolve;
      });
    }),
  };
});

beforeEach(async () => {
  await resetDb();
  await seedOnboarded(CURRICULUM, { seedVersion: CURRICULUM.version });
  backupMocks.resolveExport = undefined;
});

test('yedek hazırlanırken yüzde ve dosya sayısı ilerlemesini gösterir', async () => {
  render(
    <SettingsProvider>
      <BackupPanel />
    </SettingsProvider>,
  );

  await userEvent.click(await screen.findByRole('button', { name: 'Yedek indir' }));

  const progressbar = await screen.findByRole('progressbar', {
    name: 'Yedek hazırlama ilerlemesi',
  });
  expect(progressbar).toHaveAttribute('aria-valuenow', '40');
  expect(screen.getByText(/%40 · 1\/3 dosya/)).toBeInTheDocument();
  expect(screen.getByText(/Zip bellekte oluşturulduğu/)).toBeInTheDocument();

  await act(async () => {
    backupMocks.resolveExport?.(new Blob(['zip'], { type: 'application/zip' }));
  });

  await waitFor(() => {
    expect(screen.getByText('Yedek indirildi.')).toBeInTheDocument();
  });
});
