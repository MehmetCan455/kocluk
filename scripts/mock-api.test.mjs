import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import {
  DEMO_ACCOUNT,
  SYNCED_TABLES,
  startMockApi,
} from './mock-api.mjs';

/**
 * Contract tests for the local mock API (`scripts/mock-api.mjs`).
 *
 * The mock has to behave like the PHP API for every flow the SPA uses:
 * the same error envelope, cookie name, CSRF gate and sync row semantics.
 * This suite runs the real Node server on a random port and drives it over
 * HTTP, so a passing test is evidence the E2E suite can rely on it.
 */

const APP_ORIGIN = 'http://localhost:5173';
const PASSWORD = 'gizli-sifre-123';
const NEW_PASSWORD = 'yeni-sifre-456';

let baseUrl = '';
let tempDir = '';
let running = null;

function call(pathname, options = {}) {
  const {
    method = 'GET',
    cookie,
    csrf,
    body,
    origin,
    headers: extraHeaders = {},
  } = options;

  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body === undefined ? null : JSON.stringify(body);
    const headers = {
      Accept: 'application/json',
      ...(payload === null
        ? {}
        : {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...extraHeaders,
    };

    const request = httpRequest(url, { method, headers }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        let json = null;
        if (raw !== '') {
          try {
            json = JSON.parse(raw);
          } catch {
            json = null;
          }
        }
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          json,
          raw,
        });
      });
    });

    request.on('error', reject);
    if (payload !== null) {
      request.write(payload);
    }
    request.end();
  });
}

function sessionCookie(response) {
  const cookies = response.headers['set-cookie'] ?? [];
  const cookie = cookies.find((value) => value.startsWith('kocluk_session='));
  return cookie ? cookie.split(';')[0] : '';
}

async function register(email = 'kayit@example.com') {
  const response = await call('/api/auth/register', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: {
      email,
      password: PASSWORD,
      displayName: 'Kayıt Testi',
      privacyAccepted: true,
    },
  });

  expect(response.status).toBe(201);
  expect(response.json.user.email).toBe(email);
  expect(typeof response.json.csrfToken).toBe('string');

  return {
    cookie: sessionCookie(response),
    csrf: response.json.csrfToken,
    user: response.json.user,
  };
}

async function status(cookie) {
  const response = await call('/api/sync/status', { cookie });
  expect(response.status).toBe(200);
  return response.json;
}

async function push(cookie, csrf, changes) {
  const response = await call('/api/sync/push', {
    method: 'POST',
    cookie,
    csrf,
    body: { changes },
  });
  expect(response.status).toBe(200);
  return response.json;
}

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'kocluk-mock-api-'));
  running = await startMockApi({
    port: 0,
    host: '127.0.0.1',
    dataFile: path.join(tempDir, 'data.json'),
    quiet: true,
  });
  baseUrl = running.url;
});

afterAll(async () => {
  await running?.close();
  if (tempDir !== '') {
    await rm(tempDir, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  const response = await call('/api/__test__/reset', { method: 'DELETE' });
  expect(response.status).toBe(204);
});

test('sağlık, demo girişi, oturum ve CSRF kuralları', async () => {
  const health = await call('/api/health');
  expect(health.status).toBe(200);
  expect(health.json).toMatchObject({ ok: true });
  expect(typeof health.json.serverTime).toBe('string');

  const noOrigin = await call('/api/auth/login', {
    method: 'POST',
    body: { email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password },
  });
  expect(noOrigin.status).toBe(403);
  expect(noOrigin.json.error.code).toBe('csrf_failed');

  const login = await call('/api/auth/login', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password },
  });
  expect(login.status).toBe(200);
  expect(login.json.user.email).toBe(DEMO_ACCOUNT.email);

  const cookie = sessionCookie(login);
  expect(cookie).toMatch(/^kocluk_session=.+/);
  const setCookie = (login.headers['set-cookie'] ?? []).join('; ');
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('SameSite=Lax');
  expect(setCookie).toContain('Path=/');

  const session = await call('/api/auth/session', { cookie });
  expect(session.status).toBe(200);
  expect(session.json.user.email).toBe(DEMO_ACCOUNT.email);
  expect(session.json.csrfToken).toBe(login.json.csrfToken);

  const logoutWithoutCsrf = await call('/api/auth/logout', {
    method: 'POST',
    cookie,
  });
  expect(logoutWithoutCsrf.status).toBe(403);
  expect(logoutWithoutCsrf.json.error.code).toBe('csrf_failed');

  const logoutWithoutSession = await call('/api/auth/logout', {
    method: 'POST',
    csrf: login.json.csrfToken,
    origin: APP_ORIGIN,
  });
  expect(logoutWithoutSession.status).toBe(401);

  const logout = await call('/api/auth/logout', {
    method: 'POST',
    cookie,
    csrf: login.json.csrfToken,
  });
  expect(logout.status).toBe(200);
  expect(logout.json).toEqual({ ok: true });
  expect((logout.headers['set-cookie'] ?? []).join('; ')).toContain('Max-Age=0');

  const afterLogout = await call('/api/auth/session', { cookie });
  expect(afterLogout.status).toBe(401);
  expect(afterLogout.json.error.code).toBe('unauthenticated');
});

