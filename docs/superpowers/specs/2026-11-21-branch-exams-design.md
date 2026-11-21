# Branş Denemeleri Tasarımı

- Tarih: 2026-11-21
- Durum: Onay bekliyor
- Kapsam: Denemeler, deneme formu/detayı, dashboard istatistikleri, yedekleme

## 1. Özet

Deneme eklerken “Tam deneme” yanında **“Branş denemesi”** seçilebilecek. Branş
denemesi TYT veya AYT olacak; AYT’de alan (Sayısal / Eşit Ağırlık / Sözel)
seçilecek. Deneme tek bir branştan oluşacak (ör. TYT Sosyal, AYT Sayısal Fen) ve
tek satır D/Y/B/net girilecek. Branş denemeleri Denemeler sayfasında ayrı bir
**Branş** sekmesinde listelenecek ve seçilen branşın net trend grafiği
gösterilecek. Bu denemeler ana sayfadaki deneme net grafiğine, net ortalamasına
ve en yüksek net hesabına **karışmayacak**; normal TYT/AYT denemelerinin
grafiklerinde de görünmeyecek.

## 2. Neden

Öğrenci tam denemelerin yanında tek branş denemeleri de çözüyor. Bunları tam
deneme gibi kaydetmek, TYT/AYT net ortalamasını ve grafiğini bozuyor; ayrıca
TYT Sosyal gibi bir branşta Tarih/Coğrafya/Felsefe/Din ayrı ayrı satırlara
bölünüyor. Branş denemeleri kendi branşında, tek net olarak takip edilmeli.

## 3. Hedefler

- Deneme formunda “Tam deneme / Branş denemesi” seçimi.
- Branş denemesi TYT veya AYT; AYT’de alan seçimi.
- Branş başına tek satır D/Y/B/net; soru sayısı branş kataloğundan gelir.
- Denemeler sayfasında ayrı **Branş** sekmesi; TYT/AYT ve AYT alan filtresi,
  branş seçici, branş net trend grafiği ve branş denemesi listesi.
- Ana sayfa net grafiği, net ortalaması, en yüksek net ve “son denemeler”
  yalnızca tam denemeleri saysın.
- Normal TYT/AYT sekmeleri ve grafikleri yalnızca tam denemeleri göstersin.
- Branş denemesi detayında branş etiketi, tek net satırı ve aynı branştaki
  önceki denemeyle karşılaştırma.
- Eski denemeler ve eski yedekler otomatik “tam deneme” sayılsın; IndexedDB
  şema sürümü artmasın.

## 4. Hedef olmayanlar

- Bir branş denemesinde birden çok branş/ders satırı.
- Branş denemelerinde yanlış fotoğrafı yükleme (v1’de gösterilmez).
- Branş denemelerinin konu/kitap ilerlemesine veya fotoğraf arşivine bağlanması.
- Branş denemelerinin fotoğraf yükleme ve pratik deneme seçicilerinde görünmesi.
- Branş denemelerinin tam deneme ortalamasına/grafiğine dahil edilmesi.
- Branş başına ayrı bir ders kırılımı (branş zaten tek net).
- Yeni bir IndexedDB tablosu veya sürüm artışı.

## 5. Mevcut durum

- `Exam { type: 'TYT'|'AYT', alan?, ... }`; sonuçlar `ExamResult` tablosunda
  `subjectId` ile tutuluyor, net `correct - wrong/4`.
- `ExamFormPage` ders listesini `getExamSubjectConfig` ve `listSubjects` ile
  kuruyor; TYT’de Tarih/Coğrafya/Felsefe/Din ayrı satırlar.
- `ExamsPage` TYT/AYT filtreleri, toplam net grafiği, ders bazlı grafik ve
  AYT alan filtresi kullanıyor.
- Dashboard `netStatsFor` ve `buildNetSeries` tüm denemeleri sayıyor;
  “Son denemeler” tüm denemeleri listeliyor.
- `saveExam` sonuçları tamamen değiştiriyor; yedek şeması `examSchema` ve
  `examResultSchema`.

## 6. Yaklaşımlar

### A) `Exam.kind` + branş anahtarı + tek `ExamResult` satırı (seçilen)

`Exam` kaydına `kind: 'full' | 'branch'` ve branş denemelerinde `branch` alanı
eklenir. Branş sonucu mevcut `examResults` tablosunda tek satır olarak,
`subjectId = branchKey`, D/Y/B/net ile tutulur. Grafikler ve listeler
`exam.kind`/`exam.branch` ile filtrelenir.

- Artı: Yeni tablo yok; net, yedek, detay ve grafik altyapısı yeniden kullanılır;
  eski kayıtlar `kind` yoksa tam deneme sayılır.
- Eksi: `examResults.subjectId` gerçek bir ders kimliği değil, branş anahtarı
  olur; detay/liste etiketi branş kataloğundan çözülür.

