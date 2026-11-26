# Sayfa Zinciri Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Haftalık planda seçilen günlere tek kitaptan ardışık sayfa aralıkları yazan, kaçırılan/geçmiş günlerde aralıkları sağa kaydıran ve taşan aralığı “Planlanmamış” olarak gösteren bir sayfa zinciri eklemek.

**Architecture:** Zincir, `schedule_tasks` şemasına dokunmadan yeni `schedulePageChains` senkron tablosunda tutulur; bağlı görevler `slots` JSON’u ile işaret edilir. Saf sayfa matematiği `src/domain/pageChain.ts`’de, Dexie CRUD/recompute `src/db/pageChainRepository.ts`’de, UI paneli `src/features/schedule/PageChainModal.tsx`’de yaşar. Mevcut hücre modalı, tik modu, kopyalama ve yedek akışları korunur.

**Tech Stack:** React 19, TypeScript, Dexie 4, date-fns, Tailwind CSS 4, Vitest + React Testing Library, Playwright, PHP 8.4 + PHPUnit (CI).

**Spec:** `docs/superpowers/specs/2026-11-26-page-chain-design.md`

## Global Constraints

- Node.js `>=22.22.2`; yeni bağımlılık eklenmez.
- Tüm arayüz metinleri Türkçe; mevcut `Button`, `Modal`, `Field`, `cn`, `lucide-react` desenleri.
- `schedule_tasks` tablosuna yeni kolon eklenmez; yeni veri yalnızca `schedulePageChains` tablosunda.
- Zincir tek satır + tek kitap; en az 2, en fazla 7 gün.
- Aralıklar başlangıç/bitiş dahil, bitişik ve örtüşmesiz; `chunkCount` parça sayısını belirler.
- Otomatik “Yapılmadı” `missedAt` olarak yazılmaz; yalnızca görüntü ve zincir hesabında etkilidir.
- Normal görevler otomatik kırmızı çarpı görür ama sayfa kaydırmaz; yalnızca zincir görevleri kayar.
- Eski istemciler `schedulePageChains` tablosunu bilmez; görev senkronu değişmez.
- Çalışma dalı `feat/page-chain`; kullanıcı önizlemeyi onaylamadan `main`’e merge/push ve canlı deploy yok.
- `dist/` yalnızca son yayın görevinde build edilip commit edilir.
- Tüm alt ajanlar `opencode-go/deepseek-v4.1-flash#max` modelini kullanır.
- PHPUnit yerelde çalışmıyorsa (PHP yok) CI’daki `api` işi esas alınır; Vitest/Playwright yerelde çalıştırılır.

## Review Focus

1. **Geçmiş gün otomatik çarpı:** Dün işaretsiz kalan zincir görevi sonraki günü kaydırır; normal görev yalnızca çarpı görür ve kaymaz. Test: Task 2 + Task 5.
2. **Eksik görev / tombstone:** Henüz pull edilmemiş görev zinciri çözmez; gerçekten silinmiş veya gün/satır/kitap kimliği değişmiş görev çözer. Test: Task 5.
3. **Parça matematiği:** `chunkCount` olmadan son parça yanlış üretilir; aynı `chunkIndex` iki görevde geçerlidir. Test: Task 1.
4. **Eski istemci uyumu:** Yeni tablo eski istemcilerin görev push/pull’ını etkilemez; görev satırları değişmez. Test: Task 6 + Task 7.
5. **Yedek/senkron round-trip:** `slots` JSON’u, `chunkCount` ve yeni tablo yedekten ve sunucudan kayıpsız döner. Test: Task 8 + Task 6.

---

## File Structure

```
src/domain/pageChain.ts                 saf parçalama, atama, slots parse/serialize
src/domain/pageChain.test.ts            birim testleri
src/domain/schedule.ts                  gün bazlı etkin durum + benzersiz sayfa
src/domain/schedule.test.ts             güncellenen testler
src/db/scheduleTaskFields.ts            paylaşılan görev alanı doğrulaması
src/db/pageChainRepository.ts           Dexie CRUD/recompute/reconcile
src/db/pageChainRepository.test.ts      repository testleri
src/db/scheduleRepository.ts            setTaskStatus/update/delete/row entegrasyonu
src/db/db.ts                            v9 store
src/db/db.test.ts                       tablo listesi testi
src/db/sync/constants.ts                yeni senkron tablosu
src/db/backup.ts                        yedek şema v7
src/db/backup.test.ts                   yedek testleri
src/features/schedule/PageChainModal.tsx        yeni panel
src/features/schedule/PageChainBanner.tsx       planlanmamış uyarısı
src/features/schedule/WeeklyPlan.tsx            panel + reconcile + banner
src/features/schedule/WeeklyPlanTable.tsx       “Sayfa zinciri” düğmesi
src/features/schedule/TaskChip.tsx              zincir rozeti
src/features/schedule/schedule.test.tsx         UI testleri
api/src/Sync/TableMap.php                       yeni tablo tanımı
api/migrations/004_page_chain.sql               yeni tablo
api/tests/Unit/TableMapTest.php                 14 tablo + alan testleri
api/tests/Integration/MigrationTest.php         tablo listesi
scripts/mock-api.mjs                            mock tablo + sync
scripts/mock-api.test.mjs                       contract testi
tests/e2e/page-chain.spec.ts                    uçtan uca akış
```

---

## Task 1: Sayfa Zinciri Matematiği

**Files:**
- Create: `src/domain/pageChain.ts`
- Test: `src/domain/pageChain.test.ts`

**Interfaces:**
- Consumes: `ScheduleTaskStatus` from `src/domain/schedule.ts`.
- Produces:

