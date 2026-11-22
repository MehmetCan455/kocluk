# Kitap Sayfa Takibi ve Haftalık Plan — Uygulama Planı (Aşama 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kitap takibini sayfa bazlı katalog/raf modeline geçirmek ve tarihli haftalık planda tiklenen görevlerin kitap ilerlemesini otomatik kaydetmesini sağlamak. Bu aşama tamamen yereldir; hesap, Supabase ve senkron yoktur.

**Architecture:** Dexie v6'ya yeni tablolar eklenir; eski `books`, `topicBooks` ve `scheduleTables` verileri legacy olarak korunur. Kitap ilerlemesi `activityLogs` üzerinden türetilir. Haftalık plan `scheduleWeeks` / `scheduleRows` / `scheduleTasks` tablolarında tutulur. Tik işlemi tek Dexie transaction'ında görev ve aktivite kaydını birlikte yazar. UI mevcut bileşen ve stil kalıplarını kullanır.

**Tech Stack:** React 19, TypeScript, Vite, Dexie, date-fns, lucide-react, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-kitap-sayfa-takibi-ve-supabase-senkron-design.md`

## Global Constraints

- React 19 + TypeScript strict; mevcut `@/` yol takma adı ve Tailwind sınıfları kullanılır.
- Tüm kullanıcı metinleri Türkçe; mevcut tasarım dili, `Card`, `Button`, `Field`, `Modal`, `EmptyState`, `ProgressBar`, `RingProgress` bileşenleri korunur.
- Dokunma hedefleri en az 44px; ikon düğmelerinde `aria-label` zorunlu.
- Bu aşamada ağ isteği, Supabase, auth veya senkron **yoktur**.
- Eski `books`, `topicBooks`, `scheduleTables`, `scheduleEntries` tabloları ve verileri silinmez; yalnızca salt okunur legacy olarak gösterilir.
- Doğal anahtarlı satırlar deterministik UUIDv5 kullanır: raf kitabı (`bookId`), hafta (`weekStart`), konu durumu (`topicId`), katalog tohumu (başlık+yayınevi+baskı), hafta kopyası (hedef hafta + kaynak kimliği).
- Tarihler ISO 8601; hafta pazartesi başlar, gün indeksi pazartesi = 1 … pazar = 7. Sayfa aralıkları kapsayıcıdır.
- Her görev kendi test döngüsünü taşır; test yaz, kırmızı gör, minimum kodu yaz, yeşil gör, commit et.
- Commit'ler yereldir. **`git push` yapılmaz.** Son görevde local preview alınır ve kullanıcı onayı beklenir.
- Subagent'lar yalnızca `opencode-go/deepseek-v4.1-flash#max` modelini kullanır.
- Test komutu: `npx vitest run <dosya>`. Tip kontrolü: `npm run typecheck`. Derleme: `npm run build`.

## Review Focus

Bu planın en kolay kırılacak yerleri; her biri ilgili görevin testlerinde sabitlenir:

1. Aynı görevi iki kez tiklemek veya tik kaldırıp yeniden tiklemek ilerlemeyi çift saymamalı; aynı anda tek aktif aktivite kalmalı.
2. Manuel sayfa girişiyle aşağı doğru düzeltme yüzdeyi düşürmeli; sonraki plan tikleri yeni tabandan ileri saymalı.
3. Aynı haftayı iki kez kopyalamak veya aynı görevi tekrar tiklemek yinelenen satır/aktivite üretmemeli.
4. Ters sayfa aralığı, 0 sayfa, toplam sayfayı aşan aralık ve sayfa sayısı olmayan kitap reddedilmeli; ilerleme bozulmamalı.
5. Tamamlanmış görev/kitap/konu silinince plan, ilerleme ve geçmiş tutarlı kalmalı; orphan görev veya sessiz veri kaybı olmamalı.

---

## Task 1: Yeni domain tipleri ve Dexie v6 şeması

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/db/db.ts`
- Test: `src/db/db.test.ts`

**Interfaces:**
- Produces: `CatalogBook`, `UserBook`, `UserBookStatus`, `ActivityLog`, `ActivityType`, `ScheduleWeek`, `ScheduleRow`, `ScheduleTask`, `ScheduleTaskType`, `TopicProgress`, `BookProgress`.
- Produces: `KoclukDB.catalogBooks`, `KoclukDB.userBooks`, `KoclukDB.activityLogs`, `KoclukDB.scheduleWeeks`, `KoclukDB.scheduleRows`, `KoclukDB.scheduleTasks`, `KoclukDB.topicProgress`.

- [x] **Step 1: Add the failing schema test**

In `src/db/db.test.ts`, update the table-list test expectation to include the new tables and add:

```ts
expect(db.userBooks.schema.indexes.find((index) => index.name === 'bookId')?.unique).toBe(true);
expect(db.scheduleWeeks.schema.indexes.find((index) => index.name === 'weekStart')?.unique).toBe(true);
expect(db.topicProgress.schema.indexes.find((index) => index.name === 'topicId')?.unique).toBe(true);
```

- [x] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/db/db.test.ts`
Expected: FAIL because the new tables/indexes do not exist.

- [x] **Step 3: Add the types and Dexie v6 schema**

Append to `src/domain/types.ts`:

