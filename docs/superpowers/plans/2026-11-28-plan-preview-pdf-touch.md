# Plan Önizleme, Test PDF ve Dokunmatik Düzenleme Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sayfa zinciri önizlemesine düzenlenebilir dengeli dağılım, rastgele testlere iki soru/sayfa PDF indirme ve haftalık plana dokunmatik düzenleme/silme eklemek; mevcut canlı zincirleri ve çizelge verisini değiştirmeden.

**Architecture:** Üç bağımsız parça. (A) `schedulePageChains`’e nullable `chunkSizes` JSON’u eklenir; yeni zincirler dengeli/özel boyutları saklar, eski satırlar `splitPageRange` legacy formülünde kalır. (B) Fotoğraflar cihazda olduğu için PDF `jspdf` + gömülü Roboto TTF ile istemcide üretilir. (C) Görev çipine dokunma düzenleme modalını açar; silme modal içine taşınır; DB şeması değişmez.

**Tech Stack:** React 19, TypeScript, Dexie 4, Tailwind CSS 4, Vitest + React Testing Library, Playwright, `jspdf`, PHP 8.4 + PHPUnit (CI), MariaDB 10.6.

**Spec:** `docs/superpowers/specs/2026-11-28-plan-preview-pdf-touch-design.md`

## Global Constraints

- Node.js `>=22.22.2`; React 19 + Vite 8 + Dexie + Tailwind 4.
- Yeni runtime bağımlılığı yalnızca `jspdf`; font asset (`Roboto-Regular.ttf`) ve lisans dosyası repoya eklenir.
- Tüm arayüz metinleri Türkçe; mevcut `Button`, `Modal`, `Field`, `cn`, `lucide-react` desenleri.
- `schedule_tasks` / `schedule_rows` şeması değişmez; Dexie sürümü artmaz.
- `SchedulePageChain.chunkSizes` nullable/opsiyonel; `null`/`undefined`/`'[]'` = legacy formül. Eski zincirler backfill edilmez.
- `chunk_sizes` kolonu `TEXT NULL`; TableMap’de opsiyonel; `preserveWhenNull` ile eski istemci push’u mevcut değeri silmez.
- PDF: A4 yatay, iki soru bir sayfada (sol/sağ), kapak yok, sonunda cevap anahtarı; Roboto gömülü; fotoğraflar sunucuya gitmez.
- Dokunmatik: görev çipine dokun → düzenleme modalı; modalda “Görevi sil”; tick modu ve masaüstü hover’ı korunur; veri göçü yok.
- PHPUnit yerelde yok; `api` CI işi (PHP 8.4 + MariaDB 10.6) merge/deploy kapısı.
- Çalışma dalı `feat/preview-pdf-touch`; kullanıcı onayı olmadan `main`’e merge/push ve canlı deploy yok.
- `dist/` yalnızca yayın görevinde build edilir; bu planın task’larında commit edilmez.
- Tüm alt ajanlar `opencode-go/deepseek-v4.1-flash#max` modelini kullanır.

## Review Focus

1. **Eski zincir dokunulmazlığı:** `chunkSizes` alanı olmayan satır tam olarak `floor + son gün` aralıklarını korur; recompute onu değiştirmez. Test: Task A3 + A7.
2. **Geçersiz özel dağılım:** Günlük adetler toplamı tutmaz veya son gün 0’a düşerse oluşturma engellenir; yarım zincir/görev yazılmaz. Test: Task A4.
3. **Eski istemci push’u:** `chunkSizes` göndermeyen istemci yeni zincirin dağılımını silmez; sunucu mevcut JSON’u korur. Test: Task A6.
4. **PDF uç durumları:** Silinmiş fotoğraf, tek kalan soru ve doğru şıkkı olmayan soru numaralandırmayı/cevap anahtarını bozmaz; indirme `.pdf` üretir. Test: Task B1 + B2 + B4.
5. **Dokunma çakışması:** Çip tıklaması modalı bir kez açar; hover ikonları ikinci kez açmaz; tick modu hâlâ durum değiştirir; mevcut görev verisi korunur. Test: Task C1 + C2 + C4.

## File Structure

```text
src/domain/types.ts                                  SchedulePageChain.chunkSizes
src/domain/pageChain.ts                              dengeli boyut, aralık, parse
src/domain/pageChain.test.ts                         domain testleri
src/db/pageChainRepository.ts                        create/list/recompute + legacy
src/db/pageChainRepository.test.ts                   repository testleri
src/db/sync/constants.ts                             schedulePageChains alanı
src/db/sync/push.test.ts                             eski satır payload testi
src/db/backup.ts                                     yedek şeması
src/db/backup.test.ts                                round-trip/default
src/features/schedule/PageChainModal.tsx             düzenlenebilir önizleme
src/features/schedule/schedule.test.tsx              modal + touch testleri
scripts/mock-api.mjs / scripts/mock-api.test.mjs     mock parity
api/src/Sync/TableMap.php                            chunkSizes + preserveWhenNull
api/src/Sync/SyncService.php                         NULL'da mevcut değeri koruma
api/migrations/006_page_chain_chunk_sizes.sql        nullable kolon
api/tests/Unit/TableMapTest.php                      alan/opsiyonel testi
api/tests/Integration/MigrationTest.php              006 kolon testi
api/tests/Integration/SyncPushTest.php               koruma testi
tests/e2e/page-chain.spec.ts                         yeni dağılım + özel adet

package.json                                         jspdf
vite.config.ts                                       PWA ttf glob
src/assets/fonts/Roboto-Regular.ttf                  gömülü font (binary)
src/assets/fonts/Roboto-LICENSE.txt                  Apache-2.0 lisansı
src/features/practice/practicePdf.ts                 layout + builder + download
src/features/practice/practicePdfFont.ts             TTF -> jsPDF VFS
src/features/practice/practicePdf.test.ts            layout/builder testleri
src/features/practice/PracticePdfButton.tsx          indirme düğmesi
src/features/practice/PracticeSessionPage.tsx        aktif/tamamlanmış entegrasyon
src/features/practice/practice.test.tsx              düğme/oturum testleri
tests/e2e/photos.spec.ts                             PDF download E2E

src/features/schedule/TaskChip.tsx                   dokun-düzenle
src/features/schedule/ScheduleTaskModal.tsx          modal silme
src/features/schedule/WeeklyPlan.tsx                 onDelete bağlantısı
src/features/schedule/WeeklyPlanTable.tsx            dokunmatik satır çöpü
tests/e2e/touch-edit.spec.ts                         touch + desktop E2E
```

---

## Part A — Sayfa zinciri özel dağılımı