### B) Ayrı `branchExams` tablosu (reddedildi)

Branş denemeleri için yeni tablo ve kendi sonuç alanları gerekir; liste, detay,
grafik, yedek ve silme kodunu ikiye katlar. Mevcut `Exam` yapısı bunu
desteklemeye uygun.

### C) Branşları gerçek ders olarak eklemek (reddedildi)

“TYT Sosyal”, “AYT Fen” gibi dersler konu/kitap/görünürlük listelerine sızar;
branş denemesi dışındaki ekranları bozar.

### UI: Ayrı üçüncü sekme (seçilen)

Denemeler sayfasına TYT / AYT / **Branş** üçlü filtresi eklenir. Branş
sekmesinde TYT/AYT alt filtresi, AYT’de alan filtresi, branş seçici, grafik ve
liste bulunur. Ayrı bir sayfa yerine aynı sayfada sekme, mevcut filtre diline
uyar.

## 7. Veri modeli

### 7.1 Tipler

```ts
export type ExamKind = 'full' | 'branch';

export type BranchExamKey =
  | 'tyt-turkce'
  | 'tyt-sosyal'
  | 'tyt-matematik'
  | 'tyt-fen'
  | 'ayt-sayisal-matematik'
  | 'ayt-sayisal-fen'
  | 'ayt-ea-matematik'
  | 'ayt-ea-edebiyat-sosyal-1'
  | 'ayt-sozel-edebiyat-sosyal-1'
  | 'ayt-sozel-sosyal-2';

export interface Exam {
  id: string;
  type: ExamType;
  name: string;
  date: string;
  alan?: AytAlan;
  /** Eski kayıtlarda yoksa tam deneme sayılır. */
  kind?: ExamKind;
  branch?: BranchExamKey;
  note: string;
  createdAt: string;
}
```

- `kind` yoksa `isBranchExam(exam)` false döner; yani eski kayıt tam denemedir.
- `branch` yalnızca `kind === 'branch'` kayıtlarda bulunur.
- `examResults.subjectId` branş denemesinde `branch` değeridir; gerçek ders
  kimlikleriyle çakışmaz.

### 7.2 Branş kataloğu

