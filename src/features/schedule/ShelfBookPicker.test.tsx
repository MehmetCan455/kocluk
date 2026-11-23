import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import type { ShelfBook } from '@/db/bookRepositories';
import type { ExamType } from '@/domain/types';
import { ShelfBookPicker } from './ShelfBookPicker';

const now = '2026-01-01T00:00:00.000Z';

interface BookConfig {
  userBookId: string;
  catalogId: string;
  title: string;
  publisher: string;
  exam: ExamType;
  subjectSlug: string;
  totalPages: number;
  edition: string;
}

function makeBook(config: BookConfig): ShelfBook {
  return {
    userBook: {
      id: config.userBookId,
      bookId: config.catalogId,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    catalogBook: {
      id: config.catalogId,
      title: config.title,
      publisher: config.publisher,
      exam: config.exam,
      subjectSlug: config.subjectSlug,
      totalPages: config.totalPages,
      edition: config.edition,
      createdAt: now,
      updatedAt: now,
    },
    totalPages: config.totalPages,
    progress: {
      currentPage: 0,
      readPages: 0,
      totalPages: config.totalPages,
      percent: 0,
      remaining: config.totalPages,
      started: false,
      done: false,
      hasTotalPages: true,
    },
  };
}

const books: ShelfBook[] = [
  makeBook({
    userBookId: 'ub-matematik',
    catalogId: 'cat-matematik',
    title: 'TYT Matematik Soru Bankası',
    publisher: 'Bilgi Sarmal',
    exam: 'TYT',
    subjectSlug: 'matematik',
    totalPages: 640,
    edition: '2025',
  }),
  makeBook({
    userBookId: 'ub-fizik',
    catalogId: 'cat-fizik',
    title: 'AYT Fizik Soru Bankası',
    publisher: '3D Yayınları',
    exam: 'AYT',
    subjectSlug: 'fizik',
    totalPages: 480,
    edition: '2024',
  }),
];

test('kitap adı veya yayıneviyle arar ve tıklanan kitabı seçer', async () => {
  const onChange = vi.fn();
  render(
    <ShelfBookPicker id="kitap" books={books} value="" onChange={onChange} />,
  );

  const input = screen.getByLabelText('Kitap ara');
  await userEvent.type(input, 'bilgi');

  expect(
    screen.getByRole('option', { name: /Bilgi Sarmal/ }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('option', { name: /3D Yayınları/ }),
  ).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('option', { name: /Bilgi Sarmal/ }));

  expect(onChange).toHaveBeenCalledWith(books[0].userBook.id);
});

test('klavyeyle gezinip Enter ile kitabı seçer', async () => {
  const onChange = vi.fn();
  render(
    <ShelfBookPicker id="kitap" books={books} value="" onChange={onChange} />,
  );

  await userEvent.type(screen.getByLabelText('Kitap ara'), 'sarmal');
  await userEvent.keyboard('{ArrowDown}{Enter}');

  expect(onChange).toHaveBeenCalledWith(books[0].userBook.id);
});

test('seçili kitabın özetini ve Değiştir düğmesini gösterir', async () => {
  const onChange = vi.fn();
  render(
    <ShelfBookPicker
      id="kitap"
      books={books}
      value={books[0].userBook.id}
      onChange={onChange}
    />,
  );

  expect(
    screen.getByText('Seçili: TYT Matematik Soru Bankası'),
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Değiştir' }));

  expect(onChange).toHaveBeenCalledWith('');
  expect(screen.getByLabelText('Kitap ara')).toHaveFocus();
});

test('eşleşme yoksa bilgi mesajı gösterir', async () => {
  render(
    <ShelfBookPicker id="kitap" books={books} value="" onChange={() => {}} />,
  );

  await userEvent.type(screen.getByLabelText('Kitap ara'), 'zzz');

  expect(screen.getByText('Rafında eşleşen kitap yok.')).toBeInTheDocument();
  expect(screen.queryByRole('option')).not.toBeInTheDocument();
});

test('seçili kimlik rafta yoksa uyarır', () => {
  render(
    <ShelfBookPicker
      id="kitap"
      books={books}
      value="rafta-yok"
      onChange={() => {}}
    />,
  );

  expect(
    screen.getByText('Seçili kitap rafında bulunamadı.'),
  ).toBeInTheDocument();
});

test('boş rafta kitaplar sayfasına yönlendirir', () => {
  render(
    <ShelfBookPicker id="kitap" books={[]} value="" onChange={() => {}} />,
  );

  expect(
    screen.getByText('Rafında kitap yok. Kitaplar sayfasından ekleyebilirsin.'),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText('Kitap ara')).not.toBeInTheDocument();
});

test('seçenek satırında yayınevi, baskı ve sayfa bilgisini gösterir', () => {
  render(
    <ShelfBookPicker id="kitap" books={books} value="" onChange={() => {}} />,
  );

  expect(screen.getByText('Bilgi Sarmal · 2025 · 640 sayfa')).toBeInTheDocument();
  expect(screen.getByText('3D Yayınları · 2024 · 480 sayfa')).toBeInTheDocument();
});
