# Çizelge Genişletme ve Gün Tikleri Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elle ders çalışma çizelgesinin hücrelerini uzun kelimeleri bölmeyecek kadar genişletmek ve her gün hücresine kalıcı bir tamamlandı tiki eklemek.

**Architecture:** ≥768 px’te tablo `min-width: 1160px` ile sağa büyür, kart içinde yatay kaydırılır; ilk sütun sabit kalır. Çizelge sayfası `max-w-5xl` sınırını aşar. Her gün hücresinde üstte sağa yaslı bir onay kutusu, altında tam genişlikte metin alanı bulunur; tik `ScheduleTableRow.done` alanında saklanır, eski kayıtlarda varsayılan `false` okunur.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Dexie/IndexedDB, zod (yedek şeması), Vitest + React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-schedule-width-ticks-design.md`

## Global Constraints

- Node.js `>=22.22.2`; yeni bağımlılık eklenmez.
- Tüm arayüz metinleri Türkçe; mevcut `Card`, `Button`, `cn` desenleri ve tasarım değişkenleri kullanılır.
- `ScheduleTable` dışındaki veri modelleri, IndexedDB şeması, doğrulama ve otomatik kaydetme değişmez.
- Tik yalnızca gün hücrelerinde; ders ve toplam hücrelerinde tik yok.
- 360 px genişlikte sayfa düzeyinde yatay kaydırma olmaz; yatay kaydırma yalnızca tablo kartının içinde olur.
- Dokunma hedefleri en az 44 px yüksekliğinde.
- Yatay kaydırmada ders sütunu `sticky left-0` ile sabit kalır.
- Branş denemeleri bu planın kapsamı dışındadır; ayrı tasarım/plan ile yapılacaktır.
- Çalışma dalı `fix/schedule-width-ticks`; kullanıcı önizlemeyi onaylamadan push yapılmaz.
- Tüm alt ajanlar `opencode-go/deepseek-v4.1-flash#max` modelini kullanır.
- Her görev sonunda ilgili testler ve `npm run typecheck` geçer.

## Review Focus

1. **Eski kayıtlar:** `done` alanı olmayan mevcut çizelge yüklenince yedi `false` dönmeli, hata vermemeli. Test: Task 1.
2. **Eski yedekler:** `done` alanı olmayan yedek içe aktarılınca varsayılan `false`; yeni yedek tikleri kayıpsız taşımalı. Test: Task 1 (yedek testi + repository testi).
3. **Tik + uzun metin:** Tik satırı metin alanının genişliğini azaltmamalı; 120 karakterlik metin hâlâ sarıp satırı büyütmeli. Test: Task 2/Task 4.
4. **Yatay kaydırma ve sabit sütun:** 768/1024 px’te tablo kart içinde kaymalı, ders sütunu görünür kalmalı, sayfa taşmamalı. Test: Task 4.
5. **Tik kalıcılığı:** Tik işaretlenince otomatik kaydedilmeli; sayfa yenilenince geri gelmeli. Test: Task 2 + Task 4.

---

## File Structure

```
src/domain/types.ts                       ScheduleTableDoneCells + row.done
src/domain/scheduleTable.ts               boş done dizisi, satır oluşturma
src/db/repositories.ts                    done doğrulama/normalizasyon/kayıt
src/db/backup.ts                          done şema varsayılanı
src/db/schedule.test.ts                   repository testleri
src/db/backup.test.ts                     yedek round-trip testi
src/features/schedule/ScheduleTableEditor.tsx  tik UI + geniş/scroll layout
src/features/schedule/schedule.test.tsx   tik UI testleri
src/app/AppShell.tsx                      /program için tam genişlik
tests/e2e/program.spec.ts                 tik kalıcılığı
tests/e2e/responsive.spec.ts              geniş tablo/scroll testleri
docs/superpowers/specs/…                  onaylı tasarım (değişmez)
```

