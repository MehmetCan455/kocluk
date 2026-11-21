# Çizelge Hücrelerini Sarmalama ve Duyarlı Tablo Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elle ders çalışma çizelgesinde uzun hücre metinlerini sarıp satırı aşağı büyütmek; telefonda tek gün + gün seçici, tablet/masaüstünde yedi günü yatay kaydırmasız göstermek.

**Architecture:** Hücrelerdeki `<input>` alanları, `scrollHeight` ve `ResizeObserver` ile kendini büyüten `<textarea>` bileşenine çevrilir. Tablo `table-fixed` + yüzde sütun genişlikleri kullanır; 720 px altında seçili olmayan gün sütunları CSS ile gizlenir, veri bellekte kalır. Seçili gün bileşen durumundadır; veri modeli ve otomatik kaydetme değişmez.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Vitest + React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-schedule-cell-wrap-design.md`

## Global Constraints

- Node.js `>=22.22.2`; yeni bağımlılık eklenmez.
- Tüm arayüz metinleri Türkçe; mevcut `Card`, `Button`, `cn` desenleri ve tasarım değişkenleri kullanılır.
- `ScheduleTable` tipi, IndexedDB şeması, doğrulama ve otomatik kaydetme değişmez.
- 360 px genişlikte sayfa düzeyinde yatay kaydırma olmaz.
- Dokunma hedefleri en az 44 px yüksekliğinde; gün düğmeleri `min-h-11`.
- Çalışma dalı `fix/schedule-cell-wrap`; kullanıcı önizlemeyi onaylamadan push yapılmaz.
- Tüm alt ajanlar `opencode-go/deepseek-v4.1-flash#max` modelini kullanır.
- Her görev sonunda ilgili testler ve `npm run typecheck` geçer.

## Review Focus

1. **Boşluksuz 120 karakterlik metin:** Gün hücresinde tek parça uzun metin yatay taşmamalı, sarmalı ve satırı büyütmeli. Test: Task 1 (yükseklik), Task 4 (E2E `'X'.repeat(120)`).
2. **Gizli günlerin verisi:** Telefonda gün değiştirince önceki günün yazılanı kaybolmamalı ve otomatik kaydetmeye dahil olmalı. Test: Task 3 (CSS ile gizleme), Task 4 (program E2E Salı kaydı + reload).
3. **Enter tuşu:** Hücrede Enter yeni satır/boşluk üretmemeli, odaktan çıkmalı. Test: Task 1.
4. **720–768 px sığma:** Yedi gün ve uzun “TOPLAM SÜRE/SORU” başlığı yatay kaydırma üretmeden sığmalı. Test: Task 4.
5. **Erişilebilir adlar:** Gizlenen gün sütunları erişilebilirlik ağacından çıkmalı; seçili günün başlığı tam gün adıyla okunmalı. Test: Task 4.

---

## File Structure

```
src/features/schedule/
  AutoGrowTextarea.tsx        yeni: kendini büyüten textarea
  AutoGrowTextarea.test.tsx   yeni: bileşen testleri
  ScheduleTableEditor.tsx     değişir: hücreler, gün seçici, duyarlı tablo
  schedule.test.tsx           değişir: textarea ve gün seçici testleri
tests/e2e/
  program.spec.ts             değişir: mobil gün geçişi, Salı kalıcılığı
  responsive.spec.ts          değişir: tek gün, 768 px sığma, uzun metin
```

## Task 1: Kendini Büyüten Hücre Alanı

**Files:**
- Create: `src/features/schedule/AutoGrowTextarea.tsx`
- Test: `src/features/schedule/AutoGrowTextarea.test.tsx`

**Interfaces:**
- Consumes: `cn` (`@/components/ui/cn`).
- Produces:

```ts
export interface AutoGrowTextareaProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  maxLength: number;
  placeholder?: string;
  className?: string;
}
export function AutoGrowTextarea(props: AutoGrowTextareaProps);
```

- [ ] **Step 1: Write the failing tests**