```ts
export interface PageChainSlot {
  taskId: string;
  slotIndex: number;
  chunkIndex: number;
  dayIndex: number;
}
export interface PageChainChunk {
  chunkIndex: number;
  fromPage: number;
  toPage: number;
}
export interface AssignChainChunksInput {
  slots: PageChainSlot[];
  statuses: ReadonlyMap<string, ScheduleTaskStatus>;
  startPage: number;
  endPage: number;
  chunkSize: number;
  chunkCount: number;
}
export interface AssignChainChunksResult {
  chunks: PageChainChunk[];
  assignments: Map<string, PageChainChunk>;
  unscheduled: PageChainChunk[];
}
export function pageChunkSize(startPage: number, endPage: number, chunkCount: number): number;
export function splitPageRange(startPage: number, endPage: number, chunkCount: number): PageChainChunk[];
export function assignChainChunks(input: AssignChainChunksInput): AssignChainChunksResult;
export function parseChainSlots(value: string): PageChainSlot[] | null;
export function serializeChainSlots(slots: PageChainSlot[]): string;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/domain/pageChain.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  assignChainChunks,
  pageChunkSize,
  parseChainSlots,
  serializeChainSlots,
  splitPageRange,
  type PageChainSlot,
} from './pageChain';

function slot(taskId: string, slotIndex: number, chunkIndex: number, dayIndex: number): PageChainSlot {
  return { taskId, slotIndex, chunkIndex, dayIndex };
}

describe('splitPageRange', () => {
  test('100-150 beş güne bitişik bölünür', () => {
    expect(splitPageRange(100, 150, 5)).toEqual([
      { chunkIndex: 0, fromPage: 100, toPage: 109 },
      { chunkIndex: 1, fromPage: 110, toPage: 119 },
      { chunkIndex: 2, fromPage: 120, toPage: 129 },
      { chunkIndex: 3, fromPage: 130, toPage: 139 },
      { chunkIndex: 4, fromPage: 140, toPage: 150 },
    ]);
  });

  test('az sayfada her güne bir sayfa düşer', () => {
    expect(splitPageRange(100, 104, 5).map((chunk) => [chunk.fromPage, chunk.toPage])).toEqual([
      [100, 100],
      [101, 101],
      [102, 102],
      [103, 103],
      [104, 104],
    ]);
  });

  test('geçersiz aralıkları reddeder', () => {
    expect(() => splitPageRange(100, 100, 2)).toThrow();
    expect(() => splitPageRange(100, 101, 5)).toThrow();
    expect(() => splitPageRange(100, 150, 1)).toThrow();
  });

  test('parça boyu formülü', () => {
    expect(pageChunkSize(100, 150, 5)).toBe(10);
    expect(pageChunkSize(100, 119, 2)).toBe(10);
    expect(pageChunkSize(100, 104, 5)).toBe(1);
  });
});

describe('assignChainChunks', () => {
  const base = {
    startPage: 100,
    endPage: 150,
    chunkSize: 10,
    chunkCount: 5,
  };

  test('başlangıçta her görev kendi parçasını alır', () => {
    const slots = [1, 2, 3, 4, 5].map((day, index) => slot(`t${index}`, index, index, day));
    const statuses = new Map(slots.map((item) => [item.taskId, 'pending' as const]));
    const result = assignChainChunks({ ...base, slots, statuses });

    expect(result.assignments.get('t0')).toEqual({ chunkIndex: 0, fromPage: 100, toPage: 109 });
    expect(result.assignments.get('t4')).toEqual({ chunkIndex: 4, fromPage: 140, toPage: 150 });
    expect(result.unscheduled).toEqual([]);
  });

  test('ikinci gün kaçırılınca sonraki gün aynı aralığı alır', () => {
    const slots = [1, 2, 3, 4, 5].map((day, index) => slot(`t${index}`, index, index, day));
    const statuses = new Map([
      ['t0', 'done'],
      ['t1', 'missed'],
      ['t2', 'pending'],
      ['t3', 'pending'],
      ['t4', 'pending'],
    ] as const);
    const result = assignChainChunks({ ...base, slots, statuses });

    expect(result.assignments.get('t1')).toEqual({ chunkIndex: 1, fromPage: 110, toPage: 119 });
    expect(result.assignments.get('t2')).toEqual({ chunkIndex: 1, fromPage: 110, toPage: 119 });
    expect(result.assignments.get('t4')).toEqual({ chunkIndex: 3, fromPage: 130, toPage: 139 });
    expect(result.unscheduled).toEqual([{ chunkIndex: 4, fromPage: 140, toPage: 150 }]);
  });

  test('aynı chunkIndex iki görevde geçerlidir', () => {
    const slots = [slot('t0', 0, 0, 1), slot('t1', 1, 1, 2), slot('t2', 2, 1, 3)];
    const statuses = new Map([
      ['t0', 'done'],
      ['t1', 'missed'],
      ['t2', 'pending'],
    ] as const);
    const result = assignChainChunks({
      startPage: 100,
      endPage: 119,
      chunkSize: 10,
      chunkCount: 2,
      slots,
      statuses,
    });

    expect(result.assignments.get('t1')?.chunkIndex).toBe(1);
    expect(result.assignments.get('t2')?.chunkIndex).toBe(1);
  });
});

describe('chain slots', () => {
  test('serialize/parse gidiş-dönüşü', () => {
    const slots = [slot('t0', 0, 0, 1), slot('t1', 1, 2, 3)];
    expect(parseChainSlots(serializeChainSlots(slots))).toEqual(slots);
  });

  test('bozuk JSON, eksik alan, tekrarlı taskId/slotIndex reddedilir', () => {
    expect(parseChainSlots('{')).toBeNull();
    expect(parseChainSlots('[]')).toBeNull();
    expect(parseChainSlots('[{"taskId":"a","slotIndex":0}]')).toBeNull();
    expect(
      parseChainSlots(
        '[{"taskId":"a","slotIndex":0,"chunkIndex":0,"dayIndex":1},{"taskId":"a","slotIndex":1,"chunkIndex":1,"dayIndex":2}]',
      ),
    ).toBeNull();
    expect(
      parseChainSlots(
        '[{"taskId":"a","slotIndex":0,"chunkIndex":0,"dayIndex":1},{"taskId":"b","slotIndex":0,"chunkIndex":1,"dayIndex":2}]',
      ),
    ).toBeNull();
  });

  test('tekrarlı chunkIndex kabul edilir, 7’den fazla slot reddedilir', () => {
    expect(
      parseChainSlots(JSON.stringify([
        { taskId: 'a', slotIndex: 0, chunkIndex: 0, dayIndex: 1 },
        { taskId: 'b', slotIndex: 1, chunkIndex: 0, dayIndex: 2 },
      ])),
    ).toHaveLength(2);

    const eight = Array.from({ length: 8 }, (_, index) => ({
      taskId: `t${index}`,
      slotIndex: index,
      chunkIndex: 0,
      dayIndex: (index % 7) + 1,
    }));
    expect(parseChainSlots(JSON.stringify(eight))).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/domain/pageChain.test.ts`
Expected: FAIL with "Cannot find module './pageChain'".

- [ ] **Step 3: Implement `src/domain/pageChain.ts`**