### Task 1 (A1): Dengeli boyut, aralık ve parse yardımcıları

**Files:**
- Modify: `src/domain/pageChain.ts`
- Test: `src/domain/pageChain.test.ts`

**Interfaces:**
- Consumes: mevcut `PageChainChunk`, `pageChunkSize`, `splitPageRange`.
- Produces:
  - `balancedChunkSizes(startPage: number, endPage: number, chunkCount: number): number[]`
  - `chunksFromSizes(startPage: number, sizes: readonly number[]): PageChainChunk[]`
  - `parseChunkSizes(value: unknown, chunkCount: number, totalPages: number): number[] | null`

- [ ] **Step 1: Write failing tests**

```ts
import { balancedChunkSizes, chunksFromSizes, parseChunkSizes } from './pageChain';

test('dengeli dağılım kalanı ilk günlere birer birer verir', () => {
  expect(balancedChunkSizes(1, 20, 7)).toEqual([3, 3, 3, 3, 3, 3, 2]);
  expect(balancedChunkSizes(100, 150, 5)).toEqual([11, 10, 10, 10, 10]);
  expect(balancedChunkSizes(1, 8, 7)).toEqual([2, 1, 1, 1, 1, 1, 1]);
});

test('chunksFromSizes bitişik ve bitiş dahil aralıklar üretir', () => {
  expect(chunksFromSizes(100, [11, 10, 10, 10, 10])).toEqual([
    { chunkIndex: 0, fromPage: 100, toPage: 110 },
    { chunkIndex: 1, fromPage: 111, toPage: 120 },
    { chunkIndex: 2, fromPage: 121, toPage: 130 },
    { chunkIndex: 3, fromPage: 131, toPage: 140 },
    { chunkIndex: 4, fromPage: 141, toPage: 150 },
  ]);
});

test('parseChunkSizes boş ve bozuk değerleri legacy sayar', () => {
  expect(parseChunkSizes(JSON.stringify([3, 3, 3, 3, 3, 3, 2]), 7, 20)).toEqual([
    3, 3, 3, 3, 3, 3, 2,
  ]);
  for (const value of [
    null,
    undefined,
    '',
    '[]',
    'bozuk',
    '[1,2]',
    '[0,1,2,3,4,5,14]',
    '["3",3,3,3,3,3,2]',
  ]) {
    expect(parseChunkSizes(value, 7, 20)).toBeNull();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/pageChain.test.ts`
Expected: FAIL — `balancedChunkSizes`/`chunksFromSizes`/`parseChunkSizes` are not exported.

- [ ] **Step 3: Implement helpers**

- `balancedChunkSizes`: validate with the same messages/rules as `splitPageRange` (integers, `chunkCount` 2..7, `startPage >= 1`, `endPage > startPage`, `total >= chunkCount`); `base = Math.floor(total / chunkCount)`, `remainder = total % chunkCount`; `sizes[i] = base + (i < remainder ? 1 : 0)`.
- `chunksFromSizes`: validate every size is a positive integer; accumulate from `startPage`; return `PageChainChunk[]` with `chunkIndex` 0-based.
- `parseChunkSizes`: return `null` for non-string, trimmed empty, `'[]'`, malformed JSON, non-array, wrong length, non-integers `< 1`, or sum mismatch. Return the numeric array only when all checks pass.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/pageChain.test.ts`
Expected: PASS (existing legacy `splitPageRange` tests also pass).

- [ ] **Step 5: Commit**

```bash
git add src/domain/pageChain.ts src/domain/pageChain.test.ts
git commit -m "feat: add balanced page-chain chunk helpers"
```

---

### Task 2 (A2): `assignChainChunks` özel boyutları kullanır

**Files:**
- Modify: `src/domain/pageChain.ts`
- Test: `src/domain/pageChain.test.ts`

**Interfaces:**
- Consumes: Task A1 helpers.
- Produces: `AssignChainChunksInput.chunkSizes?: readonly number[]`; when present, chunk ranges come from `chunksFromSizes`, otherwise legacy `splitPageRange`.

- [ ] **Step 1: Write failing tests**

```ts
test('özel boyutlar atamaya ve planlanmamışa yansır', () => {
  const slots = Array.from({ length: 7 }, (_, index) => ({
    taskId: `t${index}`,
    slotIndex: index,
    chunkIndex: index,
    dayIndex: index + 1,
  }));
  const statuses = new Map(slots.map((slot) => [slot.taskId, 'pending' as const]));
  const result = assignChainChunks({
    slots,
    statuses,
    startPage: 1,
    endPage: 20,
    chunkSize: 2,
    chunkCount: 7,
    chunkSizes: [3, 3, 3, 3, 3, 3, 2],
  });

  expect(result.chunks).toEqual(chunksFromSizes(1, [3, 3, 3, 3, 3, 3, 2]));
  expect(result.assignments.get('t0')).toMatchObject({ fromPage: 1, toPage: 3 });
  expect(result.assignments.get('t6')).toMatchObject({ fromPage: 19, toPage: 20 });
});