test('kayıt doğrulaması, çift e-posta, profil güncelleme ve yetki', async () => {
  const shortPassword = await call('/api/auth/register', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: {
      email: 'kisa@example.com',
      password: '123',
      displayName: 'Kısa',
      privacyAccepted: true,
    },
  });
  expect(shortPassword.status).toBe(422);
  expect(shortPassword.json.error.code).toBe('validation_failed');

  const noPrivacy = await call('/api/auth/register', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: {
      email: 'onaysiz@example.com',
      password: PASSWORD,
      displayName: 'Onaysız',
      privacyAccepted: false,
    },
  });
  expect(noPrivacy.status).toBe(422);

  const invalidForgot = await call('/api/auth/forgot-password', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { email: 'gecersiz-adres' },
  });
  expect(invalidForgot.status).toBe(422);
  expect(invalidForgot.json.error.code).toBe('validation_failed');

  const unknownForgot = await call('/api/auth/forgot-password', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { email: 'yok@example.com' },
  });
  expect(unknownForgot.status).toBe(202);
  expect(unknownForgot.json).toEqual({ ok: true });

  const account = await register('profil@example.com');

  const duplicate = await call('/api/auth/register', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: {
      email: 'PROFIL@example.com',
      password: PASSWORD,
      displayName: 'Tekrar',
      privacyAccepted: true,
    },
  });
  expect(duplicate.status).toBe(409);
  expect(duplicate.json.error.code).toBe('email_taken');

  const unauthorized = await call('/api/auth/update-profile', {
    method: 'POST',
    body: { displayName: 'Yeni Ad' },
  });
  expect(unauthorized.status).toBe(401);

  const withoutCsrf = await call('/api/auth/update-profile', {
    method: 'POST',
    cookie: account.cookie,
    body: { displayName: 'Yeni Ad' },
  });
  expect(withoutCsrf.status).toBe(403);

  const wrongCsrf = await call('/api/auth/update-profile', {
    method: 'POST',
    cookie: account.cookie,
    csrf: 'yanlis-token',
    body: { displayName: 'Yeni Ad' },
  });
  expect(wrongCsrf.status).toBe(403);

  const update = await call('/api/auth/update-profile', {
    method: 'POST',
    cookie: account.cookie,
    csrf: account.csrf,
    body: { displayName: 'Yeni Ad' },
  });
  expect(update.status).toBe(200);
  expect(update.json.user.displayName).toBe('Yeni Ad');

  const session = await call('/api/auth/session', { cookie: account.cookie });
  expect(session.json.user.displayName).toBe('Yeni Ad');
});

