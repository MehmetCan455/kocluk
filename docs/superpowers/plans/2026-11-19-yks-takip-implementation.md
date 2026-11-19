# Koçluk — YKS Takip Uygulaması Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TYT/AYT derslerini, kitap-test ilerlemesini, denemeleri, konu notlarını ve yanlış fotoğraflarını tek yerde tutan, telefon/tablet/PC'de çalışan, verisi cihazda kalan bir PWA kurmak.

**Architecture:** Tek sayfalık React uygulaması; veri IndexedDB'de (Dexie), yönlendirme HashRouter ile, yayın statik olarak GitHub Pages'te. Sunucu, hesap ve otomatik senkron yok. Tüm özellikler istemcide; yedekleme zip ile.

**Tech Stack:** React 19, TypeScript, Vite 7, Tailwind CSS 4, Dexie 4, React Router 7 (HashRouter), Zustand, TipTap, Chart.js, JSZip, zod, DOMPurify, date-fns, lucide-react, vite-plugin-pwa, Vitest + React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-yks-takip-design.md`

## Global Constraints

- Tüm arayüz metinleri Türkçe; tarih/sayı biçimi `tr-TR` (ondalık virgül, `19 Kas 2026`).
- Tema yalnızca koyu; zemin `#07080A`. Vurgu rengi CSS değişkenleriyle (`--accent`, `--accent-soft`, `--accent-strong`, `--accent-contrast`) uygulanır.
- Veri yalnızca cihazda; çalışma zamanında dış ağ isteği, analitik, hesap, bulut yok.
- Mobil öncelikli; 360 px genişlikte yatay kaydırma yok, dokunma hedefleri ≥44×44 px.
- Yönlendirme `HashRouter`; üretim taban yolu `/kocluk/`.
- Tüm ID'ler `crypto.randomUUID()`; tarihler ISO string (`YYYY-MM-DD` veya tam ISO).
- Doğrulama: test sayıları tam sayı, `totalTests >= 1`, `0 <= solvedTests <= totalTests`.
- Net: `correct - wrong / 4`; iki ondalık, `tr-TR`.
- Not HTML'i her gösterimde ve içe aktarmada DOMPurify ile temizlenir.
- Yedek zip'i `schemaVersion` taşır; geri yükleme mevcut veriyi atomik olarak değiştirir.
- Public GitHub repo; repoya kişisel veri veya gerçek yedek konmaz.
- Her görev kendi testini içerir; görev sonunda `npm test -- --run` ve `npm run typecheck` geçer.

## Review Focus

1. **Silme sırasında veri kaybı:** Bir deneme, kitap veya özel konu silindiğinde fotoğraflar/notlar sessizce kaybolmamalı; bağlantı kopmalı, onay etkilenen kayıtları göstermeli. Testler: Task 3, 8, 9, 13.
2. **Türkçe yerelleştirme:** `İ/ı` araması, virgüllü net ve tarih biçimi yanlış olmamalı. Testler: Task 2, 12.
3. **Fotoğraf yükleme:** HEIC/kota/canvas hatası kullanıcıya anlaşılır hata vermeli; yükleme yarıda kalmamalı. Testler: Task 13 + manuel iOS/Android.
4. **Rastgele test durumu:** Doğru/yanlış/boş geçişleri ve yarıda kalan oturumun devamı kaybolmamalı. Testler: Task 14.
5. **PWA/offline ve taban yol:** GitHub Pages `/kocluk/` altında kurulum, ilk yükleme sonrası çevrimdışı açılış ve güncelleme çalışmalı. Testler: Task 16 + manuel.

---

## File Structure

```
C:\koçluk\
  package.json
  vite.config.ts
  vitest.config.ts
  playwright.config.ts
  tsconfig.json
  tsconfig.node.json
  index.html
  public/
    favicon.svg
    icons/                    # PWA ikonları (üretilir)
  src/
    main.tsx
    App.tsx                   # HashRouter kabuğu
    app/
      routes.tsx              # AppRoutes (testlerde MemoryRouter ile)
      AppShell.tsx
      SettingsProvider.tsx
      theme.ts
      PwaUpdateToast.tsx
    components/
      ui/                     # Button, Card, ProgressBar, RingProgress,
                              # Modal, Drawer, Toast, EmptyState, Field, Tabs
      layout/                 # Sidebar, BottomNav, TopBar
    data/
      curriculum.ts           # 22 ders + ünite düzeyi konular
      alanSubjects.ts         # AYT alanı → görünür dersler
      accentPalettes.ts
      subjectIcons.ts
    db/
      db.ts                   # Dexie şeması
      repositories.ts         # veri erişimi
      seed.ts                 # seedCurriculum
      backup.ts               # export/import
    domain/
      types.ts
      calculations.ts
      validation.ts
    features/
      onboarding/Onboarding.tsx
      dashboard/DashboardPage.tsx
      dashboard/NetTrendChart.tsx
      dashboard/chartData.ts
      subjects/SubjectsPage.tsx
      subjects/SubjectPage.tsx
      topics/TopicPage.tsx
      topics/TestsTab.tsx
      topics/TopicBookForm.tsx
      books/BooksPage.tsx
      books/BookDetailPage.tsx
      exams/ExamsPage.tsx
      exams/ExamFormPage.tsx
      exams/ExamDetailPage.tsx
      notes/NotesTab.tsx
      notes/NoteEditor.tsx
      notes/AttachmentList.tsx
      photos/PhotosPage.tsx
      photos/PhotoUpload.tsx
      photos/PhotoDetail.tsx
      photos/PhotoFilters.tsx
      practice/PracticeWizard.tsx
      practice/PracticeSessionPage.tsx
      practice/practiceSelection.ts
      search/SearchModal.tsx
      search/searchAll.ts
      settings/SettingsPage.tsx
      settings/AccentPicker.tsx
      settings/SubjectVisibility.tsx
      settings/BackupPanel.tsx
      settings/StoragePanel.tsx
      settings/InstallGuide.tsx
    lib/
      date.ts
      format.ts
      id.ts
      image.ts
      normalize.ts
      progress.ts
      sanitize.ts
      zip.ts
    test/
      setup.ts
      fixtures.ts
      renderApp.tsx
    styles/
      index.css
  tests/e2e/
    onboarding.spec.ts
    tracking.spec.ts
    exams.spec.ts
    photos.spec.ts
    backup.spec.ts
  docs/superpowers/specs/2026-11-19-yks-takip-design.md
  docs/superpowers/plans/2026-11-19-yks-takip-implementation.md
```

---

### Task 1: Proje iskeleti ve kalite kapıları

**Files:**
- Create: `package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles/index.css`, `src/test/setup.ts`, `src/App.test.tsx`, `.gitignore`, `README.md`

**Interfaces:**
- Consumes: yok.
- Produces: `App` default React bileşeni; `npm run dev`, `npm run build`, `npm test`, `npm run typecheck` komutları.

- [ ] **Step 1: Repoyu ve araçları kur**

```bash
git init
npm init -y
npm install react react-dom react-router-dom zustand dexie dexie-react-hooks date-fns lucide-react
npm install -D typescript vite @vitejs/plugin-react @types/react @types/react-dom @types/node tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

`package.json` script'leri: `dev`, `build` (`tsc -b && vite build`), `preview`, `test` (`vitest`), `typecheck` (`tsc -b`; tsconfig'lerde `noEmit: true`).

- [ ] **Step 2: Yapılandırmayı yaz**

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/kocluk/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
```

`vitest.config.ts`: `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, `globals: true`, alias `@` → `./src`.

`src/test/setup.ts`: `import '@testing-library/jest-dom/vitest';`

`src/styles/index.css`: `@import "tailwindcss";` + `:root { color-scheme: dark; }` + siyah zemin/metin değişkenleri.

`index.html`: `lang="tr"`, başlık `Koçluk — YKS Takip`, `meta name="theme-color" content="#07080A"`, `<div id="root">`, `/src/main.tsx`.

`.gitignore`: `node_modules`, `dist`, `playwright-report`, `test-results`, `.env*`, `*.local`.

- [ ] **Step 3: Failing testi yaz**

`src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import App from './App';

test('uygulama adını gösterir', () => {
  render(<App />);
  expect(screen.getByText('Koçluk')).toBeInTheDocument();
});
```

- [ ] **Step 4: Testi çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run`
Expected: FAIL — `Failed to resolve import "./App"`.