Implement the exported signatures. `pageChunkSize` uses `Math.max(1, Math.floor((endPage - startPage + 1) / chunkCount))` (inclusive page span; the last chunk absorbs the remainder). `splitPageRange` validates positive integers, `2 <= chunkCount <= 7`, `endPage > startPage`, and `endPage - startPage + 1 >= chunkCount`; the last chunk ends at `endPage`. `assignChainChunks` verifies `chunkSize === pageChunkSize(...)`, then:
- `done` slots consume their valid `chunkIndex`;
- `missed` slots keep their valid `chunkIndex` but do not consume/reserve it;
- `pending` slots get the lowest chunk not consumed/reserved and reserve it; a missing status defaults to `pending`;
- `unscheduled` is every chunk that no slot has an assignment for (a pushed-out range), not every unconsumed chunk.
`parseChainSlots` accepts only an array of 2–7 slots with unique `taskId`/`slotIndex`, integer `chunkIndex >= 0`, `dayIndex` 1–7; duplicate `chunkIndex` is allowed. `serializeChainSlots` sorts by `slotIndex` and JSON-stringifies.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/domain/pageChain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/pageChain.ts src/domain/pageChain.test.ts
git commit -m "feat(schedule): add page chain range math"
```

---

## Task 2: Gün Bazlı Etkin Durum ve Benzersiz Sayfa Özeti

**Files:**
- Modify: `src/domain/schedule.ts`
- Modify: `src/features/books/BookDetailPage.tsx`
- Test: `src/domain/schedule.test.ts`
- Test: `src/features/books/books.test.tsx`
- Test: `src/features/schedule/schedule.test.tsx` (only if an existing past-day expectation changes)

**Interfaces:**
- Produces: `scheduleTaskStatus` unchanged signature, per-day auto-miss; `summarizeWeek` unchanged signature, unique `plannedPages`.

- [ ] **Step 1: Update the failing tests**

In `src/domain/schedule.test.ts`, change the status test to use explicit days and a Sunday `now`:

```ts
test('görev durumu gün bazında tamamlanma, kaçırılma ve otomatik kaçırmadan türetilir', () => {
  // 22 Kasım 2026 Pazar; geçerli hafta 16 Kasım Pazartesi.
  const now = new Date(2026, 10, 22, 12);
  const done = task({ dayIndex: 5, completedAt: '2026-11-20T10:00:00.000Z' });

  expect(scheduleTaskStatus(done, '2026-11-16', now)).toBe('done');
  expect(
    scheduleTaskStatus(task({ dayIndex: 5, missedAt: '2026-11-20T10:00:00.000Z' }), '2026-11-16', now),
  ).toBe('missed');
  expect(scheduleTaskStatus(task({ dayIndex: 1 }), '2026-11-16', now)).toBe('missed');
  expect(scheduleTaskStatus(task({ dayIndex: 6 }), '2026-11-16', now)).toBe('missed');
  expect(scheduleTaskStatus(task({ dayIndex: 7 }), '2026-11-16', now)).toBe('pending');
  expect(scheduleTaskStatus(task({ dayIndex: 1 }), '2026-11-09', now)).toBe('missed');
  expect(scheduleTaskStatus(task({ dayIndex: 1 }), '2026-11-23', now)).toBe('pending');
  expect(scheduleTaskStatus(done, '2026-11-09', now)).toBe('done');
});
```

Add an overlapping-range summary test:

```ts
test('planlanan sayfa örtüşen aralıkları benzersiz sayar', () => {
  const tasks = [
    task({ id: 'a', dayIndex: 7, userBookId: 'book-1', fromPage: 10, toPage: 20 }),
    task({ id: 'b', dayIndex: 7, userBookId: 'book-1', fromPage: 15, toPage: 25 }),
    task({ id: 'c', dayIndex: 7, userBookId: 'book-1', fromPage: 1, toPage: 5 }),
  ];

  expect(summarizeWeek(tasks, [])).toMatchObject({ plannedPages: 21 });
});

test('farklı kitapların sayfaları ayrı sayılır', () => {
  const tasks = [
    task({ id: 'a', dayIndex: 7, userBookId: 'book-1', fromPage: 1, toPage: 20 }),
    task({ id: 'b', dayIndex: 7, userBookId: 'book-2', fromPage: 1, toPage: 20 }),
  ];

  expect(summarizeWeek(tasks, [])).toMatchObject({ plannedPages: 40 });
});
```

Add a `books.test.tsx` test: seed a `scheduleWeeks` row for a past week and a book task in that week with no `completedAt`/`missedAt`, render `/kitaplar/<userBookId>`, and expect the plan link's accessible name to contain `Yapılmadı` (not `Planlandı`). The existing summary tests keep their expected values; if they use `dayIndex: 1` and now is Sunday, only `summarizeWeek` changes (it ignores status), so they still pass.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/domain/schedule.test.ts`
Expected: FAIL on the new per-day status expectations and the overlap total.

- [ ] **Step 3: Implement**

In `src/domain/schedule.ts`:
- Import `startOfDay` from `date-fns`.
- In `scheduleTaskStatus`, after explicit `completedAt`/`missedAt`, compute `taskDay = addDays(parseISO(weekStart), task.dayIndex - 1)` and return `'missed'` when `startOfDay(taskDay) < startOfDay(now)`, otherwise `'pending'`.
- Replace the `plannedPages` reduce with a helper that groups active `type === 'book'` ranges by `userBookId` (tasks without a `userBookId` each stay in their own group), merges ranges within each group (`fromPage`/`toPage` valid, `toPage >= fromPage`), and sums the group unions. Ignore status and deleted rows. Existing `readPages` logic stays.
- `BookDetailPage.tsx`: replace the local `task.completedAt ? 'Tamamlandı' : 'Planlandı'` with `scheduleTaskStatus(task, task.weekStart)` and map `done → 'Tamamlandı'`, `missed → 'Yapılmadı'`, `pending → 'Planlandı'`. This makes the book detail plan list agree with the planner's auto-missed display.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/domain/schedule.test.ts src/features/books/books.test.tsx src/features/schedule/schedule.test.tsx`
Expected: PASS. If a schedule component test uses a past day and expects "Planlandı", update it to expect "Yapılmadı" per the new rule.

- [ ] **Step 5: Commit**

```bash
git add src/domain/schedule.ts src/domain/schedule.test.ts src/features/books/BookDetailPage.tsx src/features/books/books.test.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat(schedule): derive missed days and unique planned pages"
```

---