`src/features/exams/branchConfig.ts`:

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
```

| Anahtar | Tür | Alan | Etiket | Soru |
|---|---|---|---|---|
| `tyt-turkce` | TYT | — | Türkçe | 40 |
| `tyt-sosyal` | TYT | — | Sosyal | 20 |
| `tyt-matematik` | TYT | — | Matematik | 40 |
| `tyt-fen` | TYT | — | Fen | 20 |
| `ayt-sayisal-matematik` | AYT | Sayısal | Matematik | 40 |
| `ayt-sayisal-fen` | AYT | Sayısal | Fen | 40 |
| `ayt-ea-matematik` | AYT | EA | Matematik | 40 |
| `ayt-ea-edebiyat-sosyal-1` | AYT | EA | Edebiyat-Sosyal 1 | 40 |
| `ayt-sozel-edebiyat-sosyal-1` | AYT | Sözel | Edebiyat-Sosyal 1 | 40 |
| `ayt-sozel-sosyal-2` | AYT | Sözel | Sosyal 2 | 40 |

- TYT Sosyal: Tarih 5 + Coğrafya 5 + Felsefe 5 + Din 5.
- TYT Fen: Fizik 7 + Kimya 7 + Biyoloji 6.
- AYT Fen: Fizik 14 + Kimya 13 + Biyoloji 13.
- AYT Edebiyat-Sosyal 1: Edebiyat 24 + Tarih-1 10 + Coğrafya-1 6.
- AYT Sosyal 2: Tarih-2 11 + Coğrafya-2 11 + Felsefe Grubu 12 + Din 6.
- AYT Matematik: 30 matematik + 10 geometri.

### 7.3 Kayıt ve doğrulama

`SaveExamInput` alanlarına `kind?: ExamKind` ve `branch?: BranchExamKey` eklenir.

- `kind` verilmezse `'full'`.
- Branş denemesinde:
  - `type` TYT veya AYT;
  - `branch` zorunlu ve katalogda olmalı;
  - `branch` kataloğunun `type`/`alan` değeri denemeyle eşleşmeli;
  - AYT’de `alan` somut olmalı (`sayisal`/`ea`/`sozel`);
  - TYT’de `alan` tanımsız olmalı;
  - en fazla bir sonuç satırı; satır varsa `subjectId === branch` ve
    D+Y+B toplamı branş soru sayısını aşmamalı.
- Tam denemede `branch` tanımsız; mevcut doğrulama aynen kalır.
- `saveExam` `kind`/`branch` alanlarını yazar; `getExam`/`listExams` eski
  kayıtları olduğu gibi döndürür, `isBranchExam` ile tam sayılır.
- IndexedDB tablosu/şeması değişmez.

### 7.4 Yedekleme

`examSchema`:

```ts
kind: z.enum(['full', 'branch']).default('full'),
branch: z.string().optional(),
```

- Eski yedeklerde `kind` yoksa `full`; `branch` yoksa tanımsız.
- Branş denemeleri `exams`/`examResults` içinde normal şekilde taşınır.
- Yeni yedeklerde `kind`/`branch` korunur.
- `BACKUP_SCHEMA_VERSION` **4 → 5** yükseltilir. Eski (v4 ve öncesi) yedekler
  `kind` yoksa tam deneme olarak içe aktarılır; yeni yedeği eski uygulama
  “daha yeni yedek” uyarısıyla reddeder, böylece branş sınıflandırması sessizce
  kaybolmaz.
- İçe aktarmada `kind: 'branch'` satırı için `branch` zorunlu, katalogda
  bilinen bir anahtar ve `type`/`alan` ile eşleşmiş olmalıdır; aksi hâlde
  yedek “Geçersiz yedek dosyası” ile reddedilir.
- Bilinmeyen bir `branch` anahtarı yalnızca elle/bozuk veride görülürse etiket
  “Branş”e düşer; yedek doğrulaması bunu kabul etmez.

## 8. Deneme formu

### 8.1 Yeni deneme

- Formun üstünde “Deneme biçimi”: **Tam deneme** / **Branş denemesi**
  (iki düğmeli segmented control, `aria-pressed`).
- “Deneme türü” TYT/AYT seçimi aynı kalır.
- Branş denemesinde:
  - TYT: “Branş” seçimi (Türkçe / Sosyal / Matematik / Fen).
  - AYT: mevcut “AYT alanı” seçimi zorunlu; ardından alanın branşları
    (Sayısal: Matematik / Fen; EA: Matematik / Edebiyat-Sosyal 1;
    Sözel: Edebiyat-Sosyal 1 / Sosyal 2).
- “Ders sonuçları” kartı branş denemesinde tek satır gösterir:
  branş etiketi + soru sayısı, D, Y, B, Net. Toplam net bu satırın netidir.
- Branş satırı boş bırakılabilir; deneme sonradan düzenlenip doldurulabilir.
- Kaydetme `results` için satır doldurulduysa
  `{ subjectId: branch, correct, wrong, blank }` gönderir; boşsa `[]`.
- Branş formu `?brans=1&tur=TYT|AYT&alan=...&branch=...` parametrelerini okur;
  branş sekmesindeki “Yeni deneme” mevcut tür/alan/branş seçimini taşır.
  Kaydedince `/denemeler/:id` detayına gidilir.
- Branş denemesinde ders görünürlüğü, `hiddenSubjects`, geometri modu ve
  AYT alanına göre ders listesi mantığı kullanılmaz.

### 8.2 Düzenleme

- Düzenlemede “Deneme biçimi”, “Deneme türü”, AYT alanı ve branş
  değiştirilemez (farklı tür/branş için yeni deneme).
- Ad, tarih, not ve D/Y alanları düzenlenebilir.
- Branş sonucu `subjectId === branch` satırından okunur; yoksa boş gelir.

### 8.3 Form doğrulamaları

- Ad zorunlu; tarih geçerli.
- Branş denemesinde branş zorunlu; AYT’de alan zorunlu.
- D/Y tam sayı, 0 veya büyük; D+Y branş soru sayısını aşamaz.
- Mevcut Türkçe hata mesajları ve `aria-invalid` deseni korunur.

## 9. Denemeler sayfası

### 9.1 Üst filtre

- Üç düğme: **TYT**, **AYT**, **Branş**. URL `tur=TYT|AYT|BRANS`.
- TYT/AYT sekmeleri yalnızca `!isBranchExam` denemeleri listeler; mevcut
  toplam/ders grafiği ve AYT alan filtresi tam denemelerle çalışır.
- Branş sekmesi:
  - TYT/AYT alt filtresi;
  - AYT’de alan filtresi (Sayısal / EA / Sözel);
  - branş seçici (`branchesFor(type, alan)`);
  - seçilen branşın net trend grafiği (`NetTrendChart`);
  - seçilen branşın branş denemeleri listesi.
- Branş sekmesindeki “Yeni deneme” bağlantısı
  `/denemeler/yeni?brans=1&tur=TYT|AYT&alan=...&branch=...` ile formu branş
  modunda ve mevcut filtreyle açar.
- Açılış seçimleri: TYT’de `tyt-turkce`; AYT’de `settings.aytAlan` somut ise o
  alan, değilse `sayisal`; branş, seçilen alanın ilk branşı. Kullanıcı
  değiştirebilir.
- Ana “Yeni deneme” bağlantısı tam deneme formunu açar.

### 9.2 Branş grafiği

- Yalnızca `isBranchExam(exam) && exam.branch === selectedBranch` denemeleri.
- `buildNetSeries(branchExams, results, type, alan)` kullanılır; branş
  denemesinde tek sonuç satırı olduğu için toplam net branş netidir.
- Grafik başlığı: “TYT Sosyal branş denemeleri” gibi.
- Kayıt (record) mantığı aynı: yalnızca o branşın geçmişine göre rekor.
- Ders bazlı grafik seçicisi branş sekmesinde yoktur.

### 9.3 Branş listesi

- Seçilen branşın denemeleri, en yeniden eskiye.
- Kart: tarih · TYT/AYT · alan (AYT) · **Branş** · branş etiketi; toplam net;
  önceki aynı branş denemesine göre fark; tek satır D/Y/B/net.
- Karşılaştırma yalnızca aynı branştaki denemelerle yapılır.
- Kart tıklanınca branş denemesi detayı açılır.

## 10. Deneme detayı

- Başlık etiketi: `TYT · Branş · Sosyal` veya
  `AYT · Sayısal · Branş · Fen`.
- Toplam net ve önceki aynı branş denemesine göre fark.
- “Ders sonuçları” yerine tek satır: branş etiketi, D, Y, B, Net.
- “Yanlış fotoğrafları” kartı branş denemesinde gösterilmez.
- Düzenle/Sil aynı; silme sonuçları ve denemeyi kaldırır.
- Branş denemesi notu gösterilir.

## 11. Ana sayfa ve grafik filtreleri

- `netStatsFor` yalnızca `!isBranchExam` denemeleri sayar.
- Dashboard net grafiği `data.exams.filter(!isBranchExam)` ile beslenir.
- “Son denemeler” listesi ve “X deneme” sayısı yalnızca tam denemeleri sayar.
- Denemeler sayfasındaki TYT/AYT grafikleri ve `buildExamComparison` çağrıları
  tam denemelerle sınırlanır; branş grafiği/listesi kendi filtresini kullanır.
- `buildNetSeries`, `buildSubjectNetSeries`, `buildExamComparison` imzaları
  değişmez; çağıranlar filtreler. Böylece mevcut testler korunur.
- Global arama branş denemelerini de listeler; alt başlık
  `TYT · Branş · Sosyal · tarih · net` veya
  `AYT · Sayısal · Branş · Fen · tarih · net` olur. `searchAll.examSubtitle`
  branş etiketini ekler; arama sonucu branş detayına gider.
- Fotoğraf yükleme ve pratik deneme seçicileri branş denemelerini listelemez.

## 12. Doğrulama

- Birim:
  - Branş kataloğu: anahtarlar, tür/alan eşleşmesi, soru sayıları.
  - `saveExam`: branş kaydı, tek satır, yanlış branş/alan reddi, eski `kind`siz
    kayıt tam deneme.
  - Yedek: branş denemesi round-trip; `kind`/`branch` olmayan eski yedek tam.
  - `buildNetSeries`/dashboard filtreleri: branş denemesi ana seriye girmiyor;
    branş serisi yalnızca seçilen branşı alıyor.
  - Form: branş modu, TYT Sosyal tek satır, AYT alanına göre branş seçenekleri,
    düzenleme kilidi, D/Y doğrulaması.
- E2E:
  - Branş sekmesi → yeni TYT Sosyal branş denemesi → D/Y gir → kaydet →
    branş listesinde ve grafikte görünür.
  - Aynı deneme TYT tam deneme sekmesinde ve dashboard net kartlarında
    görünmez.
  - Branş denemesi detayında tek satır ve “Branş” etiketi.
  - Branş denemesi yeniden yüklenince korunur.
- Mevcut 336 birim ve 16 E2E testi geçmeye devam eder.

## 13. Önizleme ve teslim

- `npm run build` + `npm run preview`; 390/768/1440 ekran görüntüleri:
  branş formu (TYT ve AYT), branş sekmesi/grafiği, detay, dashboard’un
  değişmediği.
- Kullanıcı önizlemeyi onaylamadan push yok.
- Uygulama `opencode-go/deepseek-v4.1-flash#max` subagent’larıyla yapılır.

## 14. Uygulayıcıya kalanlar

- Branş formunun mevcut `ExamFormPage` içinde mi ayrı bileşende mi
  çözüleceği; dosya boyutu nedeniyle ayrı `BranchExamFields` bileşeni önerilir.
- Branş sekmesi alt filtrelerinin URL’de mi yerel durumda mı tutulacağı;
  mevcut `tur` parametresi korunur, alt filtreler yerel durumda kalabilir.
- Branş kartındaki tek satırın görsel yerleşimi.
- Yeni birim test dosyalarının yerleşimi.