test('chunkSizes yoksa legacy splitPageRange kullanılır', () => {
  const slots = Array.from({ length: 7 }, (_, index) => ({
    taskId: `t${index}`,
    slotIndex: index,
    chunkIndex: index,
    dayIndex: index + 1,
  }));
  const statuses = new Map(slots.map((slot) => [slot.taskId, 'pending' as const]));
  const result = assignChainChunks({
    slots,
    statuses,
    startPage: 1,
    endPage: 20,
    chunkSize: 2,
    chunkCount: 7,
  });

  expect(result.chunks[6]).toMatchObject({ fromPage: 13, toPage: 20 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/pageChain.test.ts`
Expected: FAIL — `chunkSizes` is not part of the input type/behavior.

- [ ] **Step 3: Implement**

- Add `chunkSizes?: readonly number[]` to `AssignChainChunksInput`.
- In `assignChainChunks`, choose:
  - `chunkSizes` present → validate length === `chunkCount`, every size positive integer, sum === `endPage - startPage + 1`; `chunks = chunksFromSizes(startPage, chunkSizes)`.
  - absent → `chunks = splitPageRange(...)`.
- Keep the existing `chunkSize === pageChunkSize(...)` validation and all assignment/unscheduled logic unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/domain/pageChain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/pageChain.ts src/domain/pageChain.test.ts
git commit -m "feat: support custom page-chain chunk sizes"
```

---

### Task 3 (A3): Repository `chunkSizes` + legacy koruması

**Files:**
- Modify: `src/domain/types.ts` (`SchedulePageChain`)
- Modify: `src/db/pageChainRepository.ts`
- Test: `src/db/pageChainRepository.test.ts`

**Interfaces:**
- Consumes: Task A1/A2.
- Produces:
  - `SchedulePageChain.chunkSizes?: string | null`
  - `CreatePageChainInput.chunkSizes?: readonly number[]`
  - `createPageChain` stores `JSON.stringify(sizes)`; omitted sizes default to `balancedChunkSizes`.
  - `chunksFor` uses parsed sizes when valid, else legacy.
  - `isValidChainSettings`: `chunkSizes` null/undefined/empty/`'[]'` → legacy valid; non-empty invalid → false.
  - `recomputePageChain` passes parsed sizes to `assignChainChunks`.

- [ ] **Step 1: Write failing repository tests**

```ts
test('yeni zincir varsayılan dengeli boyutlarla oluşur', async () => {
  const view = await createPageChain({
    weekId, rowId, userBookId,
    startPage: 1, endPage: 20,
    days: [1, 2, 3, 4, 5, 6, 7],
  });
  expect(view.chain.chunkSizes).toBe('[3,3,3,3,3,3,2]');
  expect(view.tasks.map((task) => [task.fromPage, task.toPage])).toEqual([
    [1, 3], [4, 6], [7, 9], [10, 12], [13, 15], [16, 18], [19, 20],
  ]);
});

test('özel boyutlar görev aralıklarına ve görünüme yansır', async () => {
  const view = await createPageChain({
    weekId, rowId, userBookId,
    startPage: 1, endPage: 20,
    days: [1, 2, 3, 4],
    chunkSizes: [2, 3, 5, 10],
  });
  expect(view.tasks.map((task) => [task.fromPage, task.toPage])).toEqual([
    [1, 2], [3, 5], [6, 10], [11, 20],
  ]);
});

test('chunkSizes alanı olmayan eski zincir legacy aralıkları korur', async () => {
  await seedLegacyChain({ startPage: 100, endPage: 150, chunkCount: 5 });
  const [view] = await listWeekPageChains(weekId);
  expect(view.chunks[0]).toMatchObject({ fromPage: 100, toPage: 109 });
  expect(view.chunks[4]).toMatchObject({ fromPage: 140, toPage: 150 });
  await recomputePageChain(view.chain.id, fixedNow);
  const [after] = await listWeekPageChains(weekId);
  expect(after.chunks[0]).toMatchObject({ fromPage: 100, toPage: 109 });
});

test('geçersiz özel boyutlar oluşturmayı reddeder ve satır yazmaz', async () => {
  await expect(createPageChain({
    weekId, rowId, userBookId,
    startPage: 1, endPage: 20,
    days: [1, 2, 3, 4, 5, 6, 7],
    chunkSizes: [1, 1],
  })).rejects.toThrow();
  expect(await db.schedulePageChains.where('weekId').equals(weekId).count()).toBe(0);
  expect(await db.scheduleTasks.where('weekId').equals(weekId).count()).toBe(0);
});
```

`seedLegacyChain` is a local test helper that writes a `SchedulePageChain` row **without** `chunkSizes`, its tasks, and slots. Use `chunkSize: 10`, `chunkCount: 5`, `skippedChunks: '[]'`, `slots` with five task ids. Use a fixed `now` before the week so recompute statuses are stable.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/pageChainRepository.test.ts`
Expected: FAIL — `chunkSizes` missing/default is legacy; new creation not balanced.

- [ ] **Step 3: Implement repository changes**

- Add `chunkSizes?: string | null` to `SchedulePageChain` (after `skippedChunks`).
- Add `chunkSizes?: readonly number[]` to `CreatePageChainInput`.
- In `createPageChain`:
  - `const sizes = input.chunkSizes ?? balancedChunkSizes(start, end, days.length);`
  - Validate with the same rules as `chunksFromSizes`; throw `'Parça boyutları sayfa aralığıyla uyuşmuyor.'` on length/sum mismatch.
  - `const chunks = chunksFromSizes(start, sizes);`
  - Keep `chunkSize = pageChunkSize(...)`.
  - Store `chunkSizes: JSON.stringify(sizes)`.
- `chunksFor`:
  - `const total = endPage - startPage + 1;`
  - `const sizes = parseChunkSizes(chain.chunkSizes, chain.chunkCount, total);`
  - `return sizes ? chunksFromSizes(chain.startPage, sizes) : splitPageRange(...)`.
- `isValidChainSettings`: after existing checks, if `chunkSizes` is non-empty and not `'[]'`, return `parseChunkSizes(...) !== null`; otherwise true.
- `recomputePageChain`: pass `chunkSizes: parseChunkSizes(...) ?? undefined`.
- Update existing test expectations for ranges created with `createPageChain`: `100–150 / 5` now starts `100–110`; the legacy tests that seeded rows without `chunkSizes` keep `100–109`.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/domain/pageChain.test.ts src/db/pageChainRepository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/db/pageChainRepository.ts src/db/pageChainRepository.test.ts
git commit -m "feat: persist custom page-chain layouts"
```

---

### Task 4 (A4): Önizlemede düzenlenebilir günlük adetler

**Files:**
- Modify: `src/features/schedule/PageChainModal.tsx`
- Test: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- Consumes: Task A1 (`balancedChunkSizes`, `chunksFromSizes`), Task A3 (`CreatePageChainInput.chunkSizes`).
- Produces: preview starts with balanced sizes; non-last day inputs editable; last day auto; `createPageChain` receives `chunkSizes`.

- [ ] **Step 1: Write failing UI tests**

Use the existing page-chain modal test setup (saved row, shelf book, selected days). Add:

```ts
test('önizleme dengeli dağılımla başlar', async () => {
  // 1–20, 7 gün, all days selected
  expect(within(dialog).getByText('Pzt 1–3')).toBeInTheDocument();
  expect(within(dialog).getByText('Paz 19–20')).toBeInTheDocument();
  expect(within(dialog).getByLabelText('Pazartesi sayfa sayısı')).toHaveValue(3);
  expect(within(dialog).getByText('Pazar sayfa sayısı: 2')).toBeInTheDocument();
});

test('günlük adet değişince aralıklar ve son gün güncellenir', async () => {
  await userEvent.clear(within(dialog).getByLabelText('Pazartesi sayfa sayısı'));
  await userEvent.type(within(dialog).getByLabelText('Pazartesi sayfa sayısı'), '4');
  expect(within(dialog).getByText('Pzt 1–4')).toBeInTheDocument();
  expect(within(dialog).getByText('Sal 5–7')).toBeInTheDocument();
  expect(within(dialog).getByText('Paz 20–20')).toBeInTheDocument();
});

test('geçersiz dağılım oluşturmayı kapatır', async () => {
  await userEvent.clear(within(dialog).getByLabelText('Pazartesi sayfa sayısı'));
  await userEvent.type(within(dialog).getByLabelText('Pazartesi sayfa sayısı'), '99');
  expect(within(dialog).getByRole('alert')).toHaveTextContent(/toplam sayfayı aşamaz/);
  expect(within(dialog).getByRole('button', { name: 'Zinciri oluştur' })).toBeDisabled();
});

test('dengeli dağıt elle düzenlemeyi sıfırlar', async () => {
  // edit Monday to 4, then click Dengeli dağıt
  await userEvent.click(within(dialog).getByRole('button', { name: 'Dengeli dağıt' }));
  expect(within(dialog).getByText('Pzt 1–3')).toBeInTheDocument();
});

test('bitiş sayfası değişince elle dağılım otomatiğe döner', async () => {
  // edit Monday to 4, then change end from 20 to 21
  await userEvent.clear(within(dialog).getByLabelText('Bitiş sayfası'));
  await userEvent.type(within(dialog).getByLabelText('Bitiş sayfası'), '21');
  expect(within(dialog).getByText('Pzt 1–3')).toBeInTheDocument();
  expect(within(dialog).getByText('Paz 19–21')).toBeInTheDocument();
});
```

Also assert the created chain: after submit, query `db.schedulePageChains` or inspect the first/last task ranges.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/schedule/schedule.test.tsx -t "önizleme dengeli"`
Expected: FAIL — preview still uses `splitPageRange`.

- [ ] **Step 3: Implement modal distribution editor**

- Import `balancedChunkSizes`, `chunksFromSizes`, `parseChunkSizes` as needed; remove `splitPageRange` from the modal.
- Derive `distributionKey = `${fromPage}:${toPage}:${days.join(',')}``.
- Keep a draft `{ key: string; values: string[] } | null`; if `draft?.key !== distributionKey`, display `balancedChunkSizes(from, to, days.length).map(String)`.
- Show inputs for indices `0..days.length-2`; label `${day.label} sayfa sayısı`; `min=1`, `inputMode="numeric"`.
- Last day display: computed `last = total - sum(parsed non-last)`; render `Pazar sayfa sayısı: ${last}` as text (not an input).
- Compute `chunks` from the full parsed sizes via `chunksFromSizes`; if any input is empty/non-integer/<1 or last < 1, set `distributionError = 'Günlük sayfa adetleri toplam sayfayı aşamaz.'` (or a more precise message) and disable create.
- Add a “Dengeli dağıt” button that sets the draft to null (auto).
- When start/end/days change, the `distributionKey` changes and the draft is ignored; no effect needed.
- Pass `chunkSizes: parsedSizes` to `createPageChain`.
- Keep the existing total and `aria-live` behavior; add the last-day text.

- [ ] **Step 4: Run focused UI tests**

Run: `npx vitest run src/features/schedule/schedule.test.tsx`
Expected: PASS; update old `Pzt 100–109` expectations to `Pzt 100–110` where the modal creates a new 100–150/5 chain.

- [ ] **Step 5: Commit**

```bash
git add src/features/schedule/PageChainModal.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat: edit daily page counts in chain preview"
```

---

### Task 5 (A5): Sync, yedek ve mock parity

**Files:**
- Modify: `src/db/sync/constants.ts`
- Modify: `src/db/backup.ts`
- Test: `src/db/backup.test.ts`
- Modify: `scripts/mock-api.mjs`
- Test: `scripts/mock-api.test.mjs`
- Test: `src/db/sync/push.test.ts`

**Interfaces:**
- Consumes: `SchedulePageChain.chunkSizes?: string | null`.
- Produces: client push field, backup schema `z.string().max(65535).nullish().default(null)`, mock column nullable, legacy rows null.

- [ ] **Step 1: Write failing parity tests**

Backup:

```ts
test('chunkSizes yedekten kayıpsız döner', async () => {
  // seed a chain with chunkSizes '[3,3,3,3,3,3,2]'
  const restored = await importBackup(exported);
  expect(await db.schedulePageChains.get(chainId)).toMatchObject({
    chunkSizes: '[3,3,3,3,3,3,2]',
  });
});

test('chunkSizes alanı olmayan eski yedek null ile okunur', async () => {
  // remove chunkSizes from the fixture JSON
  await importBackup(legacyWithoutField);
  expect((await db.schedulePageChains.get(chainId))?.chunkSizes ?? null).toBeNull();
});
```

Mock API: push a chain with `chunkSizes`, then pull/full; assert it returns the string. Push a legacy row without it; assert stored `chunkSizes` is null and no validation error.

Push: a legacy chain row without `chunkSizes` builds a payload that omits the field (the server is optional); a new row includes it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/backup.test.ts src/db/sync/push.test.ts`
Run: `node --test scripts/mock-api.test.mjs`
Expected: FAIL — field unknown/not preserved.

- [ ] **Step 3: Implement**

- `src/db/sync/constants.ts`: append `'chunkSizes'` to `SYNC_TABLE_FIELDS.schedulePageChains`.
- `src/db/backup.ts`: add `chunkSizes: z.string().max(65535).nullish().default(null)` to `schedulePageChainSchema`; keep `BACKUP_SCHEMA_VERSION = 7`.
- `scripts/mock-api.mjs`: add `'chunkSizes'` to the `schedulePageChains` columns; **do not** add it to required; normalize legacy rows to `null`.
- No push default is added; the server accepts omission.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/db/backup.test.ts src/db/sync/push.test.ts`
Run: `node --test scripts/mock-api.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/sync/constants.ts src/db/backup.ts src/db/backup.test.ts src/db/sync/push.test.ts scripts/mock-api.mjs scripts/mock-api.test.mjs
git commit -m "feat: sync nullable page-chain chunk sizes"
```

---

### Task 6 (A6): Sunucu TableMap, migration ve eski istemci koruması

**Files:**
- Modify: `api/src/Sync/TableMap.php`
- Modify: `api/src/Sync/SyncService.php`
- Create: `api/migrations/006_page_chain_chunk_sizes.sql`
- Test: `api/tests/Unit/TableMapTest.php`
- Test: `api/tests/Integration/MigrationTest.php`
- Test: `api/tests/Integration/SyncPushTest.php`

**Interfaces:**
- Consumes: API field `chunkSizes`, DB column `chunk_sizes`.
- Produces: optional `chunkSizes`; `preserveWhenNull => ['chunkSizes']`; migration `TEXT NULL`; update keeps existing value when incoming is null.

- [ ] **Step 1: Write failing PHPUnit tests**

TableMap (copy the full required `schedulePageChains` row from the existing
page-chain mapping test around `TableMapTest.php:315-350`, then omit
`chunkSizes`):

```php
public function test_chunk_sizes_is_optional_and_null_by_default(): void
{
    $db = TableMap::toDb('schedulePageChains', [
        // full required row, no chunkSizes
    ]);
    self::assertArrayHasKey('chunk_sizes', $db);
    self::assertNull($db['chunk_sizes']);
    self::assertNotContains('chunkSizes', TableMap::definition('schedulePageChains')['required']);
}
```

SyncPush preservation (follow the existing push helper/test style):

```php
public function test_missing_chunk_sizes_does_not_clear_an_existing_layout(): void
{
    $row = [...]; // full chain row
    $row['chunkSizes'] = '[3,3,3,3,3,3,2]';
    $this->push($account, 'schedulePageChains', [$row]);

    $without = $row;
    unset($without['chunkSizes']);
    $this->push($account, 'schedulePageChains', [$without]);

    $stored = self::$db->fetchOne(
        'SELECT `chunk_sizes` FROM `schedule_page_chains` WHERE `id` = ?',
        [$row['id']],
    );
    self::assertSame('[3,3,3,3,3,3,2]', $stored['chunk_sizes']);
}
```

MigrationTest: assert `chunk_sizes` exists, `IS_NULLABLE = 'YES'`, `DATA_TYPE = 'text'`.

- [ ] **Step 2: Run tests (CI or local if PHP available)**

Local PHP is absent. Run the Vitest/typecheck suite and review the PHP diff; the `api` CI job is the gate.
Expected: CI PHPUnit fails before the implementation, passes after.

- [ ] **Step 3: Implement**

- `api/migrations/006_page_chain_chunk_sizes.sql`:
  ```sql
  ALTER TABLE `schedule_page_chains`
      ADD COLUMN IF NOT EXISTS `chunk_sizes` TEXT NULL;
  ```
- `TableMap`:
  - Add `'chunkSizes' => 'chunk_sizes'` to columns.
  - Add `'chunkSizes' => self::RULE_TEXT` to rules.
  - Add `'preserveWhenNull' => ['chunkSizes']` to the `schedulePageChains` definition.
- `SyncService::update`:
  - Map `preserveWhenNull` API fields to columns.
  - Skip a column in the SET list when its incoming value is `null` and it is in that list; otherwise unchanged.
  - Do not change `insert` (a brand-new legacy row still writes NULL).
- Do not add `chunkSizes` to `required`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck`
Run: `npx vitest run src/db/backup.test.ts src/db/sync/push.test.ts`
PHP: static review; note that CI runs `TableMapTest`, `MigrationTest`, `SyncPushTest`.

- [ ] **Step 5: Commit**

```bash
git add api/src/Sync/TableMap.php api/src/Sync/SyncService.php api/migrations/006_page_chain_chunk_sizes.sql api/tests/Unit/TableMapTest.php api/tests/Integration/MigrationTest.php api/tests/Integration/SyncPushTest.php
git commit -m "feat(api): preserve page-chain chunk sizes"
```

---

### Task 7 (A7): Sayfa zinciri E2E ve odaklı doğrulama

**Files:**
- Modify: `tests/e2e/page-chain.spec.ts`

**Interfaces:**
- Consumes: A1–A6.
- Produces: balanced expectations + custom distribution E2E.

- [ ] **Step 1: Update the existing E2E expectations**

For `100–150 / 5` (Mon–Fri):
- Preview: `Pzt 100–110`; after creation, Salı chip is `111–120`.
- After right-clicking Salı: the banner’s unscheduled range is `141–150`.
- “Sonraki boş güne ekle” puts `141–150` on Saturday; reload preserves it.
- Skip test: Monday `100–110`, Friday `131–140`, skip button names `141–150`.

Add a custom distribution scenario:
- Create a `1–20 / 7` chain; edit Monday’s count to `4`; expect `Pzt 1–4`, `Sal 5–7`, `Paz 20–20`.
- Submit; reload; assert the Monday chip says `Syf. 1–4` and Sunday says `Syf. 20–20`.

- [ ] **Step 2: Run the page-chain E2E**

Run: `npx playwright test tests/e2e/page-chain.spec.ts`
Expected: PASS (2 existing tests updated + 1 new custom test).

- [ ] **Step 3: Run focused unit/type checks**

Run: `npx vitest run src/domain/pageChain.test.ts src/db/pageChainRepository.test.ts src/features/schedule/schedule.test.tsx`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/page-chain.spec.ts
git commit -m "test: cover balanced and custom page-chain layouts"
```

---

## Part B — Test PDF

### Task 8 (B1): PDF layout motoru

**Files:**
- Create: `src/features/practice/practicePdf.ts`
- Test: `src/features/practice/practicePdf.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PdfDocLike {
    text(text: string, x: number, y: number, options?: Record<string, unknown>): void;
    addImage(dataUrl: string, format: string, x: number, y: number, width: number, height: number): void;
    addPage(): void;
    setPage(page: number): void;
    getNumberOfPages(): number;
  }
  export interface PracticePdfQuestion {
    number: number;
    imageDataUrl: string;
    width: number;
    height: number;
    answer?: CorrectOption;
  }
  export interface PracticePdfInput {
    title: string;
    dateLabel: string;
    questions: PracticePdfQuestion[];
  }
  export function layoutPracticePdf(doc: PdfDocLike, input: PracticePdfInput): void;
  ```

- [ ] **Step 1: Write failing layout tests**

Use a fake doc:

```ts
function fakeDoc() {
  const texts: Array<{ text: string; x: number; y: number }> = [];
  const images: Array<Record<string, unknown>> = [];
  let pages = 1;
  return {
    texts,
    images,
    get pages() { return pages; },
    text(text: string, x: number, y: number) { texts.push({ text, x, y }); },
    addImage(dataUrl: string, format: string, x: number, y: number, width: number, height: number) {
      images.push({ dataUrl, format, x, y, width, height });
    },
    addPage() { pages += 1; },
    setPage() {},
    getNumberOfPages() { return pages; },
  };
}

test('beş soru üç soru sayfası ve bir cevap anahtarı üretir', () => {
  const doc = fakeDoc();
  layoutPracticePdf(doc, {
    title: 'Rastgele Test',
    dateLabel: '28.11.2026',
    questions: Array.from({ length: 5 }, (_, index) => ({
      number: index + 1,
      imageDataUrl: `data:image/jpeg;base64,${index}`,
      width: 800,
      height: 1200,
      answer: index === 4 ? undefined : 'C',
    })),
  });
  expect(doc.pages).toBe(4);
  expect(doc.images).toHaveLength(5);
  // Odd question count: the fifth question sits in the left column.
  expect((doc.images[4] as { x: number }).x).toBeCloseTo(
    (doc.images[0] as { x: number }).x,
    1,
  );
  expect(doc.texts).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: 'Soru 1', x: 12 }),
    expect.objectContaining({ text: 'Soru 2', x: 152.5 }),
    expect.objectContaining({ text: '1 · C', x: 12 }),
    expect.objectContaining({ text: '5 · —' }),
    expect.objectContaining({ text: '1 / 4', x: 285 }),
  ]));
});

