import { expect, test } from 'vitest';
import type { ActivityLog, ScheduleTask } from './types';
import {
  dayLabel,
  scheduleTaskContent,
  scheduleTaskStatus,
  shiftWeek,
  summarizeWeek,
  validateTaskPages,
  weekLabel,
  weekStartOf,
} from './schedule';

function task(partial: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: 'task-1',
    weekId: 'week-1',
    rowId: 'row-1',
    dayIndex: 1,
    type: 'book',
    createdAt: '2026-11-16T10:00:00.000Z',
    updatedAt: '2026-11-16T10:00:00.000Z',
    ...partial,
  };
}

function log(partial: Partial<ActivityLog> = {}): ActivityLog {
  return {
    id: 'log-1',
    type: 'book_pages',
    source: 'task',
    createdAt: '2026-11-16T10:00:00.000Z',
    ...partial,
  };
}

test('hafta başlangıcı pazar gününü önceki pazartesiye eşler', () => {
  expect(weekStartOf(new Date(2026, 10, 22, 12))).toBe('2026-11-16');
  expect(weekStartOf(new Date(2026, 10, 16, 12))).toBe('2026-11-16');
});

test('shiftWeek ay ve yıl sınırlarını doğru geçer', () => {
  expect(shiftWeek('2026-11-30', 1)).toBe('2026-12-07');
  expect(shiftWeek('2026-12-28', 1)).toBe('2027-01-04');
  expect(shiftWeek('2026-01-04', -1)).toBe('2025-12-28');
});

test('weekLabel Türkçe tarih aralığı üretir', () => {
  expect(weekLabel('2026-11-16')).toBe('16–22 Kasım 2026');
  expect(weekLabel('2026-11-30')).toBe('30 Kasım – 6 Aralık 2026');
  expect(weekLabel('2026-12-28')).toBe('28 Aralık 2026 – 3 Ocak 2027');
});

test('dayLabel pazartesiden pazara günleri adlandırır', () => {
  expect(dayLabel('2026-11-16', 1)).toBe('Pazartesi 16 Kasım');
  expect(dayLabel('2026-11-16', 7)).toBe('Pazar 22 Kasım');
});

test('geçerli sayfa aralığı için hata döndürmez', () => {
  expect(validateTaskPages(10, 20, 100)).toBeNull();
  expect(validateTaskPages(100, 100, 100)).toBeNull();
});

test('eksik sayfa aralığını reddeder', () => {
  expect(validateTaskPages(undefined, 20, 100)).toBe('Başlangıç ve bitiş sayfası gerekli.');
  expect(validateTaskPages(10, undefined, 100)).toBe('Başlangıç ve bitiş sayfası gerekli.');
});

test('sıfır veya negatif sayfa numarasını reddeder', () => {
  expect(validateTaskPages(0, 20, 100)).toBe('Sayfa numaraları 1 veya daha büyük olmalı.');
  expect(validateTaskPages(-5, 20, 100)).toBe('Sayfa numaraları 1 veya daha büyük olmalı.');
});

test('ondalık ve NaN sayfa numarasını sessizce kırpmadan reddeder', () => {
  expect(validateTaskPages(10.5, 20, 100)).toBe('Sayfa numaraları tam sayı olmalı.');
  expect(validateTaskPages(10, 20.2, 100)).toBe('Sayfa numaraları tam sayı olmalı.');
  expect(validateTaskPages(Number.NaN, 20, 100)).toBe('Sayfa numaraları tam sayı olmalı.');
});

test('ters sayfa aralığını reddeder', () => {
  expect(validateTaskPages(20, 10, 100)).toBe('Başlangıç sayfası bitiş sayfasından büyük olamaz.');
});

test('toplam sayfayı aşan aralığı reddeder', () => {
  expect(validateTaskPages(90, 120, 100)).toBe('Bitiş sayfası toplam sayfa sayısını aşamaz.');
});

test('toplam sayfası bilinmeyen kitabı reddeder', () => {
  expect(validateTaskPages(1, 10, 0)).toBe('Kitabın toplam sayfa sayısı bilinmiyor.');
});

test('haftalık özet görevleri ve okunan sayfaları sayar', () => {
  const tasks = [
    task({ id: 'book-a', fromPage: 210, toPage: 220 }),
    task({
      id: 'book-b',
      fromPage: 1,
      toPage: 50,
      completedAt: '2026-11-17T10:00:00.000Z',
    }),
    task({ id: 'topic-a', type: 'topic', topicId: 'topic-1' }),
    task({ id: 'free-a', type: 'free', title: 'Deneme çözümü' }),
    task({ id: 'free-done', type: 'free', completedAt: '2026-11-18T10:00:00.000Z' }),
  ];
  const logs = [
    log({ id: 'log-a', taskId: 'book-a', fromPage: 210, toPage: 220 }),
    log({ id: 'log-b', taskId: 'book-b', fromPage: 1, toPage: 10 }),
    log({ id: 'topic-log', type: 'topic_review', taskId: 'topic-a' }),
    log({ id: 'manual-log', fromPage: 1, toPage: 5 }),
    log({ id: 'other-log', taskId: 'not-in-week', fromPage: 1, toPage: 100 }),
  ];

  expect(summarizeWeek(tasks, logs)).toEqual({
    taskCount: 5,
    doneCount: 2,
    plannedPages: 61,
    readPages: 21,
  });
});