```ts
export type UserBookStatus = 'active' | 'completed' | 'archived';
export type ActivityType = 'book_pages' | 'page_set' | 'topic_review';
export type ScheduleTaskType = 'book' | 'topic' | 'free';

export interface CatalogBook {
  id: string;
  ownerId?: string;
  title: string;
  publisher?: string;
  exam?: ExamType;
  subjectSlug?: string;
  totalPages: number;
  edition?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface UserBook {
  id: string;
  bookId: string;
  totalPagesOverride?: number;
  note?: string;
  status: UserBookStatus;
  startedAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ActivityLog {
  id: string;
  type: ActivityType;
  userBookId?: string;
  topicId?: string;
  fromPage?: number;
  toPage?: number;
  taskId?: string;
  source: 'task' | 'manual';
  createdAt: string;
  deletedAt?: string;
}

export interface ScheduleWeek {
  id: string;
  weekStart: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ScheduleRow {
  id: string;
  weekId: string;
  subjectId?: string;
  label: string;
  order: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ScheduleTask {
  id: string;
  weekId: string;
  rowId: string;
  dayIndex: number;
  type: ScheduleTaskType;
  userBookId?: string;
  fromPage?: number;
  toPage?: number;
  topicId?: string;
  title?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface TopicProgress {
  id: string;
  topicId: string;
  done: boolean;
  doneAt?: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface BookProgress {
  currentPage: number;
  totalPages: number;
  percent: number;
  remaining: number;
  started: boolean;
  done: boolean;
  hasTotalPages: boolean;
}
```

In `src/db/db.ts`, add table properties and `this.version(6).stores({...})` with:

```ts
catalogBooks: 'id, ownerId, title, exam, subjectSlug, updatedAt, deletedAt',
userBooks: 'id, &bookId, status, updatedAt, deletedAt',
activityLogs: 'id, userBookId, topicId, taskId, createdAt, deletedAt',
scheduleWeeks: 'id, &weekStart, updatedAt, deletedAt',
scheduleRows: 'id, weekId, order',
scheduleTasks: 'id, weekId, rowId, dayIndex, completedAt, updatedAt, deletedAt',
topicProgress: 'id, &topicId, done, updatedAt, deletedAt',
```

- [x] **Step 4: Run the schema test**

Run: `npx vitest run src/db/db.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/domain/types.ts src/db/db.ts src/db/db.test.ts
git commit -m "feat: add page-based book and weekly plan tables"
```

---

## Task 2: Deterministik kimlikler, katalog tohumu ve katalog repository'si

**Files:**
- Modify: `package.json` (add `uuid`)
- Create: `src/lib/deterministicId.ts`
- Create: `src/lib/namespaces.ts`
- Create: `src/data/catalogBooks.ts`
- Create: `src/db/catalogRepository.ts`
- Modify: `src/app/SettingsProvider.tsx`
- Test: `src/db/catalogRepository.test.ts`

**Interfaces:**
- Produces: `deterministicId(namespace: string, key: string): string`
- Produces: `LOCAL_SCOPE = 'local'`, `CATALOG_NAMESPACE`, `USER_BOOK_NAMESPACE`, `WEEK_NAMESPACE`, `COPY_NAMESPACE`, `TOPIC_PROGRESS_NAMESPACE` in `src/lib/namespaces.ts`
- Produces: `CATALOG_SEED: readonly CatalogBookSeed[]`, `catalogBookId(title: string, publisher: string, edition: string): string`
- Produces: `seedCatalog(): Promise<void>`, `listCatalogBooks(): Promise<CatalogBook[]>`, `getCatalogBook(id: string): Promise<CatalogBook | undefined>`, `searchCatalog(query: string): Promise<CatalogBook[]>`

- [x] **Step 1: Add the failing repository test**

Create `src/db/catalogRepository.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest';
import { db } from './db';
import { getCatalogBook, listCatalogBooks, seedCatalog, searchCatalog } from './catalogRepository';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

test('katalog tohumu idempotenttir ve arama yapar', async () => {
  await seedCatalog();
  const firstCount = await db.catalogBooks.count();
  await seedCatalog();
  expect(await db.catalogBooks.count()).toBe(firstCount);

  const results = await searchCatalog('bilgi sarmal matematik');
  expect(results.some((book) => book.title.includes('Bilgi Sarmal'))).toBe(true);

  const book = await getCatalogBook(results[0].id);
  expect(book?.totalPages).toBeGreaterThan(0);
});
```

- [x] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/db/catalogRepository.test.ts`
Expected: FAIL because the module does not exist.

- [x] **Step 3: Install uuid and add the deterministic helper**

Run: `npm install uuid`
Create `src/lib/deterministicId.ts`:

```ts
import { v5 as uuidv5 } from 'uuid';

