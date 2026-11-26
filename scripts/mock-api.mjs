#!/usr/bin/env node
/**
 * Local mock API for preview and E2E (design §9.1, §9.5, plan Task 15).
 *
 * This is NOT production code. It mirrors the PHP API wire contract closely
 * enough for the SPA:
 *   * same paths, envelopes, status codes and `kocluk_session` cookie;
 *   * CSRF on every authenticated write and on public writes made with a
 *     session; public writes without a session trust a loopback Origin;
 *   * `hasData` / `hasUserData`, last-writer-wins pushes, tombstones, natural
 *     key conflicts and the pull cursor;
 *   * in-memory data persisted to a gitignored JSON file between restarts.
 *
 * Passwords are hashed with scrypt and session/token values are stored as
 * SHA-256 digests. The only intentional test hooks are
 * `DELETE /api/__test__/reset` and `GET /api/__test__/tokens`, both local-only.
 */

import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_FILE = path.join(SCRIPT_DIR, 'mock-api-data.json');
const DEFAULT_PORT = 8787;
const COOKIE_NAME = 'kocluk_session';
const SESSION_TTL_DAYS = 30;
const COOKIE_TTL_DAYS = 90;
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const MAX_PUSH_BYTES = 1024 * 1024;
const MAX_PUSH_CHANGES = 100;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const PRIVACY_VERSION = '2026-11-24';

export const DEMO_ACCOUNT = {
  email: 'deneme@kocluk.local',
  password: 'deneme1234',
  displayName: 'Deneme Öğrenci',
};

export const SYNCED_TABLES = [
  'subjects',
  'topics',
  'exams',
  'examResults',
  'notes',
  'catalogBooks',
  'userBooks',
  'activityLogs',
  'scheduleWeeks',
  'scheduleRows',
  'scheduleTasks',
  'schedulePageChains',
  'topicProgress',
  'settings',
];

const ACCOUNT_SETTINGS = [
  'profileName',
  'examDate',
  'examName',
  'onboardingDone',
  'lastBackupAt',
  'schemaVersion',
  'seedVersion',
  'aytAlan',
  'hiddenSubjects',
  'geometryMode',
];

/**
 * Mirrors api/src/Sync/TableMap.php: columns are the public API fields,
 * required fields must be present and non-null, natural keys are the active
 * unique keys, and settings is a per-account JSON row.
 */
