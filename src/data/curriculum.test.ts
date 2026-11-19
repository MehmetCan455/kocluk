import { CURRICULUM } from './curriculum';

const EXPECTED_SUBJECT_KEYS = [
  'tyt-turkce',
  'tyt-matematik',
  'tyt-geometri',
  'tyt-fizik',
  'tyt-kimya',
  'tyt-biyoloji',
  'tyt-tarih',
  'tyt-cografya',
  'tyt-felsefe',
  'tyt-din-kulturu',
  'ayt-matematik',
  'ayt-geometri',
  'ayt-edebiyat',
  'ayt-fizik',
  'ayt-kimya',
  'ayt-biyoloji',
  'ayt-tarih-1',
  'ayt-cografya-1',
  'ayt-tarih-2',
  'ayt-cografya-2',
  'ayt-felsefe-grubu',
  'ayt-din-kulturu',
];

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

test('ders anahtarları, sırası ve ikonları tutarlıdır', () => {
  expect(CURRICULUM.subjects.map((subject) => subject.seedKey).sort()).toEqual(
    [...EXPECTED_SUBJECT_KEYS].sort(),
  );
  expect(CURRICULUM.subjects.map((subject) => subject.order)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  ]);
  for (const subject of CURRICULUM.subjects) {
    expect(subject.seedKey).toMatch(/^[a-z0-9-]+$/);
    expect(subject.slug).toMatch(/^[a-z0-9-]+$/);
    expect(subject.name.trim()).not.toBe('');
    expect(subject.icon.trim()).not.toBe('');
    expect(subject.topics.length).toBeLessThanOrEqual(35);
    expect(subject.topics.map((topic) => topic.order)).toEqual(
      subject.topics.map((_, index) => index + 1),
    );
  }
});

test('konu anahtarları ASCII, benzersiz ve ders anahtarıyla ön eklenmiştir', () => {
  for (const subject of CURRICULUM.subjects) {
    for (const topic of subject.topics) {
      expect(topic.seedKey).toMatch(/^[a-z0-9-]+$/);
      expect(topic.seedKey.startsWith(`${subject.seedKey}-`)).toBe(true);
      expect(topic.name.trim()).not.toBe('');
      expect(topic.name).not.toMatch(/kazanım|öğrenci|açıklar|ifade eder/i);
    }
  }
});

test('AYT Felsefe Grubu felsefe, psikoloji, sosyoloji ve mantık konularını içerir', () => {
  const subject = CURRICULUM.subjects.find((item) => item.seedKey === 'ayt-felsefe-grubu');
  expect(subject).toBeDefined();
  const names = subject!.topics.map((topic) => topic.name);

  expect(names).toContain('Bilgi Felsefesi');
  expect(names).toContain('Psikoloji Bilimini Tanıyalım');
  expect(names).toContain('Sosyolojiye Giriş');
  expect(names).toContain('Mantığa Giriş');
});