Create `src/features/schedule/AutoGrowTextarea.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { AutoGrowTextarea } from './AutoGrowTextarea';

test('etiketiyle görünür ve değerini textarea olarak gösterir', () => {
  render(
    <AutoGrowTextarea
      value="2 saat"
      onChange={() => {}}
      label="1. satır Pazartesi"
      maxLength={120}
    />,
  );

  const field = screen.getByLabelText('1. satır Pazartesi');
  expect(field.tagName).toBe('TEXTAREA');
  expect(field).toHaveValue('2 saat');
  expect(field).toHaveAttribute('maxlength', '120');
});

test('Enter yeni satır eklemez ve odağı bırakır', async () => {
  const onChange = vi.fn();
  render(
    <AutoGrowTextarea
      value="Matematik"
      onChange={onChange}
      label="1. satır ders"
      maxLength={80}
    />,
  );

  const field = screen.getByLabelText('1. satır ders');
  field.focus();
  await userEvent.keyboard('{Enter}');

  expect(field).not.toHaveFocus();
  expect(field).toHaveValue('Matematik');
  expect(onChange).not.toHaveBeenCalled();
});

test('içerik uzadıkça yüksekliği büyür', () => {
  const { rerender } = render(
    <AutoGrowTextarea
      value="kısa"
      onChange={() => {}}
      label="1. satır Salı"
      maxLength={120}
    />,
  );
  const field = screen.getByLabelText('1. satır Salı');
  Object.defineProperty(field, 'scrollHeight', { configurable: true, value: 96 });
  Object.defineProperty(field, 'offsetHeight', { configurable: true, value: 46 });
  Object.defineProperty(field, 'clientHeight', { configurable: true, value: 44 });

  rerender(
    <AutoGrowTextarea
      value="daha uzun bir metin"
      onChange={() => {}}
      label="1. satır Salı"
      maxLength={120}
    />,
  );

  expect(field).toHaveStyle({ height: '98px' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/features/schedule/AutoGrowTextarea.test.tsx`

Expected: FAIL — `Cannot find module './AutoGrowTextarea'`.

- [ ] **Step 3: Implement the component**

Create `src/features/schedule/AutoGrowTextarea.tsx` with the exported interface above. Requirements:

- `<textarea rows={1} ref={ref} value={value} aria-label={label} maxLength={maxLength} placeholder={placeholder} />`.
- `onChange`: `event.target.value` ile `onChange` çağır.
- `onKeyDown`: `Enter` için `event.preventDefault()` ve `event.currentTarget.blur()`.
- `useLayoutEffect` her `value` değişiminde yüksekliği ayarlar.
- `useEffect` içinde `ResizeObserver` alanı gözler; genişlik değişince yükseklik yeniden hesaplanır.
- Gizli hücrede `scrollHeight` 0 döner; bu durumda yüksekliğe dokunma.
- Temel sınıflar: `block min-h-11 w-full min-w-0 resize-none overflow-hidden rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm leading-5 text-fg placeholder:text-muted transition-colors hover:border-line focus:border-[var(--accent)] focus:bg-canvas [overflow-wrap:anywhere]`, ardından `className`.

Yükseklik algoritması:

```ts
function resize(el: HTMLTextAreaElement): void {
  if (el.scrollHeight === 0) return; // gizli hücre
  el.style.height = 'auto';
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + border}px`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/features/schedule/AutoGrowTextarea.test.tsx`

Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/schedule/AutoGrowTextarea.tsx src/features/schedule/AutoGrowTextarea.test.tsx
git commit -m "feat: add auto-growing schedule cell field"
```

## Task 2: Hücreleri Yeni Alanla Değiştir

**Files:**
- Modify: `src/features/schedule/ScheduleTableEditor.tsx`
- Test: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- Consumes: `AutoGrowTextarea` from Task 1 (`value`, `onChange(value)`, `label`, `maxLength`, `placeholder`, `className`).
- Produces: no exported API change; table cells become `<textarea>`.

- [ ] **Step 1: Add the failing textarea assertion**

In `src/features/schedule/schedule.test.tsx`, in the test `'elle tablo beş boş satırla açılır, satır eklenip silinir'`, after the `getAllByLabelText(/^\d+\. satır ders$/)` length check add:

```tsx
expect(within(table).getByLabelText('1. satır ders').tagName).toBe('TEXTAREA');
```

Run: `npm run test:run -- src/features/schedule/schedule.test.tsx`

Expected: FAIL — received `INPUT`.

- [ ] **Step 2: Replace the cells**

In `src/features/schedule/ScheduleTableEditor.tsx`:

- Import `AutoGrowTextarea` from `./AutoGrowTextarea`.
- Delete the `cellInputClass` constant.
- Change `bodyCellClass` to `'border-b border-r border-line p-1 align-top'`.
- Subject cell: wrapper `flex items-start gap-1`; replace the `<input>` with:

```tsx
<AutoGrowTextarea
  value={row.subject}
  onChange={(value) => updateSubject(row.id, value)}
  label={`${index + 1}. satır ders`}
  placeholder="Ders / etkinlik"
  maxLength={SCHEDULE_TABLE_SUBJECT_MAX_LENGTH}
  className="flex-1"
/>
```

- Day cells: replace each `<input>` with:

```tsx
<AutoGrowTextarea
  value={value}
  onChange={(next) => updateRowDay(row.id, dayIndex, next)}
  label={`${index + 1}. satır ${SCHEDULE_DAYS[dayIndex].label}`}
  maxLength={SCHEDULE_TABLE_CELL_MAX_LENGTH}
/>
```

