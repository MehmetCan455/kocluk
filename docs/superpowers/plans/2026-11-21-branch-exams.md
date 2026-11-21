# Branş Denemeleri Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tam denemelerden ayrı, tek branşlı TYT/AYT branş denemeleri kaydetmek; bunları ayrı Branş sekmesinde listeleyip grafikleştirmek; ana sayfa ve normal TYT/AYT istatistiklerini etkilememek.

**Architecture:** `Exam` kaydına `kind: 'full' | 'branch'` ve branş denemelerinde `branch` eklenir. Branş sonucu mevcut `ExamResult` tablosunda `subjectId = branch` olan tek satır olarak tutulur. Branş kataloğu TYT/AYT alan gruplarını ve soru sayılarını tanımlar; form, liste, grafik ve dashboard bu alanlara göre filtreler. Yeni tablo ve IndexedDB sürüm artışı yoktur; yedek biçimi v5’e çıkar.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS 4, Dexie/IndexedDB, zod, Chart.js, Vitest + React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-21-branch-exams-design.md`

## Global Constraints

- Node.js `>=22.22.2`; yeni bağımlılık eklenmez.
- Tüm arayüz metinleri Türkçe; mevcut `Card`, `Button`, `Field`, `cn`, `NetTrendChart` desenleri.
- Branş denemesi TYT veya AYT; AYT’de somut alan (`sayisal`/`ea`/`sozel`) zorunlu.
- Branş kataloğu ve soru sayıları spec’teki tabloyla birebir aynıdır.
- Branş denemesinde en fazla bir `ExamResult` satırı; `subjectId === branch`.
- `Exam.kind` yoksa tam deneme sayılır; eski kayıtlar ve eski yedekler bozulmaz.
- IndexedDB şema sürümü artmaz; `BACKUP_SCHEMA_VERSION` 4 → 5 olur.
- Ana sayfa net grafiği, net ortalaması, en yüksek net ve son denemeler yalnızca tam denemeleri sayar.
- Normal TYT/AYT sekmeleri ve grafikleri yalnızca tam denemeleri gösterir.
- Branş denemelerinde yanlış fotoğrafı yükleme ve pratik/fotoğraf deneme seçicilerinde görünme yoktur.
- Çalışma dalı `feat/branch-exams`; kullanıcı önizlemeyi onaylamadan push yok.
- Tüm alt ajanlar `opencode-go/deepseek-v4.1-flash#max` modelini kullanır.

## Review Focus

1. **Eski veri:** `kind` alanı olmayan denemeler tam deneme sayılmalı; Branş sekmesinde/ana istatistiklerde yanlış yere düşmemeli. Test: Task 1, 2, 4, 5.
2. **Ana istatistikler:** Branş denemesi ana sayfa net grafiğini, ortalamayı, en yüksek neti, “son denemeler”i ve TYT/AYT grafiklerini değiştirmemeli. Test: Task 5.
3. **Branş doğrulaması:** Yanlış tür/alan/branş, birden çok sonuç satırı ve soru sayısını aşan D/Y/B reddedilmeli; geçerli branş tek satırla kaydedilmeli. Test: Task 2.
4. **Yedek uyumu:** v4 eski yedek tam deneme olarak açılmalı; v5 branş denemesi round-trip yapmalı; tutarsız branş satırı reddedilmeli. Test: Task 2.
5. **Branş akışı:** Branş sekmesi varsayılanları, “Yeni deneme” ön dolgusu, kayıttan sonra detay ve düzenleme kilidi çalışmalı. Test: Task 3, 4, 6.

---

## File Structure

```
src/domain/types.ts                              ExamKind, BranchExamKey, Exam.kind/branch
src/features/exams/branchConfig.ts               katalog + yardımcılar
src/features/exams/branchConfig.test.ts          katalog testleri
src/db/repositories.ts                           SaveExamInput, saveExam doğrulaması, listFullExams
src/db/exams.test.ts                             repository branş/eski kayıt testleri
src/db/backup.ts                                 v5 + examSchema kind/branch
src/db/backup.test.ts                            branş/eski/tutarsız yedek testleri
src/features/exams/ExamFormPage.tsx              branş modu
src/features/exams/exams.test.tsx                form + liste testleri
src/features/exams/ExamsPage.tsx                 üçlü filtre + Branş sekmesi
src/features/exams/ExamDetailPage.tsx            branş detayı
src/features/dashboard/DashboardPage.tsx         tam deneme filtreleri
src/features/dashboard/dashboard.test.tsx        ana istatistik testleri
src/features/search/searchAll.ts                 branş arama etiketi
src/features/search/search.test.ts               arama testi
src/features/photos/PhotoUpload.tsx              tam deneme seçici
src/features/photos/PhotosPage.tsx               tam deneme filtresi
src/features/practice/PracticeWizard.tsx         tam deneme seçici
tests/e2e/branch-exams.spec.ts                   branş E2E
```