test('görsel iki sütuna en-boy oranı korunarak sığar', () => {
  const doc = fakeDoc();
  layoutPracticePdf(doc, {
    title: 'Test', dateLabel: '28.11.2026',
    questions: [
      { number: 1, imageDataUrl: 'a', width: 800, height: 1200, answer: 'A' },
      { number: 2, imageDataUrl: 'b', width: 800, height: 1200, answer: 'B' },
    ],
  });
  const [left, right] = doc.images;
  expect(left).toMatchObject({ format: 'JPEG', y: 30, height: 166 });
  expect((left as { width: number }).width).toBeCloseTo(110.67, 1);
  expect((left as { x: number }).x).toBeCloseTo(22.92, 1);
  expect((right as { x: number }).x).toBeCloseTo(163.42, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/practice/practicePdf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement layout**

Constants:
- `PAGE_W = 297`, `PAGE_H = 210`, `MARGIN = 12`
- `HEADER_Y = 16`, `CONTENT_TOP = 24`, `CONTENT_BOTTOM = 198`
- `COL_W = 132.5`, `GAP = 8`, `LABEL_H = 6`, `IMG_H = 166`
- `ANSWER_TOP = 36`, `ANSWER_COLS = 8`, `ANSWER_COL_W = 34.125`, `ANSWER_ROW_H = 10`

Behavior:
- Start on the existing first page.
- For each pair of questions: if not the first pair, `doc.addPage()`; write header (`title` at 12/16, date at 285/16 right? `doc.text` options can carry `align`; the fake ignores; assert x). Write `Soru N` at the column x and `CONTENT_TOP + 4`; fit the image into `COL_W × IMG_H` (scale = min ratio), center; `doc.addImage(imageDataUrl, 'JPEG', x, y, w, h)`.
- After all questions, `doc.addPage()` for the answer key; write `Cevap Anahtarı` at 12/28; write each `N · answer ?? '—'` in 8 columns, starting at `ANSWER_TOP`, 10mm rows; add another page if the grid overflows.
- After all content, `total = doc.getNumberOfPages()`; for each page `doc.setPage(i); doc.text(`${i} / ${total}`, 285, 204, { align: 'right' })`.
- The layout must not include user answers.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/practice/practicePdf.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/practice/practicePdf.ts src/features/practice/practicePdf.test.ts
git commit -m "feat: add practice PDF layout"
```

---

### Task 9 (B2): Font, jsPDF builder ve indirme

**Files:**
- Modify: `package.json` (`jspdf`)
- Create: `src/assets/fonts/Roboto-Regular.ttf` (binary)
- Create: `src/assets/fonts/Roboto-LICENSE.txt`
- Modify: `vite.config.ts` (`globPatterns` add `ttf`)
- Create: `src/features/practice/practicePdfFont.ts`
- Modify: `src/features/practice/practicePdf.ts`
- Test: `src/features/practice/practicePdf.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function loadPracticePdfQuestions(photoIds: readonly string[]): Promise<PracticePdfQuestion[]>;
  export interface PracticePdfBuildInput { title: string; dateLabel: string; questions: PracticePdfQuestion[]; }
  export async function buildPracticePdf(input: PracticePdfBuildInput): Promise<Blob>;
  export async function downloadPracticePdf(session: PracticeSession): Promise<void>;
  export async function loadRobotoFont(doc: PdfDocLike & { addFileToVFS: (name: string, data: string) => void; addFont: (name: string, id: string, style: string) => void; setFont: (name: string) => void }): Promise<void>;
  ```

- [ ] **Step 1: Add the font asset and dependency**

```powershell
npm install jspdf
New-Item -ItemType Directory -Force src/assets/fonts
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/googlefonts/roboto-2/main/src/hinted/Roboto-Regular.ttf" -OutFile "src/assets/fonts/Roboto-Regular.ttf"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/googlefonts/roboto-2/main/LICENSE" -OutFile "src/assets/fonts/Roboto-LICENSE.txt"
```

- `vite.config.ts`: `globPatterns: ['**/*.{js,css,html,svg,png,woff2,ttf}']`.
- `practicePdfFont.ts`: import `fontUrl from '@/assets/fonts/Roboto-Regular.ttf?url'`; fetch, convert ArrayBuffer to base64, `doc.addFileToVFS('Roboto-Regular.ttf', base64)`, `doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal')`, `doc.setFont('Roboto')`.

- [ ] **Step 2: Write failing builder/download tests**

```ts
test('fotoğrafları oturum sırasıyla yükler, silinmişleri atlar', async () => {
  // seed three photos; one missing from the session
  const questions = await loadPracticePdfQuestions([first, missing, second]);
  expect(questions.map((question) => question.number)).toEqual([1, 2]);
  expect(questions[0].imageDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  expect(questions[0].answer).toBe('A');
});

test('buildPracticePdf iki soruyu layout motoruna verir', async () => {
  // vi.mock('jspdf', () => ({ jsPDF: FakeDoc }))
  // vi.mock('./practicePdfFont', () => ({ loadRobotoFont: vi.fn() }))
  const blob = await buildPracticePdf({
    title: 'Rastgele Test',
    dateLabel: '28.11.2026',
    questions: [/* two questions */],
  });
  expect(blob).toBeInstanceOf(Blob);
  expect(fakeDoc.images).toHaveLength(2);
});

test('indirme dosya adı ve blob URL üretir', async () => {
  // mock buildPracticePdf, URL.createObjectURL/revokeObjectURL, anchor click
  await downloadPracticePdf(session);
  expect(anchor.download).toMatch(/^rastgele-test-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/);
});

test('görünür fotoğraf yoksa indirme hata verir', async () => {
  await expect(
    downloadPracticePdf({ ...session, photoIds: ['missing-photo'] }),
  ).rejects.toThrow('PDF oluşturulacak soru yok.');
});
```

- [ ] **Step 3: Implement builder/download**

- `loadPracticePdfQuestions`:
  - `db.photos.bulkGet(photoIds)`; keep original order; skip missing entries (hard-deleted photos are absent).
  - Convert each blob to a data URL with `FileReader`; use the stored `photo.width` / `photo.height` (no image decode needed).
  - Return `{ number, imageDataUrl, width, height, answer: photo.correctOption }` with sequential numbers.
- `buildPracticePdf`:
  - Dynamic `const { jsPDF } = await import('jspdf');`
  - `const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });`
  - `await loadRobotoFont(doc);`
  - `layoutPracticePdf(doc, input);`
  - `return doc.output('blob');`
- `downloadPracticePdf`:
  - `const questions = await loadPracticePdfQuestions(session.photoIds);`
  - If empty, throw `new Error('PDF oluşturulacak soru yok.')`.
  - `const blob = await buildPracticePdf({ title: 'Rastgele Test', dateLabel: formatPdfDate(session.createdAt), questions });`
  - `const url = URL.createObjectURL(blob);` anchor `download = practicePdfFileName(session.createdAt)`; click; `URL.revokeObjectURL(url)`.
- `practicePdfFileName` uses local date/time `rastgele-test-YYYY-MM-DD-HHmm.pdf`.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/features/practice/practicePdf.test.ts`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/assets/fonts src/features/practice/practicePdf.ts src/features/practice/practicePdfFont.ts src/features/practice/practicePdf.test.ts vite.config.ts
git commit -m "feat: build practice PDFs with embedded Roboto"
```

---

### Task 10 (B3): PDF indirme düğmesi ve oturum entegrasyonu

**Files:**
- Create: `src/features/practice/PracticePdfButton.tsx`
- Modify: `src/features/practice/PracticeSessionPage.tsx`
- Test: `src/features/practice/practice.test.tsx`

**Interfaces:**
- Consumes: Task B2 `downloadPracticePdf(session)`.
- Produces: `<PracticePdfButton session={session} />` on active and completed test screens.

- [ ] **Step 1: Write failing UI tests**

- Mock `downloadPracticePdf`.
- Render the active session page; click “PDF indir”; assert busy text “PDF hazırlanıyor…” then success; no error.
- Make the mock reject; assert `role="alert"` with “PDF oluşturulamadı”.
- Render the completed page; assert the button is present.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/practice/practice.test.tsx -t "PDF"`
Expected: FAIL — button not found.

- [ ] **Step 3: Implement**

- `PracticePdfButton`:
  ```tsx
  export function PracticePdfButton({ session, className }: { session: PracticeSession; className?: string }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // onClick: setBusy(true); await downloadPracticePdf(session); catch -> setError('PDF oluşturulamadı. Lütfen tekrar dene.'); finally setBusy(false)
    // Button variant="secondary" with Download icon; label "PDF indir" / "PDF hazırlanıyor…"; role alert for error
  }
  ```
- Active `PracticeSessionPage` header: add the button in the right-side actions (next to the answered count).
- `CompletedPractice`: add the button to the button row.
- Disable while busy; keep the existing navigation links.

- [ ] **Step 4: Run focused UI tests**

Run: `npx vitest run src/features/practice/practice.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/practice/PracticePdfButton.tsx src/features/practice/PracticeSessionPage.tsx src/features/practice/practice.test.tsx
git commit -m "feat: add practice PDF download button"
```

---

### Task 11 (B4): PDF E2E

**Files:**
- Modify: `tests/e2e/photos.spec.ts`

**Interfaces:**
- Consumes: B1–B3.
- Produces: real download check.

- [ ] **Step 1: Extend the existing random-test E2E**

After the completed test assertions, add:

```ts
import { readFile } from 'node:fs/promises';

const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'PDF indir' }).click(),
]);
expect(download.suggestedFilename()).toMatch(/^rastgele-test-\d{4}-\d{2}-\d{2}-\d{4}\.pdf$/);
const path = await download.path();
expect(path).toBeTruthy();
const bytes = await readFile(path!);
expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
```

- [ ] **Step 2: Run the E2E**

Run: `npx playwright test tests/e2e/photos.spec.ts`
Expected: PASS; the download event fires and the file starts with `%PDF`.

- [ ] **Step 3: Run focused unit/type checks**

Run: `npx vitest run src/features/practice/practicePdf.test.ts src/features/practice/practice.test.tsx`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/photos.spec.ts
git commit -m "test: verify practice PDF download"
```