test('push/pull/status/full aynı zarfları ve hasData/hasUserData kurallarını döndürür', async () => {
  const account = await register('senkron@example.com');

  const empty = await status(account.cookie);
  expect(Object.keys(empty.counts).sort()).toEqual([...SYNCED_TABLES].sort());
  expect(Object.values(empty.counts).every((count) => count === 0)).toBe(true);
  expect(empty.hasData).toBe(false);
  expect(empty.hasUserData).toBe(false);
  expect(empty.cursor).toBe(0);

  const now = iso();
  const seeded = await push(account.cookie, account.csrf, [
    {
      table: 'subjects',
      op: 'upsert',
      row: {
        id: 'subject-matematik',
        seedKey: 'tyt-matematik',
        exam: 'TYT',
        name: 'Matematik',
        slug: 'matematik',
        icon: 'calculator',
        order: 1,
        updatedAt: now,
      },
    },
    {
      table: 'settings',
      op: 'upsert',
      row: {
        userId: account.user.id,
        updatedAt: now,
        onboardingDone: true,
        profileName: 'Senkron Testi',
      },
    },
  ]);
  expect(seeded.results.map((result) => result.status)).toEqual([
    'applied',
    'applied',
  ]);
  expect(seeded.serverTime).toEqual(expect.any(String));

  const seededStatus = await status(account.cookie);
  expect(seededStatus.hasData).toBe(true);
  expect(seededStatus.hasUserData).toBe(false);
  expect(seededStatus.counts.subjects).toBe(1);
  expect(seededStatus.counts.settings).toBe(1);
  expect(seededStatus.cursor).toBe(2);

  const pull = await call('/api/sync/pull?since=0&limit=500', {
    cookie: account.cookie,
  });
  expect(pull.status).toBe(200);
  expect(pull.json.hasMore).toBe(false);
  expect(pull.json.nextCursor).toBe(2);
  expect(pull.json.changes).toHaveLength(2);
  expect(pull.json.changes.map((change) => change.table).sort()).toEqual([
    'settings',
    'subjects',
  ]);

  const personal = await push(account.cookie, account.csrf, [
    {
      table: 'catalogBooks',
      op: 'upsert',
      row: {
        id: 'catalog-kitap',
        title: 'Deneme Kitabı',
        totalPages: 100,
        createdAt: now,
        updatedAt: now,
      },
    },
    {
      table: 'userBooks',
      op: 'upsert',
      row: {
        id: 'user-book',
        bookId: 'catalog-kitap',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    },
    {
      table: 'topicProgress',
      op: 'upsert',
      row: {
        id: 'progress-1',
        topicId: 'topic-1',
        done: true,
        doneAt: now,
        updatedAt: now,
      },
    },
  ]);
  expect(personal.results.every((result) => result.status === 'applied')).toBe(true);

  const personalStatus = await status(account.cookie);
  expect(personalStatus.hasUserData).toBe(true);
  expect(personalStatus.counts.catalogBooks).toBe(1);
  expect(personalStatus.counts.userBooks).toBe(1);
  expect(personalStatus.counts.topicProgress).toBe(1);

  const full = await call('/api/sync/full', { cookie: account.cookie });
  expect(full.status).toBe(200);
  expect(Object.keys(full.json.tables).sort()).toEqual([...SYNCED_TABLES].sort());
  expect(full.json.tables.userBooks).toHaveLength(1);
  expect(full.json.tables.settings).toHaveLength(1);
  expect(full.json.cursor).toBe(5);

  const unauthenticatedPush = await call('/api/sync/push', {
    method: 'POST',
    body: { changes: [] },
  });
  expect(unauthenticatedPush.status).toBe(401);
});

test('son yazan kazanır, tombstone, ayar silme ve activity log kuralları', async () => {
  const account = await register('cakisma@example.com');
  const first = iso(-60_000);
  const current = iso();
  const newer = iso(1_000);

  const create = await push(account.cookie, account.csrf, [
    {
      table: 'subjects',
      op: 'upsert',
      row: {
        id: 'subject-cakisma',
        seedKey: 'cakisma',
        exam: 'TYT',
        name: 'İlk Ad',
        slug: 'cakisma',
        icon: 'book',
        order: 1,
        updatedAt: current,
      },
    },
  ]);
  expect(create.results[0].status).toBe('applied');

  const stale = await push(account.cookie, account.csrf, [
    {
      table: 'subjects',
      op: 'upsert',
      row: {
        id: 'subject-cakisma',
        seedKey: 'cakisma',
        exam: 'TYT',
        name: 'Eski Ad',
        slug: 'cakisma',
        icon: 'book',
        order: 1,
        updatedAt: first,
      },
    },
  ]);
  expect(stale.results[0].status).toBe('conflict');
  expect(stale.results[0].row.name).toBe('İlk Ad');

  const equal = await push(account.cookie, account.csrf, [
    {
      table: 'subjects',
      op: 'upsert',
      row: {
        id: 'subject-cakisma',
        seedKey: 'cakisma',
        exam: 'TYT',
        name: 'Eşit Ad',
        slug: 'cakisma',
        icon: 'book',
        order: 1,
        updatedAt: current,
      },
    },
  ]);
  expect(equal.results[0].status).toBe('conflict');

  const updated = await push(account.cookie, account.csrf, [
    {
      table: 'subjects',
      op: 'upsert',
      row: {
        id: 'subject-cakisma',
        seedKey: 'cakisma',
        exam: 'TYT',
        name: 'Yeni Ad',
        slug: 'cakisma',
        icon: 'book',
        order: 1,
        updatedAt: newer,
      },
    },
  ]);
  expect(updated.results[0].status).toBe('applied');
  expect(updated.results[0].row.name).toBe('Yeni Ad');
  expect(updated.results[0].timeAdjusted).toBeUndefined();

  const createdBook = await push(account.cookie, account.csrf, [
    {
      table: 'userBooks',
      op: 'upsert',
      row: {
        id: 'silinecek-kitap',
        bookId: 'catalog-silinecek',
        status: 'active',
        createdAt: current,
        updatedAt: current,
      },
    },
  ]);
  expect(createdBook.results[0].status).toBe('applied');

  const beforeDelete = await status(account.cookie);
  const removed = await push(account.cookie, account.csrf, [
    {
      table: 'userBooks',
      op: 'delete',
      rowId: 'silinecek-kitap',
      updatedAt: newer,
    },
  ]);
  expect(removed.results[0].status).toBe('applied');
  expect(removed.results[0].row.deletedAt).toBeTruthy();

  const afterDelete = await status(account.cookie);
  expect(afterDelete.counts.userBooks).toBe(0);

  const tombstonePull = await call(
    `/api/sync/pull?since=${beforeDelete.cursor}&limit=500`,
    { cookie: account.cookie },
  );
  expect(tombstonePull.status).toBe(200);
  expect(tombstonePull.json.changes).toHaveLength(1);
  expect(tombstonePull.json.changes[0].row.deletedAt).toBeTruthy();

  const settings = await push(account.cookie, account.csrf, [
    {
      table: 'settings',
      op: 'upsert',
      row: { userId: account.user.id, updatedAt: current, onboardingDone: true },
    },
  ]);
  expect(settings.results[0].status).toBe('applied');
  expect(settings.results[0].row.updatedAt).toMatch(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}000Z$/,
  );

  // A newer settings update must win; the mock used to produce a malformed
  // normalized timestamp (".Z") and answer every later push with conflict.
  const newerSettings = new Date(Date.parse(current) + 1000).toISOString();
  const updatedSettings = await push(account.cookie, account.csrf, [
    {
      table: 'settings',
      op: 'upsert',
      row: {
        userId: account.user.id,
        updatedAt: newerSettings,
        onboardingDone: true,
        profileName: 'Yeni Profil',
      },
    },
  ]);
  expect(updatedSettings.results[0].status).toBe('applied');
  expect(updatedSettings.results[0].row.profileName).toBe('Yeni Profil');

  const settingsDelete = await push(account.cookie, account.csrf, [
    { table: 'settings', op: 'delete', rowId: account.user.id, updatedAt: newer },
  ]);
  expect(settingsDelete.results[0].status).toBe('error');
  expect(settingsDelete.results[0].error.code).toBe('validation_failed');

  const activity = {
    id: 'activity-1',
    type: 'topic_review',
    topicId: 'topic-1',
    taskId: 'task-1',
    source: 'manual',
    createdAt: current,
  };
  const firstActivity = await push(account.cookie, account.csrf, [
    { table: 'activityLogs', op: 'upsert', row: activity },
  ]);
  expect(firstActivity.results[0].status).toBe('applied');

  const duplicateActivity = await push(account.cookie, account.csrf, [
    {
      table: 'activityLogs',
      op: 'upsert',
      row: { ...activity, id: 'activity-2' },
    },
  ]);
  expect(duplicateActivity.results[0].status).toBe('conflict');
  expect(duplicateActivity.results[0].row.id).toBe('activity-1');

  const unknownField = await push(account.cookie, account.csrf, [
    {
      table: 'subjects',
      op: 'upsert',
      row: {
        id: 'subject-gecersiz',
        seedKey: 'gecersiz',
        exam: 'TYT',
        name: 'Geçersiz',
        slug: 'gecersiz',
        icon: 'book',
        order: 1,
        updatedAt: newer,
        userId: 'baska-hesap',
      },
    },
  ]);
  expect(unknownField.results[0].status).toBe('error');
  expect(unknownField.results[0].error.code).toBe('forbidden');
});

