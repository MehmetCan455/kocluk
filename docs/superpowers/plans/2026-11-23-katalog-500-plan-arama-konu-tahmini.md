# Katalog 500+, Plan Araması ve Kitap Tabanlı Konu Tahmini — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kataloğu 500+ doğrulanmış kitaba çıkar, görev formuna aranabilir kitap seçici ekle, bugünün planında yayınevi göster ve kitap ilerlemesini ders konularına sıralı tahmin olarak yansıt.

**Architecture:** Katalog verisi ders bazlı seed modüllerine ayrılır; araştırma subagent'ları JSON raporu üretir, reviewer doğrular, bir build script'i raporları TS modüllerine çevirir. UI tarafında `ShelfBookPicker` raf kitaplarını arar; `subjectEstimate` saf domain fonksiyonu kitap yüzdelerini konulara sırayla dağıtır ve `progress.ts` hook'ları bunu kullanır.

**Tech Stack:** React 19, TypeScript, Vite, Dexie, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-23-katalog-500-plan-arama-konu-tahmini-design.md`

## Global Constraints

- Node.js `>=22.22.2`; mevcut `package.json` bağımlılıkları dışında yeni paket eklenmez.
- Her subagent yalnızca `opencode-go/deepseek-v4.1-flash#max` modeliyle çalıştırılır.
- `main` dalına push, local preview kullanıcı tarafından onaylanmadan yapılmaz. GitHub Pages `main` push'unda dağıtım yaptığı için bu kural canlı yayın kuralıdır.
- Veritabanı şeması değişmez; yeni tablo/index yok. `CatalogBook` kimliği `title|publisher|edition` olarak kalır.
- Mevcut 80 katalog satırının içeriği ve kimlikleri değişmez.
- `ExamType` yalnızca `TYT` ve `AYT`.
- İzinli `subjectSlug` değerleri: `turkce`, `matematik`, `geometri`, `fizik`, `kimya`, `biyoloji`, `tarih`, `cografya`, `felsefe`, `din-kulturu`, `edebiyat`, `tarih-1`, `tarih-2`, `cografya-1`, `cografya-2`, `felsefe-grubu`.
- Katalogda aynı `title + publisher` ikilisi yalnızca bir kez bulunur; edition farkı yeni satır açmaz.
- Katalog toplamı en az 500; hedef 536.
- Kitap tahmini: her kitap kendi yüzdesini konu sırasına göre dağıtır; bir kitap bir konuya en fazla %50, iki kitap bir konuyu %100 yapar; %100 yalnızca gerçekten tamamlanınca gösterilir.
- Tüm kullanıcı metinleri Türkçe ve mevcut üslupla uyumlu.
- Testler `npm run test:run`, tip kontrolü `npm run typecheck`, derleme `npm run build` ile doğrulanır.

## Review Focus

- **Kaynaksız/uydurma katalog satırı:** Her yeni satırın en az bir http(s) kaynağı olmalı; reviewer örnek URL'leri açıp sayfa sayısını doğrulamalı.
- **Aynı kitabın çift kaydı:** Aynı `title + publisher` mevcut 80'de veya yeni raporlarda tekrar etmemeli; reviewer tüm raporları birlikte taramalı.
- **500 satırlı katalog modalı:** İlk açılış 60 satırla sınırlı olmalı; "Daha fazla göster" çalışmalı; arama sonucu sayısı doğru olmalı.
- **Aranabilir seçici:** Türkçe büyük/küçük harf, aynı adlı farklı yayınevleri, hiç kitap olmaması, tek kitap ve klavye seçimi test edilmeli.
- **Tahmin uç durumları:** Arşivli/silinmiş/toplam sayfası bilinmeyen kitap katkı vermemeli; manuel biten konu %100 kalmalı; TYT ve AYT ayrı hesaplanmalı; "TYT-AYT" ortak kitabı iki tarafa da sayılmalı.

---

## Phase 0 — Hazırlık

### Task 0: İzole çalışma alanı ve temel doğrulama

**Files:** Yok (sadece çalışma alanı).

**Interfaces:**
- Consumes: mevcut `main` dalı, temiz çalışma ağacı.
- Produces: `feat/katalog-500-plan-arama-konu-tahmini` dalı veya eşdeğer worktree.

- [ ] **Step 1: Kullanıcıya worktree tercihini sor**

Kullanıcıya şunu sor: "Değişiklikleri izole bir worktree'de mi yapayım, yoksa mevcut dizinde `feat/katalog-500-plan-arama-konu-tahmini` dalında mı?" Kullanıcı worktree isterse `using-git-worktrees` skill'ini uygula; istemezse mevcut dizinde feature dalı aç.

- [ ] **Step 2: Dalı hazırla**

Run:
```bash
git switch -c feat/katalog-500-plan-arama-konu-tahmini
```
Expected: `Switched to a new branch ...`

- [ ] **Step 3: Temel testleri çalıştır**

Run:
```bash
npm run test:run
npm run typecheck
```
Expected: Mevcut testler ve tip kontrolü geçer. Geçmezse dur ve kullanıcıya bildir.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: start catalog expansion branch" --allow-empty
```

---

## Phase 1 — Katalog iskeleti ve araştırma altyapısı

### Task 1: Katalog seed modüllerini oluştur

**Files:**
- Create: `src/data/catalog/types.ts`
- Create: `src/data/catalog/mevcut.ts`
- Create: `src/data/catalog/tyt-turkce.ts`, `tyt-matematik.ts`, `tyt-geometri.ts`, `tyt-fizik.ts`, `tyt-kimya.ts`, `tyt-biyoloji.ts`, `tyt-tarih.ts`, `tyt-cografya.ts`, `tyt-felsefe.ts`, `tyt-din-kulturu.ts`
- Create: `src/data/catalog/ayt-matematik.ts`, `ayt-geometri.ts`, `ayt-edebiyat.ts`, `ayt-fizik.ts`, `ayt-kimya.ts`, `ayt-biyoloji.ts`, `ayt-tarih-1.ts`, `ayt-tarih-2.ts`, `ayt-cografya-1.ts`, `ayt-cografya-2.ts`, `ayt-felsefe-grubu.ts`, `ayt-din-kulturu.ts`
- Create: `src/data/catalog/index.ts`
- Modify: `src/data/catalogBooks.ts`
- Test: `src/data/catalogBooks.test.ts`

**Interfaces:**
- Consumes: mevcut `CatalogBookSeed` arayüzü ve 80 satırlık `CATALOG_SEED`.
- Produces:
  - `src/data/catalog/types.ts`: `export interface CatalogBookSeed { title: string; publisher: string; exam: ExamType; subjectSlug: string; totalPages: number; edition: string; }`
  - Her ders modülü: `export const <CONST>: readonly CatalogBookSeed[] = [];`
  - `src/data/catalog/index.ts`: `export const YENI_KATALOG: readonly CatalogBookSeed[]`
  - `src/data/catalogBooks.ts`: `CATALOG_SEED`, `CatalogBookSeed` re-export, `catalogBookId` aynı imza.

- [ ] **Step 1: Mevcut 80 satırı taşı**

`src/data/catalogBooks.ts` içindeki `CATALOG_SEED` dizisini birebir `src/data/catalog/mevcut.ts` içine taşı:

```ts
import type { CatalogBookSeed } from './types';

/** Mevcut starter katalog: 80 kitap, kimlikleri değişmez. */
export const MEVCUT: readonly CatalogBookSeed[] = [
  // mevcut 80 satır birebir
];
```

`catalogBooks.ts` içinde `CatalogBookSeed` arayüzünü `types.ts`e taşı ve re-export et. `catalogBookId` fonksiyonunu değiştirme.

- [ ] **Step 2: Boş ders modüllerini oluştur**

Her dosya şu kalıpta olsun (örnek `tyt-matematik.ts`):

```ts
import type { CatalogBookSeed } from './types';