export function deterministicId(namespace: string, key: string): string {
  return uuidv5(key, namespace);
}
```

Create `src/lib/namespaces.ts` with fixed UUID namespaces (generate four literal UUID strings once and keep them stable forever):

```ts
export const LOCAL_SCOPE = 'local';
export const CATALOG_NAMESPACE = '6f1c2a9e-3b4d-4f6a-9c2e-8d7b5a1f0e3c';
export const USER_BOOK_NAMESPACE = '0b7d2f4a-6c1e-4a8b-9d3f-2e5c7a1b4d6f';
export const WEEK_NAMESPACE = '3a9e5c1d-7b2f-4e6a-8c4d-1f0b9a7e5c3d';
export const COPY_NAMESPACE = '8d4b2a6f-1c3e-4f7a-9b5d-6e2c8a0f4b1d';
export const TOPIC_PROGRESS_NAMESPACE = '5c2a8e4f-9d1b-4a6c-8f3e-7b0d5a2c9e1f';
```

All later tasks import these constants; do not redefine namespace strings.

- [x] **Step 4: Add the catalog seed**

Create `src/data/catalogBooks.ts`, importing `CATALOG_NAMESPACE` from `@/lib/namespaces`, with these starter entries (page counts are starter values; users can override):

```ts
export const CATALOG_SEED = [
  { title: 'TYT Matematik Soru Bankası', publisher: 'Bilgi Sarmal', exam: 'TYT', subjectSlug: 'matematik', totalPages: 400, edition: '2025' },
  { title: 'TYT Matematik Soru Bankası', publisher: '3D Yayınları', exam: 'TYT', subjectSlug: 'matematik', totalPages: 360, edition: '2026' },
  { title: 'TYT Matematik Soru Kitabı', publisher: 'Palme', exam: 'TYT', subjectSlug: 'matematik', totalPages: 384, edition: '2026' },
  { title: 'TYT Matematik Soru Bankası', publisher: 'Karekök', exam: 'TYT', subjectSlug: 'matematik', totalPages: 392, edition: '2026' },
] as const;
```

`catalogBookId` = `deterministicId(CATALOG_NAMESPACE, \`${title}|${publisher}|${edition}\`)`.

- [x] **Step 5: Implement the repository and seed call**

Create `src/db/catalogRepository.ts` with the four exported functions. `seedCatalog` inserts only missing IDs and never overwrites an existing row. `searchCatalog` normalizes Turkish text with the existing `matchesTokens`/`tokenizeTr` helpers and matches title, publisher, subjectSlug, exam. In `SettingsProvider.load`, after `seedCurriculum`, call `await seedCatalog()`.

- [x] **Step 6: Run the tests**

Run: `npx vitest run src/db/catalogRepository.test.ts`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/deterministicId.ts src/data/catalogBooks.ts src/db/catalogRepository.ts src/db/catalogRepository.test.ts src/app/SettingsProvider.tsx
git commit -m "feat: seed deterministic book catalog"
```

---

## Task 3: Kitap ilerlemesi hesabı

**Files:**
- Create: `src/domain/bookProgress.ts`
- Create: `src/domain/bookProgress.test.ts`

**Interfaces:**
- Produces: `calculateBookProgress(logs: ActivityLog[], totalPages: number): BookProgress`
- Produces: `resolveBookTotalPages(userBook: UserBook, catalogBook: CatalogBook | undefined): number`

- [x] **Step 1: Write the failing tests**

Cover:
- `book_pages` 1–100 then 101–220 → current 220, percent 46 for 480.
- deleted logs are ignored.
- `page_set` 180 after 220 → current 180; a later 181–200 log → current 200.
- deleting the `page_set` log falls back to the earlier 220.
- totalPages 0 → percent 0, `hasTotalPages` false.
- current >= total → percent 100, done true, remaining 0.
- current > total is clamped for display.

Use a helper `log(partial: Partial<ActivityLog>): ActivityLog` with fixed IDs/createdAt.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/domain/bookProgress.test.ts`
Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement the calculator**

Implement the baseline rule exactly:

```ts
const active = logs.filter((entry) => !entry.deletedAt && (entry.type === 'book_pages' || entry.type === 'page_set'));
const pageSets = active
  .filter((entry) => entry.type === 'page_set')
  .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
const baseline = pageSets.at(-1);
const pageLogs = active.filter(
  (entry) => entry.type === 'book_pages' && (!baseline || entry.createdAt > baseline.createdAt),
);
const reached = Math.max(baseline?.toPage ?? 0, ...pageLogs.map((entry) => entry.toPage ?? 0));
```

`percent` is 0 when `totalPages <= 0`; 100 when `reached >= totalPages`; otherwise `Math.min(99, Math.round((reached / totalPages) * 100))`. `currentPage` is `Math.min(reached, totalPages)` when total > 0.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/domain/bookProgress.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/domain/bookProgress.ts src/domain/bookProgress.test.ts
git commit -m "feat: calculate page-based book progress"
```

---

## Task 4: Raf ve ilerleme repository'leri

**Files:**
- Create: `src/db/bookRepositories.ts`
- Create: `src/db/bookRepositories.test.ts`
- Modify: `src/db/repositories.ts` (only if a shared helper is needed; do not delete legacy functions)

**Interfaces:**
- Consumes: `LOCAL_SCOPE`, `USER_BOOK_NAMESPACE`, `deterministicId`, `calculateBookProgress`, `resolveBookTotalPages`.
- Produces: `interface ShelfBook { userBook: UserBook; catalogBook: CatalogBook; totalPages: number; progress: BookProgress; }`
- Produces: `listShelfBooks(includeArchived?: boolean): Promise<ShelfBook[]>`
- Produces: `getShelfBook(id: string): Promise<ShelfBook | undefined>`
- Produces: `addCatalogBookToShelf(catalogBookId: string, totalPagesOverride?: number): Promise<UserBook>`
- Produces: `addCustomBook(input: CustomBookInput): Promise<UserBook>`
- Produces: `updateUserBook(id: string, input: UpdateUserBookInput): Promise<void>`
- Produces: `setBookPage(userBookId: string, page: number): Promise<void>`
- Produces: `listBookActivity(userBookId: string): Promise<ActivityLog[]>`
- Produces: `deleteActivityLog(id: string): Promise<void>`
- Produces: `deleteShelfBook(id: string): Promise<void>`

- [x] **Step 1: Write failing repository tests**

Cover: adding a catalog book is idempotent; custom book has `ownerId: LOCAL_SCOPE`; `setBookPage` creates a `page_set` log; invalid page throws; `updateUserBook` can set/clear the page override; `listShelfBooks` computes progress; `deleteActivityLog` tombstones; `deleteShelfBook` soft-deletes the book and its logs.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/db/bookRepositories.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement the repository**

Use `userBookId = deterministicId(USER_BOOK_NAMESPACE, \`${LOCAL_SCOPE}:${bookId}\`)`. `addCatalogBookToShelf` reuses an existing row for the same `bookId` (including archived) and clears `deletedAt`/sets `status: 'active'`. `setBookPage` validates `0 <= page <= totalPages`, creates `{ type: 'page_set', source: 'manual', toPage: page }`, refreshes the progress, and sets `status` to `completed` at 100% or back to `active` when a correction drops it below 100% (unless the user archived it). Do nothing if the page equals the current page. `deleteShelfBook` soft-deletes the user book, its activity logs, and its schedule tasks (import the schedule table from `db` directly to avoid a circular dependency).

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/db/bookRepositories.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/db/bookRepositories.ts src/db/bookRepositories.test.ts
git commit -m "feat: add book shelf repository"
```

---

## Task 5: Kitaplar sayfası ve katalog ekleme akışı

**Files:**
- Modify: `src/features/books/BooksPage.tsx`
- Create: `src/features/books/BookCatalogModal.tsx`
- Create: `src/features/books/CustomBookModal.tsx`
- Modify: `src/features/books/books.test.tsx`

**Interfaces:**
- Consumes: Task 2 catalog functions, Task 4 shelf functions.
- Produces: accessible labels used by later tests: `Kitap ekle`, `Kitap, yayınevi veya ders ara`, `Kendi kitabımı ekle`, `Rafın boş`.

- [x] **Step 1: Write failing UI tests**

Replace the old tests with:
- Empty shelf shows `Rafın boş. Katalogdan ilk kitabını ekle.`
- Clicking `Kitap ekle` opens dialog `Kitap ekle`; searching `bilgi sarmal` shows the catalog row; clicking `... kitabını rafıma ekle` closes the dialog and shows the book card with a progress bar.
- `Kendi kitabımı ekle` opens `Yeni kitap`; filling `Kitap adı`, `Toplam sayfa` and saving shows the book.
- Status filter `Arşiv` hides active books after archive.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/features/books/books.test.tsx`
Expected: FAIL against the old page.

- [x] **Step 3: Implement the shelf page**

Use `useLiveQuery(() => listShelfBooks(true), [])` and `listSubjects()` to map `subjectSlug` to a display name (fallback `Genel`). Keep the existing header, search field, empty-state and card visual language. Card text: title, publisher, subject label, `x/y sayfa`, `%NN`, remaining pages, `ProgressBar`. When `totalPages === 0`, show `Sayfa sayısını gir` instead of a percent and disable the progress bar. Link to `/kitaplar/${userBook.id}`. Filters: `Aktif`, `Bitenler`, `Arşiv`. The add dialog embeds catalog search and a `Kendi kitabımı ekle` button that opens the custom form. The catalog seed is a starter set; `Kendi kitabımı ekle` is the path for every other book.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/features/books/books.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/books/BooksPage.tsx src/features/books/BookCatalogModal.tsx src/features/books/CustomBookModal.tsx src/features/books/books.test.tsx
git commit -m "feat: add page-based books shelf"
```

---

## Task 6: Kitap detayı, sayfa güncelleme ve geçmiş

**Files:**
- Modify: `src/features/books/BookDetailPage.tsx`
- Create: `src/features/books/BookEditModal.tsx`
- Modify: `src/features/books/books.test.tsx`

**Interfaces:**
- Consumes: Task 4 functions, Task 3 progress.
- Produces: labels `Sayfa güncelle`, `Şu anki sayfa`, `İlerleme geçmişi`, `Düzeltme`.

- [x] **Step 1: Write failing detail tests**

Cover: opening `/kitaplar/:id` shows `0/400 sayfa`; entering 220 updates to `220/400` and `%55`; entering a lower page 180 updates downward; history shows `Manuel`; deleting the manual log returns to 220; editing the total page count shows the override; archiving hides the book from the active shelf.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/features/books/books.test.tsx`
Expected: FAIL.

- [x] **Step 3: Implement the detail page**

Header with `RingProgress`, `current/total sayfa`, remaining, last activity. `PageUpdateForm` posts `setBookPage`. History is newest first; `page_set` logs show `Manuel`/`Düzeltme` and a delete button. `BookEditModal` edits total pages and note; for custom books it also edits title/publisher/exam/subject. Archive and delete actions use confirmation modals. Load related tasks with `listBookTasks` from Task 10; until that exists, render nothing for the task section.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/features/books/books.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/books/BookDetailPage.tsx src/features/books/BookEditModal.tsx src/features/books/books.test.tsx
git commit -m "feat: add book detail and page history"
```

---

## Task 7: Konu bitirme durumu ve ders ilerlemesi

**Files:**
- Create: `src/db/topicProgressRepository.ts`
- Create: `src/db/topicProgressRepository.test.ts`
- Modify: `src/domain/calculations.ts`
- Modify: `src/lib/progress.ts`
- Modify: `src/features/subjects/SubjectCard.tsx`
- Modify: `src/features/subjects/TopicRow.tsx`
- Modify: `src/features/subjects/SubjectPage.tsx`
- Modify: `src/features/subjects/DeleteTopicModal.tsx`
- Modify: `src/lib/progress.test.tsx`

**Interfaces:**
- Consumes: `LOCAL_SCOPE`, `TOPIC_PROGRESS_NAMESPACE`, `deterministicId`.
- Produces: `setTopicDone(topicId: string, done: boolean): Promise<TopicProgress>`
- Produces: `getTopicDone(topicId: string): Promise<boolean>`
- Produces: `listAllTopicProgress(): Promise<TopicProgress[]>`
- Produces: `listTopicReviews(topicId: string): Promise<ActivityLog[]>`
- Produces: `listAllTopicReviews(): Promise<ActivityLog[]>`
- Produces: `calculateCountProgress(done: number, total: number): Progress`
- Produces: `TopicProgressRow { topic; progress; reviewCount; legacyTestRecordCount }`

- [x] **Step 1: Write failing tests**

Cover: setting a topic done creates one deterministic row and toggling it updates the same row; subject overview computes 1/2 done; review logs increment `reviewCount` but do not mark a topic done; a deleted topic’s progress row is removed by the cascade.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/db/topicProgressRepository.test.ts src/lib/progress.test.tsx`
Expected: FAIL.

- [x] **Step 3: Implement the repository and progress hook**

Use `topicProgressId = deterministicId(TOPIC_PROGRESS_NAMESPACE, \`${LOCAL_SCOPE}:${topicId}\`)`. `setTopicDone` upserts. `listTopicReviews` filters `activityLogs` by `type: 'topic_review'` and `topicId`, not deleted. `calculateCountProgress` returns `solved=done`, `total`, `percent = total ? Math.min(100, Math.round(done/total*100)) : 0`, `done = total > 0 && done === total`. Update `useSubjectOverview` to load topics, progress, reviews and legacy `topicBooks` in one query. Set `started = done || reviewCount > 0`. Update `SubjectCard`, `TopicRow`, `SubjectPage` labels from “test” to “konu”; `DeleteTopicModal` prop becomes `legacyRecordCount`. Update `deleteCustomTopicCascade` in `src/db/repositories.ts` to delete `topicProgress`, tombstone topic reviews, and tombstone schedule tasks for the topic.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/db/topicProgressRepository.test.ts src/lib/progress.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/db/topicProgressRepository.ts src/db/topicProgressRepository.test.ts src/domain/calculations.ts src/lib/progress.ts src/features/subjects src/lib/progress.test.tsx src/db/repositories.ts
git commit -m "feat: track topic completion separately from books"
```

---

## Task 8: Konu sayfası — durum, tekrar geçmişi ve legacy testler

**Files:**
- Modify: `src/features/topics/TopicPage.tsx`
- Create: `src/features/topics/TopicStatusTab.tsx`
- Create: `src/features/topics/LegacyTestsSection.tsx`
- Delete: `src/features/topics/TestsTab.tsx`
- Delete: `src/features/topics/TopicBookForm.tsx`
- Modify/replace: `src/features/topics/tests.test.tsx`

**Interfaces:**
- Consumes: Task 7 topic functions, existing `listTopicBooks`/`listBooks` for legacy.
- Produces: tab label `Durum`, checkbox `Bu konuyu bitirdim`, heading `Eski test kayıtları`.

- [x] **Step 1: Write failing UI tests**

Cover: opening a topic shows `Durum` tab and `Bu konuyu bitirdim`; checking it updates the subject page to `1/2 konu`; a topic review activity shows in `Tekrar geçmişi`; legacy `topicBooks` rows render under `Eski test kayıtları` and are read-only (no edit/delete buttons).

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/features/topics/tests.test.tsx`
Expected: FAIL.

- [x] **Step 3: Implement the topic status tab**

Header shows `Bitti` / `Başlanmadı` and review count. Tabs become `Durum`, `Notlar`, `Yanlışlar`. `TopicStatusTab` owns the checkbox and review list. `LegacyTestsSection` reads `listTopicBooks(topicId)` plus `listBooks()` and shows `x/y test` rows with no actions. Remove the old test-entry imports from `TopicPage`.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/features/topics/tests.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/topics/TopicPage.tsx src/features/topics/TopicStatusTab.tsx src/features/topics/LegacyTestsSection.tsx src/features/topics/tests.test.tsx
git rm src/features/topics/TestsTab.tsx src/features/topics/TopicBookForm.tsx
git commit -m "feat: add topic status and legacy test archive"
```

---

## Task 9: Haftalık plan domain yardımcıları

**Files:**
- Create: `src/domain/schedule.ts`
- Create: `src/domain/schedule.test.ts`

**Interfaces:**
- Produces: `weekStartOf(date: Date): string`
- Produces: `shiftWeek(weekStart: string, weeks: number): string`
- Produces: `weekLabel(weekStart: string): string`
- Produces: `dayLabel(weekStart: string, dayIndex: number): string`
- Produces: `validateTaskPages(from: number | undefined, to: number | undefined, totalPages: number): string | null`
- Produces: `summarizeWeek(tasks: ScheduleTask[], logs: ActivityLog[]): WeekSummary`
- Produces: `WeekSummary { taskCount; doneCount; plannedPages; readPages }`

- [x] **Step 1: Write failing tests**

Cover: a Sunday date maps to the previous Monday; `shiftWeek` crosses month/year; `weekLabel` returns a Turkish range; day 1 is Monday and day 7 is Sunday; reversed/zero/over-total page ranges return Turkish error strings; summary counts tasks and sums page ranges; deleted logs/tasks are ignored.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/domain/schedule.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement with date-fns**

Use `startOfWeek(date, { weekStartsOn: 1 })`, `addWeeks`, `format` with `tr` locale, and `parseISO`. Keep all functions pure. `summarizeWeek` sums `toPage - fromPage + 1` for active book tasks; `readPages` sums active `book_pages` logs whose `taskId` is in the active task set.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/domain/schedule.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/domain/schedule.ts src/domain/schedule.test.ts
git commit -m "feat: add weekly schedule domain helpers"
```

---

## Task 10: Haftalık plan repository'si ve otomatik ilerleme

**Files:**
- Create: `src/db/scheduleRepository.ts`
- Create: `src/db/scheduleRepository.test.ts`
- Modify: `src/db/bookRepositories.ts` (add `listBookTasks` import only if needed; avoid cycles)

**Interfaces:**
- Produces: `WeekData { week: ScheduleWeek; rows: ScheduleRow[]; tasks: ScheduleTask[] }`
- Produces: `getWeek(weekStart: string): Promise<WeekData | undefined>`
- Produces: `getOrCreateWeek(weekStart: string): Promise<WeekData>`
- Produces: `saveWeekNote(weekId: string, note: string): Promise<void>`
- Produces: `addRow(weekId: string, label: string, subjectId?: string): Promise<ScheduleRow>`
- Produces: `renameRow(rowId: string, label: string): Promise<void>`
- Produces: `deleteRow(rowId: string): Promise<void>`
- Produces: `addTask(input: CreateScheduleTaskInput): Promise<ScheduleTask>`
- Produces: `updateTask(taskId: string, input: UpdateScheduleTaskInput): Promise<void>`
- Produces: `deleteTask(taskId: string): Promise<void>`
- Produces: `toggleTask(taskId: string, done: boolean): Promise<void>`
- Produces: `copyWeek(sourceWeekStart: string, targetWeekStart: string): Promise<void>`
- Produces: `listBookTasks(userBookId: string): Promise<Array<ScheduleTask & { weekStart: string }>>`
- Produces: `listTasksForDay(weekStart: string, dayIndex: number): Promise<ScheduleTask[]>`

- [x] **Step 1: Write failing repository tests**

Cover:
- `addTask` rejects reversed ranges, 0, over-total, missing book/topic; accepts a valid book range.
- `toggleTask` re-validates the page range against the book’s current total and rejects an over-total tick.
- `toggleTask` creates one active `book_pages` log and sets `completedAt`; toggling off tombstones it; toggling on creates a new active log.
- A topic task creates a `topic_review` log and does not touch topic progress.
- A free task has no activity log.
- Updating a completed task’s page range tombstones the old log and creates a new one.
- `copyWeek` copies rows/tasks without `completedAt` or logs, and running it twice does not duplicate.
- Deleting a task keeps its active log; deleting a row removes its tasks.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/db/scheduleRepository.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement the repository**

Use one transaction for `toggleTask` and `updateTask`. Week IDs: `deterministicId(WEEK_NAMESPACE, \`${LOCAL_SCOPE}:${weekStart}\`)`. Copied row/task IDs: `deterministicId(COPY_NAMESPACE, \`${targetWeekId}:${sourceId}\`)`. `getOrCreateWeek` reuses a soft-deleted week row and clears its `deletedAt`. `listBookTasks` joins each task’s week to return `weekStart`. On tick, enforce at most one active activity per task by querying `activityLogs.where('taskId').equals(taskId)` and filtering `!deletedAt`. On untick, tombstone that log. On re-tick, insert a new random UUID log. `addTask` validates the book’s resolved total pages with `resolveBookTotalPages` and `validateTaskPages`. `deleteTask` tombstones the task but keeps its active activity log (progress remains); only untick tombstones the log. `deleteRow` tombstones the row and its tasks, also keeping their logs. Any accepted activity log must be stamped after the book's latest active log so a same-millisecond page set cannot hide a tick.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/db/scheduleRepository.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/db/scheduleRepository.ts src/db/scheduleRepository.test.ts
git commit -m "feat: add weekly plan repository with auto progress"
```

---

## Task 11: Haftalık plan ekranı — hafta, satırlar ve not

**Files:**
- Modify: `src/features/schedule/SchedulePage.tsx`
- Create: `src/features/schedule/WeeklyPlan.tsx`
- Create: `src/features/schedule/WeeklyPlanTable.tsx`
- Modify/replace: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- Consumes: Task 9 helpers, Task 10 week/row functions.
- Produces: labels `Önceki hafta`, `Sonraki hafta`, `Bu hafta`, `Satır ekle`, `Haftanın notu`.

- [x] **Step 1: Write failing UI tests**

Cover: opening `/program` shows the current week and seven day columns on desktop / day tabs on mobile; `Sonraki hafta` changes the date range; `Satır ekle` adds an editable row; renaming a row persists after reload; the week note saves.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/features/schedule/schedule.test.tsx`
Expected: FAIL against the old free-text table.

- [x] **Step 3: Implement the weekly shell**

`SchedulePage` keeps the upload/manual mode switch. In manual mode it renders `WeeklyPlan`; `WeeklyPlan` reads an optional `?week=YYYY-MM-DD` query parameter (validated with `isValidDateString`; fallback `weekStartOf(new Date())`), owns `weekStart` state, calls `getOrCreateWeek`, and renders `WeeklyPlanTable`. Rows are free-text labels (`AutoGrowTextarea`), with add/delete. Use `SCHEDULE_DAYS` for labels. The week note uses `saveWeekNote` with debounce, reusing the existing save-status pattern. Task cells are empty placeholders until Task 12.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/features/schedule/schedule.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/schedule/SchedulePage.tsx src/features/schedule/WeeklyPlan.tsx src/features/schedule/WeeklyPlanTable.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat: add dated weekly plan shell"
```

---

## Task 12: Görev ekleme, tikleme, özet ve hafta kopyalama

**Files:**
- Create: `src/features/schedule/ScheduleTaskModal.tsx`
- Create: `src/features/schedule/TaskChip.tsx`
- Create: `src/features/schedule/WeekSummary.tsx`
- Modify: `src/features/schedule/WeeklyPlanTable.tsx`
- Modify: `src/features/schedule/WeeklyPlan.tsx`
- Modify: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- Consumes: Task 10 `addTask`, `toggleTask`, `updateTask`, `deleteTask`, `copyWeek`, `listTasksForDay`.
- Produces: labels `Görev ekle`, `Kitap sayfası`, `Konu tekrarı`, `Serbest görev`, `Geçen haftadan kopyala`, `Planlanan sayfa`, `Okunan sayfa`.

- [x] **Step 1: Write failing UI tests**

Cover:
- Add a book task to Wednesday with `Bilgi Sarmal` pages 210–220; the chip shows `s. 210–220`.
- Ticking the chip updates the book detail progress and adds a `book_pages` log.
- Unticking removes the progress; re-ticking does not double count.
- Add a topic review task; ticking it shows a review entry on the topic page but the topic stays not done.
- `Geçen haftadan kopyala` copies tasks without completion; running it twice does not duplicate.
- `Planlanan sayfa` and `Okunan sayfa` update.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/features/schedule/schedule.test.tsx`
Expected: FAIL.

- [x] **Step 3: Implement task modal and chips**

`ScheduleTaskModal` uses segmented type buttons and shows only the fields for the selected type. Book select comes from `listShelfBooks()`; topic select uses `listSubjects()` + `listAllTopics()`. On save call `addTask`/`updateTask`. `TaskChip` has a checkbox (`aria-label` = `${label} görevini tamamla`), an edit button, and a delete button; done chips use the success tone. `WeeklyPlanTable` renders a `+` button per cell and a list of chips. `WeekSummary` uses `summarizeWeek`. Copy action calls `copyWeek` with the previous week. In `BookDetailPage`, replace the temporary empty task section with `listBookTasks(book.id)` and link each task to `/program?week=${task.weekStart}`.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/features/schedule/schedule.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/schedule/ScheduleTaskModal.tsx src/features/schedule/TaskChip.tsx src/features/schedule/WeekSummary.tsx src/features/schedule/WeeklyPlanTable.tsx src/features/schedule/WeeklyPlan.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat: add schedule tasks with automatic progress"
```

---

## Task 13: Ana sayfa — konu yüzdeleri, kitap rafı ve bugünün planı

**Files:**
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Create: `src/features/dashboard/TodayPlanCard.tsx`
- Modify: `src/features/dashboard/dashboard.test.tsx`

**Interfaces:**
- Consumes: Task 7 progress, Task 4 shelf, Task 10 `listTasksForDay`/`toggleTask`.
- Produces: card heading `Bugünün planı`; book cards use page progress.

- [x] **Step 1: Write failing dashboard tests**

Cover: overall/TYT/AYT percentages come from done topics; a page-based book card shows `220/400` and `%55`; today’s plan lists today’s tasks and ticking one updates the book progress.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/features/dashboard/dashboard.test.tsx`
Expected: FAIL against old test-based data.

- [x] **Step 3: Implement the new data flow**

Load `subjects`, `topics`, `topicProgress`, `shelfBooks`, `exams`, `results`, `photosSinceBackup`, and current-week tasks. `StatCard` labels become “Genel konu ilerlemesi”, “TYT konu ilerlemesi”, “AYT konu ilerlemesi”; extra text `${topicCount} konu`. Book section uses `shelfBooks.slice(0, 5)` and `ProgressBar` page percent. `TodayPlanCard` computes the day index as `((new Date().getDay() + 6) % 7) + 1`, calls `listTasksForDay(weekStartOf(new Date()), dayIndex)`, and renders checkboxes that call `toggleTask`; empty state `Bugün için görev yok.`.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/features/dashboard/dashboard.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/dashboard/DashboardPage.tsx src/features/dashboard/TodayPlanCard.tsx src/features/dashboard/dashboard.test.tsx
git commit -m "feat: update dashboard for page and topic progress"
```

---

## Task 14: Arama — raf kitapları ve yeni konu durumu

**Files:**
- Modify: `src/features/search/searchAll.ts`
- Modify: `src/features/search/search.test.ts`

**Interfaces:**
- Consumes: `listShelfBooks()`, `listSubjects()`, `listAllTopics()`.
- Produces: book result `href: /kitaplar/${userBook.id}`, title from catalog title, subtitle publisher + subject.

- [x] **Step 1: Write failing search tests**

Cover: searching a catalog book name returns a book result; searching a subject name returns the book; legacy `books` table rows no longer appear as separate results.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/features/search/search.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement**

Replace `listBooks()` with `listShelfBooks(true)`. Map `ShelfBook` to the existing `SearchResult` shape. Keep the existing per-kind limit and ordering. Update any test fixtures that create legacy books to create catalog/shelf books instead.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/features/search/search.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/search/searchAll.ts src/features/search/search.test.ts
git commit -m "feat: search page-based book shelf"
```

---

## Task 15: Zip yedek şeması v6 — dışa aktarma ve içe aktarma

**Files:**
- Modify: `src/db/backup.ts`
- Modify: `src/db/backup.test.ts`

**Interfaces:**
- Produces: `BACKUP_SCHEMA_VERSION = 6`
- Produces: backup/restore for `catalogBooks`, `userBooks`, `activityLogs`, `scheduleWeeks`, `scheduleRows`, `scheduleTasks`, `topicProgress`.

- [x] **Step 1: Write failing round-trip tests**

Add: export a DB with a catalog book, user book, page log, week/row/task and topic progress; import into a cleared DB; assert all rows and progress survive; assert manifest counts include the new tables; assert `syncQueue`/`syncMeta` are absent (they do not exist yet, so only assert the new tables).

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/db/backup.test.ts`
Expected: FAIL because v6 tables are not serialized.

- [x] **Step 3: Implement**

Bump the schema version. Add zod schemas for each new table with the exact fields from Task 1. Extend `backupDataSchema` with `.default([])` for backward compatibility, `RestoredData`, `countTables`, export collection and import `bulkPut` calls. The existing `db.transaction('rw', db.tables, ...)` clears all tables; keep that. After the transaction, call `seedCatalog()` next to the existing `seedCurriculum()` call. Leave v5→v6 migration for Task 16.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/db/backup.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/db/backup.ts src/db/backup.test.ts
git commit -m "feat: add v6 backup tables"
```

---

## Task 16: v5 yedeğini yeni modele taşıma

**Files:**
- Modify: `src/db/backup.ts`
- Modify: `src/db/backup.test.ts`

**Interfaces:**
- Consumes: legacy `books`, `topicBooks`, `topics`, `subjects`; `seedCatalog`.
- Produces: on `schemaVersion < 6`, `catalogBooks`/`userBooks`/`topicProgress` derived before the restore transaction.

- [x] **Step 1: Write failing migration tests**

Build a minimal v5 archive with two subjects, a book linked to both, and two topics; one topic fully solved. Import it. Assert:
- one user book exists, subject is the majority or `Genel` when tied;
- `Book.note` moved to `userBooks.note`;
- fully solved topic has `done: true`, partial topic does not;
- legacy `books`/`topicBooks` rows are still present;
- catalog match uses the seeded catalog when title+publisher match.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/db/backup.test.ts`
Expected: FAIL.

- [x] **Step 3: Implement the legacy conversion**

In `importBackup`, after `RestoredData` is built and before the transaction, if `manifest.schemaVersion < 6`, call a new `buildNewModelFromLegacy(restored)` that returns the three new arrays. It must match against the in-memory `CATALOG_SEED` (not the DB, because the transaction clears every table) and include the matched catalog rows in the returned `catalogBooks`, so `userBooks.bookId` never dangles. Choose the newest edition deterministically; otherwise create a private `CatalogBook` with `ownerId: LOCAL_SCOPE`, `totalPages: 0`. Derive subject/exam from the majority of the book’s legacy topic records; ties become `Genel`/undefined. Group `topicBooks` by topic for full-completion `topicProgress`. Add the derived rows to the restore `bulkPut` list. After the transaction, call `seedCatalog()` together with the existing `seedCurriculum` call to fill any missing catalog entries.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/db/backup.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/db/backup.ts src/db/backup.test.ts
git commit -m "feat: migrate v5 backups to page-based model"
```

---

## Task 17: Eski çizelgeyi salt okunur gösterme ve temizlik

**Files:**
- Create: `src/features/schedule/LegacyScheduleTable.tsx`
- Modify: `src/features/schedule/SchedulePage.tsx`
- Delete: `src/features/schedule/ScheduleTableEditor.tsx`
- Modify: `src/features/schedule/schedule.test.tsx`
- Modify: `src/features/settings/SettingsPage.tsx` (copy text if needed)

**Interfaces:**
- Consumes: `getScheduleTable()`.
- Produces: `<details>` summary `Eski çizelge`; read-only table and note.

- [x] **Step 1: Write failing legacy tests**

Cover: with an old `scheduleTables` row, `/program` shows `Eski çizelge`; the old free-text cells are visible but not editable; the new weekly plan still works.

- [x] **Step 2: Run and verify failure**

Run: `npx vitest run src/features/schedule/schedule.test.tsx`
Expected: FAIL.

- [x] **Step 3: Implement and remove the old editor**

Render the old table as a simple read-only `<table>` with day headers, subject rows, done styles, and the note. Delete `ScheduleTableEditor.tsx`; keep `scheduleTable.ts` for types/legacy data. Update `SchedulePage` imports.

- [x] **Step 4: Run and verify pass**

Run: `npx vitest run src/features/schedule/schedule.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/features/schedule/LegacyScheduleTable.tsx src/features/schedule/SchedulePage.tsx src/features/schedule/schedule.test.tsx
git rm src/features/schedule/ScheduleTableEditor.tsx
git commit -m "feat: keep legacy schedule read-only"
```

---

## Task 18: Bütünleşik doğrulama ve local preview

**Files:**
- Modify: `tests/e2e/program.spec.ts` (stale old schedule editor)
- Modify: `README.md` (book/plan behavior, no cloud yet)
- Modify: `docs/superpowers/plans/2026-11-22-kitap-sayfa-takibi-ve-haftalik-plan.md` (check boxes as completed)

- [x] **Step 1: Update stale E2E specs and run Playwright**

`tests/e2e/program.spec.ts` still drives the deleted `ScheduleTableEditor` UI. Rewrite it for the new dated weekly plan:
- open `/program`,
- verify the current week label and `Satır ekle`,
- add a row, type a label, wait for autosave, reload, assert it persists,
- optionally add a task and tick it if the test environment is stable.
Also grep `tests/e2e` for `Kitap / test ekle`, `Toplam test`, `Çözülen test`, `Haftalık tablo`, `Tik modu`, and old editor labels; fix any stale spec that would fail.
Run: `npm run test:e2e`
Expected: PASS.

- [x] **Step 2: Run the full unit/UI suite**

Run: `npm run test:run`
Expected: PASS, no skipped new tests.

- [x] **Step 3: Run typecheck and production build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [x] **Step 4: Update README**

Document that books are now page-based and the weekly plan records progress; note that accounts/cloud sync are the next phase. Do not claim cloud features.

- [x] **Step 5: Commit**

```bash
git add tests/e2e/program.spec.ts README.md docs/superpowers/plans/2026-11-22-kitap-sayfa-takibi-ve-haftalik-plan.md
git commit -m "docs: describe page-based books and weekly plan"
```

- [x] **Step 6: Start the local preview and stop**

Run: `npm run dev -- --host`
Expected: Vite prints a local URL (`http://localhost:5173/`). Leave it running for the user and report the URL. **Do not run `git push`.**
Ask the user to check: books page, catalog add, book detail page update, weekly plan task tick, topic done, dashboard, legacy sections.
Wait for explicit approval before any push or Phase 2 work.

---

## Phase 2 (ayrı plan)

Supabase auth, per-user DB, sync engine, migration, `restore_account` RPC and deployment are **not** in this plan. After Phase 1 preview is approved, write the Phase 2 plan against the real interfaces from this implementation.