## Task 3: Veri Modeli, Dexie v9 ve Senkron Sabitleri

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/db/db.ts`
- Modify: `src/db/sync/constants.ts`
- Modify: `src/db/db.test.ts`
- Modify: `src/db/sync/queue.ts` (comment only)

**Interfaces:**
- Produces:

```ts
export interface SchedulePageChain {
  id: string;
  weekId: string;
  rowId: string;
  userBookId: string;
  startPage: number;
  endPage: number;
  chunkSize: number;
  chunkCount: number;
  slots: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
```

- [ ] **Step 1: Add the failing table-list assertion**

In `src/db/db.test.ts`, add `'schedulePageChains'` to the expected table list (alphabetically after `scheduleFiles`/before `scheduleRows`) and add:

```ts
expect(db.schedulePageChains.schema.indexes.map((index) => index.name)).toEqual([
  'weekId',
  'rowId',
  'updatedAt',
  'deletedAt',
]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/db/db.test.ts`
Expected: FAIL because the table/store does not exist.

- [ ] **Step 3: Implement**

- `src/domain/types.ts`: add `SchedulePageChain` after `ScheduleTask`.
- `src/db/db.ts`: import the type, add `schedulePageChains!: Table<SchedulePageChain, string>`, and add:

```ts
// v9 adds the page-chain layer without touching schedule_tasks.
this.version(9).stores({
  schedulePageChains: 'id, weekId, rowId, updatedAt, deletedAt',
});
```

- `src/db/sync/constants.ts`: add `'schedulePageChains'` to `SYNCED_TABLES` after `scheduleTasks`; add `schedulePageChains: 'id'` to `SYNC_ROW_ID_FIELDS`; add:

```ts
schedulePageChains: [
  'id',
  'weekId',
  'rowId',
  'userBookId',
  'startPage',
  'endPage',
  'chunkSize',
  'chunkCount',
  'slots',
  'createdAt',
  'updatedAt',
  'deletedAt',
],
```

- `src/db/sync/queue.ts`: change the 13-table comment to 14.

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- src/db/db.test.ts src/db/sync/queue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/db/db.ts src/db/sync/constants.ts src/db/sync/queue.ts src/db/db.test.ts
git commit -m "feat(sync): add schedule page chain store"
```

---

## Task 4: Görev Alanı Doğrulamasını Ayır ve Zincir Repository’sini Kur

**Files:**
- Create: `src/db/scheduleTaskFields.ts`
- Modify: `src/db/scheduleRepository.ts`
- Create: `src/db/pageChainRepository.ts`
- Test: `src/db/pageChainRepository.test.ts`

**Interfaces:**
- `scheduleTaskFields.ts` exports:

```ts
export interface TaskFields {
  type: ScheduleTaskType;
  userBookId?: string;
  fromPage?: number;
  toPage?: number;
  topicId?: string;
  title?: string;
}
export function validateTaskFields(
  input: CreateScheduleTaskInput | UpdateScheduleTaskInput,
): Promise<TaskFields>;
```

- `pageChainRepository.ts` exports:

```ts
export interface CreatePageChainInput {
  weekId: string;
  rowId: string;
  userBookId: string;
  startPage: number;
  endPage: number;
  days: number[];
}
export interface PageChainView {
  chain: SchedulePageChain;
  slots: PageChainSlot[];
  tasks: ScheduleTask[];
  chunks: PageChainChunk[];
  unscheduled: PageChainChunk[];
  incomplete: boolean;
  nextEmptyDay: number | null;
}
export async function createPageChain(input: CreatePageChainInput): Promise<PageChainView>;
export async function listWeekPageChains(weekId: string): Promise<PageChainView[]>;
export async function recomputePageChain(chainId: string, now?: Date): Promise<PageChainView | null>;
export async function dissolvePageChain(chainId: string): Promise<void>;
export async function findChainForTask(weekId: string, taskId: string): Promise<string | null>;
```

- [ ] **Step 1: Write the failing repository tests**

Create `src/db/pageChainRepository.test.ts` with the project’s usual temp-Dexie setup. Seed a catalog book + user book, a `scheduleWeeks` row and a `scheduleRows` row. Use `weekStart = '2026-12-07'` for the status-shift tests (so no task is auto-missed); use `weekStart = '2026-11-16'` only for the auto-missed test in Task 5. Add:

```ts
test('beş günlük zincir beş görev ve bir zincir satırı oluşturur', async () => {
  const view = await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 100,
    endPage: 150,
    days: [1, 2, 3, 4, 5],
  });

  expect(view.tasks).toHaveLength(5);
  expect(view.tasks.map((task) => [task.fromPage, task.toPage])).toEqual([
    [100, 109],
    [110, 119],
    [120, 129],
    [130, 139],
    [140, 150],
  ]);
  expect(view.slots).toHaveLength(5);
  expect(view.unscheduled).toEqual([]);
  expect(await db.schedulePageChains.count()).toBe(1);
});

test('dolu günü zincire eklemez', async () => {
  await addTask({ weekId, rowId, dayIndex: 2, type: 'free', title: 'Dolu' });
  await expect(
    createPageChain({
      weekId,
      rowId,
      userBookId,
      startPage: 100,
      endPage: 150,
      days: [1, 2, 3],
    }),
  ).rejects.toThrow('Bu güne zaten bir görev eklenmiş.');
});

test('kaçırılan gün sonraki günü kaydırır ve taşan aralığı bildirir', async () => {
  const view = await createPageChain({
    weekId,
    rowId,
    userBookId,
    startPage: 100,
    endPage: 150,
    days: [1, 2, 3, 4, 5],
  });
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  await db.scheduleTasks.update(second.id, {
    missedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  // Seed the week as a future week (ör. 2026-12-07) so no task is auto-missed;
  // alternatively pass a fixed `now` before the week.
  const recomputed = await recomputePageChain(view.chain.id, new Date(2026, 11, 1, 12));

  expect(recomputed?.tasks.find((task) => task.dayIndex === 3)).toMatchObject({
    fromPage: 110,
    toPage: 119,
  });
  expect(recomputed?.tasks.find((task) => task.dayIndex === 5)).toMatchObject({
    fromPage: 130,
    toPage: 139,
  });
  expect(recomputed?.unscheduled).toEqual([
    { chunkIndex: 4, fromPage: 140, toPage: 150 },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/db/pageChainRepository.test.ts`
Expected: FAIL with "Cannot find module './pageChainRepository'".

- [ ] **Step 3: Extract validation and implement the repository core**

- Move `TaskFields` and `validateTaskFields` verbatim from `scheduleRepository.ts` into `scheduleTaskFields.ts`; import `db`, `validateTaskPages`, `resolveBookTotalPages`, `isActiveRow`, and the input types with `import type { CreateScheduleTaskInput, UpdateScheduleTaskInput } from './scheduleRepository'` (type-only, so no runtime cycle). Make the function exported. Update `scheduleRepository.ts` to import them and delete the local definitions. Keep `validateDayIndex` in `scheduleRepository.ts`.
- Implement `createPageChain`:
  - Sort/validate `days` (unique, 2–7, 1–7); verify the row is active and the week exists.
  - Compute `chunkSize = pageChunkSize(...)`, `chunks = splitPageRange(...)`.
  - In one `db.transaction('rw', db.scheduleTasks, db.schedulePageChains, db.userBooks, db.catalogBooks, db.topics, ...)`, verify every selected cell is empty, call `validateTaskFields` per day, build `ScheduleTask` rows with `newId()`, `bulkAdd` them, create the chain row with `id: newId()`, `slots: serializeChainSlots(...)`, `createdAt/updatedAt`, and return the view.
- Implement `listWeekPageChains`:
  - Query active chain rows by `weekId`; parse slots; load tasks by IDs; mark `incomplete` if a task is absent; compute `chunks`, `unscheduled`, and `nextEmptyDay` (first day after the last slot with no active task in the row).
- Implement `recomputePageChain`:
  - Load chain + week (`db.scheduleWeeks.get(chain.weekId)`), parse slots, load tasks.
  - Build `statuses` with `scheduleTaskStatus(task, week.weekStart, now)`.
  - Call `assignChainChunks`; update only slots whose status is `pending` and whose `fromPage`/`toPage`/`chunkIndex` changed; update the chain `slots`/`updatedAt` only if any chunk assignment changed.
- Implement `dissolvePageChain` (set `deletedAt`/`updatedAt`) and `findChainForTask` (scan active chains for the week, parse slots, match `taskId`).

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- src/db/pageChainRepository.test.ts src/db/sync/push.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/scheduleTaskFields.ts src/db/scheduleRepository.ts src/db/pageChainRepository.ts src/db/pageChainRepository.test.ts
git commit -m "feat(schedule): create and recompute page chains"
```

---

## Task 5: Durum, Reconcile, Sonraki Gün ve Çözme Entegrasyonu

**Files:**
- Modify: `src/db/pageChainRepository.ts`
- Modify: `src/db/scheduleRepository.ts`
- Test: `src/db/pageChainRepository.test.ts`
- Test: `src/db/scheduleRepository.test.ts` (create if absent)

**Interfaces:**
- Adds:

```ts
export async function reconcileWeekPageChains(weekId: string, now?: Date): Promise<void>;
export async function addUnscheduledChunk(chainId: string): Promise<void>;
export async function dissolveChainsForTask(weekId: string, taskId: string): Promise<void>;
export async function dissolveChainsForRow(weekId: string, rowId: string): Promise<void>;
```

- [ ] **Step 1: Write the failing integration tests**

Add to `src/db/pageChainRepository.test.ts`:

```ts
test('durum değişikliği zinciri kaydırır', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3, 4, 5] });
  const second = view.tasks.find((task) => task.dayIndex === 2)!;

  await setTaskStatus(second.id, 'missed');

  const tasks = await db.scheduleTasks.where('weekId').equals(weekId).toArray();
  expect(tasks.find((task) => task.dayIndex === 3)).toMatchObject({ fromPage: 110, toPage: 119 });
  expect(tasks.find((task) => task.dayIndex === 5)).toMatchObject({ fromPage: 130, toPage: 139 });
});