- [ ] **Step 5: Minimal App'i yaz**

`src/App.tsx`:

```tsx
export default function App() {
  return <main><h1>Koçluk</h1></main>;
}
```

`src/main.tsx`: `createRoot(document.getElementById('root')!).render(<App />);` + `import './styles/index.css';`

- [ ] **Step 6: Testi ve tip kontrolünü çalıştır**

Run: `npm test -- --run && npm run typecheck`
Expected: PASS, 1 test.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore: scaffold React + Vite + Tailwind + Vitest app"
```

---

### Task 2: Domain tipleri ve hesaplamalar

**Files:**
- Create: `src/domain/types.ts`, `src/domain/calculations.ts`, `src/domain/calculations.test.ts`, `src/lib/format.ts`, `src/lib/date.ts`, `src/lib/id.ts`

**Interfaces:**
- Consumes: yok.
- Produces:
  - `ExamType = 'TYT' | 'AYT'`, `AytAlan = 'sayisal' | 'ea' | 'sozel' | 'tumu'`
  - `Subject`, `Topic`, `Book`, `TopicBook`, `Exam`, `ExamResult`, `Photo`, `PhotoFilters`, `Note`, `Attachment`, `PracticeSession`, `PracticeOutcome`, `PracticeFilters`, `AppSettings`, `Progress`
  - `calculateNet(correct: number, wrong: number): number`
  - `calculateProgress(records: Array<{ solvedTests: number; totalTests: number }>): Progress`
  - `formatNet(net: number): string`, `formatPercent(percent: number): string`
  - `daysUntil(date: string, today?: Date): number`
  - `newId(): string` (crypto.randomUUID)

- [ ] **Step 1: Failing testi yaz**

`src/domain/calculations.test.ts`:

```ts
import { calculateNet, calculateProgress } from './calculations';
import { formatNet, formatPercent } from '@/lib/format';
import { daysUntil } from '@/lib/date';

test('net hesaplar', () => {
  expect(calculateNet(30, 8)).toBe(28);
  expect(calculateNet(0, 4)).toBe(-1);
});

test('ilerleme hesaplar', () => {
  expect(calculateProgress([])).toEqual({ solved: 0, total: 0, percent: 0, remaining: 0, started: false, done: false });
  expect(calculateProgress([{ solvedTests: 5, totalTests: 6 }])).toMatchObject({ percent: 83, remaining: 1, started: true, done: false });
  expect(calculateProgress([{ solvedTests: 3, totalTests: 3 }])).toMatchObject({ percent: 100, remaining: 0, done: true });
});

test('tr-TR biçimlendirir', () => {
  expect(formatNet(28)).toBe('28,00');
  expect(formatPercent(83)).toBe('%83');
});

test('gün farkını hesaplar', () => {
  expect(daysUntil('2027-06-19', new Date('2027-06-19T00:00:00'))).toBe(0);
});
```

- [ ] **Step 2: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/domain/calculations.test.ts`
Expected: FAIL — modüller yok.

- [ ] **Step 3: Tipleri ve fonksiyonları yaz**

`src/domain/types.ts`: yukarıdaki arayüzler. Zorunlu alanlar:

```ts
export interface AppSettings {
  profileName: string;
  accent: string;
  examDate: string;
  examName: string;
  onboardingDone: boolean;
  lastBackupAt?: string;
  schemaVersion: number;
  seedVersion: number;
  aytAlan: AytAlan;
  hiddenSubjects: string[];
}

export interface PhotoFilters {
  examType?: ExamType;
  subjectId?: string;
  topicId?: string;
  examId?: string;
  mastered?: boolean;
  from?: string;
  to?: string;
  query?: string;
}
```

`src/domain/calculations.ts`: net ve progress. Yüzdeyi `Math.round` ile tam sayıya çevir; `total === 0` → 0. `solved > total` durumunda yüzde 100'ü aşmasın (veri doğrulaması ayrıca engeller).

`src/lib/format.ts`: `Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`; `formatPercent` için `%${Math.round}`.

`src/lib/date.ts`: yerel gece yarısına göre gün farkı; `daysUntil` negatif olabilir.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm test -- --run src/domain/calculations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain src/lib
git commit -m "feat: add domain types and progress/net calculations"
```

---

### Task 3: IndexedDB şeması, repository'ler ve seed altyapısı

**Files:**
- Create: `src/db/db.ts`, `src/db/repositories.ts`, `src/db/seed.ts`, `src/db/db.test.ts`, `src/test/fixtures.ts`
- Modify: `src/test/setup.ts` (fake-indexeddb)

**Interfaces:**
- Consumes: `Subject`, `Topic`, `Book`, `TopicBook`, `Photo`, `Note`, `Attachment`, `AppSettings` (Task 2).
- Produces:
  - `db: KoclukDB` (Dexie)
  - `DEFAULT_SETTINGS: AppSettings`
  - `getSettings(): Promise<AppSettings>`, `patchSettings(patch: Partial<AppSettings>): Promise<void>`
  - `seedCurriculum(seed: CurriculumSeed): Promise<void>` — `CurriculumSeed = { version: number; subjects: Array<{ seedKey; exam; name; slug; icon; order; topics: Array<{ seedKey; name; order }> }> }`
  - `resetDb(): Promise<void>`, `seedOnboarded(seed: CurriculumSeed, patch?: Partial<AppSettings>): Promise<void>` (test yardımcıları)
  - `listSubjects(exam?: ExamType): Promise<Subject[]>`, `listTopics(subjectId: string): Promise<Topic[]>`
  - `listTopicBooks(topicId: string): Promise<TopicBook[]>` (salt okunur; CRUD Task 7'de)
  - `addCustomTopic(subjectId: string, name: string): Promise<Topic>`
  - `renameTopic(topicId: string, name: string): Promise<void>`
  - `deleteCustomTopicCascade(topicId: string): Promise<void>`

- [ ] **Step 1: Test bağımlılığını ekle**

Run: `npm install -D fake-indexeddb`
`src/test/setup.ts` başına `import 'fake-indexeddb/auto';` ekle.

- [ ] **Step 2: Failing testi yaz**

`src/db/db.test.ts`:

```ts
import { beforeEach, expect, test } from 'vitest';
import { db } from './db';
import { DEFAULT_SETTINGS, getSettings, patchSettings, seedCurriculum, addCustomTopic, deleteCustomTopicCascade } from './repositories';

beforeEach(async () => { await db.delete(); await db.open(); });

test('varsayılan ayarları döner ve yamayı saklar', async () => {
  expect(await getSettings()).toMatchObject(DEFAULT_SETTINGS);
  await patchSettings({ profileName: 'Deniz', aytAlan: 'sayisal' });
  expect(await getSettings()).toMatchObject({ profileName: 'Deniz', aytAlan: 'sayisal' });
});

test('seed idempotenttir ve mevcut kaydı ezmez', async () => {
  const seed = { version: 1, subjects: [{ seedKey: 'tyt-mat', exam: 'TYT', name: 'Matematik', slug: 'matematik', icon: 'calculator', order: 1, topics: [{ seedKey: 'tyt-mat-turev', name: 'Türev', order: 1 }] }] };
  await seedCurriculum(seed as never);
  await seedCurriculum(seed as never);
  expect(await db.subjects.count()).toBe(1);
  expect(await db.topics.count()).toBe(1);
});