---

## Part C — Dokunmatik düzenleme

### Task 12 (C1): Görev çipine dokun → düzenleme

**Files:**
- Modify: `src/features/schedule/TaskChip.tsx`
- Test: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- Consumes: existing `onEdit?: () => void`, `tickMode`, `disabled`.
- Produces: normal-mode chip click calls `onEdit`; action buttons stop propagation; tick mode unchanged.

- [ ] **Step 1: Write failing tests**

Use the existing `taskChip(title)` test helper from `schedule.test.tsx`:

```ts
test('normal modda görev çipine tıklamak düzenleme modalını açar', async () => {
  await userEvent.click(taskChip('Matematik denemesi'));
  expect(screen.getByRole('dialog', { name: 'Görevi düzenle' })).toBeInTheDocument();
});

test('hover düzenle ikonuna tıklamak modalı iki kez açmaz', async () => {
  await userEvent.click(screen.getByRole('button', { name: /görevini düzenle/ }));
  expect(screen.getAllByRole('dialog', { name: 'Görevi düzenle' })).toHaveLength(1);
});

test('tick modunda çip tıklaması durumu değiştirir, modal açmaz', async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Tik modu' }));
  await userEvent.click(taskChip('Matematik denemesi'));
  expect(screen.queryByRole('dialog', { name: 'Görevi düzenle' })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/schedule/schedule.test.tsx -t "çipine tıklamak"`