export const TYT_MATEMATIK: readonly CatalogBookSeed[] = [];
```

Const adları: `TYT_TURKCE`, `TYT_MATEMATIK`, `TYT_GEOMETRI`, `TYT_FIZIK`, `TYT_KIMYA`, `TYT_BIYOLOJI`, `TYT_TARIH`, `TYT_COGRAFYA`, `TYT_FELSEFE`, `TYT_DIN_KULTURU`, `AYT_MATEMATIK`, `AYT_GEOMETRI`, `AYT_EDEBIYAT`, `AYT_FIZIK`, `AYT_KIMYA`, `AYT_BIYOLOJI`, `AYT_TARIH_1`, `AYT_TARIH_2`, `AYT_COGRAFYA_1`, `AYT_COGRAFYA_2`, `AYT_FELSEFE_GRUBU`, `AYT_DIN_KULTURU`.

- [ ] **Step 3: Barrel oluştur**

`src/data/catalog/index.ts`:

```ts
import type { CatalogBookSeed } from './types';
import { TYT_TURKCE } from './tyt-turkce';
// ... 21 import daha

export const YENI_KATALOG: readonly CatalogBookSeed[] = [
  ...TYT_TURKCE,
  // ... 21 spread daha
];
```

- [ ] **Step 4: `catalogBooks.ts`i sadeleştir**

```ts
import { MEVCUT } from './catalog/mevcut';
import { YENI_KATALOG } from './catalog';

export type { CatalogBookSeed } from './catalog/types';

export const CATALOG_SEED: readonly CatalogBookSeed[] = [
  ...MEVCUT,
  ...YENI_KATALOG,
];

export function catalogBookId(title: string, publisher: string, edition: string): string {
  return deterministicId(CATALOG_NAMESPACE, `${title}|${publisher}|${edition}`);
}
```

`deterministicId` ve `CATALOG_NAMESPACE` importlarını koru.

- [ ] **Step 5: Yeni test dosyasını yaz**

`src/data/catalogBooks.test.ts`:

```ts
import { expect, test } from 'vitest';
import { CATALOG_SEED, catalogBookId } from './catalogBooks';
import { MEVCUT } from './catalog/mevcut';