## Task 1: Türler ve Branş Kataloğu

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/features/exams/branchConfig.ts`
- Test: `src/features/exams/branchConfig.test.ts`

**Interfaces:**
- Produces:

```ts
export type ExamKind = 'full' | 'branch';

export type BranchExamKey =
  | 'tyt-turkce' | 'tyt-sosyal' | 'tyt-matematik' | 'tyt-fen'
  | 'ayt-sayisal-matematik' | 'ayt-sayisal-fen'
  | 'ayt-ea-matematik' | 'ayt-ea-edebiyat-sosyal-1'
  | 'ayt-sozel-edebiyat-sosyal-1' | 'ayt-sozel-sosyal-2';

export interface Exam {
  // mevcut alanlar
  kind?: ExamKind;
  branch?: BranchExamKey;
}
```

`branchConfig.ts`:

```ts
export interface BranchExamConfig {
  key: BranchExamKey;
  type: ExamType;
  alan?: Exclude<AytAlan, 'tumu'>;
  label: string;
  questionCount: number;
}
export const BRANCH_EXAMS: readonly BranchExamConfig[];
export function getBranchExam(key: string): BranchExamConfig | undefined;
export function branchesFor(
  type: ExamType,
  alan?: Exclude<AytAlan, 'tumu'>,
): BranchExamConfig[];
export function isBranchExam(exam: Pick<Exam, 'kind'>): boolean;
export function branchDisplayLabel(config: BranchExamConfig): string;
```

- [ ] **Step 1: Write the failing catalog test**

Create `src/features/exams/branchConfig.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  BRANCH_EXAMS,
  branchDisplayLabel,
  branchesFor,
  getBranchExam,
  isBranchExam,
} from './branchConfig';

test('branş kataloğu TYT ve AYT soru sayılarını doğru verir', () => {
  expect(branchesFor('TYT').map((b) => [b.key, b.questionCount])).toEqual([
    ['tyt-turkce', 40],
    ['tyt-sosyal', 20],
    ['tyt-matematik', 40],
    ['tyt-fen', 20],
  ]);
  expect(branchesFor('AYT', 'sayisal').map((b) => [b.key, b.questionCount])).toEqual([
    ['ayt-sayisal-matematik', 40],
    ['ayt-sayisal-fen', 40],
  ]);
  expect(branchesFor('AYT', 'ea').map((b) => b.key)).toEqual([
    'ayt-ea-matematik',
    'ayt-ea-edebiyat-sosyal-1',
  ]);
  expect(branchesFor('AYT', 'sozel').map((b) => b.key)).toEqual([
    'ayt-sozel-edebiyat-sosyal-1',
    'ayt-sozel-sosyal-2',
  ]);
  expect(BRANCH_EXAMS).toHaveLength(10);
});

test('branş etiketi ve bilinmeyen anahtar davranışı', () => {
  expect(getBranchExam('tyt-sosyal')).toMatchObject({
    label: 'Sosyal',
    questionCount: 20,
    type: 'TYT',
  });
  expect(getBranchExam('bilinmeyen')).toBeUndefined();
  expect(branchDisplayLabel(getBranchExam('ayt-sayisal-fen')!)).toBe(
    'AYT Sayısal · Fen',
  );
});