test('değiştirilemez alanlar güncellemede korunur', async () => {
  const account = await register('degismez@example.com');
  const now = iso();
  const later = iso(1_000);

  const subject = await push(account.cookie, account.csrf, [
    {
      table: 'subjects',
      op: 'upsert',
      row: {
        id: 'subject-degismez',
        seedKey: 'sabit-seed',
        exam: 'TYT',
        name: 'Eski Ad',
        slug: 'sabit',
        icon: 'book',
        order: 1,
        updatedAt: now,
      },
    },
  ]);
  expect(subject.results[0].status).toBe('applied');

  const changedSubject = await push(account.cookie, account.csrf, [
    {
      table: 'subjects',
      op: 'upsert',
      row: {
        id: 'subject-degismez',
        seedKey: 'yeni-seed',
        exam: 'TYT',
        name: 'Yeni Ad',
        slug: 'sabit',
        icon: 'book',
        order: 1,
        updatedAt: later,
      },
    },
  ]);
  expect(changedSubject.results[0].status).toBe('applied');
  expect(changedSubject.results[0].row.seedKey).toBe('sabit-seed');
  expect(changedSubject.results[0].row.name).toBe('Yeni Ad');

  const book = await push(account.cookie, account.csrf, [
    {
      table: 'userBooks',
      op: 'upsert',
      row: {
        id: 'book-degismez',
        bookId: 'catalog-sabit',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
    },
  ]);
  expect(book.results[0].status).toBe('applied');

  const changedBook = await push(account.cookie, account.csrf, [
    {
      table: 'userBooks',
      op: 'upsert',
      row: {
        id: 'book-degismez',
        bookId: 'catalog-yeni',
        status: 'completed',
        createdAt: now,
        updatedAt: later,
      },
    },
  ]);
  expect(changedBook.results[0].status).toBe('applied');
  expect(changedBook.results[0].row.bookId).toBe('catalog-sabit');
  expect(changedBook.results[0].row.status).toBe('completed');

  const result = await push(account.cookie, account.csrf, [
    {
      table: 'examResults',
      op: 'upsert',
      row: {
        id: 'result-degismez',
        examId: 'exam-sabit',
        subjectId: 'subject-sabit',
        correct: 1,
        wrong: 0,
        blank: 0,
        net: 1,
        updatedAt: now,
      },
    },
  ]);
  expect(result.results[0].status).toBe('applied');

  const changedResult = await push(account.cookie, account.csrf, [
    {
      table: 'examResults',
      op: 'upsert',
      row: {
        id: 'result-degismez',
        examId: 'exam-yeni',
        subjectId: 'subject-yeni',
        correct: 2,
        wrong: 0,
        blank: 0,
        net: 2,
        updatedAt: later,
      },
    },
  ]);
  expect(changedResult.results[0].status).toBe('applied');
  expect(changedResult.results[0].row.examId).toBe('exam-sabit');
  expect(changedResult.results[0].row.subjectId).toBe('subject-sabit');
  expect(changedResult.results[0].row.correct).toBe(2);

  const week = await push(account.cookie, account.csrf, [
    {
      table: 'scheduleWeeks',
      op: 'upsert',
      row: {
        id: 'week-degismez',
        weekStart: '2026-11-23',
        note: 'Eski not',
        createdAt: now,
        updatedAt: now,
      },
    },
  ]);
  expect(week.results[0].status).toBe('applied');

  const changedWeek = await push(account.cookie, account.csrf, [
    {
      table: 'scheduleWeeks',
      op: 'upsert',
      row: {
        id: 'week-degismez',
        weekStart: '2026-11-30',
        note: 'Yeni not',
        createdAt: now,
        updatedAt: later,
      },
    },
  ]);
  expect(changedWeek.results[0].status).toBe('applied');
  expect(changedWeek.results[0].row.weekStart).toBe('2026-11-23');
  expect(changedWeek.results[0].row.note).toBe('Yeni not');

  const progress = await push(account.cookie, account.csrf, [
    {
      table: 'topicProgress',
      op: 'upsert',
      row: {
        id: 'progress-degismez',
        topicId: 'topic-sabit',
        done: false,
        updatedAt: now,
      },
    },
  ]);
  expect(progress.results[0].status).toBe('applied');

  const changedProgress = await push(account.cookie, account.csrf, [
    {
      table: 'topicProgress',
      op: 'upsert',
      row: {
        id: 'progress-degismez',
        topicId: 'topic-yeni',
        done: true,
        updatedAt: later,
      },
    },
  ]);
  expect(changedProgress.results[0].status).toBe('applied');
  expect(changedProgress.results[0].row.topicId).toBe('topic-sabit');
  expect(changedProgress.results[0].row.done).toBe(true);
});

test('şifre değişimi oturumları/CSRFyi döndürür; sıfırlama ve doğrulama çalışır', async () => {
  const account = await register('sifre@example.com');

  const secondLogin = await call('/api/auth/login', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { email: 'sifre@example.com', password: PASSWORD },
  });
  expect(secondLogin.status).toBe(200);
  const secondCookie = sessionCookie(secondLogin);

  const change = await call('/api/auth/change-password', {
    method: 'POST',
    cookie: account.cookie,
    csrf: account.csrf,
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  expect(change.status).toBe(200);
  expect(change.json.user.email).toBe('sifre@example.com');
  expect(change.json.csrfToken).not.toBe(account.csrf);

  const newCookie = sessionCookie(change);
  const rotatedSession = await call('/api/auth/session', { cookie: newCookie });
  expect(rotatedSession.status).toBe(200);

  const revokedOther = await call('/api/auth/session', { cookie: secondCookie });
  expect(revokedOther.status).toBe(401);

  const oldCookie = await call('/api/auth/session', { cookie: account.cookie });
  expect(oldCookie.status).toBe(401);

  const oldCsrf = await call('/api/auth/update-profile', {
    method: 'POST',
    cookie: newCookie,
    csrf: account.csrf,
    body: { displayName: 'Eski Token' },
  });
  expect(oldCsrf.status).toBe(403);

  const newCsrf = await call('/api/auth/update-profile', {
    method: 'POST',
    cookie: newCookie,
    csrf: change.json.csrfToken,
    body: { displayName: 'Yeni Token' },
  });
  expect(newCsrf.status).toBe(200);
  expect(newCsrf.json.user.displayName).toBe('Yeni Token');

  const forgot = await call('/api/auth/forgot-password', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { email: 'sifre@example.com' },
  });
  expect(forgot.status).toBe(202);
  expect(forgot.json).toEqual({ ok: true });

  const tokens = await call('/api/__test__/tokens?email=sifre%40example.com');
  expect(tokens.status).toBe(200);
  expect(typeof tokens.json.resetToken).toBe('string');

  const emptyReset = await call('/api/auth/reset-password', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { token: '', password: 'ucuncu-sifre-789' },
  });
  expect(emptyReset.status).toBe(422);
  expect(emptyReset.json.error.code).toBe('validation_failed');

  const unknownReset = await call('/api/auth/reset-password', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { token: 'olmayan-token', password: 'ucuncu-sifre-789' },
  });
  expect(unknownReset.status).toBe(410);
  expect(unknownReset.json.error.code).toBe('invalid_token');

  const reset = await call('/api/auth/reset-password', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { token: tokens.json.resetToken, password: 'ucuncu-sifre-789' },
  });
  expect(reset.status).toBe(200);
  expect(reset.json).toEqual({ ok: true });

  const revokedAfterReset = await call('/api/auth/session', { cookie: newCookie });
  expect(revokedAfterReset.status).toBe(401);

  const oldPasswordLogin = await call('/api/auth/login', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { email: 'sifre@example.com', password: NEW_PASSWORD },
  });
  expect(oldPasswordLogin.status).toBe(401);

  const newPasswordLogin = await call('/api/auth/login', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { email: 'sifre@example.com', password: 'ucuncu-sifre-789' },
  });
  expect(newPasswordLogin.status).toBe(200);

  const verifyAccount = await register('dogrula@example.com');
  const verifyTokens = await call('/api/__test__/tokens?email=dogrula%40example.com');
  expect(typeof verifyTokens.json.verificationToken).toBe('string');

  const verify = await call('/api/auth/verify-email', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { token: verifyTokens.json.verificationToken },
  });
  expect(verify.status).toBe(200);
  expect(verify.json).toEqual({ ok: true });

  const verifiedSession = await call('/api/auth/session', {
    cookie: verifyAccount.cookie,
  });
  expect(verifiedSession.status).toBe(200);
  expect(typeof verifiedSession.json.user.emailVerifiedAt).toBe('string');

  const reused = await call('/api/auth/verify-email', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { token: verifyTokens.json.verificationToken },
  });
  expect(reused.status).toBe(410);
  expect(reused.json.error.code).toBe('invalid_token');
});