## Task 1: `done` Veri Modeli ve Kalıcılık

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/domain/scheduleTable.ts`
- Modify: `src/db/repositories.ts`
- Modify: `src/db/backup.ts`
- Test: `src/db/schedule.test.ts`
- Test: `src/db/backup.test.ts`

**Interfaces:**
- Produces:

```ts
export type ScheduleTableDoneCells = [
  boolean, boolean, boolean, boolean, boolean, boolean, boolean,
];

export interface ScheduleTableRow {
  id: string;
  subject: string;
  days: ScheduleTableDayCells;
  done: ScheduleTableDoneCells;
  total: string;
}

export function emptyScheduleTableDoneCells(): ScheduleTableDoneCells;
```

- `getScheduleTable()` returns rows whose `done` is always a seven-boolean tuple, even for legacy records.
- `saveScheduleTable()` accepts rows with `done` and persists it.

- [ ] **Step 1: Write the failing repository test**

In `src/db/schedule.test.ts`, add `ScheduleTableRow` to the type imports from
`@/domain/types`, then append:

```ts
test('gün tiklerini kaydeder ve eski kayıtta varsayılan false okur', async () => {
  const empty = createEmptyScheduleTable();
  empty.rows[0].done[0] = true;
  empty.rows[0].done[3] = true;

  const saved = await saveScheduleTable({
    rows: empty.rows,
    totals: empty.totals,
    note: '',
  });

  expect(saved.rows[0].done).toEqual([
    true,
    false,
    false,
    true,
    false,
    false,
    false,
  ]);
  expect((await getScheduleTable())?.rows[0].done).toEqual(saved.rows[0].done);

  await db.scheduleTables.put({
    id: 'main',
    rows: [
      {
        id: 'eski-satir',
        subject: 'Eski',
        days: ['', '', '', '', '', '', ''],
        total: '',
      } as ScheduleTableRow,
    ],
    totals: {
      label: 'TOPLAM SÜRE/SORU',
      days: ['', '', '', '', '', '', ''],
      total: '',
    },
    note: '',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const loaded = await getScheduleTable();
  expect(loaded?.rows[0].done).toEqual([
    false,
    false,
    false,
    false,
    false,
    false,
    false,
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/db/schedule.test.ts`

Expected: FAIL — `empty.rows[0].done` is undefined.

- [ ] **Step 3: Implement the type, row factory and repository**

In `src/domain/types.ts`, add `ScheduleTableDoneCells` above `ScheduleTableRow` and add `done: ScheduleTableDoneCells` to the row interface (between `days` and `total`).

In `src/domain/scheduleTable.ts`, add:

```ts
export function emptyScheduleTableDoneCells(): ScheduleTableDoneCells {
  return [false, false, false, false, false, false, false];
}
```

and include `done: emptyScheduleTableDoneCells()` in `createEmptyScheduleRow()`.

In `src/db/repositories.ts`:

- import `ScheduleTableDoneCells` and `emptyScheduleTableDoneCells`;
- add:

```ts
function parseScheduleDone(value: unknown): ScheduleTableDoneCells {
  if (!Array.isArray(value) || value.length !== 7) {
    return emptyScheduleTableDoneCells();
  }
  return value.map((cell) => cell === true) as ScheduleTableDoneCells;
}
```

- include `done: parseScheduleDone(candidate.done)` in `parseScheduleRows`'s returned row;
- normalize reads:

```ts
export async function getScheduleTable(): Promise<ScheduleTable | undefined> {
  const table = await db.scheduleTables.get(SCHEDULE_TABLE_ID);
  if (!table) {
    return undefined;
  }
  return {
    ...table,
    rows: table.rows.map((row) => ({ ...row, done: parseScheduleDone(row.done) })),
  };
}
```

Also update the existing `'tek-satir'` row literal in the same test file so
typecheck stays green: import `emptyScheduleTableDoneCells` from
`@/domain/scheduleTable` and add `done: emptyScheduleTableDoneCells()` to that
row.

In `src/db/backup.ts`, add to `scheduleTableRowSchema`:

```ts
done: z
  .array(z.boolean())
  .length(7)
  .default([false, false, false, false, false, false, false]),
```

- [ ] **Step 4: Update the backup round-trip test**

In `src/db/backup.test.ts`, in the first row of the saved schedule table, add:

```ts
done: [true, false, false, false, false, false, true],
```

and assert it in the serialized row:

```ts
expect(serializedRows[0]).toMatchObject({
  subject: 'Matematik',
  days: ['2 saat', '40 soru', '', '', '', '', ''],
  done: [true, false, false, false, false, false, true],
  total: '2 saat',
});
```

The existing `expect(await db.scheduleTables.get('main')).toEqual(table)` then covers the import side.

- [ ] **Step 5: Run the focused tests**

Run: `npm run test:run -- src/db/schedule.test.ts src/db/backup.test.ts`

Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`

Expected: exit code 0.

```bash
git add src/domain/types.ts src/domain/scheduleTable.ts src/db/repositories.ts src/db/backup.ts src/db/schedule.test.ts src/db/backup.test.ts
git commit -m "feat: persist schedule day completion flags"
```

## Task 2: Tik Arayüzü

**Files:**
- Modify: `src/features/schedule/ScheduleTableEditor.tsx`
- Test: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- Consumes: `ScheduleTableRow.done` (Task 1), `emptyScheduleTableDoneCells`.
- Produces: no exported API change; day cells gain a checkbox labelled
  `<satır no>. satır <gün> tamamlandı`.

- [ ] **Step 1: Write the failing UI test**

Append to `src/features/schedule/schedule.test.tsx`:

```tsx
test('gün tiki hücreyi yeşile çevirir ve yeniden açınca korunur', async () => {
  const view = await openSchedule();
  const table = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });

  const tick = within(table).getByRole('checkbox', {
    name: '1. satır Pazartesi tamamlandı',
  });
  expect(tick).not.toBeChecked();

  await userEvent.click(tick);

  expect(tick).toBeChecked();
  expect(tick.closest('td')).toHaveClass('bg-success/10');
  expect(within(table).getByLabelText('1. satır Pazartesi')).toHaveClass('opacity-60');

  expect(
    await screen.findByText('Kaydedildi', {}, { timeout: 3000 }),
  ).toBeInTheDocument();

  view.unmount();
  await openSchedule();

  const reloaded = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  expect(
    within(reloaded).getByRole('checkbox', {
      name: '1. satır Pazartesi tamamlandı',
    }),
  ).toBeChecked();
  expect(within(reloaded).getByLabelText('1. satır Pazartesi')).toHaveClass('opacity-60');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/features/schedule/schedule.test.tsx`

Expected: FAIL — no checkbox with that name.

- [ ] **Step 3: Implement the tick UI and state**

In `ScheduleTableEditor.tsx`:

- import `ScheduleTableDoneCells` from `@/domain/types`;
- clone `done` in `draftFrom`:
  `done: [...row.done] as ScheduleTableDoneCells`;
- add:

```ts
function updateRowDone(rowId: string, dayIndex: number, done: boolean): void {
  setDraft((current) => ({
    ...current,
    rows: current.rows.map((row) => {
      if (row.id !== rowId) {
        return row;
      }
      const next = [...row.done] as ScheduleTableDoneCells;
      next[dayIndex] = done;
      return { ...row, done: next };
    }),
  }));
}
```

- in each day `<td>` add `row.done[dayIndex] && 'bg-success/10'` to the `cn(...)` classes, and render before the textarea:

```tsx
<div className="flex justify-end">
  <label className="grid h-11 w-11 place-items-center">
    <input
      type="checkbox"
      checked={row.done[dayIndex]}
      onChange={(event) =>
        updateRowDone(row.id, dayIndex, event.target.checked)
      }
      aria-label={`${index + 1}. satır ${SCHEDULE_DAYS[dayIndex].label} tamamlandı`}
      className="h-5 w-5 accent-[var(--color-success)]"
    />
  </label>
</div>
<AutoGrowTextarea
  value={value}
  onChange={(next) => updateRowDay(row.id, dayIndex, next)}
  label={`${index + 1}. satır ${SCHEDULE_DAYS[dayIndex].label}`}
  maxLength={SCHEDULE_TABLE_CELL_MAX_LENGTH}
  className={row.done[dayIndex] ? 'text-muted opacity-60' : undefined}
/>
```

- leave the subject and total cells untouched.

- [ ] **Step 4: Run the focused test**

Run: `npm run test:run -- src/features/schedule/schedule.test.tsx`

Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

Expected: exit code 0.

```bash
git add src/features/schedule/ScheduleTableEditor.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat: add schedule day completion ticks"
```

## Task 3: Geniş Tablo, Yatay Kaydırma ve Sabit Ders Sütunu

**Files:**
- Modify: `src/features/schedule/ScheduleTableEditor.tsx`
- Modify: `src/app/AppShell.tsx`

**Interfaces:**
- Consumes: Task 2's cell markup (tick + textarea).
- Produces: no exported API change; `/program` page uses the full available width.

- [ ] **Step 1: Use the full width for the schedule page**

In `src/app/AppShell.tsx`:

- import `useLocation` from `react-router-dom`;
- inside `AppShell`, add `const { pathname } = useLocation();` and
  `const isWidePage = pathname === '/program';`
- change the `<main>` class to:

```tsx
className={cn(
  'mx-auto w-full px-4 sm:px-6',
  isWidePage ? 'max-w-none' : 'max-w-5xl',
  isDesktop ? 'py-8' : 'py-5 pb-28',
)}
```

- [ ] **Step 2: Widen the table and make it scroll inside its card**

In `ScheduleTableEditor.tsx`:

- table wrapper: `className="overflow-x-auto rounded-xl border border-line"` (replace `overflow-hidden`);
- table: `className="w-full table-fixed border-collapse text-sm min-[768px]:min-w-[1160px]"`;
- subject `<th>`: `cn(headCellClass, 'sticky left-0 z-20 w-[45%] min-[768px]:w-[18%]')`;
- day `<th>`: `'w-[33%] min-[768px]:w-[10.4%]'`;
- total `<th>`: `'w-[22%] min-[768px]:w-[9.2%]'`;
- subject `<td>`: `cn(bodyCellClass, 'sticky left-0 z-10 bg-surface')`;
- footer label `<th>`: `cn(headCellClass, 'sticky left-0 z-10 border-b-0 bg-raised')`;
- keep all day cells exactly as Task 2 left them.

- [ ] **Step 3: Run the schedule and shell tests**

Run: `npm run test:run -- src/features/schedule/schedule.test.tsx src/app/AppShell.test.tsx`

Expected: PASS.

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck`

Expected: exit code 0.

Run: `npm run build`

Expected: build succeeds and Tailwind compiles the new arbitrary classes.

- [ ] **Step 5: Commit**

```bash
git add src/features/schedule/ScheduleTableEditor.tsx src/app/AppShell.tsx
git commit -m "feat: widen schedule table with in-card scrolling"
```

## Task 4: E2E Kapsamı

**Files:**
- Modify: `tests/e2e/program.spec.ts`
- Modify: `tests/e2e/responsive.spec.ts`

**Interfaces:**
- Consumes: day-tick checkbox names from Task 2; ≥768 px table min-width from Task 3.
- Produces: no production code change.

- [ ] **Step 1: Update the 768 px expectation for horizontal scrolling**

In `tests/e2e/responsive.spec.ts`:

- replace `expectDaysWithinWidth` with a helper that asserts all seven day
  headers exist:

```ts
async function expectSevenDayTable(table: Locator) {
  for (const day of DAYS) {
    await expect(
      table.getByRole('columnheader', { name: day, exact: true }),
    ).toBeVisible();
  }
}
```

- in the 768 px test, replace `expectDaysWithinWidth(table, 768)` calls with
  `expectSevenDayTable(table)`;
- replace the `tableOverflow` assertion with:

```ts
const scroll = await table.evaluate((element) => ({
  table: element.scrollWidth,
  wrapper: element.parentElement?.clientWidth ?? 0,
}));
expect(scroll.table).toBeGreaterThan(scroll.wrapper);

const mondayWidth = await table
  .getByRole('columnheader', { name: 'Pazartesi', exact: true })
  .evaluate((element) => element.getBoundingClientRect().width);
expect(mondayWidth).toBeGreaterThanOrEqual(110);
```

- keep `pageOverflow <= 1` and the post-fill page-overflow re-check;
- rename the test to
  `'768 px çizelgede yedi gün kaydırılarak görünür ve uzun hücre aşağı büyür'`.

- [ ] **Step 2: Add a 1440 px width test**

Append to `tests/e2e/responsive.spec.ts`:

```ts
test('1440 px çizelgede tablo genişler ve sayfa taşmaz', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await page.goto('./#/program');

  const table = page.getByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  await expectSevenDayTable(table);

  const width = await table.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  expect(width).toBeGreaterThanOrEqual(1160);

  const dayWidth = await table
    .getByRole('columnheader', { name: 'Pazartesi', exact: true })
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(dayWidth).toBeGreaterThanOrEqual(110);

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 3: Add tick persistence to the program E2E**

In `tests/e2e/program.spec.ts`, after the day/total fills and before the first
`Kaydedildi` wait, add:

```ts
await page
  .getByRole('checkbox', { name: '1. satır Pazartesi tamamlandı' })
  .check();
```

The existing `Kaydedildi` wait then covers the tick save. In the final reload
block, after re-opening the manual table and checking Pazartesi/Salı values,
add:

```ts
await expect(
  reloadedTable.getByRole('checkbox', {
    name: '1. satır Pazartesi tamamlandı',
  }),
).toBeChecked();
```

- [ ] **Step 4: Run the affected E2E tests**

Run: `npx playwright test tests/e2e/program.spec.ts tests/e2e/responsive.spec.ts`

Expected: PASS. Ensure no stale preview is listening on port 4173 so the
current build is served.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/program.spec.ts tests/e2e/responsive.spec.ts
git commit -m "test: cover schedule ticks and wide scrolling table"
```

## Task 5: Tam Doğrulama ve Yerel Önizleme

**Files:** none.

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:run`

Expected: all tests pass.

- [ ] **Step 2: Typecheck and production build**

Run: `npm run typecheck`

Expected: exit code 0.

Run: `npm run build`

Expected: `dist/` produced without errors.

- [ ] **Step 3: Run the full E2E suite**

Run: `npm run test:e2e`

Expected: all Playwright tests pass.

- [ ] **Step 4: Start the local preview**

Run: `npm run preview -- --port 4173 --strictPort` in the background.

Expected: `http://localhost:4173/kocluk/` serves the new build.

- [ ] **Step 5: Capture preview screenshots**

Use a temporary script (do not commit; delete after use) that, for each
viewport `360×800`, `390×844`, `768×900`, `1024×900`, `1440×900`:

1. completes onboarding (`Adın` = `Önizleme`, `İleri`, `Tümü`, `İleri`, `Mavi`, `İleri`, `Başla`);
2. opens `#/program`;
3. fills the first row with `Matematik` and a long sentence in `1. satır Pazartesi`;
4. ticks `1. satır Pazartesi tamamlandı` on every capture, so the green/faded
   done state is visible on phone and desktop;
5. waits for `Kaydedildi`;
6. saves a full-page screenshot under
   `C:\Users\user\AppData\Local\Temp\opencode\schedule-ticks-preview\<width>.png`.

Expected: ≥768 px day cell ≥110 px wide, long words not split mid-word;
horizontal scroll inside the card only; tick shows a faint green cell and faded
text; 390/360 keep the one-day layout.

- [ ] **Step 6: Report to the user**

Report commands/results, show the screenshots, and wait for approval before
any push.
