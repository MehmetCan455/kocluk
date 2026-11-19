import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { CURRICULUM } from '@/data/curriculum';
import { db } from '@/db/db';
import {
  addCustomTopic,
  getSettings,
  listSubjects,
  listTopics,
  patchSettings,
} from '@/db/repositories';
import type { CurriculumSeed } from '@/db/repositories';
import type { Subject, Topic } from '@/domain/types';
import { seedOnboarded } from '@/test/fixtures';
import { renderApp } from '@/test/renderApp';

const FIXTURE: CurriculumSeed = {
  version: 1,
  subjects: [
    {
      seedKey: 'tyt-mat',
      exam: 'TYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 1,
      topics: [
        { seedKey: 'tyt-mat-turev', name: 'Türev', order: 1 },
        { seedKey: 'tyt-mat-pol', name: 'Polinomlar', order: 2 },
      ],
    },
    {
      seedKey: 'tyt-fiz',
      exam: 'TYT',
      name: 'Fizik',
      slug: 'fizik',
      icon: 'atom',
      order: 2,
      topics: [{ seedKey: 'tyt-fiz-hareket', name: 'Hareket', order: 1 }],
    },
    {
      seedKey: 'ayt-matematik',
      exam: 'AYT',
      name: 'Matematik',
      slug: 'matematik',
      icon: 'calculator',
      order: 1,
      topics: [{ seedKey: 'ayt-mat-turev', name: 'Türev', order: 1 }],
    },
    {
      seedKey: 'ayt-edebiyat',
      exam: 'AYT',
      name: 'Edebiyat',
      slug: 'edebiyat',
      icon: 'book-open',
      order: 2,
      topics: [{ seedKey: 'ayt-edebiyat-siir', name: 'Şiir', order: 1 }],
    },
  ],
};

let recordSequence = 0;

async function subjectByKey(seedKey: string): Promise<Subject> {
  const subject = (await listSubjects()).find((item) => item.seedKey === seedKey);
  if (!subject) {
    throw new Error(`Test dersi bulunamadı: ${seedKey}`);
  }
  return subject;
}

async function topicByKey(seedKey: string): Promise<Topic> {
  const topic = await db.topics.where('seedKey').equals(seedKey).first();
  if (!topic) {
    throw new Error(`Test konusu bulunamadı: ${seedKey}`);
  }
  return topic;
}

async function addTestRecord(topicId: string, solvedTests: number, totalTests: number): Promise<void> {
  recordSequence += 1;
  await db.topicBooks.add({
    id: `tb-${recordSequence}`,
    topicId,
    bookId: `book-${recordSequence}`,
    totalTests,
    solvedTests,
    createdAt: '',
    updatedAt: '',
  });
}

beforeEach(async () => {
  // The fixture keeps seedVersion current so SettingsProvider does not replace
  // this small curriculum with the full 339-topic seed.
  await seedOnboarded(FIXTURE, { seedVersion: CURRICULUM.version });
});

test('TYT ders kartlarını gösterir', async () => {
  renderApp('/tyt');

  expect(await screen.findByRole('heading', { level: 1, name: 'TYT Dersleri' })).toBeInTheDocument();
  expect(await screen.findByText('Matematik')).toBeInTheDocument();
  expect(await screen.findByText('Fizik')).toBeInTheDocument();
  expect(await screen.findByText('2 konu')).toBeInTheDocument();
});

test('konu listesini ve ilerlemeyi gösterir', async () => {
  renderApp('/tyt');

  await userEvent.click(await screen.findByText('Matematik'));

  expect(await screen.findByText('Türev')).toBeInTheDocument();
  expect(await screen.findByText('Henüz test eklenmedi')).toBeInTheDocument();
});