Expected: FAIL — click does nothing.

- [ ] **Step 3: Implement**

- `TaskChip`:
  - `onClick={tickMode ? markDone : disabled ? undefined : onEdit}`.
  - Add `cursor-pointer` when not tickMode.
  - Add `onClick={(event) => event.stopPropagation()}` on the action-container `<div>` (and/or buttons).
  - Remove `max-[767px]:pointer-events-auto max-[767px]:opacity-100` from `HOVER_ACTIONS`; touch access is the chip tap.
- Keep `role`/`tabIndex` only for tick mode; the hidden edit button remains focusable for keyboard.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/features/schedule/schedule.test.tsx`
Expected: PASS; update the old test at ~line 1385 that asserts `max-[767px]:opacity-100` on the action container.

- [ ] **Step 5: Commit**

```bash
git add src/features/schedule/TaskChip.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat: open task editor by tapping the chip"
```

---

### Task 13 (C2): Modal içinden görev silme

**Files:**
- Modify: `src/features/schedule/ScheduleTaskModal.tsx`
- Modify: `src/features/schedule/WeeklyPlan.tsx`
- Test: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- Consumes: `ScheduleTaskModal` `task?` existing prop; `WeeklyPlan.requestDeleteTask`.
- Produces: `ScheduleTaskModalProps.onDelete?: () => void`; danger button when editing; parent closes editor and opens the existing confirmation.

- [ ] **Step 1: Write failing tests**

```ts
test('düzenleme modalındaki Görevi sil onay modalını açar', async () => {
  // open edit via chip
  await userEvent.click(screen.getByRole('button', { name: 'Görevi sil' }));
  expect(screen.getByRole('dialog', { name: 'Görevi sil' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Sil' }));
  await waitFor(() => expect(/* task gone */).toBe(true));
});
```

Add a chain-task case: the warning “Bu görev bir sayfa zincirinin parçası; silmek zinciri çözer.” remains.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/schedule/schedule.test.tsx -t "Görevi sil"`
Expected: FAIL — no delete button in the edit modal.

- [ ] **Step 3: Implement**

- `ScheduleTaskModalProps`: `onDelete?: () => void`.
- Footer: if `task && onDelete`, render a `Button variant="danger"` with text “Görevi sil” and `disabled={saving}`; then the existing Vazgeç/Kaydet.
- `WeeklyPlan` passes:
  ```tsx
  onDelete={taskEditor.task ? () => {
    const task = taskEditor.task;
    setTaskEditor(null);
    requestDeleteTask(task);
  } : undefined}
  ```
- Do not delete directly; always go through `requestDeleteTask`.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/features/schedule/schedule.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/schedule/ScheduleTaskModal.tsx src/features/schedule/WeeklyPlan.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat: delete a task from its editor"
```

---

### Task 14 (C3): Dokunmatik satır silme görünürlüğü

**Files:**
- Modify: `src/features/schedule/WeeklyPlanTable.tsx`
- Test: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- Produces: row trash visible on coarse pointers; task action icons remain hover-only on touch.

- [ ] **Step 1: Write failing class test**

```ts
test('satır silme düğmesi dokunmatikte görünür', () => {
  const button = screen.getByRole('button', { name: /satırı sil/ });
  expect(button).toHaveClass('pointer-coarse:opacity-100', 'any-pointer-coarse:opacity-100');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/schedule/schedule.test.tsx -t "dokunmatikte görünür"`
Expected: FAIL — classes absent.

- [ ] **Step 3: Implement**

- `WeeklyPlanTable` row trash class: append `pointer-coarse:opacity-100 any-pointer-coarse:opacity-100`; keep `max-[767px]:opacity-100`.
- No other layout change.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/features/schedule/schedule.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/schedule/WeeklyPlanTable.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat: show row delete on touch devices"
```

---

### Task 15 (C4): Dokunmatik ve masaüstü E2E

**Files:**
- Create: `tests/e2e/touch-edit.spec.ts`

**Interfaces:**
- Consumes: C1–C3.
- Produces: touch edit/delete and desktop click/tick regression in a dedicated spec.

- [ ] **Step 1: Create the touch E2E**

Use the same onboarding/plan setup helper as `program.spec.ts`. Scope the touch
context to a describe so the desktop regression keeps the default input:

```ts
test.describe('dokunmatik', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('tablette görev çipine dokunup düzenler ve siler', async ({ page }) => {
    // create a plan row + task, reload
    await page.locator('[data-status]').first().tap();
    await expect(page.getByRole('dialog', { name: 'Görevi düzenle' })).toBeVisible();
    await page.getByRole('button', { name: 'Görevi sil' }).tap();
    await expect(page.getByRole('dialog', { name: 'Görevi sil' })).toBeVisible();
    await page.getByRole('button', { name: 'Sil' }).tap();
    await expect(page.getByText('Görevi sil')).not.toBeVisible();
  });
});
```

- [ ] **Step 2: Add a desktop regression test in the same file**

- Click the chip (not the hover icon) → edit modal opens.
- Close it, click “Tik modu” → chip click marks done; no edit modal.

- [ ] **Step 3: Run the E2E**

Run: `npx playwright test tests/e2e/touch-edit.spec.ts`
Expected: PASS.

- [ ] **Step 4: Run focused unit/type checks**

Run: `npx vitest run src/features/schedule/schedule.test.tsx`
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/touch-edit.spec.ts
git commit -m "test: cover touch task editing and deletion"
```

---

### Task 16 (R1): Tam doğrulama ve yayın hazırlığı

**Files:**
- Modify: `PROGRESS.md`
- Modify: `docs/ROLLBACK.md`
- No `dist/` commit in this task.

- [ ] **Step 1: Full local verification**

Run, in order:

```bash
npm run typecheck
npm run test:run
npm run build
npx playwright test
npm audit --audit-level=high
```

Expected:
- Typecheck clean.
- Vitest all files pass (new total ≥ the current 867; report exact count).
- Build succeeds with only the existing chunk-size warning.
- Playwright all specs pass (new PDF/touch tests included).
- Audit has no high/critical.

- [ ] **Step 2: Update docs**

- `PROGRESS.md`: add the three features, test totals, and the forward-only rollback note.
- `docs/ROLLBACK.md`: append the page-chain custom-layout policy:
  - `chunk_sizes` nullable; API/migration rollback not standalone while the new client is live.
  - Gate query `SELECT COUNT(*) FROM schedule_page_chains WHERE chunk_sizes IS NOT NULL;`
  - Client rollback unsupported after new layouts exist; forward-only fix.
- Do not change the design/plan docs.

- [ ] **Step 3: Restore the build output and check the worktree**

The build in Step 1 may rewrite `dist/`; this plan does not commit it:

```bash
git restore dist
git clean -fd dist
git status --short
git diff --check
```

Expected: only the intended docs changes; no `dist/` changes.

- [ ] **Step 4: Commit docs**

```bash
git add PROGRESS.md docs/ROLLBACK.md
git commit -m "docs: record plan preview, PDF and touch release"
```

- [ ] **Step 5: Report, do not deploy**

Report:
- Branch/commit.
- Exact test counts and commands.
- PHP CI status: not run locally; the `api` job must pass on push.
- Deploy order: `006_page_chain_chunk_sizes.sql` → API → client.
- Do not push/merge/deploy or commit `dist/` without the user’s explicit approval.