test('mevcut 80 kitap korunur ve kimlikleri benzersizdir', () => {
  expect(MEVCUT).toHaveLength(80);
  expect(CATALOG_SEED.length).toBeGreaterThanOrEqual(80);

  const ids = new Set(CATALOG_SEED.map((book) => catalogBookId(book.title, book.publisher, book.edition)));
  expect(ids.size).toBe(CATALOG_SEED.length);

  expect(CATALOG_SEED).toContainEqual(
    expect.objectContaining({
      title: 'TYT Matematik Soru Bankası',
      publisher: 'Bilgi Sarmal',
      totalPages: 400,
    }),
  );
});
```

- [ ] **Step 6: Testleri çalıştır**

Run:
```bash
npm run test:run -- src/data/catalogBooks.test.ts src/db/catalogRepository.test.ts src/db/backup.test.ts
```
Expected: PASS. `CATALOG_SEED` hâlâ 80 satır olduğu için mevcut katalog testleri geçer.

- [ ] **Step 7: Commit**

```bash
git add src/data/catalog src/data/catalogBooks.ts src/data/catalogBooks.test.ts
git commit -m "refactor: split catalog seed into subject modules"
```

---

### Task 2: Araştırma brief'i, reviewer talimatı ve build script'i

**Files:**
- Create: `docs/superpowers/research/catalog-2026-11-23/brief.md`
- Create: `docs/superpowers/research/catalog-2026-11-23/reviewer.md`
- Create: `scripts/build-catalog.mjs`

**Interfaces:**
- Consumes: Task 1'in `CatalogBookSeed` alan adları ve modül dosya adları.
- Produces:
  - Research subagent'larının okuyacağı `brief.md`.
  - Reviewer subagent'larının okuyacağı `reviewer.md`.
  - `node scripts/build-catalog.mjs` komutu; JSON raporlarından `src/data/catalog/*.ts` ve `src/data/catalog/index.ts` üretir.

- [ ] **Step 1: `brief.md` dosyasını yaz**

Aşağıdaki bölümleri içersin:

```markdown
# Katalog Araştırma Brief'i (2026-11-23)

## Amaç
YKS TYT/AYT kataloğuna eklenecek 456 yeni kitabı, doğrulanmış sayfa sayılarıyla araştırmak.

## Zorunlu kurallar
- Sadece gerçek, güncel satışta olan kitaplar.
- `exam` yalnızca TYT veya AYT.
- `subjectSlug` şu listeden: turkce, matematik, geometri, fizik, kimya, biyoloji, tarih, cografya, felsefe, din-kulturu, edebiyat, tarih-1, tarih-2, cografya-1, cografya-2, felsefe-grubu.
- `totalPages` pozitif tam sayı.
- `edition` 4 haneli yıl; çoğunlukla 2026.
- Her satırda `sourceUrl` ve en az bir `sourceUrls` girdisi.
- `confidence`: high (resmî künye veya en az 2 bağımsız kaynak), medium (tek güvenilir kaynak), low (kabul edilmez).
- Aynı `title + publisher` mevcut `src/data/catalog/mevcut.ts` içinde varsa ekleme (edition farklı olsa bile).
- TYT-AYT ortak tek cilt kitaplar TYT batch'ine yazılır; `exam: "TYT"`.
- AYT Tarih-1/Tarih-2 ve AYT Coğrafya-1/Coğrafya-2 için yalnızca tek alt dersi hedefleyen kitaplar ekle. "AYT Tarih"/"AYT Coğrafya" gibi iki alt dersi birlikte kapsayan tek ciltleri ekleme.
- Deneme sınavı kitapçıkları, DVD, poster, defter ekleme.
- Fasikül seti tek satırsa başlıkta `(X Fasikül)` yaz; `totalPages` setin toplamı olsun.
- Başlık ve yayınevi adlarını Türkçe ve künyedeki haliyle yaz.

## Sayfa sayısı çelişkisi
Resmî yayınevi künyesi > aynı ISBN'li mağaza çoğunluğu > eski baskı. Farkı `notes` alanına yaz.

## Rapor biçimi
`docs/superpowers/research/catalog-2026-11-23/<batch>.json`:

{
  "batch": "<batch>",
  "books": [
    {
      "title": "...",
      "publisher": "...",
      "exam": "TYT",
      "subjectSlug": "matematik",
      "totalPages": 400,
      "edition": "2026",
      "sourceUrl": "https://...",
      "sourceUrls": ["https://..."],
      "confidence": "high",
      "notes": "..."
    }
  ],
  "gaps": ["doğrulanamayan kitaplar"]
}

## Kapsam hedefleri
- Fasikül, problemler ve paragraf kitapları özellikle hedeflenir.
- Her batch hedefini `gaps` olmadan doldurmaya çalış; dolduramadığın kısmı `gaps`e yaz.

## Yasak
- Uygulama kodu değiştirme.
- Kaynaksız veya uydurma satır yazma.
```

- [ ] **Step 2: `reviewer.md` dosyasını yaz**

```markdown
# Katalog Reviewer Talimatı

Sen bağımsız bir doğrulayıcısın. Araştırma raporunu düzeltmezsin; sadece inceler ve rapor yazarsın.

## Oku
- `docs/superpowers/research/catalog-2026-11-23/brief.md`
- İncelenen batch JSON'u
- `src/data/catalog/mevcut.ts`
- Diğer tüm batch JSON'ları (tekrar taraması için)

## Kontrol et
1. Şema: tüm alanlar var, `exam` TYT/AYT, `subjectSlug` izinli, `totalPages` pozitif tam sayı, `edition` 4 haneli, `sourceUrl` http(s), `confidence` high/medium.
2. Tekrar: aynı `title + publisher` mevcut 80'de veya herhangi bir batch'te var mı?
3. Kaynak: her satırın en az bir kaynağı var mı? Rastgele en az %20 satırda URL'yi açıp sayfa sayısını doğrula. Medium ve çelişkili satırların tamamını kontrol et.
4. Kapsam: fasikül/problem/paragraf hedefleri, TYT-AYT sahipliği, AYT Tarih/Coğrafya alt ders kuralı.
5. Sayfa sayısı: resmî künye > mağaza çoğunluğu > eski baskı kuralına uyulmuş mu?

## Yaz
`docs/superpowers/research/catalog-2026-11-23/review-<batch>.md`:

- `PASS` veya `FAIL`
- FAIL ise satır satır düzeltme listesi ve gerekçe
- Kontrol edilen URL sayısı
- Toplam satır sayısı

JSON'u değiştirme.
```

- [ ] **Step 3: Build script'ini yaz**

`scripts/build-catalog.mjs` şunları yapar:

- `docs/superpowers/research/catalog-2026-11-23/*.json` dosyalarını okur.
- Her kitap için zorunlu alanları ve `confidence !== 'low'` kontrolünü yapar; hata varsa dosya/satır yazıp `process.exit(1)`.
- Tüm raporlarda `title|publisher` tekrarını arar; tekrar varsa listeler ve çıkar.
- Kitapları `exam|subjectSlug` gruplarına ayırır.
- Sabit modül eşlemesi:

```js
const MODULES = [
  ['TYT', 'turkce', 'tyt-turkce', 'TYT_TURKCE'],
  ['TYT', 'matematik', 'tyt-matematik', 'TYT_MATEMATIK'],
  ['TYT', 'geometri', 'tyt-geometri', 'TYT_GEOMETRI'],
  ['TYT', 'fizik', 'tyt-fizik', 'TYT_FIZIK'],
  ['TYT', 'kimya', 'tyt-kimya', 'TYT_KIMYA'],
  ['TYT', 'biyoloji', 'tyt-biyoloji', 'TYT_BIYOLOJI'],
  ['TYT', 'tarih', 'tyt-tarih', 'TYT_TARIH'],
  ['TYT', 'cografya', 'tyt-cografya', 'TYT_COGRAFYA'],
  ['TYT', 'felsefe', 'tyt-felsefe', 'TYT_FELSEFE'],
  ['TYT', 'din-kulturu', 'tyt-din-kulturu', 'TYT_DIN_KULTURU'],
  ['AYT', 'matematik', 'ayt-matematik', 'AYT_MATEMATIK'],
  ['AYT', 'geometri', 'ayt-geometri', 'AYT_GEOMETRI'],
  ['AYT', 'edebiyat', 'ayt-edebiyat', 'AYT_EDEBIYAT'],
  ['AYT', 'fizik', 'ayt-fizik', 'AYT_FIZIK'],
  ['AYT', 'kimya', 'ayt-kimya', 'AYT_KIMYA'],
  ['AYT', 'biyoloji', 'ayt-biyoloji', 'AYT_BIYOLOJI'],
  ['AYT', 'tarih-1', 'ayt-tarih-1', 'AYT_TARIH_1'],
  ['AYT', 'tarih-2', 'ayt-tarih-2', 'AYT_TARIH_2'],
  ['AYT', 'cografya-1', 'ayt-cografya-1', 'AYT_COGRAFYA_1'],
  ['AYT', 'cografya-2', 'ayt-cografya-2', 'AYT_COGRAFYA_2'],
  ['AYT', 'felsefe-grubu', 'ayt-felsefe-grubu', 'AYT_FELSEFE_GRUBU'],
  ['AYT', 'din-kulturu', 'ayt-din-kulturu', 'AYT_DIN_KULTURU'],
];
```

- Her modül için `src/data/catalog/<file>.ts` yazar; satırları başlık, yayınevi, edition sırasıyla `tr` locale'de sıralar. Boş modülü de yazar.
- `src/data/catalog/index.ts` dosyasını yeniden üretir.
- `mevcut.ts` dosyasına dokunmaz.
- Konsola ders başına ve toplam satır sayısını yazar.

- [ ] **Step 4: Script'i boş raporlarla çalıştır**

Run:
```bash
node scripts/build-catalog.mjs
```
Expected: Hata yok; 22 modül boş kalır; `src/data/catalogBooks.test.ts` hâlâ geçer.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/research/catalog-2026-11-23 scripts/build-catalog.mjs
git commit -m "chore: add catalog research brief and build script"
```

---

## Phase 2 — Katalog araştırması ve reviewer

### Task 3: TYT wave 1 — batch 1–4

**Batch'ler:** `tyt-turkce` (35), `tyt-matematik` (35), `tyt-geometri` (25), `tyt-fizik` (28).

**Files:**
- Create: `docs/superpowers/research/catalog-2026-11-23/tyt-turkce.json`
- Create: `docs/superpowers/research/catalog-2026-11-23/tyt-matematik.json`
- Create: `docs/superpowers/research/catalog-2026-11-23/tyt-geometri.json`
- Create: `docs/superpowers/research/catalog-2026-11-23/tyt-fizik.json`
- Create: `docs/superpowers/research/catalog-2026-11-23/review-tyt-*.md`

**Interfaces:**
- Consumes: `brief.md`, `reviewer.md`, `src/data/catalog/mevcut.ts`.
- Produces: Reviewer `PASS` almış dört JSON raporu.

- [ ] **Step 1: Dört araştırma subagent'ını paralel başlat**

Her biri için `subagent` çağrısı: `agent: "general"`, `model: "opencode-go/deepseek-v4.1-flash#max"`, `description: "<batch> araştırması"`.

Prompt şablonu:

```
YKS katalog araştırmacısısın. Önce şu dosyayı oku:
docs/superpowers/research/catalog-2026-11-23/brief.md
ve mevcut katalog:
src/data/catalog/mevcut.ts

Batch: <batch>. Hedef: <n> kitap. Ders: <subjectSlug>. Sınav: <TYT/AYT>.
Kurallara uy. Yalnızca şu dosyayı yaz:
docs/superpowers/research/catalog-2026-11-23/<batch>.json
Uygulama kodunu değiştirme. Hedefe ulaşamadığın kitapları `gaps` dizisine yaz.
```

- [ ] **Step 2: Raporların varlığını kontrol et**

Run:
```bash
Get-ChildItem docs/superpowers/research/catalog-2026-11-23/*.json | Select-Object Name,Length
```
Expected: Dört JSON dosyası var ve boş değil.

- [ ] **Step 3: Reviewer A'yı başlat**

`subagent` çağrısı: `agent: "general"`, `model: "opencode-go/deepseek-v4.1-flash#max"`, `description: "TYT wave 1 review"`.

Prompt:

```
Bağımsız katalog reviewer'ısın. Şu dosyayı oku:
docs/superpowers/research/catalog-2026-11-23/reviewer.md

Şu batch'leri incele: tyt-turkce, tyt-matematik, tyt-geometri, tyt-fizik.
Her batch için ayrı review-<batch>.md yaz. JSON'ları değiştirme.
FAIL varsa satır satır düzeltme listesi ver.
```

- [ ] **Step 4: FAIL varsa araştırmacıya geri gönder**

Her FAIL batch için aynı araştırma subagent'ına `sessionID` ile review dosyasını okuyup yalnızca belirtilen satırları düzeltmesini söyle. Düzeltme sonrası aynı reviewer'a tekrar inceleme gönder. PASS olmadan Step 5'e geçme.

- [ ] **Step 5: Raporları commit et**

```bash
git add docs/superpowers/research/catalog-2026-11-23
git commit -m "docs: add TYT wave 1 catalog research and reviews"
```

---

### Task 4: TYT wave 2 — batch 5–8

**Batch'ler:** `tyt-kimya` (28), `tyt-biyoloji` (28), `tyt-sosyal-1` (TYT Tarih 18 + TYT Coğrafya 18), `tyt-sosyal-2` (TYT Felsefe 15 + TYT Din 10).

**Files:**
- Create: `docs/superpowers/research/catalog-2026-11-23/tyt-kimya.json`
- Create: `docs/superpowers/research/catalog-2026-11-23/tyt-biyoloji.json`
- Create: `docs/superpowers/research/catalog-2026-11-23/tyt-sosyal-1.json`
- Create: `docs/superpowers/research/catalog-2026-11-23/tyt-sosyal-2.json`
- Create: ilgili `review-*.md`

**Interfaces:**
- Consumes: Task 3 ile aynı brief/reviewer.
- Produces: Reviewer `PASS` almış dört JSON raporu.

- [ ] **Step 1: Dört araştırma subagent'ını paralel başlat**

Task 3 Step 1'deki prompt şablonunu batch ve hedeflerle kullan. `tyt-sosyal-1` iki ders içerir: TYT Tarih (`tarih`) 18, TYT Coğrafya (`cografya`) 18. `tyt-sosyal-2`: TYT Felsefe (`felsefe`) 15, TYT Din Kültürü (`din-kulturu`) 10.

- [ ] **Step 2: Reviewer A ile incele**

Task 3 Step 3'teki reviewer promptunu bu dört batch için kullan. FAIL döngüsü Task 3 Step 4 ile aynı.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/research/catalog-2026-11-23
git commit -m "docs: add TYT wave 2 catalog research and reviews"
```

---

### Task 5: AYT wave — batch 9–13

**Batch'ler:**
- `ayt-matematik-geometri`: AYT Matematik 30 + AYT Geometri 25
- `ayt-edebiyat-tarih`: AYT Edebiyat 25 + AYT Tarih-1 9 + AYT Tarih-2 9
- `ayt-fizik-kimya`: AYT Fizik 25 + AYT Kimya 25
- `ayt-biyoloji-cografya`: AYT Biyoloji 25 + AYT Coğrafya-1 9 + AYT Coğrafya-2 9
- `ayt-felsefe-din`: AYT Felsefe Grubu 15 + AYT Din Kültürü 10

**Files:**
- Create: `docs/superpowers/research/catalog-2026-11-23/ayt-*.json`
- Create: ilgili `review-*.md`

**Interfaces:**
- Consumes: Task 3 ile aynı brief/reviewer.
- Produces: Reviewer `PASS` almış beş JSON raporu.

- [ ] **Step 1: Beş araştırma subagent'ını paralel başlat**

Task 3 Step 1 promptunu batch, ders ve hedeflerle kullan. AYT Tarih/Coğrafya alt ders kuralını promptta hatırlat: tek alt dersi hedefleyen kitaplar; iki alt dersi birlikte kapsayan tek cilt yok.

- [ ] **Step 2: Reviewer B ile incele**

Task 3 Step 3 reviewer promptunu bu beş batch için kullan. FAIL döngüsü aynı.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/research/catalog-2026-11-23
git commit -m "docs: add AYT catalog research and reviews"
```

---

### Task 6: Raporları TS modüllerine birleştir ve katalog testlerini tamamla

**Files:**
- Modify: `src/data/catalog/*.ts` (build script üretir)
- Modify: `src/data/catalog/index.ts` (build script üretir)
- Modify: `src/data/catalogBooks.test.ts`

**Interfaces:**
- Consumes: Task 3–5'in PASS raporları, `scripts/build-catalog.mjs`.
- Produces: `CATALOG_SEED.length >= 500`; ders bazlı modüller dolu; katalog veri testleri.

- [ ] **Step 1: Build script'ini çalıştır**

Run:
```bash
node scripts/build-catalog.mjs
```
Expected: Toplam satır sayısı en az 500; her ders için hedefe yakın sayı; hata yok.

- [ ] **Step 2: Mevcut testlerdeki sabit katalog sayılarını güncelle**

`src/db/catalogRepository.test.ts`:
- `expect(CATALOG_SEED).toHaveLength(80)` → `expect(CATALOG_SEED.length).toBeGreaterThanOrEqual(500)`.
- `expect(biyotik).toHaveLength(6)` → `expect(biyotik.length).toBeGreaterThanOrEqual(6)`.
- `expect(biyotik.map(...).sort()).toEqual([...])` → `expect(biyotik.map(...)).toEqual(expect.arrayContaining([...]))`; yeni Biyotik kitapları listeyi büyütebilir.
- `expect(apotemi).toHaveLength(7)` → `expect(apotemi.length).toBeGreaterThanOrEqual(7)`.

`src/features/books/books.test.tsx`:
- "orbital" aramasındaki `toHaveLength(4)` → `toBeGreaterThanOrEqual(4)`.

- [ ] **Step 3: Katalog veri testlerini genişlet**

`src/data/catalogBooks.test.ts` içine ekle:

```ts
import { CURRICULUM } from './curriculum';

const SUBJECT_SLUGS = new Set(CURRICULUM.subjects.map((subject) => subject.slug));

test('katalog en az 500 geçerli kitap içerir', () => {
  expect(CATALOG_SEED.length).toBeGreaterThanOrEqual(500);

  for (const book of CATALOG_SEED) {
    expect(['TYT', 'AYT']).toContain(book.exam);
    expect(SUBJECT_SLUGS.has(book.subjectSlug)).toBe(true);
    expect(Number.isInteger(book.totalPages)).toBe(true);
    expect(book.totalPages).toBeGreaterThan(0);
    expect(book.title.trim()).not.toBe('');
    expect(book.publisher.trim()).not.toBe('');
    expect(book.edition).toMatch(/^\d{4}$/);
  }
});

test('aynı title + publisher ikinci kez geçmez', () => {
  const keys = CATALOG_SEED.map((book) => `${book.title}|${book.publisher}`);
  expect(new Set(keys).size).toBe(keys.length);
});

test('her derste en az 5 kitap var', () => {
  const counts = new Map<string, number>();
  for (const book of CATALOG_SEED) {
    const key = `${book.exam}|${book.subjectSlug}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const subject of CURRICULUM.subjects) {
    expect(counts.get(`${subject.exam}|${subject.slug}`) ?? 0).toBeGreaterThanOrEqual(5);
  }
});

test('fasikül, problem ve paragraf kapsamı yeterli', () => {
  const titles = CATALOG_SEED.map((book) => book.title.toLocaleLowerCase('tr-TR'));
  expect(titles.filter((title) => title.includes('fasikül')).length).toBeGreaterThanOrEqual(25);
  expect(titles.filter((title) => title.includes('problem')).length).toBeGreaterThanOrEqual(15);
  expect(titles.filter((title) => title.includes('paragraf')).length).toBeGreaterThanOrEqual(15);
});
```

- [ ] **Step 4: Testleri çalıştır**

Run:
```bash
npm run test:run -- src/data/catalogBooks.test.ts src/db/catalogRepository.test.ts src/features/books/books.test.tsx
```
Expected: PASS. Sayı hedefin altındaysa build script çıktısındaki eksik dersler için Task 3–5'e ek araştırma gönder; test geçmeden devam etme.

- [ ] **Step 5: Tip kontrolü**

Run:
```bash
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/catalog src/data/catalogBooks.test.ts src/db/catalogRepository.test.ts src/features/books/books.test.tsx
git commit -m "feat: expand catalog to 500+ verified books"
```

---

## Phase 3 — Katalog UI ve seed performansı

### Task 7: `seedCatalog()` toplu yazma

**Files:**
- Modify: `src/db/catalogRepository.ts`
- Test: `src/db/catalogRepository.test.ts`

**Interfaces:**
- Consumes: `CATALOG_SEED`, `catalogBookId`.
- Produces: `seedCatalog(): Promise<void>` aynı imza; `bulkGet` + `bulkAdd`.

- [ ] **Step 1: Mevcut satırı ezmeme testini yaz**

`src/db/catalogRepository.test.ts` içine ekle:

```ts
test('tohum mevcut satırı ezmez ve yalnızca eksikleri ekler', async () => {
  await seedCatalog();
  const first = (await listCatalogBooks())[0];
  await db.catalogBooks.update(first.id, { title: 'Kullanıcı düzenlemesi' });

  await seedCatalog();

  expect((await db.catalogBooks.get(first.id))?.title).toBe('Kullanıcı düzenlemesi');
  expect(await db.catalogBooks.count()).toBe(CATALOG_SEED.length);
});
```

- [ ] **Step 2: Testi çalıştır**

Run:
```bash
npm run test:run -- src/db/catalogRepository.test.ts
```
Expected: PASS (mevcut implementasyon da bu davranışı verir). Bu test regresyonu kilitler.

- [ ] **Step 3: `seedCatalog`ı toplu hale getir**

`src/db/catalogRepository.ts`:

```ts
export async function seedCatalog(): Promise<void> {
  const now = new Date().toISOString();
  const rows: CatalogBook[] = CATALOG_SEED.map((seed) => ({
    id: catalogBookId(seed.title, seed.publisher, seed.edition),
    title: seed.title,
    publisher: seed.publisher,
    exam: seed.exam,
    subjectSlug: seed.subjectSlug,
    totalPages: seed.totalPages,
    edition: seed.edition,
    createdAt: now,
    updatedAt: now,
  }));

  await db.transaction('rw', db.catalogBooks, async () => {
    const existing = await db.catalogBooks.bulkGet(rows.map((row) => row.id));
    const existingIds = new Set(
      existing.filter((row): row is CatalogBook => row !== undefined).map((row) => row.id),
    );
    const missing = rows.filter((row) => !existingIds.has(row.id));
    if (missing.length > 0) {
      await db.catalogBooks.bulkAdd(missing);
    }
  });
}
```

- [ ] **Step 4: Testleri çalıştır**

Run:
```bash
npm run test:run -- src/db/catalogRepository.test.ts src/db/backup.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/catalogRepository.ts src/db/catalogRepository.test.ts
git commit -m "perf: seed catalog with bulk reads and writes"
```

---

### Task 8: Katalog modalında kademeli listeleme ve edition

**Files:**
- Modify: `src/features/books/BookCatalogModal.tsx`
- Test: `src/features/books/books.test.tsx`

**Interfaces:**
- Consumes: `listCatalogBooks()`, `searchCatalog()`.
- Produces: `BookCatalogModal` ilk 60 satır; `Daha fazla göster`; satırda edition.

- [ ] **Step 1: Testleri yaz**

`src/features/books/books.test.tsx` içine ekle:

```tsx
test('katalog 500+ kitapta ilk 60 satırı gösterir ve daha fazlasını açar', async () => {
  await seedCatalog();
  renderApp('/kitaplar');

  await userEvent.click(await screen.findByRole('button', { name: 'Kitap ekle' }));
  const dialog = await screen.findByRole('dialog', { name: 'Kitap ekle' });

  await within(dialog).findByText(`${CATALOG_SEED.length} kitap`);
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(60);

  await userEvent.click(within(dialog).getByRole('button', { name: /Daha fazla göster/ }));
  expect(within(dialog).getAllByRole('listitem')).toHaveLength(120);
});
```

`books.test.tsx` dosyasının importlarına `CATALOG_SEED` ekle. Ayrıca arama testinde edition metnini kontrol et:

```tsx
expect(within(dialog).getAllByText(/2026/).length).toBeGreaterThan(0);
```

- [ ] **Step 2: Testi çalıştır**

Run:
```bash
npm run test:run -- src/features/books/books.test.tsx
```
Expected: FAIL — 500+ satır tek seferde render edildiği için 60/120 beklentisi tutmaz.

- [ ] **Step 3: Modalı güncelle**

`BookCatalogModal.tsx`:

```tsx
const PAGE_SIZE = 60;

const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

useEffect(() => {
  setVisibleCount(PAGE_SIZE);
}, [query]);

const visibleBooks = books.slice(0, visibleCount);
const remaining = books.length - visibleCount;
```

Liste başında sayı:

```tsx
<p className="text-xs text-muted">
  {trimmedQuery ? `"${trimmedQuery}" için ${books.length} sonuç` : `${books.length} kitap`}
</p>
```

Satır meta:

```tsx
{book.publisher ?? 'Yayınevi belirtilmedi'} · {book.edition ?? 'Baskı yok'} ·{' '}
{book.totalPages > 0 ? `${book.totalPages} sayfa` : 'Sayfa sayısı belirtilmedi'}
```

Liste sonunda:

```tsx
{remaining > 0 ? (
  <Button variant="secondary" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
    Daha fazla göster ({remaining} kaldı)
  </Button>
) : null}
```

`visibleBooks.map` kullan; `books.map` değil.

- [ ] **Step 4: Testleri çalıştır**

Run:
```bash
npm run test:run -- src/features/books/books.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/books/BookCatalogModal.tsx src/features/books/books.test.tsx
git commit -m "feat: paginate large catalog and show editions"
```

---

## Phase 4 — Bugünün planı ve görev formu

### Task 9: Bugünün planında yayınevi

**Files:**
- Modify: `src/features/dashboard/TodayPlanCard.tsx`
- Test: `src/features/dashboard/dashboard.test.tsx`

**Interfaces:**
- Consumes: `scheduleTaskContent` from `@/domain/schedule`, `ShelfBook`.
- Produces: Kitap etiketi `Yayınevi · Kitap Adı Syf. X–Y`.

- [ ] **Step 1: Testi yaz**

`dashboard.test.tsx` içine ekle:

```tsx
test('bugünün planında kitap görevi yayıneviyle görünür', async () => {
  const userBook = await addCustomBook({
    title: 'Fizik Soru Bankası',
    publisher: 'Bilgi Sarmal',
    exam: 'TYT',
    subjectSlug: 'fizik',
    totalPages: 100,
  });
  const { week } = await getOrCreateWeek(weekStartOf(new Date()));
  const row = await addRow(week.id, 'Fizik');
  await addTask({
    weekId: week.id,
    rowId: row.id,
    dayIndex: todayDayIndex(),
    type: 'book',
    userBookId: userBook.id,
    fromPage: 1,
    toPage: 20,
  });

  renderApp('/');

  expect(
    await screen.findByRole('checkbox', {
      name: 'Bilgi Sarmal · Fizik Soru Bankası Syf. 1–20 görevini tamamla',
    }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Testi çalıştır**

Run:
```bash
npm run test:run -- src/features/dashboard/dashboard.test.tsx
```
Expected: FAIL — etiket yayınevi içermiyor.

- [ ] **Step 3: `TodayPlanCard`i güncelle**

`taskLabel` içinde `scheduleTaskContent` kullan:

```ts
import { scheduleTaskContent } from '@/domain/schedule';

function taskLabel(
  task: ScheduleTask,
  books: ReadonlyArray<ShelfBook>,
  topics: ReadonlyArray<Topic>,
): string {
  const shelfBook =
    task.type === 'book'
      ? books.find((row) => row.userBook.id === task.userBookId)
      : undefined;
  const content = scheduleTaskContent(task, {
    bookTitle: shelfBook?.catalogBook.title,
    bookPublisher: shelfBook?.catalogBook.publisher,
    topicName:
      task.type === 'topic'
        ? topics.find((topic) => topic.id === task.topicId)?.name
        : undefined,
  });
  return content.detail ? `${content.title} ${content.detail}` : content.title;
}
```

- [ ] **Step 4: Testleri çalıştır**

Run:
```bash
npm run test:run -- src/features/dashboard/dashboard.test.tsx
```
Expected: PASS; eski yayınevisiz test de geçer.

- [ ] **Step 5: Commit**

```bash
git add src/features/dashboard/TodayPlanCard.tsx src/features/dashboard/dashboard.test.tsx
git commit -m "feat: show publisher in today's plan"
```

---

### Task 10: `ShelfBookPicker` bileşeni

**Files:**
- Create: `src/features/schedule/ShelfBookPicker.tsx`
- Test: `src/features/schedule/ShelfBookPicker.test.tsx`

**Interfaces:**
- Consumes: `ShelfBook[]`, `tokenizeTr`, `matchesTokens`.
- Produces:

```ts
export interface ShelfBookPickerProps {
  id: string;
  books: ReadonlyArray<ShelfBook>;
  value: string;
  onChange: (userBookId: string) => void;
  disabled?: boolean;
}
```

- [ ] **Step 1: Bileşen testini yaz**

`ShelfBookPicker.test.tsx` içinde iki `ShelfBook` fixture'ı oluştur (biri Bilgi Sarmal TYT Matematik, biri 3D AYT Fizik). Testler:

```tsx
render(
  <ShelfBookPicker id="kitap" books={books} value="" onChange={onChange} />,
);

const input = screen.getByLabelText('Kitap ara');
await userEvent.type(input, 'bilgi');
expect(screen.getByRole('option', { name: /Bilgi Sarmal/ })).toBeInTheDocument();
expect(screen.queryByRole('option', { name: /3D Yayınları/ })).not.toBeInTheDocument();

await userEvent.click(screen.getByRole('option', { name: /Bilgi Sarmal/ }));
expect(onChange).toHaveBeenCalledWith(books[0].userBook.id);
```

Klavye testi:

```tsx
await userEvent.type(input, 'sarmal');
await userEvent.keyboard('{ArrowDown}{Enter}');
expect(onChange).toHaveBeenCalledWith(books[0].userBook.id);
```

Seçili özet testi: `value={books[0].userBook.id}` ile render et; `Seçili: TYT Matematik Soru Bankası` ve `Değiştir` düğmesi görünür.

Sonuç yok testi: `"zzz"` yaz; `Rafında eşleşen kitap yok.` metni görünür.

- [ ] **Step 2: Testi çalıştır**

Run:
```bash
npm run test:run -- src/features/schedule/ShelfBookPicker.test.tsx
```
Expected: FAIL — bileşen yok.

- [ ] **Step 3: Bileşeni yaz**

Davranış:
- `query` state'i; `selected = books.find((book) => book.userBook.id === value)`.
- `results`: sorgu varsa `title + publisher + subjectSlug` üzerinden `matchesTokens`; yoksa `books.slice(0, 8)`. En fazla 8.
- Input: `id`, `type="search"`, `aria-label="Kitap ara"`, placeholder `Kitap veya yayınevi ara`, `autoComplete="off"`.
- Input altında sonuç listesi: `role="listbox"`, her sonuç `role="option"`, `aria-selected`.
- Satır: kitap adı; alt satır `yayınevi · edition · X sayfa`.
- Seçimde `onChange(userBook.id)`, `setQuery('')`.
- Seçili kitap varsa üstte/altında `Seçili: <title>` ve `Değiştir` düğmesi; `Değiştir` `onChange('')` çağırır ve inputa odaklanır.
- Klavye: `ArrowDown/ArrowUp` aktif index; `Enter` seçer.
- `value` dolu ama `books` içinde yoksa: `Seçili kitap rafında bulunamadı.` uyarısı.
- Boş raf: `Rafında kitap yok. Kitaplar sayfasından ekleyebilirsin.`

- [ ] **Step 4: Testleri çalıştır**

Run:
```bash
npm run test:run -- src/features/schedule/ShelfBookPicker.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/schedule/ShelfBookPicker.tsx src/features/schedule/ShelfBookPicker.test.tsx
git commit -m "feat: add searchable shelf book picker"
```

---

### Task 11: Görev formuna aramalı seçiciyi bağla

**Files:**
- Modify: `src/features/schedule/ScheduleTaskModal.tsx`
- Test: `src/features/schedule/schedule.test.tsx`

**Interfaces:**
- Consumes: `ShelfBookPicker`.
- Produces: Kitap görevinde `<select>` yerine arama kutusu; `canSave` seçili kitap rafta varsa true.

- [ ] **Step 1: Mevcut testleri güncelle**

`schedule.test.tsx` içindeki `selectOptions` kullanan testleri arama akışına çevir:

```tsx
const search = within(dialog).getByLabelText('Kitap ara');
await userEvent.type(search, 'bilgi sarmal');
await userEvent.click(
  within(dialog).getByRole('option', { name: /Bilgi Sarmal/ }),
);
```

Aynı dosyaya yeni bir entegrasyon testi ekle: iki farklı yayınevinden kitap varken "3d" yaz, yalnızca 3D sonucu kalır, seç, kaydet; DB'de `userBookId` doğru.

- [ ] **Step 2: Testleri çalıştır**

Run:
```bash
npm run test:run -- src/features/schedule/schedule.test.tsx
```
Expected: FAIL — form hâlâ `<select>`.

- [ ] **Step 3: `ScheduleTaskModal`u güncelle**

`<select>` bloğunu şununla değiştir:

```tsx
<Field
  label="Kitap ara"
  htmlFor={bookId}
  hint={
    selectedBook
      ? `Toplam ${selectedBook.totalPages} sayfa`
      : 'Rafındaki aktif kitaplardan birini ara ve seç.'
  }
>
  <ShelfBookPicker
    id={bookId}
    books={books ?? []}
    value={selectedBookId}
    onChange={setSelectedBookId}
    disabled={loading}
  />
</Field>
```

`canSave` koşulunu güncelle:

```ts
const canSave =
  !saving &&
  !loading &&
  (type === 'book'
    ? selectedBookId !== '' && selectedBook !== undefined
    : type === 'topic'
      ? selectedTopicId !== ''
      : trimmedTitle !== '');
```

- [ ] **Step 4: Testleri çalıştır**

Run:
```bash
npm run test:run -- src/features/schedule/schedule.test.tsx src/features/schedule/ShelfBookPicker.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/schedule/ScheduleTaskModal.tsx src/features/schedule/schedule.test.tsx
git commit -m "feat: use searchable book picker in schedule task form"
```

---

## Phase 5 — Kitap tabanlı konu tahmini

### Task 12: `subjectEstimate` domain fonksiyonları

**Files:**
- Create: `src/domain/subjectEstimate.ts`
- Test: `src/domain/subjectEstimate.test.ts`

**Interfaces:**
- Consumes: `ExamType`, `Progress`.
- Produces:

```ts
export interface SubjectBookMatch {
  title: string;
  exam?: ExamType;
  subjectSlug?: string;
}

export interface SubjectRef {
  exam: ExamType;
  slug: string;
}

export function countsForSubject(book: SubjectBookMatch, subject: SubjectRef): boolean;

export function distributeBookPercent(
  topicIds: readonly string[],
  books: ReadonlyArray<{ percent: number }>,
): Map<string, number>;

export function subjectBookEstimate(
  topicIds: readonly string[],
  books: ReadonlyArray<{ percent: number }>,
): { byTopic: Map<string, number>; estimate: number };

export function effectiveTopicPercent(manualDone: boolean, bookPercent: number): number;

export function calculateSubjectProgress(
  topicPercents: readonly number[],
  anyStarted: boolean,
): Progress;
```

- [ ] **Step 1: Testleri yaz**

`subjectEstimate.test.ts`:

```ts
import { expect, test } from 'vitest';
import {
  calculateSubjectProgress,
  countsForSubject,
  distributeBookPercent,
  effectiveTopicPercent,
  subjectBookEstimate,
} from './subjectEstimate';

const TOPICS = ['t1', 't2', 't3', 't4'];

test('ders eşleşmesi sınav ve slug üzerinden çalışır', () => {
  expect(countsForSubject(
    { title: 'TYT Matematik Soru Bankası', exam: 'TYT', subjectSlug: 'matematik' },
    { exam: 'TYT', slug: 'matematik' },
  )).toBe(true);
  expect(countsForSubject(
    { title: 'TYT Matematik Soru Bankası', exam: 'TYT', subjectSlug: 'matematik' },
    { exam: 'AYT', slug: 'matematik' },
  )).toBe(false);
});

test('TYT-AYT ortak kitabı iki sınava da sayılır', () => {
  const book = { title: 'TYT-AYT Geometri Soru Bankası', exam: 'TYT' as const, subjectSlug: 'geometri' };
  expect(countsForSubject(book, { exam: 'TYT', slug: 'geometri' })).toBe(true);
  expect(countsForSubject(book, { exam: 'AYT', slug: 'geometri' })).toBe(true);
});

test('kitap yüzdesi konulara sırayla dağıtılır', () => {
  expect([...distributeBookPercent(TOPICS, [{ percent: 25 }]).values()]).toEqual([25, 0, 0, 0]);
  expect([...distributeBookPercent(TOPICS, [{ percent: 50 }]).values()]).toEqual([50, 0, 0, 0]);
  expect([...distributeBookPercent(TOPICS, [{ percent: 75 }]).values()]).toEqual([50, 25, 0, 0]);
  expect([...distributeBookPercent(TOPICS, [{ percent: 100 }]).values()]).toEqual([50, 50, 50, 50]);
});

test('iki kitap bir konuyu tamamlar', () => {
  const values = [...distributeBookPercent(TOPICS, [{ percent: 100 }, { percent: 100 }]).values()];
  expect(values).toEqual([100, 100, 100, 100]);
});

test('dolu konular atlanır', () => {
  const values = [...distributeBookPercent(TOPICS, [
    { percent: 100 },
    { percent: 50 },
    { percent: 50 },
  ]).values()];
  expect(values).toEqual([100, 100, 50, 50]);
});

test('kitap tahmini konu ortalamasının floor değeridir', () => {
  expect(subjectBookEstimate(TOPICS, [{ percent: 25 }])).toEqual({
    byTopic: new Map([['t1', 25], ['t2', 0], ['t3', 0], ['t4', 0]]),
    estimate: 6,
  });
  expect(subjectBookEstimate(TOPICS, [{ percent: 100 }]).estimate).toBe(50);
});

test('manuel bitirme kitap katkısını düşürmez', () => {
  expect(effectiveTopicPercent(true, 0)).toBe(100);
  expect(effectiveTopicPercent(false, 25)).toBe(25);
  expect(effectiveTopicPercent(true, 50)).toBe(100);
});

test('ders yüzdesi ortalamadır ve tümü bitmeden 99u geçmez', () => {
  expect(calculateSubjectProgress([25, 0, 0, 0], true)).toMatchObject({
    percent: 6, solved: 0, total: 4, remaining: 4, started: true, done: false,
  });
  expect(calculateSubjectProgress([100, 100, 100, 100], true)).toMatchObject({
    percent: 100, solved: 4, total: 4, remaining: 0, done: true,
  });
  expect(calculateSubjectProgress([99, 100, 100, 100], true)).toMatchObject({
    percent: 99, solved: 3, done: false,
  });
});
```

- [ ] **Step 2: Testi çalıştır**

Run:
```bash
npm run test:run -- src/domain/subjectEstimate.test.ts
```
Expected: FAIL — dosya yok.

- [ ] **Step 3: Domain fonksiyonlarını yaz**

Kurallar:
- `countsForSubject`: slug eşleşmeli; `exam` eşleşmeli veya başlık `/TYT\s*[-–]\s*AYT/i` içermeli.
- `distributeBookPercent`: her kitap için `percent = clamp(percent, 0, 100)`. **`percent >= 100` ise her konuya `min(50, 100 - katkı)` ekle ve devam et** (bitmiş kitap dersin tamamını kapsar). Kısmi kitapta `kalan = percent`; konular sırayla; `oda = min(50, 100 - katkı)`; `pay = min(kalan, oda)`; `pay <= 0` ise atla; katkıya ekle; `kalan === 0` ise dur.
- `subjectBookEstimate`: `byTopic` map; `estimate = floor(average(values))`, cap 100, boşsa 0.
- `effectiveTopicPercent`: `max(manualDone ? 100 : 0, bookPercent)`.
- `calculateSubjectProgress`: `solved = percent >= 100` sayısı; `done = total > 0 && solved === total`; `percent = done ? 100 : min(99, floor(average))`; `remaining = total - solved`; `started = anyStarted`.

- [ ] **Step 4: Testleri çalıştır**

Run:
```bash
npm run test:run -- src/domain/subjectEstimate.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/subjectEstimate.ts src/domain/subjectEstimate.test.ts
git commit -m "feat: add sequential subject estimate domain"
```

---

### Task 13: Progress hook'larına kitap tahminini bağla

**Files:**
- Modify: `src/db/repositories.ts` (`getSubject`, `getTopic`)
- Modify: `src/lib/progress.ts`
- Test: `src/lib/progress.test.tsx`
- Test: `src/lib/subjectBookProgress.test.tsx` (yeni)

**Interfaces:**
- Consumes: `subjectEstimate` fonksiyonları, `listShelfBooks()`.
- Produces:
  - `SubjectOverview` yeni alanları: `bookEstimate: number`, `manualDoneCount: number`.
  - `TopicProgressRow` yeni alanları: `bookPercent: number`, `manualDone: boolean`.
  - `useTopicEstimate(topicId: string): { progress: Progress; bookPercent: number; manualDone: boolean } | undefined`
  - `useTopicProgress` aynı imza; içinde `useTopicEstimate` kullanır.
  - `getSubject(id)`, `getTopic(id)`.

- [ ] **Step 1: Repository fonksiyonlarını ekle**

`src/db/repositories.ts`:

```ts
export function getSubject(id: string): Promise<Subject | undefined> {
  return db.subjects.get(id);
}

export function getTopic(id: string): Promise<Topic | undefined> {
  return db.topics.get(id);
}
```

- [ ] **Step 2: Yeni hook testlerini yaz**

`src/lib/subjectBookProgress.test.tsx`: 4 konulu `TYT Fizik` fixture'ı ile:

```tsx
test('kitap ilerlemesi konulara sırayla yansır', async () => {
  const subject = (await listSubjects('TYT')).find((item) => item.slug === 'fizik')!;
  const userBook = await addCustomBook({
    title: 'Fizik Soru Bankası',
    exam: 'TYT',
    subjectSlug: 'fizik',
    totalPages: 100,
  });
  await addBookPageRange(userBook.id, 1, 25);

  const { result } = renderHook(() => useSubjectOverview(subject.id));

  await waitFor(() => {
    expect(result.current?.bookEstimate).toBe(6);
    expect(result.current?.topics.map((row) => row.progress.percent)).toEqual([25, 0, 0, 0]);
    expect(result.current?.progress.percent).toBe(6);
  });
});
```

Ek testler:
- 1 kitap %100 → tüm konular 50, `bookEstimate` 50, ders 50.
- 2 kitap %100 → tümü 100.
- Manuel biten konu + kitap %25 → ilk konu 100, ders 25, `manualDoneCount` 1.
- Arşivli kitap katkı vermez.
- Toplam sayfası 0 kitap katkı vermez.
- "TYT-AYT Geometri" kitabı AYT Geometri'ye sayılır.
- `useTopicEstimate` konu katkısını döndürür.

- [ ] **Step 3: Testi çalıştır**

Run:
```bash
npm run test:run -- src/lib/subjectBookProgress.test.tsx
```
Expected: FAIL — hook'lar kitap tahminini bilmiyor.

- [ ] **Step 4: `progress.ts`i güncelle**

`useSubjectOverview`:
- `Promise.all` içine `getSubject(subjectId)` ve `listShelfBooks()` ekle.
- Kitapları filtrele: `book.progress.hasTotalPages` ve `countsForSubject({title, exam, subjectSlug}, subject)`.
- `subjectBookEstimate(topics.map(t => t.id), books.map(b => ({ percent: b.progress.percent })))`.
- Her konu için:
  - `manualDone = doneByTopic.get(topic.id) === true`
  - `bookPercent = byTopic.get(topic.id) ?? 0`
  - `effective = effectiveTopicPercent(manualDone, bookPercent)`
  - `progress` nesnesi: `{ solved: effective >= 100 ? 1 : 0, total: 1, percent: effective, remaining: effective >= 100 ? 0 : 1, started: manualDone || reviewCount > 0 || bookPercent > 0, done: effective >= 100 }`
  - `bookPercent` alanını satıra ekle.
- `TopicProgressRow` arayüzüne `manualDone: boolean` ekle; her satırda doldur.
- `manualDoneCount = rows.filter((row) => row.manualDone).length`.
- Ders progress: `calculateSubjectProgress(rows.map(row => row.progress.percent), rows.some(row => row.progress.started))`.
- `SubjectOverview` dönüşüne `bookEstimate` ve `manualDoneCount` ekle.

`useTopicEstimate`:
- `getTopic(topicId)`, `getSubject(topic.subjectId)`, `listTopics(subject.id)`, `listShelfBooks()`, `getTopicDone`, `listTopicReviews`.
- Aynı filtre ve `subjectBookEstimate`.
- `bookPercent = byTopic.get(topicId) ?? 0`; `manualDone`; `effective`.
- `Progress` nesnesi yukarıdaki gibi.
- `useTopicProgress` = `useTopicEstimate(topicId)?.progress`.

- [ ] **Step 5: Mevcut progress testlerini çalıştır**

Run:
```bash
npm run test:run -- src/lib/progress.test.tsx src/lib/subjectBookProgress.test.tsx
```
Expected: PASS. Kitapsız fixture'larda `bookEstimate 0`, eski davranış korunur.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories.ts src/lib/progress.ts src/lib/progress.test.tsx src/lib/subjectBookProgress.test.tsx
git commit -m "feat: derive subject progress from shelf books"
```

---

### Task 14: Ders ve konu arayüzlerine tahmini yansıt

**Files:**
- Modify: `src/features/subjects/SubjectCard.tsx`
- Modify: `src/features/subjects/SubjectPage.tsx`
- Modify: `src/features/subjects/TopicRow.tsx`
- Modify: `src/features/topics/TopicPage.tsx`
- Modify: `src/features/topics/TopicStatusTab.tsx`
- Test: `src/features/subjects/subjects.test.tsx`
- Test: `src/features/topics/tests.test.tsx`

**Interfaces:**
- Consumes: `SubjectOverview.bookEstimate`, `TopicProgressRow.bookPercent`, `useTopicEstimate`.
- Produces: Ders kartı/sayfası ve konu satırı etkin yüzdeyi gösterir; durum metinleri güncellenir.

- [ ] **Step 1: Ders UI testini yaz**

`subjects.test.tsx` içine ekle:

```tsx
test('kitap ilerlemesi ders ve konu yüzdesine yansır', async () => {
  const subject = await subjectByKey('ayt-matematik');
  const userBook = await addCustomBook({
    title: 'AYT Matematik Soru Bankası',
    exam: 'AYT',
    subjectSlug: 'matematik',
    totalPages: 100,
  });
  await addBookPageRange(userBook.id, 1, 100);

  renderApp(`/ayt/${subject.id}`);

  expect(await screen.findByText(/Kitap tahmini %50/)).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Matematik genel ilerlemesi' }))
    .toHaveAttribute('aria-valuenow', '50');
  expect(screen.getAllByText('%50').length).toBeGreaterThan(0);
});
```

`addCustomBook` ve `addBookPageRange` importlarını ekle.

- [ ] **Step 2: Testi çalıştır**

Run:
```bash
npm run test:run -- src/features/subjects/subjects.test.tsx
```
Expected: FAIL — UI kitap tahminini göstermiyor.

- [ ] **Step 3: UI bileşenlerini güncelle**

`SubjectPage` alt metni:

```tsx
{progress.total === 0
  ? 'Henüz konu yok'
  : progress.done
    ? `${progress.solved}/${progress.total} konu · Tümü bitti`
    : overview.bookEstimate > 0
      ? `${progress.solved}/${progress.total} konu · Kitap tahmini %${overview.bookEstimate}`
      : `${progress.solved}/${progress.total} konu · ${progress.remaining} konu kaldı`}
```

`SubjectCard.cardMessage` önceliği:

```ts
if (overview.progress.done) return 'Tüm konular tamam';
if (overview.bookEstimate > 0) return `Kitap tahmini: %${overview.bookEstimate}`;
```

`TopicRow` değişmez: `progress.percent`, `progress.started` ve `progress.done` artık etkin değerleri taşıdığı için mevcut `statusLabel` ve `ProgressBar` doğru çalışır.

`TopicPage` `useTopicProgress` yerine `useTopicEstimate` kullanır:

```tsx
const estimate = useTopicEstimate(topicId);
// ...
if (!estimate || reviewCount === undefined) { ... }
const progress = estimate.progress;
```

`TopicStatusTab` prop'una `bookPercent` ekle:

```ts
export interface TopicStatusTabProps {
  topicId: string;
  bookPercent?: number;
}
```

İpucu:

```tsx
{bookPercent && bookPercent > 0
  ? `Kitap ilerlemesi bu konuya %${bookPercent} ekliyor; kutu yalnızca elle bitirme kaydıdır.`
  : data.done
    ? 'Bu konu bitti olarak işaretli.'
    : 'Konuyu tamamladığında işaretle; ders ilerlemesi bu duruma göre hesaplanır.'}
```

`TopicPage` içinde `<TopicStatusTab topicId={topic.id} bookPercent={estimate.bookPercent} />`.

- [ ] **Step 4: Testleri çalıştır**

Run:
```bash
npm run test:run -- src/features/subjects/subjects.test.tsx src/features/topics/tests.test.tsx src/lib/progress.test.tsx src/lib/subjectBookProgress.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/subjects src/features/topics
git commit -m "feat: show estimated progress on subject and topic screens"
```

---

## Phase 6 — Dokümantasyon ve doğrulama

### Task 15: README ve tam doğrulama

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: tüm önceki görevler.
- Produces: Güncel dokümantasyon ve geçen tam test/derleme.

- [ ] **Step 1: README'yi güncelle**

- "80 kitaplık" ifadesini "500+ kitaplık" yap.
- Katalog kapsamına fasikül, problemler, paragraf ve TYT/AYT tüm dersleri ekle.
- Görev formunda arama kutusu olduğunu yaz.
- Kitap ilerlemesinin ders konularına sıralı tahmin olarak yansıdığını, bir kitabın bir konuya en fazla %50 katkı verdiğini ve iki kitabın konuyu tamamladığını yaz.

- [ ] **Step 2: Tam test paketini çalıştır**

Run:
```bash
npm run test:run
```
Expected: Tüm testler PASS.

- [ ] **Step 3: Tip kontrolü ve derleme**

Run:
```bash
npm run typecheck
npm run build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update catalog and progress documentation"
```

---

### Task 16: Local preview ve kullanıcı onayı

**Files:**
- Create (geçici, commit edilmez): `C:\Users\user\AppData\Local\Temp\opencode\preview-*.mjs`
- Create (geçici): `C:\Users\user\AppData\Local\Temp\opencode\preview-*.png`

**Interfaces:**
- Consumes: çalışan dev sunucusu, tamamlanmış uygulama.
- Produces: Dört ekran görüntüsü ve local URL; kullanıcı onayı.

- [ ] **Step 1: Dev sunucusunu başlat**

Run (background):
```bash
npm run dev -- --host
```
Expected: Local URL (ör. `http://localhost:5173/`). URL'yi not et.

- [ ] **Step 2: Playwright ile önizleme verisini hazırla**

Geçici bir Playwright script'i yaz:
- Uygulamayı aç, onboarding'i tamamla.
- Katalogdan bir AYT Fizik kitabı ekle.
- Kitap detayında 1–100 sayfa aralığını gir; kitap %100 olsun. Bu, tek kitabın tüm konulara %50 vermesi için yeterli.
- Bugünün planına bir kitap görevi ekle.
- Bir ders sayfasına git.

- [ ] **Step 3: Dört ekran görüntüsü al**

- `preview-today-plan.png`: Bugünün planında `Yayınevi · Kitap` etiketi.
- `preview-task-search.png`: Görev formunda "bilgi" yazılmış, filtrelenmiş sonuçlar ve seçili kitap.
- `preview-catalog.png`: Katalog modalında 500+ kitap sayısı, arama ve "Daha fazla göster".
- `preview-subject-estimate.png`: Bir ders sayfasında `Kitap tahmini %50` ve konu yüzdeleri.

- [ ] **Step 4: Kullanıcıya göster**

Local URL'yi ve dört PNG yolunu kullanıcıya ver. Kullanıcıdan şunu iste: "Local preview'ı inceleyip onaylıyor musun? Onaylamadan `main`e push etmeyeceğim."

- [ ] **Step 5: Onay gelince dur**

Kullanıcı onaylayana kadar push/merge yapma. Onay gelirse ayrı bir adımda `main`e merge ve push yapılır; bu planın kapsamı dışındadır.

---

## Plan Özeti

- **Kod görevleri:** 16 görev; her biri kendi testi ve commit'i ile.
- **Araştırma:** 13 batch, 3 wave; 2 reviewer; PASS olmayan rapor birleşmez.
- **Kritik kapılar:** `CATALOG_SEED.length >= 500`, aynı `title + publisher` tekrarı yok, reviewer PASS, tüm testler/typecheck/build PASS.
- **Yayın kapısı:** local preview kullanıcı onayı olmadan push yok.