test('schedulePageChains push/pull round-trip yapar', async () => {
  const account = await register('zincir@example.com');
  const now = iso();
  const row = {
    id: 'chain-1',
    weekId: 'week-1',
    rowId: 'row-1',
    userBookId: 'book-1',
    startPage: 100,
    endPage: 150,
    chunkSize: 10,
    chunkCount: 5,
    slots: '[{"taskId":"task-1","slotIndex":0,"chunkIndex":0,"dayIndex":1}]',
    createdAt: now,
    updatedAt: now,
  };

  const pushed = await push(account.cookie, account.csrf, [
    { table: 'schedulePageChains', op: 'upsert', row },
  ]);
  expect(pushed.results[0].status).toBe('applied');

  const pulled = await call('/api/sync/pull?since=0&limit=500', {
    cookie: account.cookie,
  });
  const change = pulled.json.changes.find(
    (item) => item.table === 'schedulePageChains',
  );
  expect(change.row).toMatchObject({
    id: 'chain-1',
    chunkCount: 5,
    slots: row.slots,
  });

  const full = await call('/api/sync/full', { cookie: account.cookie });
  expect(full.json.tables.schedulePageChains).toHaveLength(1);
});

test('hesap silme veriyi ve oturumları kaldırır; test reset temiz başlatır', async () => {
  const account = await register('silinecek@example.com');

  const wrongPassword = await call('/api/auth/delete-account', {
    method: 'POST',
    cookie: account.cookie,
    csrf: account.csrf,
    body: { password: 'yanlis-sifre' },
  });
  expect(wrongPassword.status).toBe(403);
  expect(wrongPassword.json.error.code).toBe('invalid_password');

  const deleted = await call('/api/auth/delete-account', {
    method: 'POST',
    cookie: account.cookie,
    csrf: account.csrf,
    body: { password: PASSWORD },
  });
  expect(deleted.status).toBe(200);
  expect(deleted.json).toEqual({ ok: true });
  expect((deleted.headers['set-cookie'] ?? []).join('; ')).toContain('Max-Age=0');

  const oldSession = await call('/api/auth/session', { cookie: account.cookie });
  expect(oldSession.status).toBe(401);

  const oldLogin = await call('/api/auth/login', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { email: 'silinecek@example.com', password: PASSWORD },
  });
  expect(oldLogin.status).toBe(401);
  expect(oldLogin.json.error.code).toBe('invalid_credentials');

  const reset = await call('/api/__test__/reset', { method: 'DELETE' });
  expect(reset.status).toBe(204);

  const demoLogin = await call('/api/auth/login', {
    method: 'POST',
    origin: APP_ORIGIN,
    body: { email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password },
  });
  expect(demoLogin.status).toBe(200);

  const demoStatus = await status(sessionCookie(demoLogin));
  expect(demoStatus.hasData).toBe(false);
  expect(demoStatus.hasUserData).toBe(false);
  expect(demoStatus.cursor).toBe(0);
});