- Row total and footer total cells: same pattern with `updateRowTotal` / `updateTotalDay` / `updateTotal`, their existing labels and `SCHEDULE_TABLE_TOTAL_MAX_LENGTH` / `SCHEDULE_TABLE_CELL_MAX_LENGTH`; footer fields keep `className="font-medium"`.
- Keep the table's current `min-w-[920px]`, `overflow-x-auto` and `sticky` classes for now; Task 3 changes the layout.

- [ ] **Step 3: Run the schedule tests**

Run: `npm run test:run -- src/features/schedule/schedule.test.tsx`

Expected: PASS (all existing tests, including typing, autosave, reload and mode switching).

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck`

Expected: exit code 0.

```bash
git add src/features/schedule/ScheduleTableEditor.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat: wrap schedule cell text in growing fields"
```

## Task 3: Telefonda Tek Gün, Tablet ve Masaüstünde Tam Tablo

**Files:**
- Modify: `src/features/schedule/ScheduleTableEditor.tsx`
- Test: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- Consumes: `SCHEDULE_DAYS` (`day.label`, `day.short`), Task 1 component.
- Produces: internal `selectedDay` state (`number`, 0-based). No exported API change.

- [ ] **Step 1: Add the failing day selector test**

Append to `src/features/schedule/schedule.test.tsx`:

```tsx
test('gün seçicisi seçili günü değiştirir', async () => {
  await openSchedule();

  const pazartesi = screen.getByRole('button', { name: 'Pazartesi' });
  const sali = screen.getByRole('button', { name: 'Salı' });
  expect(pazartesi).toHaveAttribute('aria-pressed', 'true');
  expect(sali).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(sali);

  expect(sali).toHaveAttribute('aria-pressed', 'true');
  expect(pazartesi).toHaveAttribute('aria-pressed', 'false');
});
```

Run: `npm run test:run -- src/features/schedule/schedule.test.tsx`

Expected: FAIL — `Unable to find role="button"` for Pazartesi.

- [ ] **Step 2: Add the day selector**

In `ScheduleTableEditor` add `const [selectedDay, setSelectedDay] = useState(0);`.

After the header row (`Haftalık tablo` + `Satır ekle`) and before the table wrapper, add:

```tsx
<div
  role="group"
  aria-label="Çizelge günü"
  className="grid grid-cols-7 gap-1 min-[720px]:hidden"
