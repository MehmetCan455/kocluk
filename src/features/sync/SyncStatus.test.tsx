import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import type { SyncState } from '@/db/sync/engine';
import { markDead } from '@/db/sync/queue';
import { seedOnboarded } from '@/test/fixtures';
import { installMockApi, type MockApi } from '@/test/mockApi';
import { renderApp } from '@/test/renderApp';
import { SyncStatus } from './SyncStatus';

function state(overrides: Partial<SyncState> = {}): SyncState {
  return {
    status: 'synced',
    pending: 0,
    dead: 0,
    lastSyncAt: '2026-11-24T10:00:00.000Z',
    serverTime: '2026-11-24T10:00:00.000Z',
    clockSkewMs: 0,
    error: null,
    ...overrides,
  };
}

let mockApi: MockApi | null = null;

afterEach(() => {
  mockApi?.restore();
  mockApi = null;
});

test('senkron durumunu, son senkronu ve sayaçları gösterir', () => {
  const { rerender } = render(<SyncStatus state={state()} />);

  expect(screen.getByRole('heading', { name: 'Senkron' })).toBeInTheDocument();
  expect(screen.getByText('Senkronize')).toBeInTheDocument();
  expect(screen.getByText('Bekleyen kayıt: 0')).toBeInTheDocument();
  expect(screen.getByText('Gönderilemeyen kayıt: 0')).toBeInTheDocument();
  expect(screen.getByText(/Son senkron:/)).toBeInTheDocument();

  rerender(<SyncStatus state={state({ status: 'pending', pending: 2 })} />);
  expect(screen.getByText('Bekleyen değişiklikler var')).toBeInTheDocument();
  expect(screen.getByText('Bekleyen kayıt: 2')).toBeInTheDocument();
});

test('henüz senkronize edilmediyse bunu söyler', () => {
  render(<SyncStatus state={state({ lastSyncAt: null })} />);
  expect(screen.getByText('Henüz senkronize edilmedi.')).toBeInTheDocument();
});

test('çevrimdışı ve hata durumlarını gösterir', () => {
  const { rerender } = render(<SyncStatus state={state({ status: 'offline' })} />);
  expect(screen.getByText('Çevrimdışı')).toBeInTheDocument();

  rerender(
    <SyncStatus
      state={state({
        status: 'error',
        error: 'Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.',
      })}
    />,
  );
  expect(screen.getByText('Senkron hatası')).toBeInTheDocument();
  expect(
    screen.getByText('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.'),
  ).toBeInTheDocument();
});

test('ölü kayıt sayısı gösterilir', () => {
  render(<SyncStatus state={state({ status: 'error', dead: 3 })} />);
  expect(screen.getByText('Gönderilemeyen kayıt: 3')).toBeInTheDocument();
});

test('"Şimdi senkronize et" elle senkronu tetikler', async () => {
  const onSyncNow = vi.fn();
  render(<SyncStatus state={state()} onSyncNow={onSyncNow} />);

  await userEvent.click(screen.getByRole('button', { name: 'Şimdi senkronize et' }));
  expect(onSyncNow).toHaveBeenCalledTimes(1);
});

test('senkron sürerken düğme devre dışıdır', () => {
  render(<SyncStatus state={state({ status: 'syncing' })} />);
  expect(screen.getByText('Senkronize ediliyor…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Şimdi senkronize et' })).toBeDisabled();
});

test('saat farkı 5 dakikadan fazlaysa cihaz saati uyarısı gösterir', () => {
  const { rerender } = render(
    <SyncStatus state={state({ clockSkewMs: 6 * 60_000 })} />,
  );
  expect(screen.getByText('Cihaz saatinizi düzeltin')).toBeInTheDocument();
  expect(
    screen.getByText(/Saat farkı, son yazan kazanır kuralını etkileyebilir/),
  ).toBeInTheDocument();

  rerender(<SyncStatus state={state({ clockSkewMs: 2 * 60_000 })} />);
  expect(screen.queryByText('Cihaz saatinizi düzeltin')).not.toBeInTheDocument();

  rerender(
    <SyncStatus
      state={state({ clockSkewMs: null, serverTime: new Date(Date.now() - 6 * 60_000).toISOString() })}
    />,
  );
  expect(screen.getByText('Cihaz saatinizi düzeltin')).toBeInTheDocument();
});