test('isBranchExam eski kaydı tam deneme sayar', () => {
  expect(isBranchExam({})).toBe(false);
  expect(isBranchExam({ kind: 'full' })).toBe(false);
  expect(isBranchExam({ kind: 'branch' })).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/exams/branchConfig.test.ts`

Expected: FAIL — module/type missing.

- [ ] **Step 3: Implement types and catalog**

Add `ExamKind`, `BranchExamKey`, `kind?`, `branch?` to `src/domain/types.ts`.
Create `branchConfig.ts` with the 10 exact catalog rows from the spec,
`branchesFor` filtering type/alan, `getBranchExam` via a `Map`, and
`branchDisplayLabel` returning `TYT · <label>` or
`AYT <Alan> · <label>` (`Sayısal` / `Eşit Ağırlık` / `Sözel`). `isBranchExam`
returns `exam.kind === 'branch'`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/features/exams/branchConfig.test.ts`

Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`

```bash
git add src/domain/types.ts src/features/exams/branchConfig.ts src/features/exams/branchConfig.test.ts
git commit -m "feat: add branch exam catalog"
```

## Task 2: Repository ve Yedek Desteği

**Files:**
- Modify: `src/db/repositories.ts`
- Modify: `src/db/backup.ts`
- Test: `src/db/exams.test.ts` (new)
- Test: `src/db/backup.test.ts`

**Interfaces:**
- Consumes: `ExamKind`, `BranchExamKey`, `getBranchExam`, `branchesFor`.
- Produces:

```ts
export interface SaveExamInput {
  // mevcut alanlar
  kind?: ExamKind;
  branch?: BranchExamKey;
}

export async function listFullExams(type?: ExamType): Promise<Exam[]>;
```

- [ ] **Step 1: Write the failing repository test**

Create `src/db/exams.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest';
import { db } from '@/db/db';
import {
  getExam,
  listExamResults,
  listFullExams,
  saveExam,
} from '@/db/repositories';
import { resetDb } from '@/test/fixtures';

beforeEach(resetDb);

test('branş denemesini tek sonuç satırıyla kaydeder', async () => {
  const saved = await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'TYT Sosyal 1',
    date: '2026-11-20',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });

  expect(saved).toMatchObject({ kind: 'branch', branch: 'tyt-sosyal' });
  const [result] = await listExamResults(saved.id);
  expect(result).toMatchObject({
    subjectId: 'tyt-sosyal',
    correct: 15,
    wrong: 3,
    blank: 2,
  });
  expect(result.net).toBeCloseTo(14.25);
  expect((await getExam(saved.id))?.kind).toBe('branch');
  expect(await listFullExams('TYT')).toEqual([]);
});

test('branş doğrulamaları Türkçe hata verir', async () => {
  const base = {
    kind: 'branch' as const,
    type: 'TYT' as const,
    branch: 'tyt-sosyal' as const,
    name: 'Hatalı',
    date: '2026-11-20',
  };

  await expect(
    saveExam({
      ...base,
      results: [{ subjectId: 'tyt-fen', correct: 1, wrong: 0, blank: 0 }],
    }),
  ).rejects.toThrow('Branş sonucu branşla eşleşmiyor');

  await expect(
    saveExam({
      ...base,
      type: 'AYT',
      alan: 'sayisal',
      branch: 'ayt-ea-matematik',
      results: [],
    }),
  ).rejects.toThrow('Branş AYT alanıyla eşleşmiyor');

  await expect(
    saveExam({
      ...base,
      results: [
        { subjectId: 'tyt-sosyal', correct: 1, wrong: 0, blank: 0 },
        { subjectId: 'tyt-fen', correct: 1, wrong: 0, blank: 0 },
      ],
    }),
  ).rejects.toThrow('Branş denemesinde tek sonuç satırı olabilir');

  await expect(
    saveExam({
      ...base,
      kind: 'full',
      results: [],
    }),
  ).rejects.toThrow('Tam denemede branş seçilemez');

  await expect(
    saveExam({
      ...base,
      results: [{ subjectId: 'tyt-sosyal', correct: 20, wrong: 1, blank: 0 }],
    }),
  ).rejects.toThrow('Doğru, yanlış ve boş toplamı 20 soruyu aşıyor');
});