>
  {SCHEDULE_DAYS.map((day, dayIndex) => (
    <button
      key={day.day}
      type="button"
      aria-label={day.label}
      aria-pressed={dayIndex === selectedDay}
      onClick={() => setSelectedDay(dayIndex)}
      className={cn(
        'min-h-11 rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        dayIndex === selectedDay
          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'border-line bg-surface text-muted hover:text-fg',
      )}
    >
      {day.short}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Make the table fit**

In the same file:

- Remove the entire `<colgroup>` block.
- Remove `min-w-[920px]` from `<table>`; use `className="w-full table-fixed border-collapse text-sm"`.
- Change the table wrapper to `className="rounded-xl border border-line"` (no `max-w-full overflow-x-auto`).
- Subject `<th>`: `className={cn(headCellClass, 'w-[36%] min-[720px]:w-[20%]')}`; inside it show `DERS` below 720 px and `DERSLER / TARİH` at and above 720 px (two spans with `min-[720px]:hidden` / `hidden min-[720px]:inline`).
- Each day `<th>`: add `aria-label={day.label}` and

```tsx
className={cn(
  headCellClass,
  'w-[42%] min-[720px]:w-[9.6%]',
  dayIndex !== selectedDay && 'hidden min-[720px]:table-cell',
)}
```

Inside show the full `day.label` below 720 px and `day.short` at and above 720 px (same two-span pattern).
- Total `<th>`: `className={cn(headCellClass, 'w-[22%] min-[720px]:w-[12.8%]')}` and `aria-label="Toplam süre/soru"`; show `TOPLAM` below 720 px and `TOPLAM SÜRE/SORU` at and above 720 px.
- Subject `<td>`: `className={cn(bodyCellClass, 'bg-surface')}` (remove `sticky left-0 z-10`).
- Each day `<td>`: add `dayIndex !== selectedDay && 'hidden min-[720px]:table-cell'`.
- Footer label `<th>`: `className={cn(headCellClass, 'border-b-0 bg-raised')}` (remove sticky); inside show `TOPLAM` below 720 px and `draft.totals.label || SCHEDULE_TABLE_TOTAL_LABEL` at and above 720 px.
- Each footer day `<td>`: add `dayIndex !== selectedDay && 'hidden min-[720px]:table-cell'` alongside `border-b-0`.
- Remove all remaining `sticky` classes.

- [ ] **Step 4: Run unit tests and typecheck**

Run: `npm run test:run -- src/features/schedule/schedule.test.tsx src/features/schedule/AutoGrowTextarea.test.tsx`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/schedule/ScheduleTableEditor.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat: fit schedule table on tablets and add mobile day view"
```

## Task 4: E2E Kapsamı

**Files:**
- Modify: `tests/e2e/program.spec.ts`
- Modify: `tests/e2e/responsive.spec.ts`

**Interfaces:**
- Consumes: accessible day buttons named `Pazartesi`…`Pazar`; day column headers with `aria-label={day.label}`; textarea labels unchanged (`1. satır ders`, `1. satır Pazartesi`, …).
- Produces: no production code change.

- [ ] **Step 1: Update the existing program flow for the mobile day view**

In `tests/e2e/program.spec.ts`, replace the Salı fill:

```ts
await table.getByLabel('1. satır Salı').fill('40 soru');
```

with:

```ts
await page.getByRole('button', { name: 'Salı', exact: true }).click();
await table.getByLabel('1. satır Salı').fill('40 soru');
await page.getByRole('button', { name: 'Pazartesi', exact: true }).click();
```

After the reload block re-opens the manual table and checks Pazartesi, add:

```ts
await page.getByRole('button', { name: 'Salı', exact: true }).click();
await expect(reloadedTable.getByLabel('1. satır Salı')).toHaveValue('40 soru');
```

- [ ] **Step 2: Add the responsive tests**

Append to `tests/e2e/responsive.spec.ts`:

```ts
test('390 px çizelgede tek gün görünür ve gün değiştirilir', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await page.goto('./#/program');

  const table = page.getByRole('table', { name: 'Haftalık ders çalışma tablosu' });
  await expect(table.getByRole('columnheader', { name: 'Pazartesi' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Salı' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Salı', exact: true }).click();
  await expect(table.getByRole('columnheader', { name: 'Salı' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Pazartesi' })).toHaveCount(0);

  const height = await table
    .getByLabel('1. satır Salı')
    .evaluate((field) => field.clientHeight);
  expect(height).toBeGreaterThan(40);
});

test('768 px çizelgede yedi gün sığar ve uzun hücre aşağı büyür', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await page.goto('./#/program');

  const table = page.getByRole('table', { name: 'Haftalık ders çalışma tablosu' });
  await expect(table.getByRole('columnheader', { name: 'Pazar' })).toBeVisible();

  const tableOverflow = await table.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(tableOverflow).toBeLessThanOrEqual(1);

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(1);

  const row = table.locator('tbody tr').first();
  const before = await row.boundingBox();
  const cell = table.getByLabel('1. satır Pazartesi');
  await cell.fill('X'.repeat(120));

  await expect
    .poll(async () => (await row.boundingBox())?.height ?? 0)
    .toBeGreaterThan(before?.height ?? 0);

  const cellOverflow = await cell.evaluate((element) => ({
    vertical: element.scrollHeight - element.clientHeight,
    horizontal: element.scrollWidth - element.clientWidth,
  }));
  expect(cellOverflow.vertical).toBeLessThanOrEqual(1);
  expect(cellOverflow.horizontal).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 3: Run the affected E2E tests**

Run: `npx playwright test tests/e2e/program.spec.ts tests/e2e/responsive.spec.ts`

Expected: PASS. The Playwright config builds and starts `vite preview` on port 4173; if an old preview server is already running, stop it first so the new build is served.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/program.spec.ts tests/e2e/responsive.spec.ts
git commit -m "test: cover schedule wrapping and mobile day view"
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

Create a temporary `C:\koçluk\.preview-screenshots.mjs` (do not commit; delete after use). It imports `chromium` from `@playwright/test` and, for each viewport `[390, 844]`, `[768, 900]`, `[1440, 900]`:

1. Opens a fresh context with that viewport and goes to `http://localhost:4173/kocluk/`.
2. Completes onboarding: `Adın` = `Önizleme`, `İleri`, `Tümü`, `İleri`, `Mavi`, `İleri`, `Başla`.
3. Goes to `http://localhost:4173/kocluk/#/program`.
4. Fills `1. satır ders` with `Matematik` and `1. satır Pazartesi` with
   `Türev tekrarı, 40 soru çözümü, yanlış analizi ve eksik konuların listesi`.
5. Saves a full-page screenshot to
   `C:\Users\user\AppData\Local\Temp\opencode\schedule-preview\<width>.png`.

Run: `node .preview-screenshots.mjs`, then delete the script.

Expected: 390 px shows one day + day buttons; 768 px shows all seven days fitted; long text is fully visible in all three.

- [ ] **Step 6: Report to the user**

Report the commands and results, show the screenshots, and wait for approval before any push.