test('ölü kayıtlar listelenir ve tekrar denenebilir', async () => {
  await db.userBooks.put({
    id: 'ub-dead',
    bookId: 'book-dead',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.syncQueue.put({
    id: 'userBooks:ub-dead',
    table: 'userBooks',
    rowId: 'ub-dead',
    op: 'upsert',
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
    attempts: 1,
    status: 'pending',
    lastError: null,
  });
  await markDead(db, 'userBooks:ub-dead', 'validation_failed: bozuk alan');

  const onSyncNow = vi.fn();
  render(<SyncStatus state={state({ status: 'error', dead: 1 })} onSyncNow={onSyncNow} />);

  expect(
    await screen.findByText('userBooks · ub-dead'),
  ).toBeInTheDocument();
  expect(screen.getByText(/validation_failed/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }));

  await waitFor(async () => {
    expect((await db.syncQueue.get('userBooks:ub-dead'))?.status).toBe('pending');
  });
  expect(onSyncNow).toHaveBeenCalled();
});

test('ölü kayıt yerel olarak silinebilir', async () => {
  await db.userBooks.put({
    id: 'ub-discard',
    bookId: 'book-discard',
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.syncQueue.put({
    id: 'userBooks:ub-discard',
    table: 'userBooks',
    rowId: 'ub-discard',
    op: 'upsert',
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
    attempts: 1,
    status: 'pending',
    lastError: null,
  });
  await markDead(db, 'userBooks:ub-discard', 'validation_failed');

  const onSyncNow = vi.fn();
  render(
    <SyncStatus state={state({ status: 'error', dead: 1 })} onSyncNow={onSyncNow} />,
  );

  await screen.findByText('userBooks · ub-discard');
  await userEvent.click(screen.getByRole('button', { name: 'Yerel kaydı sil' }));

  await waitFor(async () => {
    expect(await db.userBooks.get('ub-discard')).toBeUndefined();
  });
  expect(await db.syncQueue.get('userBooks:ub-discard')).toBeUndefined();
  expect(onSyncNow).toHaveBeenCalled();
});

test('üst çubuk göstergesi durum bağlantısı ve bekleyen sayısını verir', () => {
  render(
    <MemoryRouter>
      <SyncStatus
        variant="bar"
        state={state({ status: 'pending', pending: 2 })}
      />
    </MemoryRouter>,
  );

  const link = screen.getByRole('link', { name: /Senkron durumu: Bekleyen değişiklikler var/ });
  expect(link).toHaveAttribute('href', '/ayarlar');
  expect(link).toHaveTextContent('2');
});

test('Ayarlar sayfasında canlı durum ve elle senkron çalışır', async () => {
  await seedOnboarded({ version: 1, subjects: [] });
  mockApi = installMockApi({
    'GET /api/sync/pull': {
      body: { changes: [], nextCursor: 0, hasMore: false },
    },
    'GET /api/sync/status': {
      body: {
        hasData: false,
        counts: {},
        cursor: 0,
        serverTime: new Date().toISOString(),
      },
    },
  });

  renderApp('/ayarlar');

  const button = await screen.findByRole('button', { name: 'Şimdi senkronize et' });
  await waitFor(() => {
    expect(mockApi?.callsTo('GET', '/api/sync/status')).toHaveLength(1);
  });
  expect(await screen.findByText(/Son senkron:/)).toBeInTheDocument();

  await userEvent.click(button);
  await waitFor(() => {
    expect(mockApi?.callsTo('GET', '/api/sync/status')).toHaveLength(2);
  });
});

test('masaüstü kenar çubuğunda da senkron göstergesi vardır', async () => {
  await seedOnboarded({ version: 1, subjects: [] });
  mockApi = installMockApi({
    'GET /api/sync/pull': {
      body: { changes: [], nextCursor: 0, hasMore: false },
    },
    'GET /api/sync/status': {
      body: {
        hasData: false,
        counts: {},
        cursor: 0,
        serverTime: new Date().toISOString(),
      },
    },
  });

  renderApp('/ayarlar');
  await screen.findByRole('button', { name: 'Şimdi senkronize et' });

  expect(
    screen.getAllByRole('link', { name: /Senkron durumu:/ }).length,
  ).toBeGreaterThan(0);
});

test('pull edilen ayarlar yeniden yükleme olmadan görünür', async () => {
  await seedOnboarded(
    { version: 1, subjects: [] },
    { profileName: 'Yerel Profil', examName: 'Yerel Sınav' },
  );

  let deliverSettings = false;
  const emptyPull = { changes: [], nextCursor: 0, hasMore: false };
  const serverSettingsRow = {
    userId: 'test-user',
    profileName: 'Sunucu Profili',
    examName: 'Sunucu Sınavı',
    examDate: '2027-06-20',
    hiddenSubjects: [],
    onboardingDone: true,
    updatedAt: new Date().toISOString(),
  };

  mockApi = installMockApi({
    'GET /api/sync/pull': () => ({
      body: deliverSettings
        ? {
            changes: [{ table: 'settings', row: serverSettingsRow }],
            nextCursor: 1,
            hasMore: false,
          }
        : emptyPull,
    }),
    'GET /api/sync/status': {
      body: {
        hasData: true,
        counts: {},
        cursor: 1,
        serverTime: new Date().toISOString(),
      },
    },
  });

  renderApp('/ayarlar');

  const profile = await screen.findByLabelText('Ad soyad');
  expect(profile).toHaveValue('Yerel Profil');
  expect(screen.getByLabelText('Sınav adı')).toHaveValue('Yerel Sınav');

  deliverSettings = true;
  await userEvent.click(screen.getByRole('button', { name: 'Şimdi senkronize et' }));

  await waitFor(() => {
    expect(profile).toHaveValue('Sunucu Profili');
  });
  expect(screen.getByLabelText('Sınav adı')).toHaveValue('Sunucu Sınavı');
});