test('özel konu silme bağlı verileri temizler, fotoğrafı korur', async () => {
  await seedCurriculum({ version: 1, subjects: [{ seedKey: 'tyt-mat', exam: 'TYT', name: 'Matematik', slug: 'matematik', icon: 'calculator', order: 1, topics: [] }] });
  const subject = await db.subjects.toCollection().first();
  const topic = await addCustomTopic(subject!.id, 'Kendi konum');
  const book = await db.books.add({ id: 'b1', name: 'Kitap', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await db.topicBooks.add({ id: 'tb1', topicId: topic.id, bookId: book, totalTests: 5, solvedTests: 2, createdAt: '', updatedAt: '' });
  await db.notes.add({ topicId: topic.id, contentHtml: '<p>x</p>', plainText: 'x', updatedAt: '' });
  await db.photos.add({ id: 'p1', examType: 'TYT', subjectId: subject!.id, topicId: topic.id, note: '', blob: new Blob(), thumbBlob: new Blob(), width: 1, height: 1, mastered: false, practiceCount: 0, createdAt: '' });
  await deleteCustomTopicCascade(topic.id);
  expect(await db.topicBooks.count()).toBe(0);
  expect(await db.notes.count()).toBe(0);
  expect((await db.photos.get('p1'))?.topicId).toBeUndefined();
});
```

Testteki `subject` erişimini basitleştirmek için `seedCurriculum` çağrısından sonra `db.subjects.toCollection().first()` kullan; gerekirse test yardımcı fonksiyonu ekle.

- [ ] **Step 3: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/db/db.test.ts`
Expected: FAIL — `db.ts` yok.

- [ ] **Step 4: Şemayı ve repository'leri yaz**

`src/db/db.ts`: `KoclukDB extends Dexie`; sürüm 1 store'ları:

```ts
this.version(1).stores({
  settings: 'key',
  subjects: 'id, &seedKey, exam, order',
  topics: 'id, &seedKey, subjectId, order',
  books: 'id, name, updatedAt',
  topicBooks: 'id, topicId, bookId',
  exams: 'id, type, date',
  examResults: 'id, examId, subjectId',
  photos: 'id, examId, subjectId, topicId, createdAt',
  notes: 'topicId',
  attachments: 'id, topicId',
  practiceSessions: 'id, createdAt, completedAt',
});
```

`settings` satırı `{ key: string; value: unknown }`. `photos.mastered` boolean olduğu için indekslenmez; filtre `toArray()` sonrası bellekte yapılır.

`src/db/repositories.ts`:
- `getSettings`: `settings` tablosundaki satırları `DEFAULT_SETTINGS` üzerine merge et.
- `patchSettings`: her anahtar için `settings.put({ key, value })`.
- `src/db/seed.ts`: `seedCurriculum`; `db.subjects`/`db.topics` üzerinde `seedKey` ile var olanı atla; eksikleri ekle; `seedVersion` güncelle. `src/db/repositories.ts` bunu yeniden dışa aktarır.
- `addCustomTopic`: `isCustom: true`, `seedKey: undefined`, sıra = mevcut konu sayısı + 1.
- `deleteCustomTopicCascade`: yalnızca `isCustom` ise çalışsın; `topicBooks`, `notes`, `attachments` sil; `photos` içinde `topicId` eşleşenleri `undefined` yap.
- `listSubjects`/`listTopics`: `order` ile sırala.

- [ ] **Step 5: Testleri çalıştır**

Run: `npm test -- --run src/db/db.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db src/test
git commit -m "feat: add Dexie schema, settings and seed repositories"
```

---

### Task 4: Tema, uygulama kabuğu ve navigasyon

**Files:**
- Create: `src/data/accentPalettes.ts`, `src/data/subjectIcons.ts`, `src/app/theme.ts`, `src/app/SettingsProvider.tsx`, `src/app/AppShell.tsx`, `src/app/routes.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/layout/BottomNav.tsx`, `src/components/layout/TopBar.tsx`, `src/components/ui/{Button,Card,ProgressBar,RingProgress,EmptyState,Modal,Tabs,Toast,Field}.tsx`, `src/features/settings/SettingsPage.tsx`, `src/features/settings/AccentPicker.tsx`, `src/app/theme.test.ts`, `src/app/AppShell.test.tsx`, `src/features/settings/settings.test.tsx`, `src/test/renderApp.tsx`
- Modify: `src/App.tsx`, `src/App.test.tsx`, `src/styles/index.css`, `src/main.tsx`

**Interfaces:**
- Consumes: `getSettings`, `patchSettings` (Task 3); `AppSettings` (Task 2).
- Produces: `SettingsProvider`, `useAppSettings()` (`{ settings: AppSettings; updateSettings: (patch: Partial<AppSettings>) => Promise<void>; loading: boolean }`), `AppRoutes`, `AppShell`, `applyAccent(hex: string): void`, `ACCENT_PALETTES`, `SettingsPage`.

- [ ] **Step 1: Failing testi yaz**

`src/app/theme.test.ts`:

```ts
import { applyAccent } from './theme';

test('vurgu rengini CSS değişkenlerine uygular', () => {
  applyAccent('#22C55E');
  const root = document.documentElement;
  expect(root.style.getPropertyValue('--accent')).toBe('#22C55E');
  expect(root.style.getPropertyValue('--accent-contrast')).toBeTruthy();
});
```

`src/app/AppShell.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

test('ana navigasyonu gösterir', async () => {
  renderApp('/');
  expect(await screen.findByText('Ana Sayfa')).toBeInTheDocument();
  expect(screen.getAllByText('TYT').length).toBeGreaterThan(0);
  expect(screen.getAllByText('AYT').length).toBeGreaterThan(0);
});
```

`src/features/settings/settings.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '@/test/renderApp';
import { getSettings } from '@/db/repositories';

test('vurgu rengi değişir ve saklanır', async () => {
  renderApp('/ayarlar');
  await userEvent.click(await screen.findByRole('button', { name: 'Yeşil' }));
  expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#22C55E');
  expect((await getSettings()).accent).toBe('#22C55E');
});
```

- [ ] **Step 2: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/app`
Expected: FAIL — modüller yok.

- [ ] **Step 3: Temayı ve ayar sağlayıcısını yaz**

`accentPalettes.ts`: mavi `#3B82F6` (varsayılan), indigo `#6366F1`, mor `#A855F7`, turkuaz `#14B8A6`, yeşil `#22C55E`, amber `#F59E0B`, turuncu `#F97316`, pembe `#EC4899`, kırmızı `#EF4444`.

`theme.ts`: `applyAccent`; yardımcı `hexToRgb`, `relativeLuminance`; parlaklık > 0.55 ise kontrast `#0A0A0C`, değilse `#FFFFFF`; `--accent-soft` için `rgba(...,0.16)`, `--accent-strong` için `rgba(...,0.28)`.

`SettingsProvider.tsx`: açılışta `getSettings`, `useEffect` ile `applyAccent(settings.accent)`; `updateSettings` yamayı DB'ye yazar ve state'i günceller.

- [ ] **Step 4: Kabuğu ve rotaları yaz**

`routes.tsx`: `AppRoutes` bileşeni; `Routes`:
`/` Dashboard, `/tyt` SubjectsPage exam="TYT", `/tyt/:subjectId` SubjectPage, `/tyt/:subjectId/:topicId` TopicPage; `/ayt` ve alt rotaları; `/denemeler`, `/denemeler/yeni`, `/denemeler/:id`; `/yanlislar`, `/yanlislar/test`, `/yanlislar/test/:sessionId`; `/kitaplar`, `/kitaplar/:id`; `/ayarlar`. Bu görevde henüz yazılmamış sayfalar boş bir `<PagePlaceholder title>` bileşeni kullanır; ilgili görevlerde doldurulur.
`AppShell`: masaüstünde sabit sol menü (≥1024 px), mobilde üst bar + alt 5 sekme. `NAV_ITEMS` = Ana Sayfa, TYT, AYT, Denemeler, Yanlışlar; Kitaplar ve Ayarlar ikincil.
`App.tsx`: `HashRouter` + `SettingsProvider` + `AppShell` + `AppRoutes`. `src/App.test.tsx`'i `renderApp` tabanlı smoke test ile değiştir; eski `<App />` testi router/sağlayıcı olmadan çalışmaz.

`SettingsPage`: profil adı, sınav tarihi/adı, `AccentPicker` (9 renk + özel renk inputu), AYT alanı seçimi; değişiklikler `updateSettings` ile anında kaydedilir. `AccentPicker` düğmeleri erişilebilir ad taşır ("Mavi", "Yeşil", ...).

`src/test/renderApp.tsx`: `MemoryRouter` + `SettingsProvider` + `AppShell` + `AppRoutes`; testlerde `renderApp('/tyt')`.

- [ ] **Step 5: Testleri çalıştır**

Run: `npm test -- --run src/app src/features/settings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app src/components src/data src/test src/styles src/App.tsx
git commit -m "feat: add dark theme, settings provider and app shell"
```

---

### Task 5: Müfredat seed'i ve onboarding

**Files:**
- Create: `src/data/curriculum.ts`, `src/data/alanSubjects.ts`, `src/features/onboarding/Onboarding.tsx`, `src/features/onboarding/Onboarding.test.tsx`, `src/data/curriculum.test.ts`
- Modify: `src/app/routes.tsx`, `src/app/SettingsProvider.tsx` (seed çağrısı)

**Interfaces:**
- Consumes: `seedCurriculum` (Task 3), `ACCENT_PALETTES` (Task 4), `patchSettings` (Task 3).
- Produces: `CURRICULUM: CurriculumSeed`; onboarding rotası `/onboarding`; `onboardingDone` kontrolü; `computeHiddenSubjects(alan: AytAlan, subjects: Subject[]): string[]`.

- [ ] **Step 1: Müfredat verisini yaz**

`src/data/curriculum.ts`: 22 ders, ünite düzeyinde konular.

TYT dersleri: Türkçe, Matematik, Geometri, Fizik, Kimya, Biyoloji, Tarih, Coğrafya, Felsefe, Din Kültürü.
AYT dersleri: Matematik, Geometri, Edebiyat, Fizik, Kimya, Biyoloji, Tarih-1, Coğrafya-1, Tarih-2, Coğrafya-2, Felsefe Grubu, Din Kültürü.

Kurallar:
- Her ders 10-35 konu; toplam 250-350.
- `seedKey` ASCII ve kararlı: dersler için `tyt-turkce`, `tyt-matematik`, `tyt-geometri`, `tyt-fizik`, `tyt-kimya`, `tyt-biyoloji`, `tyt-tarih`, `tyt-cografya`, `tyt-felsefe`, `tyt-din-kulturu`; AYT için `ayt-matematik`, `ayt-geometri`, `ayt-edebiyat`, `ayt-fizik`, `ayt-kimya`, `ayt-biyoloji`, `ayt-tarih-1`, `ayt-cografya-1`, `ayt-tarih-2`, `ayt-cografya-2`, `ayt-felsefe-grubu`, `ayt-din-kulturu`. Konu anahtarları `tyt-matematik-turev`, `ayt-fizik-vektorler` gibi.
- Konular ünite düzeyinde: "Türev", "Polinomlar", "Vektörler"; kazanım cümlesi değil.
- AYT Felsefe Grubu içinde Felsefe, Psikoloji, Sosyoloji, Mantık konuları tek ders altında toplanır.
- Sıra numaraları ders içinde 1..n.

- [ ] **Step 2: Müfredat testini yaz**

`src/data/curriculum.test.ts`:

```ts
import { CURRICULUM } from './curriculum';

test('müfredat kapsamı ve anahtarları geçerlidir', () => {
  expect(CURRICULUM.subjects).toHaveLength(22);
  expect(CURRICULUM.subjects.filter((s) => s.exam === 'TYT')).toHaveLength(10);
  expect(CURRICULUM.subjects.filter((s) => s.exam === 'AYT')).toHaveLength(12);
  const topicCount = CURRICULUM.subjects.reduce((n, s) => n + s.topics.length, 0);
  expect(topicCount).toBeGreaterThanOrEqual(250);
  expect(topicCount).toBeLessThanOrEqual(350);
  const keys = CURRICULUM.subjects.flatMap((s) => s.topics.map((t) => t.seedKey));
  expect(new Set(keys).size).toBe(keys.length);
  for (const s of CURRICULUM.subjects) expect(s.topics.length).toBeGreaterThanOrEqual(10);
});
```

- [ ] **Step 3: Onboarding testini yaz**

`src/features/onboarding/Onboarding.test.tsx`: `renderApp('/')`; onboarding görünür; isim gir; "Sayısal" seç; renk seç; "Başla"; `getSettings()` içinde `profileName`, `aytAlan: 'sayisal'`, `accent`, `onboardingDone: true`; `hiddenSubjects` yalnızca sayısal AYT derslerini bırakacak şekilde dolu; uygulama ana sayfaya geçer.

- [ ] **Step 4: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/data/curriculum.test.ts src/features/onboarding`
Expected: FAIL — dosyalar yok.

- [ ] **Step 5: Onboarding'i ve seed çağrısını yaz**

`Onboarding.tsx`: 4 adım (isim, AYT alanı, vurgu rengi, bilgi). "Başla"da `seedCurriculum(CURRICULUM)` + `patchSettings({ ..., onboardingDone: true })`; sonra `/` rotasına git. Adımlar arası "Geri/İleri"; son adımda "Başla".
`alanSubjects.ts`: `ALAN_SUBJECT_SEED_KEYS` — Sayısal: `ayt-matematik`, `ayt-geometri`, `ayt-fizik`, `ayt-kimya`, `ayt-biyoloji`; EA: bunlara ek olarak `ayt-edebiyat`, `ayt-tarih-1`, `ayt-cografya-1`, `ayt-tarih-2`, `ayt-cografya-2`, `ayt-felsefe-grubu`, `ayt-din-kulturu` (matematik/geometri dahil); Sözel: Edebiyat, Tarih-1/2, Coğrafya-1/2, Felsefe Grubu, Din Kültürü. `computeHiddenSubjects(alan, subjects)`: alan `tumu` ise boş dizi; değilse ilgili AYT dersleri dışındaki AYT derslerinin ID'lerini döndür. Onboarding'de alan seçilince bu liste `hiddenSubjects` olarak kaydedilir.
`SettingsProvider` açılışta `getSettings` ile birlikte `seedVersion < CURRICULUM.version` ise `seedCurriculum(CURRICULUM)` çağırır; böylece onboarding'den önce de dersler hazırdır. `settings.onboardingDone === false` ise `/onboarding`'e yönlendir; onboarding tamamlanana kadar diğer rotaları gösterme. Bu guard eklendikten sonra Task 4'teki `AppShell` testini `seedOnboarded` ile güncelle; aksi halde test onboarding'e yönlenir.
Seed'i uygulama açılışında bir kez çağır; hata olursa toast + tekrar dene.

- [ ] **Step 6: Testleri çalıştır**

Run: `npm test -- --run src/data src/features/onboarding`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data src/features/onboarding src/app
git commit -m "feat: seed YKS curriculum and add onboarding"
```

---

### Task 6: TYT/AYT ders ve konu sayfaları

**Files:**
- Create: `src/features/subjects/SubjectsPage.tsx`, `src/features/subjects/SubjectPage.tsx`, `src/features/topics/TopicPage.tsx`, `src/features/subjects/subjects.test.tsx`, `src/lib/progress.ts`
- Modify: `src/app/routes.tsx`

**Interfaces:**
- Consumes: `listSubjects`, `listTopics`, `addCustomTopic`, `renameTopic`, `listTopicBooks` (Task 3); `calculateProgress` (Task 2); `useAppSettings` (Task 4).
- Produces: `useSubjectProgress(subjectId: string): Progress | undefined`; `useTopicProgress(topicId: string): Progress | undefined`; `SubjectsPage({ exam })`; `SubjectPage`; `TopicPage`.

- [ ] **Step 1: Failing testi yaz**

`src/features/subjects/subjects.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { renderApp } from '@/test/renderApp';
import { seedOnboarded } from '@/test/fixtures';

beforeEach(async () => {
  await seedOnboarded({ version: 1, subjects: [
    { seedKey: 'tyt-mat', exam: 'TYT', name: 'Matematik', slug: 'matematik', icon: 'calculator', order: 1, topics: [{ seedKey: 'tyt-mat-turev', name: 'Türev', order: 1 }, { seedKey: 'tyt-mat-pol', name: 'Polinomlar', order: 2 }] },
    { seedKey: 'tyt-fiz', exam: 'TYT', name: 'Fizik', slug: 'fizik', icon: 'atom', order: 2, topics: [{ seedKey: 'tyt-fiz-hareket', name: 'Hareket', order: 1 }] },
  ] });
});

test('TYT ders kartlarını gösterir', async () => {
  renderApp('/tyt');
  expect(await screen.findByText('Matematik')).toBeInTheDocument();
  expect(await screen.findByText('Fizik')).toBeInTheDocument();
});

test('konu listesini ve ilerlemeyi gösterir', async () => {
  renderApp('/tyt');
  await userEvent.click(await screen.findByText('Matematik'));
  expect(await screen.findByText('Türev')).toBeInTheDocument();
  expect(await screen.findByText('Henüz test eklenmedi')).toBeInTheDocument();
});
```

- [ ] **Step 2: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/features/subjects`
Expected: FAIL.

- [ ] **Step 3: Sayfaları yaz**

`SubjectsPage`: başlık `TYT Dersleri`/`AYT Dersleri`; ders kartları (ikon, ad, konu sayısı, yüzde, "devam eden konu"); AYT'de alan filtresi ve gizli ders filtresi.
`SubjectPage`: başlık + genel yüzde + ring; konu listesi; filtre Tümü/Devam edenler/Bitenler; "Konu ekle" modalı (ad gir, `addCustomTopic`); konu satırında "Yeniden adlandır" (seed dahil, `renameTopic`) ve yalnızca özel konularda "Sil" (onay + `deleteCustomTopicCascade`).
`TopicPage`: breadcrumb + konu adı + yüzde; sekmeler Testler/Notlar/Yanlışlar (bu görevde yalnızca sekmeler ve boş durum; içerik sonraki görevlerde).
`useSubjectProgress`: konu listesi + `topicBooks` sorgusu; `calculateProgress`.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm test -- --run src/features/subjects`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/subjects src/features/topics src/lib src/app/routes.tsx
git commit -m "feat: add subject and topic navigation with progress"
```

---

### Task 7: Konu bazında kitap/test takibi

**Files:**
- Create: `src/features/topics/TestsTab.tsx`, `src/features/topics/TopicBookForm.tsx`, `src/features/topics/tests.test.tsx`
- Modify: `src/db/repositories.ts`, `src/features/topics/TopicPage.tsx`

**Interfaces:**
- Consumes: `Book`, `TopicBook` (Task 2); `listBooks` (yeni), `createBook` (yeni), `listTopicBooks`, `upsertTopicBook`, `deleteTopicBook` (yeni); `calculateProgress` (Task 2).
- Produces:
  - `listBooks(): Promise<Book[]>`
  - `createBook(input: { name: string; publisher?: string }): Promise<Book>`
  - `listTopicBooks(topicId: string): Promise<TopicBook[]>`
  - `upsertTopicBook(input: { id?: string; topicId: string; bookId: string; totalTests: number; solvedTests: number }): Promise<TopicBook>`
  - `deleteTopicBook(id: string): Promise<void>`

- [ ] **Step 1: Repository testini yaz**

`src/db/repositories.test.ts` (veya `db.test.ts` içine ekle): kitap oluştur; aynı kitabı iki konuya bağla; `upsertTopicBook` ile toplam/çözülen güncelle; `solved > total` reddedilsin; `deleteTopicBook` yalnızca kaydı silsin, kitap kalsın.

- [ ] **Step 2: Component testini yaz**

`src/features/topics/tests.test.tsx`: seed konu + kitap; `renderApp('/tyt/.../...')`; "Kitap / test ekle" tıkla; kitap seç, toplam 6, çözülen 5 gir; kaydet; `5/6 test` ve `%83` görünür; "1 test kaldı" görünür.

- [ ] **Step 3: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/features/topics src/db`
Expected: FAIL.

- [ ] **Step 4: Repository ve formu yaz**

`repositories.ts`: `listBooks`, `createBook`, `listTopicBooks`, `upsertTopicBook`, `deleteTopicBook`. `upsertTopicBook` içinde tam sayı ve `solved <= total` doğrula; ihlalde `Error('Çözülen test sayısı toplamdan fazla olamaz')`.
`TopicBookForm`: mevcut kitap seçimi + "Yeni kitap" alanı; toplam/çözülen sayı inputları; kaydet. Aynı konu+kitap kaydı varsa güncelle. Yeni kitap adı mevcut bir kitapla aynıysa uyarı göster ama engelleme.
`TestsTab`: kayıt listesi (kitap adı, `x/y test`, yüzde, kalan), düzenle/sil; toplam ilerleme. Boş durum: "Henüz test eklenmedi".

- [ ] **Step 5: Testleri çalıştır**

Run: `npm test -- --run src/features/topics src/db`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/topics src/db
git commit -m "feat: track books and tests per topic"
```

---

### Task 8: Kitaplar sayfası ve kitap detayı

**Files:**
- Create: `src/features/books/BooksPage.tsx`, `src/features/books/BookDetailPage.tsx`, `src/features/books/books.test.tsx`
- Modify: `src/db/repositories.ts`, `src/app/routes.tsx`

**Interfaces:**
- Consumes: `Book`, `TopicBook`, `Topic`, `Subject` (Task 2); `listBooks`, `listTopicBooks` (Task 7).
- Produces: `getBook(id: string): Promise<Book | undefined>`; `listBookTopicBooks(bookId: string): Promise<Array<TopicBook & { topic: Topic; subject: Subject }>>`; `deleteBookCascade(bookId: string): Promise<void>`.

- [ ] **Step 1: Failing testi yaz**

`src/features/books/books.test.tsx`: seed kitap + iki konu kaydı; `/kitaplar` sayfasında kitap adı ve toplam yüzde; karta tıkla; detayda iki konu satırı; silme onayında "2 konu kaydı silinecek" uyarısı; silme sonrası `topicBooks` 0, ilişkili fotoğraf/not yerinde kalır.

- [ ] **Step 2: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/features/books`
Expected: FAIL.

- [ ] **Step 3: Repository ve sayfaları yaz**

`listBookTopicBooks`: `topicBooks` + `topics` + `subjects` join; kitap adı, kullanıldığı ders(ler), toplam yüzde.
`deleteBookCascade`: onay sonrası `topicBooks` sil, kitabı sil; fotoğraflara dokunma.
`BooksPage`: arama, yüzde çubuğu, çözülen/toplam test; boş durum "Henüz kitap yok".
`BookDetailPage`: konu satırları, her satırda "x/y test", yüzde, konuya git; düzenle/sil.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm test -- --run src/features/books`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/books src/db src/app/routes.tsx
git commit -m "feat: add books overview and detail"
```

---

### Task 9: Denemeler — kayıt, liste ve detay

**Files:**
- Create: `src/features/exams/ExamsPage.tsx`, `src/features/exams/ExamFormPage.tsx`, `src/features/exams/ExamDetailPage.tsx`, `src/features/exams/exams.test.tsx`
- Modify: `src/db/repositories.ts`, `src/app/routes.tsx`

**Interfaces:**
- Consumes: `Exam`, `ExamResult`, `Subject` (Task 2); `listSubjects` (Task 3).
- Produces:
  - `listExams(type?: ExamType): Promise<Exam[]>`
  - `getExam(id: string): Promise<Exam | undefined>`
  - `listExamResults(examId: string): Promise<ExamResult[]>`
  - `saveExam(input: { id?: string; type: ExamType; name: string; date: string; alan?: AytAlan; note?: string; results: Array<{ subjectId: string; correct: number; wrong: number; blank: number }> }): Promise<Exam>`
  - `deleteExamUnlinkPhotos(examId: string): Promise<void>`

- [ ] **Step 1: Failing testi yaz**

`src/features/exams/exams.test.tsx`: `/denemeler/yeni`; tür TYT, ad "3D TYT 5", tarih; Türkçe 30D/8Y/2B; Matematik 20D/10Y/0B; net önizlemesi `28,00` ve `17,50`; kaydet; listede toplam net `45,50`; detayda ders tablosu; denemeye bağlı fotoğraf varken deneme silinince fotoğrafın `examId` alanı boşalır, fotoğraf silinmez.

- [ ] **Step 2: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/features/exams`
Expected: FAIL.

- [ ] **Step 3: Repository'yi yaz**

`saveExam`: işlem içinde `exams` + `examResults`; düzenlemede önce mevcut sonuçları sil; boş satırları (D/Y/B hepsi boş) atla; net hesapla; `date` `YYYY-MM-DD`.
`deleteExamUnlinkPhotos`: `photos.where('examId').equals(id).modify({ examId: undefined })`; sonra deneme ve sonuçlarını sil.

- [ ] **Step 4: Sayfaları yaz**

`ExamsPage`: TYT/AYT/Tümü filtresi; liste kartları (tarih, ad, net, ders mini çubukları); "Yeni deneme".
`ExamFormPage`: tür, ad, tarih, AYT'de alan; görünür dersler için D/Y/B satırları; canlı net önizleme; kaydet. Boş satırlar toplama katılmaz.
`ExamDetailPage`: ders tablosu (D/Y/B/net), toplam net, not, düzenle/sil; fotoğraf bölümü yer tutucu (Task 13'te doldurulur).

- [ ] **Step 5: Testleri çalıştır**

Run: `npm test -- --run src/features/exams`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/exams src/db src/app/routes.tsx
git commit -m "feat: add exam tracking with per-subject nets"
```

---

### Task 10: Net grafikleri ve ana sayfa

**Files:**
- Create: `src/features/dashboard/DashboardPage.tsx`, `src/features/dashboard/NetTrendChart.tsx`, `src/features/dashboard/dashboard.test.tsx`, `src/features/dashboard/chartData.ts`
- Modify: `src/app/routes.tsx`, `src/features/exams/ExamsPage.tsx`

**Interfaces:**
- Consumes: `listExams`, `listExamResults`, `listSubjects`, `listTopicBooks`, `listBookTopicBooks` (Tasks 3–9); `calculateProgress`, `daysUntil` (Task 2); `useAppSettings` (Task 4).
- Produces: `buildNetSeries(exams: Exam[], results: ExamResult[], type: ExamType, alan?: AytAlan): { labels: string[]; values: number[] }` (son 10 deneme); `DashboardPage`.

- [ ] **Step 1: Grafik veri testini yaz**

`src/features/dashboard/chartData.test.ts`: 3 TYT denemesi; tarihe göre sıralı etiketler; netler; AYT alan filtresi yalnızca eşleşenleri alır; alanı boş denemeler "Genel" sayılır.

- [ ] **Step 2: Dashboard testini yaz**

`src/features/dashboard/dashboard.test.tsx`: seed kitap/test/deneme; `/` sayfasında genel yüzde, TYT/AYT yüzdeleri, kitap adı, net grafiği başlığı, son deneme; "YKS'ye X gün" metni.

- [ ] **Step 3: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/features/dashboard`
Expected: FAIL.

- [ ] **Step 4: Chart.js'i kur ve bileşenleri yaz**

Run: `npm install chart.js react-chartjs-2`

`NetTrendChart`: `Line` bileşeni; koyu tema; `--accent` rengi; tooltip `tr-TR`; boş veride "Henüz deneme yok". jsdom testleri için `HTMLCanvasElement.prototype.getContext` mock'u ekle.
`DashboardPage`: karşılama + geri sayım; genel/TYT/AYT yüzdeleri; son güncellenen 5 kitap; son 8 deneme net grafiği; son denemeler; hızlı ekle düğmeleri. Yüzdeler `hiddenSubjects` dışındaki dersler üzerinden hesaplanır.
`ExamsPage` üstüne aynı grafik (tür filtresiyle; AYT'de alan filtresi).

- [ ] **Step 5: Testleri çalıştır**

Run: `npm test -- --run src/features/dashboard src/features/exams`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/dashboard src/features/exams src/app/routes.tsx package.json package-lock.json
git commit -m "feat: add dashboard and net trend charts"
```

---

### Task 11: Konu notları ve dosya ekleri

**Files:**
- Create: `src/features/notes/NotesTab.tsx`, `src/features/notes/NoteEditor.tsx`, `src/features/notes/AttachmentList.tsx`, `src/features/notes/notes.test.tsx`, `src/lib/sanitize.ts`, `src/lib/sanitize.test.ts`
- Modify: `src/db/repositories.ts`, `src/features/topics/TopicPage.tsx`

**Interfaces:**
- Consumes: `Note`, `Attachment` (Task 2); `getNote`, `saveNote`, `listAttachments`, `addAttachment`, `deleteAttachment` (yeni).
- Produces:
  - `sanitizeHtml(html: string): string`
  - `getNote(topicId: string): Promise<Note | undefined>`
  - `saveNote(topicId: string, contentHtml: string, plainText: string): Promise<void>`
  - `listAttachments(topicId: string): Promise<Attachment[]>`
  - `addAttachment(topicId: string, file: File): Promise<Attachment>`
  - `deleteAttachment(id: string): Promise<void>`

- [ ] **Step 1: Testleri yaz**

`src/features/notes/notes.test.tsx`: TipTap editöründe metin yaz; 800 ms sonra `getNote` içeriği dolu; script içeren HTML `sanitizeHtml` ile temizlenir; görsel ekle; ek listede; sil.
`src/lib/sanitize.test.ts`: `<p>a</p><script>alert(1)</script>` → script yok.

- [ ] **Step 2: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/features/notes src/lib/sanitize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Bağımlılıkları kur**

Run: `npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-link @tiptap/extension-placeholder @tiptap/extension-highlight @tiptap/extension-underline dompurify`
Run: `npm install -D @types/dompurify`

- [ ] **Step 4: Repository ve editörü yaz**

`saveNote`: HTML'i sanitize et, `plainText` için `.textContent` türet, `updatedAt` yaz.
`addAttachment`: 20 MB sınırı; görselleri şimdilik olduğu gibi sakla (Task 13'te `compressImage` ile 2000 px'e küçültülecek); `size` ve `mime` sakla.
`NoteEditor`: TipTap StarterKit + Link + Placeholder + Highlight + Underline; araç çubuğu; 800 ms debounce autosave; "Kaydedildi" göstergesi; boş notta placeholder. jsdom için gerekli `ResizeObserver`/`IntersectionObserver` mock'larını `src/test/setup.ts`'e ekle.
`AttachmentList`: görsel önizleme, PDF aç/indir, sil.
`NotesTab`: editör + ekler + son kaydetme zamanı.

- [ ] **Step 5: Testleri çalıştır**

Run: `npm test -- --run src/features/notes src/lib/sanitize.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/notes src/lib src/db package.json package-lock.json
git commit -m "feat: add rich topic notes with attachments"
```

---

### Task 12: Global arama

**Files:**
- Create: `src/features/search/SearchModal.tsx`, `src/features/search/searchAll.ts`, `src/features/search/search.test.ts`, `src/lib/normalize.ts`
- Modify: `src/app/AppShell.tsx`, `src/features/search/SearchModal.tsx` route/modal state

**Interfaces:**
- Consumes: tüm tablolar (Task 3+); `Subject`, `Topic`, `Book`, `Exam`, `Photo`, `Note` (Task 2).
- Produces: `normalizeTr(text: string): string`; `SearchResult` (`{ kind: 'topic' | 'book' | 'exam' | 'photo' | 'note'; id: string; title: string; subtitle: string; href: string }`); `searchAll(query: string): Promise<SearchResult[]>`; `SearchModal`.

- [ ] **Step 1: Testi yaz**

`src/features/search/search.test.ts`: `normalizeTr('İSTANBUL') === 'istanbul'`; `normalizeTr('Iğdır') === 'ığdır'`; arama "türev" konu + not + kitap sonuçlarını döndürür; boş sorgu boş dizi.

- [ ] **Step 2: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/features/search`
Expected: FAIL.

- [ ] **Step 3: Aramayı yaz**

`normalizeTr`: `toLocaleLowerCase('tr-TR')` + baş/son boşluk temizle.
`searchAll`: `topics`, `notes.plainText`, `books.name`, `exams.name`, `photos.note` üzerinde `includes`; sonuçları türe göre grupla; her sonuçta `href` (HashRouter yolu) ve başlık/alt başlık.
`SearchModal`: üst bar arama düğmesi; `Ctrl/Cmd+K`; input; sonuç listesi; tıklayınca ilgili rotaya git ve modalı kapat; boş durum.

- [ ] **Step 4: Testleri çalıştır**

Run: `npm test -- --run src/features/search`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/search src/lib src/app/AppShell.tsx
git commit -m "feat: add global search across topics, notes, books and exams"
```

---

### Task 13: Yanlış fotoğrafları, sıkıştırma ve galeri

**Files:**
- Create: `src/lib/image.ts`, `src/features/photos/PhotosPage.tsx`, `src/features/photos/PhotoUpload.tsx`, `src/features/photos/PhotoDetail.tsx`, `src/features/photos/PhotoFilters.tsx`, `src/features/photos/photos.test.tsx`, `src/lib/image.test.ts`
- Modify: `src/db/repositories.ts`, `src/app/routes.tsx`, `src/features/exams/ExamDetailPage.tsx`, `src/features/topics/TopicPage.tsx`

**Interfaces:**
- Consumes: `Photo`, `PhotoFilters` (Task 2); `listSubjects`, `listTopics` (Task 3).
- Produces:
  - `compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<{ blob: Blob; thumbBlob: Blob; width: number; height: number }>`
  - `addPhotos(inputs: Array<{ file: File; examId?: string; examType: ExamType; subjectId: string; topicId?: string; note?: string }>): Promise<Photo[]>`
  - `listPhotos(filters: PhotoFilters): Promise<Photo[]>`
  - `updatePhoto(id: string, patch: Partial<Photo>): Promise<void>`
  - `deletePhotos(ids: string[]): Promise<void>`

- [ ] **Step 1: Sıkıştırma testini yaz**

`src/lib/image.test.ts`: sahte `createImageBitmap` ve canvas ile 2000×1000 girdi → uzun kenar 1600; çıktı JPEG blob; küçük resim 400 px; desteklenmeyen türde `Error('Bu görsel formatı desteklenmiyor')`.

- [ ] **Step 2: Galeri testini yaz**

`src/features/photos/photos.test.tsx`: fotoğraf yükle (mock `compressImage`); galeride küçük resim; ders filtresi; "çözüldü" işaretle; sil; deneme detayında fotoğraf görünür; depolama kotası hatası fırlatıldığında "Telefonda yeterli yer yok" mesajı görünür ve yükleme yarıda kalmaz.

- [ ] **Step 3: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/features/photos src/lib/image.test.ts`
Expected: FAIL.

- [ ] **Step 4: Görsel işleme ve repository'yi yaz**

`compressImage`: `createImageBitmap(file, { imageOrientation: 'from-image' })`; canvas'a ölçekle; `canvas.toBlob('image/jpeg', quality)`; küçük resim 400 px. Hata durumunda anlaşılır Türkçe mesaj. HEIC desteklenmiyorsa hata.
`addAttachment`'ı not görselleri için `compressImage(file, 2000, 0.85)` kullanacak şekilde güncelle.
`addPhotos`: sıkıştır, `photos` tablosuna ekle; `examId` varsa deneme türünü doğrula.
`listPhotos`: indeksli filtreleri Dexie ile uygula; `mastered` filtresini ve metin aramasını `toArray()` sonrası bellekte yap; `createdAt` azalan.
`deletePhotos`: blob'ları sil.

- [ ] **Step 5: Arayüzü yaz**

`PhotoUpload`: "Kamera" (`capture="environment"`) ve "Galeriden seç"; çoklu; ders/konu/deneme seçimi; not; yükleme ilerlemesi.
`PhotosPage`: özet (toplam, çözülen, bu hafta); filtreler; galeri grid; seçim modu; toplu sil; "Test oluştur" butonu (Task 14'e bağlanır); FAB.
`PhotoDetail`: büyük görsel, not, etiketler, deneme bağlantısı, çözüldü anahtarı, sil.
`ExamDetailPage` ve `TopicPage` "Yanlışlar" sekmesine yükleme kısayolu ekle.

- [ ] **Step 6: Testleri çalıştır**

Run: `npm test -- --run src/features/photos src/lib/image.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/photos src/features/exams src/features/topics src/lib src/db src/app/routes.tsx
git commit -m "feat: add wrong-answer photo archive with compression"
```

---

### Task 14: Rastgele test sihirbazı ve oturumu

**Files:**
- Create: `src/features/practice/practiceSelection.ts`, `src/features/practice/practiceSelection.test.ts`, `src/features/practice/PracticeWizard.tsx`, `src/features/practice/PracticeSessionPage.tsx`, `src/features/practice/practice.test.tsx`
- Modify: `src/db/repositories.ts`, `src/app/routes.tsx`, `src/features/photos/PhotosPage.tsx`

**Interfaces:**
- Consumes: `Photo`, `PracticeSession`, `PracticeOutcome`, `PracticeFilters` (Task 2); `listPhotos`, `updatePhoto` (Task 13).
- Produces:
  - `selectPracticePhotos(photos: Photo[], filters: PracticeFilters, shuffle?: () => number): Photo[]`
  - `createPracticeSession(input: { filters: PracticeFilters; photoIds: string[] }): Promise<PracticeSession>`
  - `recordPracticeAnswer(sessionId: string, photoId: string, outcome: PracticeOutcome): Promise<void>`
  - `completePracticeSession(sessionId: string): Promise<void>`
  - `listPracticeSessions(limit = 10): Promise<PracticeSession[]>`
  - `listOpenPracticeSessions(): Promise<PracticeSession[]>`
  - `getPracticeSession(id: string): Promise<PracticeSession | undefined>`

- [ ] **Step 1: Seçim testini yaz**

`src/features/practice/practiceSelection.test.ts`: ders/konu/tür filtreleri; `onlyUnmastered`; `count` sınırı; yeterli fotoğraf yoksa mevcutlar; aynı fotoğraf iki kez seçilmez; boş sonuç.

- [ ] **Step 2: Oturum testini yaz**

`src/features/practice/practice.test.tsx`: sihirbazda 2 fotoğraf seç; oturumda "Doğru" → `mastered=true`; "Yanlış" → `mastered=false`; "Boş" → değişmez; sayfa yeniden açıldığında kaldığı yerden devam; tamamlanınca geçmişte görünür.

- [ ] **Step 3: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/features/practice`
Expected: FAIL.

- [ ] **Step 4: Seçim ve repository'yi yaz**

`selectPracticePhotos`: filtreleri uygula, `Math.random` ile karıştır, `count` kadar al. Testte deterministik olması için `shuffle` parametresi kabul et (varsayılan `Math.random`).
`recordPracticeAnswer`: oturum `results` güncelle; fotoğraf `mastered` (doğru true, yanlış false, boş değişmez), `practiceCount + 1`, `lastPracticedAt`; oturum `updatedAt`.
`completePracticeSession`: `completedAt` yaz.
`listPracticeSessions`: tamamlananları son 10; ayrıca `listOpenPracticeSessions` (completedAt yok).

- [ ] **Step 5: Arayüzü yaz**

`PracticeWizard`: tür, ders (çoklu), konu (çoklu), deneme, sadece çözülmemişler, adet 5/10/20/tümü; özet; "Testi başlat".
`PracticeSessionPage`: büyük görsel, zoom/pan, "Notu göster", Doğru/Yanlış/Boş, ileri/geri, ilerleme; cevaplar anında kaydedilir; tamamlanınca özet. Silinmiş fotoğraf ID'lerini atla; oturum geçmişindeki skoru koru.
`PhotosPage`: "Devam eden test" varsa göster; "Seçilenlerden test oluştur" butonu.
`PracticeSessionPage` yeniden açıldığında ilk sonuçsuz fotoğrafa git.

- [ ] **Step 6: Testleri çalıştır**

Run: `npm test -- --run src/features/practice`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/practice src/features/photos src/db src/app/routes.tsx
git commit -m "feat: add random practice tests from wrong photos"
```

---

### Task 15: Zip yedekleme ve geri yükleme

**Files:**
- Create: `src/db/backup.ts`, `src/db/backup.test.ts`, `src/features/settings/BackupPanel.tsx`, `src/features/settings/StoragePanel.tsx`, `src/lib/zip.ts`
- Modify: `src/features/settings/SettingsPage.tsx`, `src/app/AppShell.tsx` (yedek hatırlatıcısı), `src/features/dashboard/DashboardPage.tsx`

**Interfaces:**
- Consumes: tüm tablolar ve tipler (Task 2/3); `db` (Task 3).
- Produces:
  - `exportBackup(): Promise<Blob>`
  - `importBackup(file: File): Promise<{ exportedAt: string; counts: Record<string, number> }>`
  - `BackupManifest = { app: 'kocluk'; schemaVersion: number; exportedAt: string; counts: Record<string, number> }`

- [ ] **Step 1: Round-trip testini yaz**

`src/db/backup.test.ts`: seed + kitap + test + deneme + not + ek + fotoğraf (küçük Blob) ekle; `exportBackup()`; veritabanını sil; `importBackup(new File([blob], 'yedek.zip'))`; tüm sayılar ve fotoğraf blob'u eşit; not HTML'i sanitize; manifest yanlışsa `Error('Geçersiz yedek dosyası')`.

- [ ] **Step 2: Çalıştır, başarısız olduğunu doğrula**

Run: `npm test -- --run src/db/backup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Bağımlılıkları kur**

Run: `npm install jszip file-saver zod`
Run: `npm install -D @types/file-saver`

- [ ] **Step 4: Export/import'u yaz**

`exportBackup`: JSZip ile `manifest.json`, `veri.json` (blob'lar hariç, fotoğraf/ek yolları referanslı), `fotograflar/yanlislar/<id>.jpg`, `ekler/<id>.<ext>`; `generateAsync({ type: 'blob' })`.
`importBackup`: zip aç; `manifest` zod ile doğrula (`app === 'kocluk'`); `schemaVersion` eskiyse migrasyon uygula, yeniyse "Daha yeni sürüm" hatası ver; `veri.json` doğrula; blob'ları yükle; `db.transaction('rw', db.tables, ...)` içinde tüm tabloları temizle ve yaz; atomik; hata olursa eski veri korunur. Not HTML'lerini sanitize et.
`StoragePanel`: `navigator.storage.estimate()` ve `persist()`; MB göster; izin durumu; API yoksa "Bu tarayıcı desteklemiyor" göster.
`BackupPanel`: yedek indir; dosya seç; özet onayı; son yedek tarihi; hata toast'ı; "Tüm verileri sil" (iki adımlı onay, önce yedek önerisi).
Yedek hatırlatıcısı: `lastBackupAt` 30 günden eskiyse veya 100+ fotoğraf varsa dashboard'da şerit.

- [ ] **Step 5: Testleri çalıştır**

Run: `npm test -- --run src/db/backup.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/backup.ts src/db/backup.test.ts src/features/settings src/lib/zip.ts src/features/dashboard src/app/AppShell.tsx package.json package-lock.json
git commit -m "feat: add zip backup and restore"
```

---

### Task 16: PWA, GitHub Pages yayını, E2E ve son rötuşlar

**Files:**
- Create: `vite.config.ts` (PWA eklentisi), `pwa-assets.config.ts`, `.github/workflows/deploy.yml`, `playwright.config.ts`, `tests/e2e/onboarding.spec.ts`, `tests/e2e/tracking.spec.ts`, `tests/e2e/exams.spec.ts`, `tests/e2e/photos.spec.ts`, `tests/e2e/backup.spec.ts`, `tests/e2e/pwa.spec.ts`, `src/app/PwaUpdateToast.tsx`, `src/features/settings/InstallGuide.tsx`, `src/features/settings/SubjectVisibility.tsx`, `public/favicon.svg`
- Modify: `src/app/AppShell.tsx`, `src/features/settings/SettingsPage.tsx`, `README.md`

**Interfaces:**
- Consumes: tüm önceki görevler.
- Produces: kurulabilir PWA; `/kocluk/` altında çalışan build; E2E testleri; yayın iş akışı.

- [ ] **Step 1: PWA eklentisini kur ve yapılandır**

Run: `npm install -D vite-plugin-pwa @vite-pwa/assets-generator @playwright/test`
Run: `npx playwright install chromium`
`vite.config.ts` içine `VitePWA({ registerType: 'prompt', manifest: {...}, workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] } })`.
`src/vite-env.d.ts` içine `/// <reference types="vite-plugin-pwa/client" />` ekle.
Manifest: `name: 'Koçluk — YKS Takip'`, `short_name: 'Koçluk'`, `theme_color: '#07080A'`, `background_color: '#07080A'`, `display: 'standalone'`, `start_url: './'`, `scope: './'`, 192/512/maskable ikonlar.
`pwa-assets.config.ts` ile `public/favicon.svg`'den ikonları üret: `npx pwa-assets-generator`.

- [ ] **Step 2: Kurulum ve güncelleme arayüzünü yaz**

`PwaUpdateToast`: `useRegisterSW` ile "Yeni sürüm hazır" + "Yenile".
`InstallGuide`: iOS Safari "Ana Ekrana Ekle", Android Chrome "Uygulamayı yükle", PC Chrome/Edge kurulum adımları; "Uygulama linkini paylaş" (`navigator.share` veya panoya kopyala).
`SettingsPage`: `InstallGuide`, `SubjectVisibility` (ders gizleme), `StoragePanel`, `BackupPanel`, sınav tarihi/adı, profil adı. AYT alanı değişince `computeHiddenSubjects` ile gizli dersleri güncelle; kullanıcı ardından tek tek değiştirebilir.
`AppShell`: kurulum istemini yalnızca `beforeinstallprompt` varsa göster.

- [ ] **Step 3: E2E testlerini yaz**

`playwright.config.ts`: `testDir: './tests/e2e'`, `use: { baseURL: 'http://localhost:4173/kocluk/', viewport: { width: 390, height: 844 } }`, `webServer: { command: 'npm run build && npm run preview -- --port 4173', url: 'http://localhost:4173/kocluk/' }`.
`onboarding.spec.ts`: ilk açılış → isim → Sayısal → renk → başla → ana sayfa.
`tracking.spec.ts`: TYT → Matematik → Türev → kitap/test ekle → yüzde.
`exams.spec.ts`: deneme ekle → net → grafik.
`photos.spec.ts`: fotoğraf yükle (fixture) → filtre → rastgele test → oturum.
`backup.spec.ts`: yedek indir → verileri sil → geri yükle → veri aynı.
`pwa.spec.ts`: sayfa yüklendikten ve service worker hazır olduktan sonra `context.setOffline(true)` + reload → uygulama kabuğu açılır; manifest linki ve `display: standalone` doğrulanır.

- [ ] **Step 4: GitHub Pages iş akışını yaz**

`.github/workflows/deploy.yml`: `on: push: branches: [main]`; `permissions: pages: write, id-token: write`; `actions/checkout`, `actions/setup-node` (22), `npm ci`, `npm run test -- --run`, `npm run build`, `actions/upload-pages-artifact` (`dist`), `actions/deploy-pages`. `base` `/kocluk/`; repo adı `kocluk` değilse `vite.config.ts` güncelle.
GitHub'a giriş ve repo: `gh auth login` (bir kez), sonra `gh repo create kocluk --public --source=. --remote=origin --push`; GitHub repo ayarlarında Pages kaynağını "GitHub Actions" yap. Yayın URL'sini `README`'ye ekle: `https://<kullanici>.github.io/kocluk/`.

- [ ] **Step 5: Son rötuşları yap**

- Responsive kontrol: 360/390/768/1024/1440 px; yatay kaydırma yok.
- Klavye odak halkaları, `aria-label`'lar, `prefers-reduced-motion`.
- Boş durumlar ve hata mesajları Türkçe.
- `README.md`: kurulum, geliştirme, test, yayın, arkadaşlarla link paylaşımı, yedekleme uyarısı.
- Spec 14'teki kabul kriterlerini tek tek doğrula (test kaydı, net, kamera, rastgele test, zip yedek, çevrimdışı, 360 px, vurgu rengi, kurulabilirlik).
- `npm run typecheck && npm test -- --run` geçir.
- Manuel: iOS Safari kurulum/kamera, Android Chrome, Windows Chrome/Edge, çevrimdışı.

- [ ] **Step 6: E2E ve build'i çalıştır**

Run: `npm run build && npx playwright test`
Expected: Tüm E2E testleri PASS; build `dist/` üretir.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add PWA, GitHub Pages deploy and end-to-end tests"
```

---

## Execution Notes

- **Sıra:** Görevler bağımlıdır; Task 1 → 16 sırayla ilerle. Her görevde önce testi yaz, kırmızı olduğunu gör, sonra uygula.
- **Veri:** Görev 3'teki Dexie şeması sonradan değiştirilecekse `version(2)` migration ekle; mevcut kullanıcı verisini silme.
- **Testler:** Onboarding guard'ı eklendikten sonra bileşen testlerinde `seedOnboarded(...)` kullan; aksi halde testler onboarding ekranına yönlenir.
- **Commit:** Her görev sonunda çalışan bir uygulama bırak. Testler geçmeden commit atma.
- **Kapsam dışı:** Hesaplar, bulut senkron, YDT, OCR, sosyal özellikler, açık tema, PDF not alma (spec 16).
- **Yayın:** GitHub kullanıcı adı ve repo adı netleşince `README` ve `base` güncelle; repo public olabilir, kişisel veri koyma.