test('sonraki boş güne ekle zincire yeni slot ekler', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3, 4, 5] });
  const second = view.tasks.find((task) => task.dayIndex === 2)!;
  await setTaskStatus(second.id, 'missed');

  await addUnscheduledChunk(view.chain.id);

  const chains = await listWeekPageChains(weekId);
  expect(chains[0].slots).toHaveLength(6);
  expect(chains[0].tasks.find((task) => task.dayIndex === 6)).toMatchObject({
    fromPage: 140,
    toPage: 150,
  });
  expect(chains[0].unscheduled).toEqual([]);
});

test('eksik görev zinciri çözmez, tombstone çözer', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3] });
  const first = view.tasks[0];
  await db.scheduleTasks.delete(first.id);

  await reconcileWeekPageChains(weekId);
  expect((await db.schedulePageChains.get(view.chain.id))?.deletedAt).toBeUndefined();

  const restored = { ...first, id: first.id };
  await db.scheduleTasks.put(restored);
  await db.scheduleTasks.update(first.id, { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await reconcileWeekPageChains(weekId);
  expect((await db.schedulePageChains.get(view.chain.id))?.deletedAt).toBeTruthy();
});

test('kimlik uyuşmazlığı zinciri çözer', async () => {
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3] });
  const first = view.tasks[0];
  await db.scheduleTasks.update(first.id, { dayIndex: 4, updatedAt: new Date().toISOString() });

  await reconcileWeekPageChains(weekId);
  expect((await db.schedulePageChains.get(view.chain.id))?.deletedAt).toBeTruthy();
});

test('geçmiş gün otomatik yapılmadı sayılır ve kaydırır', async () => {
  // Setup: weekStart 2026-11-16, chain days 1..5.
  const view = await createPageChain({ weekId, rowId, userBookId, startPage: 100, endPage: 150, days: [1, 2, 3, 4, 5] });
  const now = new Date(2026, 10, 17, 12); // Salı; Pazartesi geçmiş
  await reconcileWeekPageChains(weekId, now);

  const tasks = await db.scheduleTasks.where('weekId').equals(weekId).toArray();
  expect(tasks.find((task) => task.dayIndex === 1)).toMatchObject({ fromPage: 100, toPage: 109 });
  expect(tasks.find((task) => task.dayIndex === 1)?.missedAt).toBeUndefined();
  expect(tasks.find((task) => task.dayIndex === 2)).toMatchObject({ fromPage: 100, toPage: 109 });
  expect(tasks.find((task) => task.dayIndex === 5)).toMatchObject({ fromPage: 130, toPage: 139 });
  expect(view.chain).toBeTruthy();
});
```

Add to `src/db/scheduleRepository.test.ts` (or the existing schedule repository test file):

```ts
test('zincir görevini düzenlemek/silmek zinciri çözer', async () => {
  const { view, taskId, rowId } = await seedChain();
  await updateTask(taskId, { rowId, dayIndex: 1, type: 'free', title: 'Değişti' });
  expect((await db.schedulePageChains.get(view.chain.id))?.deletedAt).toBeTruthy();
});

