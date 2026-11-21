# Çizelge Tik Modu ve Ders Sütunu Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hücre başına tik onay kutularını kaldırıp üstte bir “Tik modu” düğmesi eklemek; mod açıkken gün hücrelerine dokunarak tik atmak ve en soldaki ders/etkinlik metnini 18 px’e büyütüp kendi kutusunun ortasına almak.

**Architecture:** Tik modu yerel bir `useState` bayrağıdır; açıkken gün hücreleri metin alanı yerine `aria-pressed` taşıyan bir `<button>` gösterir ve dokunma `done` tuple’ını mevcut `setDraft`/otomatik kaydetme yolundan değiştirir. `AutoGrowTextarea` bir `variant` prop’u alır: gün/toplam hücreleri `cell` (14 px, solda), ders hücresi `subject` (18 px, ortada). Veri modeli, yedek ve “Tüm tikleri kaldır” değişmez.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Vitest + React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-schedule-tick-mode-design.md`

## Global Constraints

- Node.js `>=22.22.2`; yeni bağımlılık eklenmez.
- Tüm arayüz metinleri Türkçe; mevcut `Button`, `cn`, `lucide-react` desenleri.
- Tik verisi, `done` tuple’ı, repository normalizasyonu, yedek şeması ve otomatik kaydetme değişmez.
- Tik modu kalıcı değildir; sayfa yenilenince kapalı başlar. Tik durumu kalıcıdır.
- Tik modu yalnızca gün hücrelerini etkiler; ders, toplam ve toplam satırı değişmez.
- Ders sütunu `text-lg` (18 px), `text-center`, `py-3`; gün/toplam `text-sm` (14 px), solda.
- Dokunma hedefleri en az 44 px.
- 360 px’te sayfa düzeyinde yatay kaydırma olmaz.
- Branş denemeleri bu planın kapsamı dışındadır.
- Çalışma dalı `feat/schedule-tick-mode`; kullanıcı önizlemeyi onaylamadan push yok.
- Tüm alt ajanlar `opencode-go/deepseek-v4.1-flash#max` modelini kullanır.

## Review Focus

1. **Mod kalıcılığı:** Tik modu yenilemede kapanmalı; tik verisi korunmalı. Test: Task 1.
2. **Dokunma/düzenleme ayrımı:** Mod açıkken metin düzenlenmemeli; kapatınca metin alanı ve değer geri gelmeli. Test: Task 1.
3. **Ders sütunu:** 18 px ve ortalı olmalı; gün/toplam 14 px kalmalı; uzun ders adı satırı bozmamalı. Test: Task 1 + önizleme.
4. **Tik görünümü:** Tikli hücre `bg-success/10`, yazı `text-muted opacity-80`; boş hücre de tiklenebilmeli. Test: Task 1.
5. **Toplu temizleme:** “Tüm tikleri kaldır” tik modunda atılan tikleri de tek tıkla silmeli ve tik yokken pasif olmalı. Test: Task 1.

---

## File Structure

```
src/features/schedule/AutoGrowTextarea.tsx       variant: cell | subject
src/features/schedule/AutoGrowTextarea.test.tsx  varyant testi
src/features/schedule/ScheduleTableEditor.tsx    tik modu + hücre düğmesi
src/features/schedule/schedule.test.tsx          tik modu + toplu temizleme testleri
tests/e2e/program.spec.ts                        tik modu akışı + reload
docs/superpowers/specs/…                         onaylı tasarım
```

## Task 1: Tik Modu ve Ders Sütunu

**Files:**
- Modify: `src/features/schedule/AutoGrowTextarea.tsx`
- Modify: `src/features/schedule/ScheduleTableEditor.tsx`
- Test: `src/features/schedule/AutoGrowTextarea.test.tsx`
- Test: `src/features/schedule/schedule.test.tsx`
- Test: `tests/e2e/program.spec.ts`

**Interfaces:**
- Consumes: `ScheduleTableRow.done`, `emptyScheduleTableDoneCells`, `updateRowDone`.
- Produces:

```ts
export interface AutoGrowTextareaProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  maxLength: number;
  placeholder?: string;
  className?: string;
  variant?: 'cell' | 'subject';
}
```

- No exported API change in `ScheduleTableEditor`; the tick mode is local state.
- Day cells expose `data-done="true"` when ticked.

- [ ] **Step 1: Write the failing component variant test**

Append to `src/features/schedule/AutoGrowTextarea.test.tsx`:

```tsx
test('subject varyantı 18 px, ortalı ve ferah metin kullanır', () => {
  render(
    <AutoGrowTextarea
      variant="subject"
      value="Matematik"
      onChange={() => {}}
      label="1. satır ders"
      maxLength={80}
    />,
  );

  expect(screen.getByLabelText('1. satır ders')).toHaveClass(
    'text-lg',
    'text-center',
    'py-3',
  );
});
```

- [ ] **Step 2: Replace the tick and clear-all UI tests**

In `src/features/schedule/schedule.test.tsx`, replace the existing
`'gün tiki hücreyi yeşile çevirir…'` test with:

```tsx
test('tik modu hücreyi tikler, geri alır ve yeniden açınca korunur', async () => {
  const view = await openSchedule();
  const table = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  const mode = screen.getByRole('button', { name: 'Tik modu' });
  expect(mode).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(mode);
  expect(mode).toHaveAttribute('aria-pressed', 'true');

  const cell = within(table).getByRole('button', {
    name: '1. satır Pazartesi',
  });
  expect(cell).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(cell);
  expect(cell).toHaveAttribute('aria-pressed', 'true');
  expect(cell.closest('td')).toHaveAttribute('data-done', 'true');
  expect(cell.closest('td')).toHaveClass('bg-success/10');
  expect(cell).toHaveClass('text-muted', 'opacity-80');

  await userEvent.click(cell);
  expect(cell).toHaveAttribute('aria-pressed', 'false');
  expect(cell.closest('td')).not.toHaveAttribute('data-done');
  expect(cell).not.toHaveClass('opacity-80');

  await userEvent.click(cell);
  expect(await screen.findByText('Kaydedilmemiş değişiklikler')).toBeInTheDocument();
  expect(
    await screen.findByText('Kaydedildi', {}, { timeout: 3000 }),
  ).toBeInTheDocument();

  view.unmount();
  await openSchedule();

  const reloaded = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  expect(screen.getByRole('button', { name: 'Tik modu' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  const reloadedCell = within(reloaded).getByLabelText('1. satır Pazartesi');
  expect(reloadedCell.closest('td')).toHaveAttribute('data-done', 'true');
  expect(reloadedCell).toHaveClass('text-muted', 'opacity-80');
});
```

Replace the existing `'tüm tikleri tek düğmeyle kaldırır'` test with:

```tsx
test('tüm tikleri tek düğmeyle kaldırır', async () => {
  await openSchedule();
  const table = await screen.findByRole('table', {
    name: 'Haftalık ders çalışma tablosu',
  });
  const clear = screen.getByRole('button', { name: 'Tüm tikleri kaldır' });
  expect(clear).toBeDisabled();

  await userEvent.click(screen.getByRole('button', { name: 'Tik modu' }));
  await userEvent.click(
    within(table).getByRole('button', { name: '1. satır Pazartesi' }),
  );
  await userEvent.click(
    within(table).getByRole('button', { name: '2. satır Salı' }),
  );
  expect(clear).toBeEnabled();

  await userEvent.click(clear);

  expect(within(table).queryAllByRole('button', { pressed: true })).toHaveLength(0);
  expect(clear).toBeDisabled();
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:run -- src/features/schedule/AutoGrowTextarea.test.tsx src/features/schedule/schedule.test.tsx`

Expected: FAIL — `variant` prop/`text-lg` missing; “Tik modu” button and cell buttons missing.

- [ ] **Step 4: Add the `variant` prop to `AutoGrowTextarea`**

In `AutoGrowTextarea.tsx`:

- add `variant?: 'cell' | 'subject'` to the props;
- keep the base class but remove `py-2 text-sm leading-5`;
- add:

```ts
const variantClass =
  variant === 'subject'
    ? 'py-3 text-center text-lg leading-7'
    : 'py-2 text-left text-sm leading-5';
```

- destructure `variant = 'cell'` and use `className={cn(baseClass, variantClass, className)}`.

- [ ] **Step 5: Implement tick mode and the subject variant in the editor**

In `ScheduleTableEditor.tsx`:

- import `CheckSquare` from `lucide-react`;
- add `const [tickMode, setTickMode] = useState(false);`
- pass `variant="subject"` to the subject `<AutoGrowTextarea>`; keep `className="flex-1"`;
- in the header button group, add before “Tüm tikleri kaldır”:

```tsx
<Button
  variant={tickMode ? 'primary' : 'secondary'}
  aria-pressed={tickMode}
  onClick={() => setTickMode((current) => !current)}
>
  <CheckSquare className="h-4 w-4" aria-hidden="true" />
  Tik modu
</Button>
```

- after the header flex, add:

```tsx
{tickMode ? (
  <p className="text-xs text-muted">Kutulara dokunarak tik at veya kaldır.</p>
) : null}
```