test('kind alanı olmayan eski deneme tam deneme sayılır', async () => {
  await db.exams.put({
    id: 'eski',
    type: 'TYT',
    name: 'Eski TYT',
    date: '2026-01-01',
    note: '',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  expect((await getExam('eski'))?.kind).toBeUndefined();
  expect((await listFullExams('TYT')).map((exam) => exam.id)).toEqual(['eski']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/db/exams.test.ts`

Expected: FAIL — branch fields/validation/listFullExams missing.

- [ ] **Step 3: Implement repository support**

In `src/db/repositories.ts`:

- add `kind?: ExamKind`, `branch?: BranchExamKey` to `SaveExamInput`;
- import `getBranchExam` and `isAytBranch` (or compare against `'sayisal'|'ea'|'sozel'`);
- in `saveExam`, compute `const kind = input.kind ?? 'full';` and validate:
  - branch: known config; `config.type === input.type`; TYT requires no `alan`;
    AYT requires a concrete `alan` and `config.alan === input.alan`;
  - results length ≤ 1, `subjectId === input.branch`, and
    `correct + wrong + blank <= config.questionCount`;
  - full: `input.branch` must be undefined;
- write `kind` and `branch` (only for branch) into the stored `Exam`;
- add:

```ts
export async function listFullExams(type?: ExamType): Promise<Exam[]> {
  return (await listExams(type)).filter((exam) => exam.kind !== 'branch');
}
```

- [ ] **Step 4: Update backup schema/version**

In `src/db/backup.ts`:

- `BACKUP_SCHEMA_VERSION = 5`;
- `examSchema` add `kind: z.enum(['full', 'branch']).default('full')` and
  `branch: z.string().optional()`;
- `.superRefine` on `examSchema`: if `kind === 'branch'`, `branch` is required,
  known via `getBranchExam`, matches `type` and (for AYT) `alan`; if
  `kind === 'full'`, `branch` must be undefined.

- [ ] **Step 5: Add backup tests**

In `src/db/backup.test.ts` add a branch exam round-trip (save via `saveExam`
with `kind: 'branch'`, export, inspect `veri.json`, reset, import, assert
`getExam` and the single result), a v4 legacy backup test (strip `kind`/`branch`
from exams and set manifest `schemaVersion: 4`; import as full), and an invalid
branch test (stub an unknown/mismatched `branch`; import rejects with
`Geçersiz yedek dosyası`).

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npm run test:run -- src/db/exams.test.ts src/db/backup.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories.ts src/db/backup.ts src/db/exams.test.ts src/db/backup.test.ts
git commit -m "feat: persist branch exams and backups"
```

## Task 3: Deneme Formu — Branş Modu

**Files:**
- Modify: `src/features/exams/ExamFormPage.tsx`
- Test: `src/features/exams/exams.test.tsx`

**Interfaces:**
- Consumes: `BranchExamKey`, `branchesFor`, `getBranchExam`, `isBranchExam`, `saveExam` kind/branch.
- Produces: form supports `?brans=1&tur=TYT|AYT&alan=...&branch=...`, emits
  `kind`/`branch` and one result row; after create navigates to `/denemeler/:id`.

- [ ] **Step 1: Write the failing form tests**

Append to `src/features/exams/exams.test.tsx`:

```tsx
test('TYT branş denemesi tek satırla kaydedilir', async () => {
  renderApp('/denemeler/yeni?brans=1&tur=TYT&branch=tyt-sosyal');
  await userEvent.type(await screen.findByLabelText('Deneme adı'), 'TYT Sosyal 1');
  await userEvent.type(screen.getByLabelText('Sosyal doğru'), '15');
  await userEvent.type(screen.getByLabelText('Sosyal yanlış'), '3');
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  expect(
    await screen.findByRole('heading', { level: 1, name: 'TYT Sosyal 1' }),
  ).toBeInTheDocument();
  const exams = await listExams('TYT');
  expect(exams).toHaveLength(1);
  expect(exams[0]).toMatchObject({ kind: 'branch', branch: 'tyt-sosyal' });
  const results = await listExamResults(exams[0].id);
  expect(results).toMatchObject([{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3 }]);
});

test('AYT branş denemesi alanına göre branş seçenekleri sunar', async () => {
  renderApp('/denemeler/yeni?brans=1&tur=AYT&alan=sayisal');
  await userEvent.type(await screen.findByLabelText('Deneme adı'), 'AYT Fen 1');
  const branch = screen.getByLabelText('Branş');
  expect(branch).toHaveDisplayValue('Branş seç');
  await userEvent.selectOptions(branch, 'ayt-sayisal-fen');
  await userEvent.type(screen.getByLabelText('Fen doğru'), '30');
  await userEvent.type(screen.getByLabelText('Fen yanlış'), '6');
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  const exams = await listExams('AYT');
  expect(exams[0]).toMatchObject({
    kind: 'branch',
    branch: 'ayt-sayisal-fen',
    alan: 'sayisal',
  });
});

test('branş denemesi düzenlemede tür/alan/branş kilitlidir', async () => {
  const saved = await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'Düzenlenecek',
    date: '2026-11-20',
    results: [{ subjectId: 'tyt-sosyal', correct: 10, wrong: 2, blank: 8 }],
  });
  renderApp(`/denemeler/${saved.id}/duzenle`);

  expect(await screen.findByRole('button', { name: 'Branş denemesi' })).toBeDisabled();
  expect(screen.getByLabelText('Deneme türü')).toBeDisabled();
  expect(screen.getByLabelText('Branş')).toBeDisabled();
  expect(screen.getByLabelText('Sosyal doğru')).toHaveValue(10);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/features/exams/exams.test.tsx`

Expected: FAIL — branch UI/state missing.

- [ ] **Step 3: Implement branch mode in the form**

In `ExamFormPage.tsx`:

- read `brans`, `tur`, `alan`, `branch` from `useSearchParams` for create; default
  `kind = 'full'`, type `TYT`;
- add `kind: ExamKind` and `branch: BranchExamKey | ''` state;
- render a “Deneme biçimi” group with two buttons (`Tam deneme`,
  `Branş denemesi`, `aria-pressed`); disable both when editing;
- render TYT branch select (`Branş`) or AYT alan select + branch select;
  options from `branchesFor(type, alan)`;
- when branch, replace the subject result rows with one branch row:
  label from `getBranchExam(branch)`, question count, D/Y inputs
  (labels `${label} doğru`/`${label} yanlış`), B and Net; reuse
  `parseCounts` with the branch question count;
- when editing a branch exam, load `kind`/`branch` and the result whose
  `subjectId === branch`; disable kind/type/alan/branch;
- `canSave` requires a branch and (for AYT) a concrete alan;
- `handleSubmit` sends `kind`, `branch` and either one result row
  (`subjectId: branch`) or `[]`; branch creates navigate to
  `/denemeler/${saved.id}`;
- full mode keeps the current behavior/tests.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm run test:run -- src/features/exams/exams.test.tsx`

Expected: PASS (existing + 3 new).

Run: `npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/features/exams/ExamFormPage.tsx src/features/exams/exams.test.tsx
git commit -m "feat: add branch exam form mode"
```

## Task 4: Denemeler Sayfası — Branş Sekmesi

**Files:**
- Modify: `src/features/exams/ExamsPage.tsx`
- Test: `src/features/exams/exams.test.tsx`

**Interfaces:**
- Consumes: `isBranchExam`, `branchesFor`, `getBranchExam`, `listExams`, `buildNetSeries`, `buildExamComparison`.
- Produces: top filter `TYT | AYT | Branş` (`tur=BRANS`), branch sub-filters and chart/list.

- [ ] **Step 1: Write the failing page tests**

Append to `src/features/exams/exams.test.tsx`:

```tsx
test('branş denemesi ayrı sekmede grafiklenir, tam deneme sekmesine girmez', async () => {
  await saveExam({
    kind: 'full',
    type: 'TYT',
    name: 'Tam TYT',
    date: '2026-11-18',
    results: [{ subjectId: turkceId, correct: 30, wrong: 5, blank: 5 }],
  });
  await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'TYT Sosyal 1',
    date: '2026-11-19',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });

  const view = renderApp('/denemeler');
  expect(await screen.findByText('Tam TYT')).toBeInTheDocument();
  expect(screen.queryByText('TYT Sosyal 1')).not.toBeInTheDocument();
  expect(screen.getByText('1 TYT denemesi')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Branş' }));
  expect(await screen.findByText('TYT Sosyal 1')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Branş'), 'tyt-sosyal');
  expect(await screen.findByText('TYT Sosyal branş denemeleri')).toBeInTheDocument();
  expect(screen.getByText('1 branş denemesi')).toBeInTheDocument();
  expect(screen.queryByText('Tam TYT')).not.toBeInTheDocument();
  view.unmount();
});
```

(`turkceId` is the seeded TYT Türkçe subject id; use the existing fixture
lookup helper or query `db.subjects`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/exams/exams.test.tsx`

Expected: FAIL — Branş filter/tab missing.

- [ ] **Step 3: Implement the Branş tab**

In `ExamsPage.tsx`:

- extend the top filter to `TYT | AYT | Branş`; `BRANS` uses `tur=BRANS`;
- full rows/chart: `data.rows.filter(!isBranchExam && type)`, full exam list for
  `buildNetSeries`, `buildSubjectNetSeries`, and `buildExamComparison`;
- branch state: `branchType` (TYT/AYT), `branchAlan`
  (`settings.aytAlan` concrete or `sayisal`), `selectedBranch`
  (`branchesFor(branchType, branchAlan)[0]?.key ?? ''`);
- branch tab controls: TYT/AYT sub-filter, AYT alan filter, branch select
  (`aria-label="Branş"`); when the type/alan changes reset the branch to the
  first option;
- branch exams: `data.rows.filter(isBranchExam && type === branchType && branch === selectedBranch)`;
- branch chart: `buildNetSeries(branchExams.map(row => row.exam), data.results, branchType, branchType === 'AYT' ? branchAlan : undefined)`; title
  `${branchLabel} branş denemeleri`; description `${points.length} branş denemesi`;
- branch list: same card as full but with a `Branş`/branch label and
  `buildExamComparison(branchExams.map(row => row.exam), data.results, exam, resolveAlan)`;
- full cards compare only full exams;
- branch empty state; “Yeni deneme” link
  `/denemeler/yeni?brans=1&tur=${branchType}&alan=${branchAlan}&branch=${selectedBranch}`;
- full empty state/chart behavior unchanged.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm run test:run -- src/features/exams/exams.test.tsx`

Expected: PASS.

Run: `npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/features/exams/ExamsPage.tsx src/features/exams/exams.test.tsx
git commit -m "feat: add branch exams tab and chart"
```

## Task 5: Detay, Dashboard, Arama ve Seçiciler

**Files:**
- Modify: `src/db/repositories.ts` (`listFullExams` already in Task 2; use it)
- Modify: `src/features/exams/ExamDetailPage.tsx`
- Modify: `src/features/dashboard/DashboardPage.tsx`
- Test: `src/features/dashboard/dashboard.test.tsx`
- Modify: `src/features/search/searchAll.ts`
- Test: `src/features/search/search.test.ts`
- Modify: `src/features/photos/PhotoUpload.tsx`
- Modify: `src/features/photos/PhotosPage.tsx`
- Modify: `src/features/practice/PracticeWizard.tsx`
- Test: `src/features/exams/exams.test.tsx` (detail)

**Interfaces:**
- Consumes: `isBranchExam`, `getBranchExam`, `branchDisplayLabel`, `listFullExams`.
- Produces: branch detail, full-only dashboard/search filters, branch search label.

- [ ] **Step 1: Write failing tests**

In `src/features/exams/exams.test.tsx`:

```tsx
test('branş denemesi detayı tek satır ve branş etiketi gösterir', async () => {
  const saved = await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'TYT Sosyal Detay',
    date: '2026-11-20',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });
  renderApp(`/denemeler/${saved.id}`);
  expect(await screen.findByText('Branş')).toBeInTheDocument();
  expect(screen.getByText('Sosyal')).toBeInTheDocument();
  expect(screen.getByText('15')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Yanlış fotoğrafları' })).not.toBeInTheDocument();
});
```

In `src/features/dashboard/dashboard.test.tsx`:

```tsx
test('branş denemesi ana sayfa net kartlarını ve son denemeleri değiştirmez', async () => {
  await saveExam({
    kind: 'full',
    type: 'TYT',
    name: 'Tam TYT',
    date: '2026-11-18',
    results: [{ subjectId: turkceId, correct: 30, wrong: 5, blank: 5 }],
  });
  await saveExam({
    kind: 'branch',
    type: 'TYT',
    branch: 'tyt-sosyal',
    name: 'Branş Sosyal',
    date: '2026-11-19',
    results: [{ subjectId: 'tyt-sosyal', correct: 15, wrong: 3, blank: 2 }],
  });
  renderApp('/');
  expect(await screen.findByText('1 deneme')).toBeInTheDocument();
  expect(screen.getByText('Tam TYT')).toBeInTheDocument();
  expect(screen.queryByText('Branş Sosyal')).not.toBeInTheDocument();
});
```

In `src/features/search/search.test.ts`, add a result whose subtitle contains
`Branş` and `Sosyal` for a saved branch exam.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/features/exams/exams.test.tsx src/features/dashboard/dashboard.test.tsx src/features/search/search.test.ts`

Expected: FAIL — branch detail/filters/label missing.

- [ ] **Step 3: Implement detail and filters**

- `ExamDetailPage`: detect `isBranchExam`; resolve label with
  `getBranchExam(exam.branch)`; comparison pool = branch exams of the same
  `branch` (full exams for full); render one branch row; hide the photo card.
- `DashboardPage`: `netStatsFor`/`buildNetSeries`/`recentExams`/exam count use
  `listFullExams`/`!isBranchExam`; branch exams never change the chart, average,
  highest or “son denemeler”.
- `searchAll.examSubtitle`: for branch, insert `Branş` and the branch label;
  keep the existing date/net parts; search includes branch exams.
- `PhotoUpload`, `PhotosPage`, `PracticeWizard`: use `listFullExams(type)` so
  branch exams never appear in the exam selectors.
- Full exam detail, charts and dashboard behavior unchanged.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npm run test:run -- src/features/exams/exams.test.tsx src/features/dashboard/dashboard.test.tsx src/features/search/search.test.ts src/features/photos/photos.test.tsx src/features/practice/practice.test.tsx`

Expected: PASS.

Run: `npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add src/features/exams/ExamDetailPage.tsx src/features/dashboard/DashboardPage.tsx src/features/dashboard/dashboard.test.tsx src/features/search/searchAll.ts src/features/search/search.test.ts src/features/photos/PhotoUpload.tsx src/features/photos/PhotosPage.tsx src/features/practice/PracticeWizard.tsx src/features/exams/exams.test.tsx
git commit -m "feat: isolate branch exams from dashboard and selectors"
```

## Task 6: E2E ve Tam Doğrulama

**Files:**
- Create: `tests/e2e/branch-exams.spec.ts`
- Test: existing E2E suites

- [ ] **Step 1: Write the branch E2E**

Create `tests/e2e/branch-exams.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { completeOnboarding, TEST_NAME } from './helpers';

test('branş denemesi eklenir, ayrı sekmede grafiklenir ve ana istatistiğe girmez', async ({
  page,
}) => {
  await completeOnboarding(page, TEST_NAME, 'Tümü');
  await page.getByRole('link', { name: 'Denemeler', exact: true }).click();

  await page.getByRole('button', { name: 'Branş', exact: true }).click();
  await page.getByRole('link', { name: 'Yeni deneme' }).click();
  await page.getByRole('button', { name: 'Branş denemesi' }).click();
  await page.getByLabel('Deneme adı').fill('TYT Sosyal 1');
  await page.getByLabel('Branş').selectOption('tyt-sosyal');
  await page.getByLabel('Sosyal doğru').fill('15');
  await page.getByLabel('Sosyal yanlış').fill('3');
  await page.getByRole('button', { name: 'Kaydet' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'TYT Sosyal 1' })).toBeVisible();
  await expect(page.getByText('Branş', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Denemeler', exact: true }).click();
  await expect(page.getByText('TYT Sosyal 1')).toBeVisible();
  await expect(page.getByText('TYT Sosyal branş denemeleri')).toBeVisible();

  await page.getByRole('button', { name: 'TYT', exact: true }).click();
  await expect(page.getByText('TYT Sosyal 1')).not.toBeVisible();
  await page.getByRole('link', { name: 'Ana Sayfa', exact: true }).click();
  await expect(page.getByText('TYT Sosyal 1')).not.toBeVisible();
});
```

- [ ] **Step 2: Run the new E2E**

Run: `npx playwright test tests/e2e/branch-exams.spec.ts`

Expected: PASS. Stop any stale preview on 4173 first.

- [ ] **Step 3: Full unit suite**

Run: `npm run test:run`

Expected: all tests pass.

- [ ] **Step 4: Typecheck and build**

Run: `npm run typecheck`

Run: `npm run build`

- [ ] **Step 5: Full E2E**

Run: `npm run test:e2e`

Expected: all Playwright tests pass.

- [ ] **Step 6: Preview**

Start `npm run preview -- --port 4173 --strictPort`; capture 390/768/1440
screenshots of the Branş tab (chart/list), branch form (TYT and AYT), branch
detail, and dashboard showing branch exams excluded. Save under
`C:\Users\user\AppData\Local\Temp\opencode\branch-exams-preview\`; report and
wait for approval before push.