test('geçen haftadan kopyalama zincir satırını kopyalamaz', async () => {
  const { sourceWeekStart, targetWeekStart } = await seedTwoWeeks();
  await seedChainInWeek(sourceWeekStart);
  await copyWeek(sourceWeekStart, targetWeekStart);
  const target = await getOrCreateWeek(targetWeekStart);
  expect(await listWeekPageChains(target.week.id)).toEqual([]);
  expect(target.tasks.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/db/pageChainRepository.test.ts src/db/scheduleRepository.test.ts`
Expected: FAIL on the new functions/expectations.

- [ ] **Step 3: Implement the integration**

- `setTaskStatus`: capture the initial task; after its transaction completes, if `initial` exists, `const chainId = await findChainForTask(initial.weekId, taskId); if (chainId) await recomputePageChain(chainId);`.
- `updateTask`/`deleteTask`: look up the chain id before the mutation; perform the task mutation; only after it succeeds, `await dissolvePageChain(chainId)`. If the mutation fails, the chain stays intact.
- `deleteRow`: delete the row/tasks, then `await dissolveChainsForRow(row.weekId, rowId)`.
- `reconcileWeekPageChains`: list active chains; parse/validate; for each:
  - invalid `slots`/`chunkCount`/`chunkSize` → dissolve;
  - a task absent → mark `incomplete` and skip (do not dissolve);
  - a task tombstoned or `weekId`/`rowId`/`userBookId`/`type`/`dayIndex` mismatch → dissolve;
  - otherwise recompute.
- `addUnscheduledChunk`: load view; take first `unscheduled`; find first empty day after the last slot in the same row; if none, throw `Bu haftada boş gün kalmadı.`; create the task + slot in one transaction, update chain `slots`; recompute.
- `dissolveChainsForTask` / `dissolveChainsForRow`: scan active chains for the week, parse slots, dissolve matching chains.

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- src/db/pageChainRepository.test.ts src/db/scheduleRepository.test.ts`
Expected: PASS. Then `npm run test:run -- src/db/scheduleRepository.test.ts src/features/schedule/schedule.test.tsx` to catch regressions.

- [ ] **Step 5: Commit**

```bash
git add src/db/pageChainRepository.ts src/db/scheduleRepository.ts src/db/pageChainRepository.test.ts src/db/scheduleRepository.test.ts
git commit -m "feat(schedule): shift chains on status and reconcile"
```

---

## Task 6: Sunucu Tablosu, Migration ve PHPUnit

**Files:**
- Modify: `api/src/Sync/TableMap.php`
- Create: `api/migrations/004_page_chain.sql`
- Modify: `api/tests/Unit/TableMapTest.php`
- Modify: `api/tests/Integration/MigrationTest.php`

**Interfaces:**
- Produces API key `schedulePageChains`, DB table `schedule_page_chains`, fields: `id, weekId, rowId, userBookId, startPage, endPage, chunkSize, chunkCount, slots, createdAt, updatedAt, deletedAt`.

- [ ] **Step 1: Update the failing server tests**

- `TableMapTest`: rename `test_the_thirteen_api_keys...` to fourteen and add `'schedulePageChains'` to the sorted expected list. Add a test:

```php
public function test_page_chain_fields_map_and_validate(): void
{
    $db = TableMap::toDb('schedulePageChains', [
        'id' => self::ID,
        'weekId' => self::OTHER_ID,
        'rowId' => self::OTHER_ID,
        'userBookId' => self::OTHER_ID,
        'startPage' => 100,
        'endPage' => 150,
        'chunkSize' => 10,
        'chunkCount' => 5,
        'slots' => '[{"taskId":"a","slotIndex":0,"chunkIndex":0,"dayIndex":1}]',
        'createdAt' => self::CREATED_AT,
        'updatedAt' => self::UPDATED_AT,
    ]);

    self::assertSame('schedule_page_chains', TableMap::definition('schedulePageChains')['table']);
    self::assertSame(5, $db['chunk_count']);
    self::assertSame(10, $db['chunk_size']);
}
```

Also add a rejection for `chunkCount: 8` and a valid 2–7 range.

- `MigrationTest`: add `'schedule_page_chains'` to `TABLES` (after `schedule_tasks`) and to `SYNC_TABLES`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `php api/vendor/bin/phpunit -c api/phpunit.xml --filter 'TableMapTest|MigrationTest'` (or push the branch and run CI `api`).
Expected: FAIL because the table/key does not exist.

- [ ] **Step 3: Implement**

- `TableMap.php`: add `RULE_CHUNK_COUNT = ['type' => 'int', 'min' => 2, 'max' => 7]` and the `schedulePageChains` definition:
  - columns exactly as above;
  - required all except `deletedAt`;
  - immutable `['id']`; natural `[]`;
  - rules: IDs for `id/weekId/rowId/userBookId`, `RULE_UNSIGNED` for pages, `RULE_SMALL_UNSIGNED` for `chunkSize`, `RULE_CHUNK_COUNT` for `chunkCount`, `['type'=>'string','maxBytes'=>65535]` for `slots`, timestamps for `createdAt/updatedAt/deletedAt`.
- `004_page_chain.sql`: create the table with the columns above, `PRIMARY KEY (user_id, id)`, `KEY idx_schedule_page_chains_user_week (user_id, week_id)`, `KEY idx_schedule_page_chains_user_server_updated (user_id, server_updated_at)`, InnoDB/utf8mb4.

- [ ] **Step 4: Run tests**

Run the same PHPUnit filter; expected PASS. CI `api` job must also pass.

- [ ] **Step 5: Commit**

```bash
git add api/src/Sync/TableMap.php api/migrations/004_page_chain.sql api/tests/Unit/TableMapTest.php api/tests/Integration/MigrationTest.php
git commit -m "feat(api): sync schedule page chains"
```

---

## Task 7: Mock API ve Contract Testi

**Files:**
- Modify: `scripts/mock-api.mjs`
- Modify: `scripts/mock-api.test.mjs`

**Interfaces:**
- Produces `schedulePageChains` in `SYNCED_TABLES`, table definition, status counts, full/export rows.

- [ ] **Step 1: Write the failing contract test**

Add a test to `scripts/mock-api.test.mjs`:

```ts
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

  const pulled = await call('/api/sync/pull?since=0&limit=500', { cookie: account.cookie });
  const change = pulled.json.changes.find((item: { table: string }) => item.table === 'schedulePageChains');
  expect(change.row).toMatchObject({ id: 'chain-1', chunkCount: 5, slots: row.slots });

  const full = await call('/api/sync/full', { cookie: account.cookie });
  expect(full.json.tables.schedulePageChains).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- scripts/mock-api.test.mjs`
Expected: FAIL because `schedulePageChains` is not a known table.

- [ ] **Step 3: Implement**

- Add `'schedulePageChains'` to `SYNCED_TABLES` after `scheduleTasks`.
- Add the `TABLES.schedulePageChains` definition with the same columns/required as the PHP map; `pk: 'id'`, `ownerKey: 'userId'`, `natural: []`, `immutable: ['id']`.
- Ensure the generic validation accepts the string `slots` and integer fields; add explicit range checks for `chunkCount` 2–7 and `chunkSize` 1–65535 if the mock has a rule table.
- Add the table to the user-data loop in `buildStatus` (a chain row is user data).
- `full`/export loops already use `SYNCED_TABLES`.

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- scripts/mock-api.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/mock-api.mjs scripts/mock-api.test.mjs
git commit -m "feat(mock): support schedule page chains"
```

---

## Task 8: Yedek Şeması v7

**Files:**
- Modify: `src/db/backup.ts`
- Modify: `src/db/backup.test.ts`

**Interfaces:**
- `BACKUP_SCHEMA_VERSION = 7`; `schedulePageChains` table in export/import/counts.

- [ ] **Step 1: Update the failing backup tests**

- Change exact `schemaVersion` expectations in `src/db/backup.test.ts` from `6` to `7`.
- Add a round-trip test that seeds a `schedulePageChains` row, exports, imports, and expects the row back with `slots` and `chunkCount` intact.
- Add a v6 archive test (existing helper) that omits the new table and expects an empty `schedulePageChains` list after import.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/db/backup.test.ts`
Expected: FAIL because the schema version/table is missing.

- [ ] **Step 3: Implement**

- Import `SchedulePageChain`; bump `BACKUP_SCHEMA_VERSION` to 7 and update the comment.
- Add `schedulePageChains: z.array(schedulePageChainSchema).default([])` where:
  - `id`, `weekId`, `rowId`, `userBookId` are `idSchema`;
  - `startPage`/`endPage`/`chunkSize`/`chunkCount` are positive ints; `chunkCount` 2–7;
  - `slots` is a string max 65535; `createdAt`/`updatedAt` strings; `deletedAt` optional.
- Add the table to `RestoredData`, `backupDataSchema`, `countTables`, `assertUniqueBackupKeys` (`id`), `exportDatabaseBackup` snapshot/destructure/data, and `importBackup` restored/transaction `bulkPut`.
- Old v6 archives default to `[]`; no migration code needed beyond the schema default.

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- src/db/backup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/backup.ts src/db/backup.test.ts
git commit -m "feat(backup): include page chains in v7 archives"
```

---

## Task 9: Zincir Paneli ve Rozet

**Files:**
- Create: `src/features/schedule/PageChainModal.tsx`
- Modify: `src/features/schedule/WeeklyPlanTable.tsx`
- Modify: `src/features/schedule/WeeklyPlan.tsx`
- Modify: `src/features/schedule/TaskChip.tsx`
- Modify: `src/features/schedule/ScheduleTaskModal.tsx`
- Test: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- `PageChainModalProps`:

```ts
export interface PageChainModalProps {
  weekId: string;
  weekStart: string;
  rows: WeeklyPlanRow[];
  tasks: ScheduleTask[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}
```

- `TaskChipProps` gains `chain?: boolean`.
- `ScheduleTaskModalProps` gains `chain?: boolean`.
- `WeeklyPlanTableProps` gains `onOpenPageChain: () => void` and `chainTaskIds: ReadonlySet<string>`.

- [ ] **Step 1: Write the failing UI tests**

Add to `src/features/schedule/schedule.test.tsx`:

```ts
test('sayfa zinciri paneli beş günü önizler ve oluşturur', async () => {
  await seedPlanRow();
  await seedBilgiSarmalBook();
  await openSchedule();

  await userEvent.click(screen.getByRole('button', { name: 'Sayfa zinciri' }));
  const dialog = await screen.findByRole('dialog', { name: 'Sayfa zinciri oluştur' });

  await userEvent.selectOptions(
    within(dialog).getByLabelText('Satır'),
    within(dialog).getByRole('option', { name: 'Matematik' }),
  );
  for (const day of ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']) {
    await userEvent.click(within(dialog).getByRole('checkbox', { name: day }));
  }
  // Use the same ShelfBookPicker interaction as the existing task-modal test:
  // type into “Kitap ara” and click the matching result button.
  await userEvent.type(within(dialog).getByLabelText('Kitap ara'), 'Bilgi Sarmal');
  await userEvent.click(within(dialog).getByRole('button', { name: /Bilgi Sarmal/ }));
  await userEvent.type(within(dialog).getByLabelText('Başlangıç sayfası'), '100');
  await userEvent.type(within(dialog).getByLabelText('Bitiş sayfası'), '150');

  expect(within(dialog).getByText('Pzt 100-109')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Zinciri oluştur' }));

  await waitFor(async () => expect(await db.scheduleTasks.count()).toBe(5));
  expect(await db.schedulePageChains.count()).toBe(1);
});
```

Add a test that a day with an existing task is disabled and that an invalid range keeps the create button disabled. Add a test that opening the edit modal for a chain task shows “Düzenlersen zincir çözülür.”

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/features/schedule/schedule.test.tsx`
Expected: FAIL because the button/panel does not exist.

- [ ] **Step 3: Implement**

- `PageChainModal.tsx`: use `useLiveQuery(() => listShelfBooks())` and the existing `ShelfBookPicker`; fields per spec; selected days `Set<number>`; preview via `splitPageRange` + `dayLabel`/`short`; disable occupied days by checking `tasks` for `rowId`/`dayIndex`; validate with `validateTaskPages` and `splitPageRange`; on submit `createPageChain`; show errors in `role="alert"`.
- `WeeklyPlanTable.tsx`: add the “Sayfa zinciri” button with `Link2`; pass `chain` to `TaskChip` when `chainTaskIds.has(task.id)`.
- `WeeklyPlan.tsx`: state `pageChainOpen`, `chainTaskIds`; render the modal; on created refresh tasks and chain IDs; pass `chain={task ? chainTaskIds.has(task.id) : false}` to `ScheduleTaskModal`; if the delete target task is in `chainTaskIds`, add “Bu görev bir sayfa zincirinin parçası; silmek zinciri çözer.” to the confirmation.
- `ScheduleTaskModal.tsx`: if `chain`, render a warning above the form: “Bu görev bir sayfa zincirinin parçası. Düzenlersen zincir çözülür.”
- `TaskChip.tsx`: optional `chain` renders a small `Link2` icon with `sr-only` “Sayfa zinciri”; do not alter the three text lines.

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- src/features/schedule/schedule.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/schedule/PageChainModal.tsx src/features/schedule/WeeklyPlanTable.tsx src/features/schedule/WeeklyPlan.tsx src/features/schedule/TaskChip.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat(schedule): add page chain panel and badge"
```

---

## Task 10: Planlanmamış Uyarısı, Reconcile ve Gün Değişimi

**Files:**
- Create: `src/features/schedule/PageChainBanner.tsx`
- Modify: `src/features/schedule/WeeklyPlan.tsx`
- Test: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- `PageChainBannerProps`:

```ts
export interface PageChainBannerProps {
  chains: PageChainView[];
  rows: WeeklyPlanRow[];
  onAddNext: (chainId: string) => Promise<void>;
}
```

- [ ] **Step 1: Write the failing banner/reconcile tests**

Add to `schedule.test.tsx`:

```ts
test('kaçırılan gün planlanmamış aralığı gösterir ve sonraki boş güne ekler', async () => {
  await seedChainWithFiveDays();
  await openSchedule();
  await userEvent.click(screen.getByRole('button', { name: 'Tik modu' }));
  await userEvent.contextMenu(screen.getByRole('button', { name: /110–119.*Planlandı/ }));

  expect(await screen.findByText('Planlanmamış sayfalar')).toBeInTheDocument();
  expect(screen.getByText('140–150')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Sonraki boş güne ekle' }));

  await waitFor(async () => {
    const tasks = await db.scheduleTasks.toArray();
    expect(tasks.find((task) => task.dayIndex === 6)).toMatchObject({ fromPage: 140, toPage: 150 });
  });
  await waitFor(() => expect(screen.queryByText('Planlanmamış sayfalar')).not.toBeInTheDocument());
});

test('plan açılışında zincirleri reconcile eder', async () => {
  const { weekId } = await seedChainWithFiveDays();
  const second = (await db.scheduleTasks.where('weekId').equals(weekId).toArray()).find((task) => task.dayIndex === 2)!;
  await db.scheduleTasks.update(second.id, { missedAt: new Date().toISOString() });
  await openSchedule();

  await waitFor(async () => {
    const tasks = await db.scheduleTasks.where('weekId').equals(weekId).toArray();
    expect(tasks.find((task) => task.dayIndex === 3)).toMatchObject({ fromPage: 110, toPage: 119 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/features/schedule/schedule.test.tsx`
Expected: FAIL because the banner/reconcile does not exist.

- [ ] **Step 3: Implement**

- `PageChainBanner.tsx`: render one row per chain with `unscheduled` ranges and `!incomplete`; button calls `onAddNext(chain.id)`; disable when `nextEmptyDay === null`; show “Bu haftada boş gün kalmadı.”; `aria-live="polite"`.
- `WeeklyPlan.tsx`:
  - After `getOrCreateWeek`, call `reconcileWeekPageChains(data.week.id)`, then reload `getOrCreateWeek` and `listWeekPageChains`; store `chains`/`chainTaskIds`.
  - `refreshTasks` also reloads chains.
  - Pass `chains` to `PageChainBanner`; `onAddNext` calls `addUnscheduledChunk`, then refresh.
  - Add a `visibilitychange` effect: if `document.visibilityState === 'visible'` and the local day key changed since the last reconcile, call `reconcileWeekPageChains` + refresh. Keep the last day key in a ref.
- Use `listWeekPageChains` for `chainTaskIds` (all slots whose tasks exist).

- [ ] **Step 4: Run tests**

Run: `npm run test:run -- src/features/schedule/schedule.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/schedule/PageChainBanner.tsx src/features/schedule/WeeklyPlan.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat(schedule): show unplanned chain ranges"
```

---

## Task 11: Uçtan Uca Test

**Files:**
- Create: `tests/e2e/page-chain.spec.ts`

**Interfaces:**
- Uses `completeOnboarding` from `./helpers`; adds the catalog book via the existing book picker; opens `./#/program`.

- [ ] **Step 1: Write the failing E2E test**

Create `tests/e2e/page-chain.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { completeOnboarding, TEST_NAME } from './helpers';

test('haftalık planda sayfa zinciri oluşturur, kaçırır ve sonraki güne ekler', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');

  await page.goto('./#/kitaplar');
  await page.getByRole('button', { name: 'Kitap ekle' }).first().click();
  await page.getByLabel('Kitap, yayınevi veya ders ara').fill('Hiç Problem Değil');
  await page.getByRole('button', { name: /Hiç Problem Değil.*rafıma ekle/ }).click();

  await page.goto('./#/program');
  // Use next week so the Mon–Fri chain is entirely in the future; otherwise a
  // run on a later weekday would auto-miss some days before the explicit test.
  await page.getByRole('button', { name: 'Sonraki hafta' }).click();
  await page.getByRole('button', { name: 'Satır ekle' }).click();
  await page.getByLabel('1. satır', { exact: true }).fill('Matematik');
  await expect(page.getByText('Kaydedildi', { exact: true })).toBeVisible({ timeout: 5_000 });

  await page.getByRole('button', { name: 'Sayfa zinciri' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sayfa zinciri oluştur' });
  for (const day of ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma']) {
    await dialog.getByRole('checkbox', { name: day }).check();
  }
  await dialog.getByLabel('Kitap ara').fill('Hiç Problem Değil');
  await dialog.getByRole('button', { name: /Hiç Problem Değil/ }).click();
  await dialog.getByLabel('Başlangıç sayfası').fill('100');
  await dialog.getByLabel('Bitiş sayfası').fill('150');
  await expect(dialog.getByText('Pzt 100-109')).toBeVisible();
  await dialog.getByRole('button', { name: 'Zinciri oluştur' }).click();

  await page.getByRole('button', { name: 'Tik modu' }).click();
  await page.getByRole('button', { name: /110–119.*Planlandı/ }).click({ button: 'right' });
  await expect(page.getByText('Planlanmamış sayfalar')).toBeVisible();
  await expect(page.getByText('140–150')).toBeVisible();
  await page.getByRole('button', { name: 'Sonraki boş güne ekle' }).click();
  await expect(page.getByText('Planlanmamış sayfalar')).not.toBeVisible();

  await page.reload();
  await page
    .getByRole('group', { name: 'Çizelge günü' })
    .getByRole('button', { name: 'Cmt Cumartesi' })
    .click();
  await expect(page.getByText(/Syf\. 140–150/)).toBeVisible();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:e2e -- tests/e2e/page-chain.spec.ts`
Expected: FAIL because the UI/flow is missing.

- [ ] **Step 3: Adjust selectors and fix any flow gaps**

Use the actual accessible names from `PageChainModal` and `TaskChip`. Do not change the spec’s behavior; only align selectors. If the mobile day view hides Saturday, switch the day tab to `Cmt` before asserting.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:e2e -- tests/e2e/page-chain.spec.ts`
Expected: PASS. Then run `npm run test:e2e:auth` and `npm run test:e2e:legacy` to ensure existing flows still pass.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/page-chain.spec.ts
git commit -m "test(e2e): cover page chain flow"
```

---

## Task 12: Tam Doğrulama, Önizleme ve Yayın Kapısı

**Files:**
- Modify: `PROGRESS.md`
- Build: `dist/` (only after approval)

- [ ] **Step 1: Run the full verification**

```bash
npm run typecheck
npm run test:run
npm run build
npm run test:e2e
npm audit --audit-level=high
```

Expected: all pass; `npm audit` has no high/critical. PHPUnit `api` CI job must pass.

- [ ] **Step 2: Check for accidental schema drift**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended files.

- [ ] **Step 3: Local preview**

```bash
npm run mock:api
npm run dev
```

Open the app, create a chain, miss a day, add the unplanned range, reload. Capture the behavior for the user. Do not merge/deploy yet.

- [ ] **Step 4: Ask the user for approval**

Report the test results and the preview behavior. Only after explicit approval:

```bash
npm run build
git add dist
git commit -m "build: refresh dist for page chains"
```

Merge `feat/page-chain` into `main`, push, then cPanel → **Update from Remote** → **Deploy HEAD Commit**. Run the migration:

```bash
/usr/local/bin/php /home/u2964068/public_html/api/bin/migrate.php
```

Verify `https://zirveacademy.com/api/health` returns 200 and run a test-account chain smoke test. Then update `PROGRESS.md` with the session log and deploy notes.

---

## Self-Review

- Spec coverage: page math (Task 1), auto-missed status (Task 2), new table/store (Task 3), create/recompute (Task 4), status/reconcile/append/dissolve (Task 5), server sync (Task 6), mock (Task 7), backup (Task 8), panel/badge (Task 9), banner/day-change (Task 10), E2E (Task 11), deploy gate (Task 12).
- Review Focus tests: Task 2/5 for auto-missed; Task 5 for missing vs tombstone; Task 1 for chunkCount/duplicate chunkIndex; Task 6/7 for old-client sync; Task 6/8 for round-trip.
- Type consistency: `PageChainSlot`, `PageChainChunk`, `PageChainView`, `CreatePageChainInput`, `SchedulePageChain` names are used consistently across tasks.
- No new dependencies; no `schedule_tasks` schema changes; `dist/` only in Task 12.