- replace each body day `<td>` content: remove the checkbox `<div>`/`<label>`; set `data-done={row.done[dayIndex] ? 'true' : undefined}` on the `<td>`; render:

```tsx
{tickMode ? (
  <button
    type="button"
    aria-label={`${index + 1}. satır ${SCHEDULE_DAYS[dayIndex].label}${value ? `: ${value}` : ''}`}
    aria-pressed={row.done[dayIndex]}
    onClick={() => updateRowDone(row.id, dayIndex, !row.done[dayIndex])}
    className={cn(
      'min-h-11 w-full whitespace-pre-wrap rounded-lg px-1 py-2 text-left text-sm leading-5 transition-colors [overflow-wrap:anywhere] hover:bg-raised',
      row.done[dayIndex] ? 'text-muted opacity-80' : 'text-fg',
    )}
  >
    {value || '\u00A0'}
  </button>
) : (
  <AutoGrowTextarea
    value={value}
    onChange={(next) => updateRowDay(row.id, dayIndex, next)}
    label={`${index + 1}. satır ${SCHEDULE_DAYS[dayIndex].label}`}
    maxLength={SCHEDULE_TABLE_CELL_MAX_LENGTH}
    className={row.done[dayIndex] ? 'text-muted opacity-80' : undefined}
  />
)}
{!tickMode && row.done[dayIndex] ? (
  <span className="sr-only">Tamamlandı</span>
) : null}
```

- leave the subject, total and footer cells untouched.
- do not persist `tickMode`.

- [ ] **Step 6: Run the focused unit tests**

Run: `npm run test:run -- src/features/schedule/AutoGrowTextarea.test.tsx src/features/schedule/schedule.test.tsx`

Expected: PASS.

- [ ] **Step 7: Update the program E2E for tick mode**

In `tests/e2e/program.spec.ts`, replace the checkbox check:

```ts
await page
  .getByRole('checkbox', { name: '1. satır Pazartesi tamamlandı' })
  .check();
```

with:

```ts
await page.getByRole('button', { name: 'Tik modu' }).click();
await page
  .getByRole('button', { name: /^1\. satır Pazartesi/ })
  .click();
await page.getByRole('button', { name: 'Tik modu' }).click();
```

In the final reload block, replace the checkbox assertion with:

```ts
await expect(page.getByRole('button', { name: 'Tik modu' })).toHaveAttribute(
  'aria-pressed',
  'false',
);
await expect(
  reloadedTable
    .getByLabel('1. satır Pazartesi', { exact: true })
    .locator('..'),
).toHaveAttribute('data-done', 'true');
```

- [ ] **Step 8: Run the affected E2E tests**

Run: `npx playwright test tests/e2e/program.spec.ts tests/e2e/responsive.spec.ts`

Expected: PASS (ensure no stale preview on port 4173).

- [ ] **Step 9: Typecheck and commit**

Run: `npm run typecheck`

Expected: exit code 0.

```bash
git add src/features/schedule/AutoGrowTextarea.tsx src/features/schedule/AutoGrowTextarea.test.tsx src/features/schedule/ScheduleTableEditor.tsx src/features/schedule/schedule.test.tsx tests/e2e/program.spec.ts
git commit -m "feat: add schedule tick mode and larger subject text"
```

## Task 2: Tam Doğrulama ve Önizleme

**Files:** none.

- [ ] **Step 1: Full unit suite**

Run: `npm run test:run`

Expected: all tests pass.

- [ ] **Step 2: Typecheck and build**

Run: `npm run typecheck`

Expected: exit code 0.

Run: `npm run build`

Expected: `dist/` produced without errors.

- [ ] **Step 3: Full E2E**

Run: `npm run test:e2e`

Expected: all Playwright tests pass.

- [ ] **Step 4: Preview screenshots**

Run `npm run preview -- --port 4173 --strictPort` and use a temporary script
(do not commit; delete after) for `360×800`, `390×844`, `768×900`, `1024×900`,
`1440×900`:

1. complete onboarding;
2. open `#/program`;
3. fill `Matematik` and a long `1. satır Pazartesi` text;
4. click “Tik modu”, click `1. satır Pazartesi`, then click “Tik modu” again;
5. wait for `Kaydedildi`;
6. save `<width>.png` and, for 390 only, a second `390-tik-modu.png` with the
   mode still open.

Expected: no per-cell checkboxes; subject text 18 px and centered; ≥768 px day
cells still wide; ticked cell green/faded; mode button clear in the header.

- [ ] **Step 5: Report and wait for approval**

Report commands/results and screenshots; no push without approval.