test('özel konu ekler, yeniden adlandırır ve siler', async () => {
  renderApp('/tyt');
  await userEvent.click(await screen.findByText('Matematik'));

  await userEvent.click(await screen.findByRole('button', { name: 'Konu ekle' }));
  const input = await screen.findByLabelText('Konu adı');
  const addButton = screen.getByRole('button', { name: 'Ekle' });
  expect(addButton).toBeDisabled();

  await userEvent.type(input, '   ');
  expect(addButton).toBeDisabled();

  await userEvent.clear(input);
  await userEvent.type(input, 'Limit');
  await userEvent.click(addButton);
  expect(await screen.findByText('Limit')).toBeInTheDocument();

  const subject = await subjectByKey('tyt-mat');
  const created = (await listTopics(subject.id)).find((topic) => topic.name === 'Limit');
  expect(created).toMatchObject({ isCustom: true, order: 3 });
  expect(created?.id).toBeTruthy();

  await addTestRecord(created!.id, 2, 5);
  expect(await screen.findByText('2/5 test')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Limit konusunu yeniden adlandır' }));
  const renameInput = await screen.findByLabelText('Konu adı');
  await userEvent.clear(renameInput);
  await userEvent.type(renameInput, 'Limitler');
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(await screen.findByText('Limitler')).toBeInTheDocument();
  expect((await db.topics.get(created!.id))?.name).toBe('Limitler');

  await userEvent.click(screen.getByRole('button', { name: 'Limitler konusunu sil' }));
  const dialog = await screen.findByRole('dialog', { name: 'Konuyu sil' });
  expect(within(dialog).getByText('1 test kaydı silinecek.')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Sil' }));
  await waitFor(() => expect(screen.queryByText('Limitler')).not.toBeInTheDocument());
  expect(await db.topics.get(created!.id)).toBeUndefined();
  expect(await db.topicBooks.where('topicId').equals(created!.id).count()).toBe(0);
});

test('seed konusu yeniden adlandırılır ama silinemez', async () => {
  const subject = await subjectByKey('tyt-mat');
  renderApp(`/tyt/${subject.id}`);

  expect(await screen.findByText('Türev')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Türev konusunu sil' })).not.toBeInTheDocument();
  expect(screen.queryAllByRole('button', { name: /konusunu sil/ })).toHaveLength(0);

  await userEvent.click(screen.getByRole('button', { name: 'Türev konusunu yeniden adlandır' }));
  const input = await screen.findByLabelText('Konu adı');
  await userEvent.clear(input);
  expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled();
  await userEvent.type(input, 'Türev II');
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet' }));

  expect(await screen.findByText('Türev II')).toBeInTheDocument();
  const topic = await topicByKey('tyt-mat-turev');
  expect(topic).toMatchObject({ name: 'Türev II', isCustom: false });
  expect((await getSettings()).hiddenSubjects).toEqual([]);
});

test('konu filtreleri devam eden ve biten konuları ayırır', async () => {
  const subject = await subjectByKey('tyt-mat');
  const turev = await topicByKey('tyt-mat-turev');
  const polinomlar = await topicByKey('tyt-mat-pol');
  await addTestRecord(turev.id, 2, 2);
  await addTestRecord(polinomlar.id, 1, 4);

  renderApp(`/tyt/${subject.id}`);

  expect(await screen.findByText('2/2 test')).toBeInTheDocument();
  expect(screen.getByText('Bitti')).toBeInTheDocument();
  expect(screen.getByText('Devam ediyor')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Bitenler' }));
  expect(screen.getByText('Türev')).toBeInTheDocument();
  expect(screen.queryByText('Polinomlar')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Devam edenler' }));
  expect(screen.getByText('Polinomlar')).toBeInTheDocument();
  expect(screen.queryByText('Türev')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Tümü' }));
  expect(screen.getByText('Türev')).toBeInTheDocument();
  expect(screen.getByText('Polinomlar')).toBeInTheDocument();
});

test('AYT alan filtresi dersleri süzer ve seçimi saklar', async () => {
  const aytSubjects = await listSubjects('AYT');
  const edebiyat = aytSubjects.find((subject) => subject.seedKey === 'ayt-edebiyat');
  expect(edebiyat).toBeDefined();
  await patchSettings({ aytAlan: 'sayisal' });

  renderApp('/ayt');

  expect(await screen.findByRole('heading', { level: 1, name: 'AYT Dersleri' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'AYT alanı' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sayısal' })).toHaveAttribute('aria-pressed', 'true');
  expect(await screen.findByText('Matematik')).toBeInTheDocument();
  expect(screen.queryByText('Edebiyat')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Tümü' }));

  expect(await screen.findByText('Edebiyat')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tümü' })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(async () => {
    const settings = await getSettings();
    expect(settings.aytAlan).toBe('tumu');
    expect(settings.hiddenSubjects).toEqual([]);
  });

  await userEvent.click(screen.getByRole('button', { name: 'Sayısal' }));

  await waitFor(() => {
    expect(screen.queryByText('Edebiyat')).not.toBeInTheDocument();
  });
  await waitFor(async () => {
    const settings = await getSettings();
    expect(settings.aytAlan).toBe('sayisal');
    expect(settings.hiddenSubjects).toEqual([edebiyat!.id]);
  });
});

test('TYT dersleri gizli ayarından etkilenmez ve alan filtresi göstermez', async () => {
  const tytSubjects = await listSubjects('TYT');
  await patchSettings({ hiddenSubjects: tytSubjects.map((subject) => subject.id) });

  renderApp('/tyt');

  expect(await screen.findByText('Matematik')).toBeInTheDocument();
  expect(await screen.findByText('Fizik')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'AYT alanı' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sayısal' })).not.toBeInTheDocument();
});

test('çok kayıtlı ilerleme toplanır ve durum done ile belirlenir', async () => {
  const turev = await topicByKey('tyt-mat-turev');
  await addTestRecord(turev.id, 5, 6);
  await addTestRecord(turev.id, 4, 4);

  renderApp('/tyt');
  expect(await screen.findByText('Devam eden: Türev')).toBeInTheDocument();
  expect(screen.getByText('9/10 test')).toBeInTheDocument();

  await userEvent.click(screen.getByText('Matematik'));

  expect(await screen.findByRole('heading', { level: 1, name: 'Matematik' })).toBeInTheDocument();
  expect(screen.getByText('9/10 test')).toBeInTheDocument();
  expect(screen.getByText('Devam ediyor')).toBeInTheDocument();
  expect(screen.queryByText('Bitti')).not.toBeInTheDocument();
  expect(screen.getAllByText('%90').length).toBeGreaterThan(0);
  expect(screen.getByRole('progressbar', { name: 'Matematik genel ilerlemesi' })).toHaveAttribute(
    'aria-valuenow',
    '90',
  );
});

test('konu sayfası sekmeleri ve boş durumları gösterir', async () => {
  const subject = await subjectByKey('tyt-mat');
  const turev = await topicByKey('tyt-mat-turev');

  renderApp(`/tyt/${subject.id}/${turev.id}`);

  expect(await screen.findByRole('heading', { level: 1, name: 'Türev' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Matematik' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Testler' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('Henüz test eklenmedi')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: 'Notlar' }));
  expect(screen.getByText('Henüz not eklenmedi')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('tab', { name: 'Yanlışlar' }));
  expect(screen.getByText('Henüz yanlış fotoğrafı yok')).toBeInTheDocument();
});

test('özel konu ekleme ders doğrular ve max sırasını kullanır', async () => {
  const subject = await subjectByKey('tyt-mat');
  const topics = await listTopics(subject.id);
  await db.topics.update(topics[1].id, { order: 10 });

  await expect(addCustomTopic(subject.id, '   ')).rejects.toThrow('Konu adı boş olamaz');
  await expect(addCustomTopic('olmayan-ders', 'Deneme')).rejects.toThrow('Ders bulunamadı');

  const created = await addCustomTopic(subject.id, 'Yeni konu');
  expect(created.order).toBe(11);
});