const TABLE_DEFS = {
  subjects: {
    pk: 'id',
    ownerKey: 'userId',
    columns: [
      'id',
      'seedKey',
      'exam',
      'name',
      'slug',
      'icon',
      'order',
      'updatedAt',
      'deletedAt',
    ],
    required: ['id', 'seedKey', 'exam', 'name', 'slug', 'icon', 'order', 'updatedAt'],
    natural: ['seedKey'],
    immutable: ['seedKey'],
  },
  topics: {
    pk: 'id',
    ownerKey: 'userId',
    columns: [
      'id',
      'seedKey',
      'subjectId',
      'name',
      'order',
      'isCustom',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    required: ['id', 'subjectId', 'name', 'order', 'isCustom', 'createdAt', 'updatedAt'],
    natural: ['seedKey'],
    immutable: ['seedKey'],
  },
  exams: {
    pk: 'id',
    ownerKey: 'userId',
    columns: [
      'id',
      'type',
      'name',
      'date',
      'alan',
      'kind',
      'branch',
      'note',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    required: ['id', 'type', 'name', 'date', 'note', 'createdAt', 'updatedAt'],
    natural: [],
  },
  examResults: {
    pk: 'id',
    ownerKey: 'userId',
    columns: [
      'id',
      'examId',
      'subjectId',
      'correct',
      'wrong',
      'blank',
      'net',
      'updatedAt',
      'deletedAt',
    ],
    required: ['id', 'examId', 'subjectId', 'correct', 'wrong', 'blank', 'net', 'updatedAt'],
    natural: ['examId', 'subjectId'],
    immutable: ['examId', 'subjectId'],
  },
  notes: {
    pk: 'topicId',
    ownerKey: 'userId',
    columns: ['topicId', 'contentHtml', 'plainText', 'updatedAt', 'deletedAt'],
    required: ['topicId', 'contentHtml', 'plainText', 'updatedAt'],
    natural: [],
    immutable: ['topicId'],
  },
  catalogBooks: {
    pk: 'id',
    ownerKey: 'ownerId',
    columns: [
      'id',
      'title',
      'publisher',
      'exam',
      'subjectSlug',
      'totalPages',
      'edition',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    required: ['id', 'title', 'totalPages', 'createdAt', 'updatedAt'],
    natural: [],
  },
  userBooks: {
    pk: 'id',
    ownerKey: 'userId',
    columns: [
      'id',
      'bookId',
      'totalPagesOverride',
      'note',
      'status',
      'startedAt',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    required: ['id', 'bookId', 'status', 'createdAt', 'updatedAt'],
    natural: ['bookId'],
    immutable: ['bookId'],
  },
  activityLogs: {
    pk: 'id',
    ownerKey: 'userId',
    columns: [
      'id',
      'type',
      'userBookId',
      'topicId',
      'fromPage',
      'toPage',
      'taskId',
      'source',
      'createdAt',
      'deletedAt',
    ],
    required: ['id', 'type', 'source', 'createdAt'],
    natural: ['taskId'],
    insertOnly: true,
  },
  scheduleWeeks: {
    pk: 'id',
    ownerKey: 'userId',
    columns: ['id', 'weekStart', 'note', 'createdAt', 'updatedAt', 'deletedAt'],
    required: ['id', 'weekStart', 'note', 'createdAt', 'updatedAt'],
    natural: ['weekStart'],
    immutable: ['weekStart'],
  },
  scheduleRows: {
    pk: 'id',
    ownerKey: 'userId',
    columns: [
      'id',
      'weekId',
      'subjectId',
      'label',
      'order',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    required: ['id', 'weekId', 'label', 'order', 'createdAt', 'updatedAt'],
    natural: [],
  },
  scheduleTasks: {
    pk: 'id',
    ownerKey: 'userId',
    columns: [
      'id',
      'weekId',
      'rowId',
      'dayIndex',
      'type',
      'userBookId',
      'fromPage',
      'toPage',
      'topicId',
      'title',
      'completedAt',
      'missedAt',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    required: ['id', 'weekId', 'rowId', 'dayIndex', 'type', 'createdAt', 'updatedAt'],
    natural: [],
  },
  schedulePageChains: {
    pk: 'id',
    ownerKey: 'userId',
    columns: [
      'id',
      'weekId',
      'rowId',
      'userBookId',
      'startPage',
      'endPage',
      'chunkSize',
      'chunkCount',
      'slots',
      'skippedChunks',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ],
    required: [
      'id',
      'weekId',
      'rowId',
      'userBookId',
      'startPage',
      'endPage',
      'chunkSize',
      'chunkCount',
      'slots',
      'skippedChunks',
      'createdAt',
      'updatedAt',
    ],
    natural: [],
    immutable: ['id'],
  },
  topicProgress: {
    pk: 'id',
    ownerKey: 'userId',
    columns: ['id', 'topicId', 'done', 'doneAt', 'updatedAt', 'deletedAt'],
    required: ['id', 'topicId', 'done', 'updatedAt'],
    natural: ['topicId'],
    immutable: ['topicId'],
  },
  settings: {
    pk: 'userId',
    ownerKey: 'userId',
    columns: ['updatedAt'],
    required: ['userId', 'updatedAt'],
    natural: [],
    settings: ACCOUNT_SETTINGS,
  },
};

const PUBLIC_WRITES = new Set([
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
]);

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

class RowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RowError';
    this.code = code;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

function trustedOrigin(request) {
  const origin = request.headers.origin;
  if (typeof origin !== 'string' || origin === '') {
    return false;
  }

  const configured = (process.env.MOCK_APP_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase().replace(/\/+$/, ''))
    .filter((value) => value !== '');

  const normalized = origin.toLowerCase().replace(/\/+$/, '');

  if (configured.length > 0 && configured.includes(normalized)) {
    return true;
  }

  // Local preview may be opened through localhost or 127.0.0.1 on the Vite
  // port. A loopback origin cannot be a cross-site attacker in a local mock.
  return isLoopbackOrigin(origin);
}

function nowIso() {
  return new Date().toISOString();
}

/** Server timestamps use six fractional digits; the client sends three. */
function normalizeTimestamp(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/.test(
      trimmed,
    )
  ) {
    return null;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().replace(/\.(\d{3})Z$/, (_match, millis) => `.${millis}000Z`);
}

function normalizedNow() {
  return normalizeTimestamp(nowIso());
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidRowId(value) {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    value.length <= 36 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function emptyData() {
  const tables = {};
  for (const table of SYNCED_TABLES) {
    tables[table] = {};
  }

  return {
    version: 1,
    users: [],
    sessions: [],
    emailVerifications: [],
    passwordResets: [],
    changeLog: {},
    tables,
  };
}

export function normalizeData(data) {
  const base = emptyData();
  if (!isRecord(data)) {
    return base;
  }

  const normalized = {
    version: 1,
    users: Array.isArray(data.users) ? data.users : [],
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    emailVerifications: Array.isArray(data.emailVerifications)
      ? data.emailVerifications
      : [],
    passwordResets: Array.isArray(data.passwordResets) ? data.passwordResets : [],
    changeLog: isRecord(data.changeLog) ? data.changeLog : {},
    tables: {},
  };

  for (const table of SYNCED_TABLES) {
    const stored = isRecord(data.tables) ? data.tables[table] : null;
    const rows = isRecord(stored) ? { ...stored } : {};
    if (table === 'schedulePageChains') {
      // Rows written before the skip list existed still have to satisfy the
      // required field; normalize the file once instead of rejecting pushes.
      for (const [rowId, row] of Object.entries(rows)) {
        if (
          isRecord(row) &&
          !Object.prototype.hasOwnProperty.call(row, 'skippedChunks')
        ) {
          rows[rowId] = { ...row, skippedChunks: '[]' };
        }
      }
    }
    normalized.tables[table] = rows;
  }

  return normalized;
}

function loadData(dataFile) {
  if (!existsSync(dataFile)) {
    return emptyData();
  }

  const raw = readFileSync(dataFile, 'utf8');
  try {
    return normalizeData(JSON.parse(raw));
  } catch (error) {
    throw new Error(
      `Mock veri dosyası okunamadı (${dataFile}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function saveData(dataFile, data) {
  mkdirSync(path.dirname(dataFile), { recursive: true });
  const temporary = `${dataFile}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  try {
    renameSync(temporary, dataFile);
  } catch {
    rmSync(dataFile, { force: true });
    renameSync(temporary, dataFile);
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return {
    passwordSalt: salt,
    passwordHash: scryptSync(password, salt, 32).toString('hex'),
  };
}

function verifyPassword(password, user) {
  const expected = Buffer.from(String(user.passwordHash ?? ''), 'hex');
  const actual = scryptSync(password, String(user.passwordSalt ?? ''), 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(value) {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  );
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    createdAt: user.createdAt,
  };
}

function createUser(data, { email, password, displayName }) {
  const timestamp = nowIso();
  const user = {
    id: randomUUID(),
    email: normalizeEmail(email),
    ...hashPassword(password),
    displayName: displayName.trim(),
    emailVerifiedAt: null,
    privacyVersion: PRIVACY_VERSION,
    consentedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  data.users.push(user);
  createVerificationToken(data, user);
  return user;
}

function seedDemoUser(data) {
  const email = normalizeEmail(DEMO_ACCOUNT.email);
  if (data.users.some((user) => normalizeEmail(user.email) === email)) {
    return data.users.find((user) => normalizeEmail(user.email) === email);
  }

  const user = createUser(data, {
    email,
    password: DEMO_ACCOUNT.password,
    displayName: DEMO_ACCOUNT.displayName,
  });
  user.emailVerifiedAt = user.createdAt;
  return user;
}

function findUserByEmail(data, email) {
  const normalized = normalizeEmail(email);
  return (
    data.users.find((user) => normalizeEmail(user.email) === normalized) ?? null
  );
}

function findUserById(data, userId) {
  return data.users.find((user) => user.id === userId) ?? null;
}

function createVerificationToken(data, user) {
  const token = randomBytes(24).toString('base64url');
  const timestamp = nowIso();
  data.emailVerifications.push({
    id: sha256(token),
    token,
    userId: user.id,
    createdAt: timestamp,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    usedAt: null,
  });
  return token;
}

function createResetToken(data, user) {
  const token = randomBytes(24).toString('base64url');
  const timestamp = nowIso();
  data.passwordResets.push({
    id: sha256(token),
    token,
    userId: user.id,
    createdAt: timestamp,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    usedAt: null,
  });
  return token;
}

function findUsableToken(records, token) {
  const hash = sha256(token);
  const now = Date.now();
  return (
    records.find(
      (record) =>
        record.id === hash &&
        record.usedAt === null &&
        Date.parse(record.expiresAt) > now,
    ) ?? null
  );
}

function createSession(data, userId) {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const session = {
    id: sha256(token),
    userId,
    csrfToken,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(
      createdAt.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
    revokedAt: null,
  };
  data.sessions.push(session);
  return { token, csrfToken, session };
}

function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string' || header === '') {
    return cookies;
  }

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name !== '') {
      cookies[name] = decodeURIComponent(value);
    }
  }

  return cookies;
}

function currentSession(data, request) {
  const token = parseCookies(request.headers.cookie)[COOKIE_NAME];
  if (typeof token !== 'string' || token === '') {
    return null;
  }

  const hash = sha256(token);
  const session = data.sessions.find((row) => row.id === hash) ?? null;
  if (session === null) {
    return null;
  }
  if (session.revokedAt !== null || Date.parse(session.expiresAt) <= Date.now()) {
    return null;
  }

  const user = findUserById(data, session.userId);
  if (user === null) {
    return null;
  }

  return { session, user };
}

function sessionCookie(token) {
  const maxAge = COOKIE_TTL_DAYS * 24 * 60 * 60;
  const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
  return `${COOKIE_NAME}=${token}; Path=/; Expires=${expires}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function rowsFor(data, table, userId) {
  data.tables[table] ??= {};
  data.tables[table][userId] ??= {};
  return data.tables[table][userId];
}

function findRow(data, table, userId, rowId) {
  return rowsFor(data, table, userId)[rowId] ?? null;
}

function maxCursor(data, userId) {
  const log = data.changeLog[userId] ?? [];
  return log.length === 0 ? 0 : log[log.length - 1].id;
}

function appendChange(data, userId, table, rowId, op) {
  data.changeLog[userId] ??= [];
  const log = data.changeLog[userId];
  const id = (log.length === 0 ? 0 : log[log.length - 1].id) + 1;
  log.push({ id, table, rowId, op, changedAt: nowIso() });
}

function allowedFields(def) {
  return [...def.columns, def.ownerKey, ...(def.settings ?? [])];
}

function assertRow(table, row) {
  const def = TABLE_DEFS[table];
  const allowed = new Set(allowedFields(def));

  for (const field of Object.keys(row)) {
    if (!allowed.has(field)) {
      throw new RowError('validation_failed', `Bilinmeyen alan: ${field}`);
    }
  }

  for (const field of def.required) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) {
      throw new RowError('validation_failed', `Zorunlu alan eksik: ${field}`);
    }
    if (row[field] === null) {
      throw new RowError('validation_failed', `Zorunlu alan null olamaz: ${field}`);
    }
  }
}

function normalizeFieldValue(field, value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (field.endsWith('At')) {
    const timestamp = normalizeTimestamp(value);
    if (timestamp === null) {
      throw new RowError('invalid_timestamp', `Geçersiz zaman damgası: ${field}`);
    }
    return timestamp;
  }

  if (field === 'date' || field === 'weekStart') {
    if (!isDateOnly(value)) {
      throw new RowError('validation_failed', `Geçersiz tarih: ${field}`);
    }
    return value;
  }

  if (field === 'isCustom' || field === 'done') {
    if (value === true || value === 1) {
      return true;
    }
    if (value === false || value === 0) {
      return false;
    }
    throw new RowError('validation_failed', `Geçersiz mantıksal değer: ${field}`);
  }

  return value;
}

function buildStoredRow(table, row, userId, updatedAtOverride) {
  const def = TABLE_DEFS[table];

  if (table === 'settings') {
    const stored = {};
    for (const field of ACCOUNT_SETTINGS) {
      if (Object.prototype.hasOwnProperty.call(row, field)) {
        stored[field] = row[field];
      }
    }
    stored.userId = userId;
    stored.updatedAt = updatedAtOverride ?? normalizeFieldValue('updatedAt', row.updatedAt);
    return stored;
  }

  const stored = {};
  for (const field of def.columns) {
    const value = Object.prototype.hasOwnProperty.call(row, field)
      ? row[field]
      : null;
    stored[field] = normalizeFieldValue(field, value);
  }
  return stored;
}

function preserveImmutable(table, stored, existing) {
  for (const field of TABLE_DEFS[table].immutable ?? []) {
    if (Object.prototype.hasOwnProperty.call(existing, field)) {
      stored[field] = existing[field];
    }
  }
  return stored;
}

function clampTimestamp(value) {
  const date = new Date(value);
  const limit = new Date(Date.now() + FUTURE_TOLERANCE_MS);
  if (date.getTime() > limit.getTime()) {
    return [normalizeTimestamp(limit.toISOString()), true];
  }
  return [value, false];
}

function isNewer(incoming, existing) {
  if (typeof existing !== 'string' || existing === '') {
    return true;
  }
  return Date.parse(incoming) > Date.parse(existing);
}

function findCanonical(data, table, userId, stored) {
  const def = TABLE_DEFS[table];
  if (def.natural.length === 0) {
    return null;
  }

  const values = [];
  for (const field of def.natural) {
    if (stored[field] === null || stored[field] === undefined) {
      return null;
    }
    values.push(stored[field]);
  }

  return (
    Object.values(rowsFor(data, table, userId)).find(
      (row) =>
        row.deletedAt === null &&
        def.natural.every((field) => row[field] === stored[field]),
    ) ?? null
  );
}

function appliedRow(table, rowId, row, timeAdjusted = false) {
  const result = {
    table,
    rowId,
    status: 'applied',
    row: row ?? null,
  };
  if (timeAdjusted) {
    result.timeAdjusted = true;
  }
  return result;
}

function conflictRow(table, rowId, row) {
  return { table, rowId, status: 'conflict', row };
}

function errorRow(table, rowId, code, message) {
  return { table, rowId, status: 'error', error: { code, message } };
}

function hasUpdatedAt(table) {
  return TABLE_DEFS[table].columns.includes('updatedAt');
}

function applyUpsert(data, userId, table, rowId, row) {
  const updatedAt = normalizeFieldValue('updatedAt', row.updatedAt);
  const [clamped, adjusted] = clampTimestamp(updatedAt);
  const stored = buildStoredRow(table, row, userId, clamped);
  stored[TABLE_DEFS[table].pk] = rowId;

  const rows = rowsFor(data, table, userId);
  const existing = rows[rowId] ?? null;

  if (existing === null) {
    const canonical = findCanonical(data, table, userId, stored);
    if (canonical !== null) {
      return conflictRow(table, rowId, canonical);
    }

    rows[rowId] = stored;
    appendChange(data, userId, table, rowId, 'upsert');
    return appliedRow(table, rowId, stored, adjusted);
  }

  if (existing.deletedAt !== null && existing.deletedAt !== undefined) {
    return conflictRow(table, rowId, existing);
  }

  if (!isNewer(clamped, existing.updatedAt)) {
    return conflictRow(table, rowId, existing);
  }

  preserveImmutable(table, stored, existing);
  rows[rowId] = stored;
  appendChange(data, userId, table, rowId, 'upsert');
  return appliedRow(table, rowId, stored, adjusted);
}

function applyActivityLogUpsert(data, userId, table, rowId, row) {
  const stored = buildStoredRow(table, row, userId);
  const rows = rowsFor(data, table, userId);
  const existing = rows[rowId] ?? null;

  if (existing !== null) {
    return conflictRow(table, rowId, existing);
  }

  const canonical = findCanonical(data, table, userId, stored);
  if (canonical !== null) {
    return conflictRow(table, rowId, canonical);
  }

  rows[rowId] = stored;
  appendChange(data, userId, table, rowId, 'upsert');
  return appliedRow(table, rowId, stored);
}

function applyDelete(data, userId, table, rowId, row, change) {  if (table === 'settings') {
    throw new RowError('validation_failed', 'Ayarlar satırı silinemez.');
  }

  const providedRaw =
    (row !== null ? row.deletedAt ?? row.updatedAt : null) ??
    change.updatedAt ??
    normalizedNow();
  const provided = normalizeTimestamp(providedRaw);
  if (provided === null) {
    throw new RowError('invalid_timestamp', 'Geçersiz zaman damgası: deletedAt');
  }

  const [deletedAt, adjusted] = clampTimestamp(provided);
  const dbRow =
    row === null ? null : buildStoredRow(table, row, userId);
  if (dbRow !== null) {
    dbRow.deletedAt = deletedAt;
    if (hasUpdatedAt(table)) {
      dbRow.updatedAt = deletedAt;
    }
  }

  const rows = rowsFor(data, table, userId);
  const existing = rows[rowId] ?? null;

  if (existing === null) {
    if (dbRow === null) {
      return appliedRow(table, rowId, null);
    }

    rows[rowId] = dbRow;
    appendChange(data, userId, table, rowId, 'delete');
    return appliedRow(table, rowId, dbRow, adjusted);
  }

  if (existing.deletedAt !== null) {
    return appliedRow(table, rowId, existing);
  }

  if (table !== 'activityLogs' && !isNewer(deletedAt, existing.updatedAt)) {
    return conflictRow(table, rowId, existing);
  }

  let canonical;
  if (dbRow !== null && table !== 'activityLogs') {
    preserveImmutable(table, dbRow, existing);
    canonical = dbRow;
    rows[rowId] = dbRow;
  } else {
    canonical = { ...existing, deletedAt };
    if (hasUpdatedAt(table)) {
      canonical.updatedAt = deletedAt;
    }
    rows[rowId] = canonical;
  }

  appendChange(data, userId, table, rowId, 'delete');
  return appliedRow(table, rowId, canonical, adjusted);
}

function applyChange(data, userId, change) {
  if (!isRecord(change)) {
    return errorRow('', null, 'validation_failed', 'Değişiklik nesnesi bekleniyordu.');
  }

  const table = change.table;
  if (typeof table !== 'string' || !Object.prototype.hasOwnProperty.call(TABLE_DEFS, table)) {
    return typeof table === 'string'
      ? errorRow(table, null, 'unknown_table', `Bilinmeyen tablo: ${table}`)
      : errorRow('', null, 'validation_failed', 'table alanı zorunlu.');
  }

  const def = TABLE_DEFS[table];
  const op = change.op;
  if (op !== 'upsert' && op !== 'delete') {
    return errorRow(
      table,
      null,
      'validation_failed',
      'op upsert veya delete olmalı.',
    );
  }

  const row = isRecord(change.row) ? change.row : null;
  if (op === 'upsert' && row === null) {
    return errorRow(table, null, 'validation_failed', 'upsert için row zorunlu.');
  }

  const rowIdHint =
    row !== null && isValidRowId(row[def.pk]) ? row[def.pk] : null;

  if (row !== null) {
    try {
      assertRow(table, row);
    } catch (error) {
      if (error instanceof RowError) {
        return errorRow(table, rowIdHint, error.code, error.message);
      }
      throw error;
    }
  }

  if (op === 'delete' && row === null && !isValidRowId(change.rowId)) {
    return errorRow(table, null, 'validation_failed', 'delete için rowId zorunlu.');
  }

  if (
    row !== null &&
    Object.prototype.hasOwnProperty.call(row, def.ownerKey) &&
    row[def.ownerKey] !== userId
  ) {
    return errorRow(table, rowIdHint, 'forbidden', 'Bu satır başka bir hesaba ait.');
  }

  let rowId;
  if (row === null) {
    rowId = change.rowId;
  } else {
    if (table === 'settings') {
      row.userId = userId;
    }
    if (!isValidRowId(row[def.pk])) {
      return errorRow(
        table,
        rowIdHint,
        'validation_failed',
        `Geçersiz satır kimliği: ${def.pk}`,
      );
    }
    rowId = row[def.pk];
  }

  try {
    const tombstone = row !== null && row.deletedAt !== null && row.deletedAt !== undefined;
    if (op === 'delete' || tombstone) {
      return applyDelete(data, userId, table, rowId, row, change);
    }
    if (def.insertOnly === true) {
      return applyActivityLogUpsert(data, userId, table, rowId, row);
    }
    return applyUpsert(data, userId, table, rowId, row);
  } catch (error) {
    if (error instanceof RowError) {
      return errorRow(table, rowId, error.code, error.message);
    }
    throw error;
  }
}

function countActive(data, table, userId) {
  const rows = Object.values(rowsFor(data, table, userId));
  if (table === 'settings') {
    return rows.length;
  }
  return rows.filter((row) => row.deletedAt === null).length;
}

function statusPayload(data, userId) {
  const counts = {};
  let hasData = false;

  for (const table of SYNCED_TABLES) {
    const count = countActive(data, table, userId);
    counts[table] = count;
    if (table !== 'settings' && count > 0) {
      hasData = true;
    }
  }

  let hasUserData = counts.catalogBooks > 0;
  for (const table of [
    'exams',
    'examResults',
    'notes',
    'userBooks',
    'activityLogs',
    'scheduleRows',
    'scheduleTasks',
    'schedulePageChains',
    'topicProgress',
  ]) {
    if (counts[table] > 0) {
      hasUserData = true;
    }
  }

  if (counts.scheduleWeeks > 0) {
    const meaningfulWeek = Object.values(rowsFor(data, 'scheduleWeeks', userId)).some(
      (row) => row.deletedAt === null && String(row.note ?? '').trim() !== '',
    );
    if (meaningfulWeek) {
      hasUserData = true;
    }
  }

  if (counts.topics > 0) {
    const customTopic = Object.values(rowsFor(data, 'topics', userId)).some(
      (row) => row.deletedAt === null && row.isCustom === true,
    );
    if (customTopic) {
      hasUserData = true;
    }
  }

  return {
    hasData,
    hasUserData,
    counts,
    cursor: maxCursor(data, userId),
    serverTime: nowIso(),
  };
}

function queryInteger(url, name) {
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') {
    return null;
  }
  if (!/^\d{1,18}$/.test(raw)) {
    throw new ApiError(
      422,
      'validation_failed',
      `${name} negatif olmayan bir tam sayı olmalı.`,
    );
  }
  return Number(raw);
}

function sortedRows(data, table, userId) {
  return Object.entries(rowsFor(data, table, userId))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, row]) => row);
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function sendJson(response, status, payload, headers = {}) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

function sendError(response, status, code, message, headers = {}) {
  sendJson(response, status, { error: { code, message } }, headers);
}

function readJson(context) {
  if (context.rawBody === '') {
    throw new ApiError(400, 'invalid_json', 'İstek gövdesi geçerli JSON değil.');
  }

  let parsed;
  try {
    parsed = JSON.parse(context.rawBody);
  } catch {
    throw new ApiError(400, 'invalid_json', 'İstek gövdesi geçerli JSON değil.');
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new ApiError(
      400,
      'invalid_json',
      'İstek gövdesi bir JSON nesnesi olmalı.',
    );
  }

  return parsed;
}

function requireSession(context) {
  if (context.auth === null) {
    throw new ApiError(
      401,
      'unauthenticated',
      'Oturum bulunamadı veya süresi dolmuş.',
    );
  }
  return context.auth;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(
          new ApiError(
            413,
            'payload_too_large',
            'İstek gövdesi boyut sınırını aşıyor.',
          ),
        );
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    request.on('error', reject);
  });
}

function createApp(dataFile, quiet) {
  let data = loadData(dataFile);
  seedDemoUser(data);
  saveData(dataFile, data);

  function persist() {
    saveData(dataFile, data);
  }

  const handlers = {
    'GET /api/health': (context) => {
      sendJson(context.response, 200, { ok: true, serverTime: nowIso() });
    },

    'POST /api/auth/register': (context) => {
      const input = readJson(context);
      const email = normalizeEmail(input.email);
      const password = typeof input.password === 'string' ? input.password : '';
      const displayName =
        typeof input.displayName === 'string' ? input.displayName.trim() : '';

      if (!isValidEmail(email)) {
        throw new ApiError(422, 'validation_failed', 'Geçerli bir e-posta adresi girin.');
      }
      if (password.length < 8 || password.length > 200) {
        throw new ApiError(
          422,
          'validation_failed',
          'Şifre 8 ile 200 karakter arasında olmalı.',
        );
      }
      if (displayName === '' || displayName.length > 80) {
        throw new ApiError(
          422,
          'validation_failed',
          'Görünen ad 1 ile 80 karakter arasında olmalı.',
        );
      }
      if (input.privacyAccepted !== true) {
        throw new ApiError(
          422,
          'validation_failed',
          'Gizlilik metni onayı zorunlu.',
        );
      }
      if (findUserByEmail(data, email) !== null) {
        throw new ApiError(409, 'email_taken', 'Bu e-posta adresi zaten kayıtlı.');
      }

      const user = createUser(data, { email, password, displayName });
      const session = createSession(data, user.id);
      persist();

      if (!quiet) {
        const verification = data.emailVerifications
          .filter((row) => row.userId === user.id && row.usedAt === null)
          .at(-1);
        if (verification !== undefined) {
          console.log(
            `[mock-api] e-posta doğrulama bağlantısı: #/eposta-dogrula?token=${verification.token}`,
          );
        }
      }

      sendJson(
        context.response,
        201,
        { user: publicUser(user), csrfToken: session.csrfToken },
        { 'Set-Cookie': sessionCookie(session.token) },
      );
    },

    'POST /api/auth/login': (context) => {
      const input = readJson(context);
      const email = normalizeEmail(input.email);
      const password = typeof input.password === 'string' ? input.password : '';
      const user = email === '' ? null : findUserByEmail(data, email);

      if (user === null || !verifyPassword(password, user)) {
        throw new ApiError(401, 'invalid_credentials', 'E-posta veya şifre hatalı.');
      }

      if (context.auth !== null) {
        context.auth.session.revokedAt = nowIso();
      }

      const session = createSession(data, user.id);
      persist();

      sendJson(
        context.response,
        200,
        { user: publicUser(user), csrfToken: session.csrfToken },
        { 'Set-Cookie': sessionCookie(session.token) },
      );
    },

    'POST /api/auth/logout': (context) => {
      const { session } = requireSession(context);
      session.revokedAt = nowIso();
      persist();

      sendJson(
        context.response,
        200,
        { ok: true },
        { 'Set-Cookie': clearSessionCookie() },
      );
    },

    'GET /api/auth/session': (context) => {
      const { session, user } = requireSession(context);
      sendJson(context.response, 200, {
        user: publicUser(user),
        csrfToken: session.csrfToken,
      });
    },

    'POST /api/auth/update-profile': (context) => {
      const { user } = requireSession(context);
      const input = readJson(context);
      const displayName =
        typeof input.displayName === 'string' ? input.displayName.trim() : '';

      if (displayName === '' || displayName.length > 80) {
        throw new ApiError(
          422,
          'validation_failed',
          'Görünen ad 1 ile 80 karakter arasında olmalı.',
        );
      }

      user.displayName = displayName;
      user.updatedAt = nowIso();
      persist();

      sendJson(context.response, 200, { user: publicUser(user) });
    },

    'POST /api/auth/change-password': (context) => {
      const { session, user } = requireSession(context);
      const input = readJson(context);
      const currentPassword =
        typeof input.currentPassword === 'string' ? input.currentPassword : '';
      const newPassword =
        typeof input.newPassword === 'string' ? input.newPassword : '';

      if (!verifyPassword(currentPassword, user)) {
        throw new ApiError(422, 'invalid_password', 'Mevcut şifre hatalı.');
      }
      if (newPassword.length < 8 || newPassword.length > 200) {
        throw new ApiError(
          422,
          'validation_failed',
          'Şifre 8 ile 200 karakter arasında olmalı.',
        );
      }

      const hashed = hashPassword(newPassword);
      user.passwordSalt = hashed.passwordSalt;
      user.passwordHash = hashed.passwordHash;
      user.updatedAt = nowIso();

      const revokedAt = nowIso();
      for (const row of data.sessions) {
        if (row.userId === user.id && row.revokedAt === null) {
          row.revokedAt = revokedAt;
        }
      }
      session.revokedAt = revokedAt;

      const next = createSession(data, user.id);
      persist();

      sendJson(
        context.response,
        200,
        { user: publicUser(user), csrfToken: next.csrfToken },
        { 'Set-Cookie': sessionCookie(next.token) },
      );
    },

    'POST /api/auth/forgot-password': (context) => {
      const input = readJson(context);
      const email = normalizeEmail(input.email);
      if (!isValidEmail(email)) {
        throw new ApiError(
          422,
          'validation_failed',
          'Geçerli bir e-posta adresi girin.',
        );
      }

      const user = findUserByEmail(data, email);
      if (user !== null) {
        const token = createResetToken(data, user);
        if (!context.quiet) {
          console.log(`[mock-api] şifre sıfırlama bağlantısı: #/sifre-sifirla?token=${token}`);
        }
        persist();
      }

      // Same answer whether the address exists or not.
      sendJson(context.response, 202, { ok: true });
    },

    'POST /api/auth/reset-password': (context) => {
      const input = readJson(context);
      const token = typeof input.token === 'string' ? input.token.trim() : '';
      const password = typeof input.password === 'string' ? input.password : '';

      if (token === '') {
        throw new ApiError(
          422,
          'validation_failed',
          'Sıfırlama bağlantısı geçersiz.',
        );
      }

      const record = findUsableToken(data.passwordResets, token);
      if (record === null) {
        throw new ApiError(410, 'invalid_token', 'Bağlantı geçersiz veya süresi dolmuş.');
      }

      if (password.length < 8 || password.length > 200) {
        throw new ApiError(
          422,
          'validation_failed',
          'Şifre 8 ile 200 karakter arasında olmalı.',
        );
      }

      const user = findUserById(data, record.userId);
      if (user === null) {
        throw new ApiError(410, 'invalid_token', 'Bağlantı geçersiz veya süresi dolmuş.');
      }

      const hashed = hashPassword(password);
      user.passwordSalt = hashed.passwordSalt;
      user.passwordHash = hashed.passwordHash;
      user.updatedAt = nowIso();
      record.usedAt = nowIso();

      for (const row of data.passwordResets) {
        if (row.userId === user.id && row.usedAt === null) {
          row.usedAt = record.usedAt;
        }
      }

      const revokedAt = nowIso();
      for (const row of data.sessions) {
        if (row.userId === user.id && row.revokedAt === null) {
          row.revokedAt = revokedAt;
        }
      }

      persist();

      sendJson(
        context.response,
        200,
        { ok: true },
        { 'Set-Cookie': clearSessionCookie() },
      );
    },

    'POST /api/auth/verify-email': (context) => {
      const input = readJson(context);
      const token = typeof input.token === 'string' ? input.token.trim() : '';

      if (token === '') {
        throw new ApiError(422, 'validation_failed', 'Doğrulama bağlantısı geçersiz.');
      }

      const record = findUsableToken(data.emailVerifications, token);
      if (record === null) {
        throw new ApiError(410, 'invalid_token', 'Bağlantı geçersiz veya süresi dolmuş.');
      }

      const user = findUserById(data, record.userId);
      if (user === null) {
        throw new ApiError(410, 'invalid_token', 'Bağlantı geçersiz veya süresi dolmuş.');
      }

      const timestamp = nowIso();
      record.usedAt = timestamp;
      user.emailVerifiedAt = timestamp;
      user.updatedAt = timestamp;

      for (const row of data.emailVerifications) {
        if (row.userId === user.id && row.usedAt === null) {
          row.usedAt = timestamp;
        }
      }

      persist();
      sendJson(context.response, 200, { ok: true });
    },

    'POST /api/auth/delete-account': (context) => {
      const { user } = requireSession(context);
      const input = readJson(context);
      const password = typeof input.password === 'string' ? input.password : '';

      if (!verifyPassword(password, user)) {
        throw new ApiError(403, 'invalid_password', 'Şifre hatalı.');
      }

      data.users = data.users.filter((row) => row.id !== user.id);
      data.sessions = data.sessions.filter((row) => row.userId !== user.id);
      data.emailVerifications = data.emailVerifications.filter(
        (row) => row.userId !== user.id,
      );
      data.passwordResets = data.passwordResets.filter(
        (row) => row.userId !== user.id,
      );
      delete data.changeLog[user.id];
      for (const table of SYNCED_TABLES) {
        delete data.tables[table][user.id];
      }

      persist();

      sendJson(
        context.response,
        200,
        { ok: true },
        { 'Set-Cookie': clearSessionCookie() },
      );
    },

    'GET /api/account/export': (context) => {
      const { user } = requireSession(context);
      const tables = {};
      for (const table of SYNCED_TABLES) {
        tables[table] = sortedRows(data, table, user.id);
      }

      sendJson(
        context.response,
        200,
        {
          exportedAt: nowIso(),
          formatVersion: 2,
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            emailVerifiedAt: user.emailVerifiedAt ?? null,
            privacyVersion: user.privacyVersion,
            consentedAt: user.consentedAt,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
          tables,
        },
        {
          'Content-Disposition': `attachment; filename="kocluk-hesap-${new Date()
            .toISOString()
            .slice(0, 10)}.json"`,
        },
      );
    },

    'POST /api/sync/push': (context) => {
      const { user } = requireSession(context);
      const input = readJson(context);

      if (Buffer.byteLength(context.rawBody, 'utf8') > MAX_PUSH_BYTES) {
        throw new ApiError(
          413,
          'payload_too_large',
          'İstek gövdesi 1 MB sınırını aşıyor.',
        );
      }

      const changes = input.changes;
      if (!Array.isArray(changes)) {
        throw new ApiError(422, 'validation_failed', 'changes bir dizi olmalı.');
      }
      if (changes.length > MAX_PUSH_CHANGES) {
        throw new ApiError(
          422,
          'payload_too_large',
          'Tek istekte en fazla 100 değişiklik gönderilebilir.',
        );
      }

      const deviceId = input.deviceId;
      if (deviceId !== undefined && (typeof deviceId !== 'string' || deviceId.length > 64)) {
        throw new ApiError(422, 'validation_failed', 'deviceId geçersiz.');
      }

      const results = changes.map((change) => {
        try {
          return applyChange(data, user.id, change);
        } catch (error) {
          if (error instanceof RowError) {
            return errorRow('', null, error.code, error.message);
          }
          throw error;
        }
      });

      persist();
      sendJson(context.response, 200, { results, serverTime: nowIso() });
    },

    'GET /api/sync/pull': (context) => {
      const { user } = requireSession(context);
      const since = queryInteger(context.url, 'since') ?? 0;
      const rawLimit = queryInteger(context.url, 'limit') ?? 500;

      if (since < 0) {
        throw new ApiError(422, 'validation_failed', 'since negatif olamaz.');
      }
      if (rawLimit < 1) {
        throw new ApiError(
          422,
          'validation_failed',
          'limit 1 ile 500 arasında olmalı.',
        );
      }

      const limit = Math.min(rawLimit, 500);
      const log = data.changeLog[user.id] ?? [];

      if (since > 0 && log.length > 0 && log[0].id > since + 1) {
        throw new ApiError(
          410,
          'cursor_expired',
          'Senkron imleci çok eski; tam çekme (sync/full) gerekli.',
        );
      }

      const pending = log.filter((entry) => entry.id > since);
      const hasMore = pending.length > limit;
      const batch = hasMore ? pending.slice(0, limit) : pending;

      let nextCursor = since;
      const changes = new Map();
      for (const entry of batch) {
        nextCursor = entry.id;
        if (!Object.prototype.hasOwnProperty.call(TABLE_DEFS, entry.table)) {
          continue;
        }
        const row = findRow(data, entry.table, user.id, entry.rowId);
        if (row === null) {
          continue;
        }
        const key = `${entry.table}:${entry.rowId}`;
        changes.delete(key);
        changes.set(key, { table: entry.table, row });
      }

      sendJson(context.response, 200, {
        changes: [...changes.values()],
        nextCursor,
        hasMore,
      });
    },

    'GET /api/sync/status': (context) => {
      const { user } = requireSession(context);
      sendJson(context.response, 200, statusPayload(data, user.id));
    },

    'GET /api/sync/full': (context) => {
      const { user } = requireSession(context);
      const tables = {};
      for (const table of SYNCED_TABLES) {
        tables[table] = sortedRows(data, table, user.id);
      }

      sendJson(context.response, 200, {
        tables,
        cursor: maxCursor(data, user.id),
        serverTime: nowIso(),
      });
    },

    'DELETE /api/__test__/reset': (context) => {
      data = emptyData();
      seedDemoUser(data);
      persist();
      context.response.writeHead(204, { 'Cache-Control': 'no-store' });
      context.response.end();
    },

    'GET /api/__test__/tokens': (context) => {
      const email = normalizeEmail(context.url.searchParams.get('email'));
      const user = findUserByEmail(data, email);
      if (user === null) {
        sendJson(context.response, 200, {
          verificationToken: null,
          resetToken: null,
        });
        return;
      }

      const verification = data.emailVerifications
        .filter((row) => row.userId === user.id && row.usedAt === null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      const reset = data.passwordResets
        .filter((row) => row.userId === user.id && row.usedAt === null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

      sendJson(context.response, 200, {
        verificationToken: verification?.token ?? null,
        resetToken: reset?.token ?? null,
      });
    },
  };

  function allowedMethods(pathname) {
    const methods = [];
    for (const key of Object.keys(handlers)) {
      const separator = key.indexOf(' ');
      if (key.slice(separator + 1) === pathname) {
        methods.push(key.slice(0, separator));
      }
    }
    return [...new Set(methods)].sort();
  }

  function guard(request, method, pathname) {
    if (!STATE_CHANGING_METHODS.has(method)) {
      return currentSession(data, request);
    }
    if (!Object.prototype.hasOwnProperty.call(handlers, `${method} ${pathname}`)) {
      return currentSession(data, request);
    }
    if (pathname.startsWith('/api/__test__/')) {
      return null;
    }

    const auth = currentSession(data, request);
    if (auth === null && PUBLIC_WRITES.has(pathname)) {
      if (!trustedOrigin(request)) {
        throw new ApiError(403, 'csrf_failed', 'İstek kaynağı doğrulanamadı.');
      }
      return null;
    }
    if (auth === null) {
      throw new ApiError(
        401,
        'unauthenticated',
        'Oturum bulunamadı veya süresi dolmuş.',
      );
    }

    const provided = request.headers['x-csrf-token'];
    if (typeof provided !== 'string' || provided === '' || provided !== auth.session.csrfToken) {
      throw new ApiError(403, 'csrf_failed', 'Oturum doğrulaması başarısız.');
    }

    return auth;
  }

  async function handleRequest(request, response) {
    const method = (request.method ?? 'GET').toUpperCase();
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    let rawBody = '';
    try {
      if (STATE_CHANGING_METHODS.has(method)) {
        rawBody = await readBody(request);
      }
      const auth = guard(request, method, pathname);
      const handler = handlers[`${method} ${pathname}`];

      if (handler === undefined) {
        const allowed = allowedMethods(pathname);
        if (allowed.length > 0) {
          sendError(
            response,
            405,
            'method_not_allowed',
            'Bu yol için HTTP yöntemi desteklenmiyor.',
            { Allow: allowed.join(', ') },
          );
          return;
        }
        sendError(response, 404, 'not_found', 'Kaynak bulunamadı.');
        return;
      }

      handler({
        request,
        response,
        url,
        method,
        path: pathname,
        rawBody,
        auth,
        quiet,
      });
    } catch (error) {
      if (error instanceof ApiError) {
        if (!response.headersSent) {
          sendError(response, error.status, error.code, error.message);
        } else {
          response.destroy();
        }
        return;
      }

      console.error('[mock-api] beklenmeyen hata', error);
      if (!response.headersSent) {
        sendError(
          response,
          500,
          'internal_error',
          'Sunucuda beklenmeyen bir hata oluştu.',
        );
      } else {
        response.destroy();
      }
    }
  }

  return { handleRequest };
}

/**
 * Starts the mock API. Port 0 picks a free port (used by contract tests).
 * `dataFile` is created and persisted on every mutation.
 */
export async function startMockApi({
  port = 0,
  host = '127.0.0.1',
  dataFile = DEFAULT_DATA_FILE,
  quiet = true,
} = {}) {
  const app = createApp(dataFile, quiet);
  const server = createServer((request, response) => {
    void app.handleRequest(request, response);
  });

  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    server,
    url: `http://${host}:${boundPort}`,
    dataFile,
    quiet,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
}

function resolveDataFile() {
  const configured = process.env.MOCK_API_DATA_FILE;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  return DEFAULT_DATA_FILE;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  const port = Number(process.env.MOCK_API_PORT ?? DEFAULT_PORT);
  const host = process.env.MOCK_API_HOST ?? '127.0.0.1';
  const dataFile = resolveDataFile();

  startMockApi({ port, host, dataFile, quiet: false })
    .then((running) => {
      const displayHost = host === '127.0.0.1' ? 'localhost' : host;
      console.log(`[mock-api] ${displayHost}:${port} hazır (http://${displayHost}:${port})`);
      console.log(`[mock-api] veri dosyası: ${dataFile}`);
      console.log(
        `[mock-api] demo hesap: ${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password}`,
      );

      const shutdown = () => {
        void running.close().finally(() => process.exit(0));
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch((error) => {
      console.error('[mock-api] başlatılamadı:', error);
      process.exit(1);
    });
}