test('silinmiş görevleri ve aktivite kayıtlarını özetten çıkarır', () => {
  const tasks = [
    task({ id: 'kept', fromPage: 1, toPage: 20 }),
    task({
      id: 'deleted-task',
      fromPage: 100,
      toPage: 500,
      completedAt: '2026-11-17T10:00:00.000Z',
      deletedAt: '2026-11-18T10:00:00.000Z',
    }),
  ];
  const logs = [
    log({ id: 'kept-log', taskId: 'kept', fromPage: 1, toPage: 10 }),
    log({
      id: 'deleted-log',
      taskId: 'kept',
      fromPage: 11,
      toPage: 20,
      deletedAt: '2026-11-18T10:00:00.000Z',
    }),
    log({ id: 'orphan-log', taskId: 'deleted-task', fromPage: 100, toPage: 150 }),
  ];

  expect(summarizeWeek(tasks, logs)).toEqual({
    taskCount: 1,
    doneCount: 0,
    plannedPages: 20,
    readPages: 10,
  });
});

test('boş hafta özeti sıfır döndürür', () => {
  expect(summarizeWeek([], [])).toEqual({
    taskCount: 0,
    doneCount: 0,
    plannedPages: 0,
    readPages: 0,
  });
});

test('planlanan sayfa örtüşen aralıkları benzersiz sayar', () => {
  const tasks = [
    task({ id: 'a', dayIndex: 7, fromPage: 10, toPage: 20 }),
    task({ id: 'b', dayIndex: 7, fromPage: 15, toPage: 25 }),
    task({ id: 'c', dayIndex: 7, fromPage: 1, toPage: 5 }),
  ];

  expect(summarizeWeek(tasks, [])).toMatchObject({ plannedPages: 21 });
});

test('görev durumu gün bazında tamamlanma, kaçırılma ve otomatik kaçırmadan türetilir', () => {
  // 22 Kasım 2026 Pazar; geçerli hafta 16 Kasım Pazartesi.
  const now = new Date(2026, 10, 22, 12);
  const done = task({ dayIndex: 5, completedAt: '2026-11-20T10:00:00.000Z' });

  expect(scheduleTaskStatus(done, '2026-11-16', now)).toBe('done');
  expect(
    scheduleTaskStatus(task({ dayIndex: 5, missedAt: '2026-11-20T10:00:00.000Z' }), '2026-11-16', now),
  ).toBe('missed');
  expect(scheduleTaskStatus(task({ dayIndex: 1 }), '2026-11-16', now)).toBe('missed');
  expect(scheduleTaskStatus(task({ dayIndex: 6 }), '2026-11-16', now)).toBe('missed');
  expect(scheduleTaskStatus(task({ dayIndex: 7 }), '2026-11-16', now)).toBe('pending');
  expect(scheduleTaskStatus(task({ dayIndex: 1 }), '2026-11-09', now)).toBe('missed');
  expect(scheduleTaskStatus(task({ dayIndex: 1 }), '2026-11-23', now)).toBe('pending');
  expect(scheduleTaskStatus(done, '2026-11-09', now)).toBe('done');
});

test('görev çipi kitap, konu ve serbest görev için üç satır üretir', () => {
  const book = scheduleTaskContent(
    task({ type: 'book', fromPage: 123, toPage: 128, title: 'Türev' }),
    {
      bookTitle: 'TYT Matematik Soru Bankası',
      bookPublisher: 'Bilgi Sarmal',
      rowLabel: 'Matematik',
    },
  );
  expect(book).toEqual({
    title: 'Bilgi Sarmal · TYT Matematik Soru Bankası',
    subtitle: 'Türev',
    detail: 'Syf. 123–128',
  });

  const bookWithoutTopic = scheduleTaskContent(
    task({ type: 'book', fromPage: 1, toPage: 2 }),
    { bookTitle: 'Kitap A', rowLabel: 'Fizik' },
  );
  expect(bookWithoutTopic).toEqual({
    title: 'Kitap A',
    subtitle: 'Fizik',
    detail: 'Syf. 1–2',
  });

  const topic = scheduleTaskContent(
    task({ type: 'topic', topicId: 'topic-1' }),
    { topicName: 'Türev', subjectName: 'Matematik', rowLabel: 'Matematik' },
  );
  expect(topic).toEqual({
    title: 'Türev',
    subtitle: 'Matematik · Tekrar',
    detail: '',
  });

  const free = scheduleTaskContent(
    task({ type: 'free', title: 'Deneme çözümü' }),
    { rowLabel: 'Matematik' },
  );
  expect(free).toEqual({
    title: 'Deneme çözümü',
    subtitle: 'Matematik',
    detail: '',
  });
});
