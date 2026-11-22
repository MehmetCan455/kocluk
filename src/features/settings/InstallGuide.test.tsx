import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { InstallGuide } from './InstallGuide';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(navigator, 'share');
});

test('kurulum adımlarını platformlara göre gösterir', () => {
  render(<InstallGuide />);

  expect(screen.getByRole('heading', { name: 'Uygulamayı kur' })).toBeInTheDocument();
  expect(
    screen.getByText(/Zirve Akademi’yi ana ekranına ekle/),
  ).toBeInTheDocument();
  expect(screen.getByText('iPhone / iPad (Safari)')).toBeInTheDocument();
  expect(screen.getByText('Android (Chrome)')).toBeInTheDocument();
  expect(screen.getByText('Bilgisayar (Chrome / Edge)')).toBeInTheDocument();
});

test('paylaşım API yoksa bağlantıyı panoya kopyalar ve geri bildirim verir', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: undefined,
  });

  render(<InstallGuide />);
  await userEvent.click(screen.getByRole('button', { name: 'Uygulama linkini paylaş' }));

  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('http'));
  expect(await screen.findByText('Bağlantı panoya kopyalandı.')).toBeInTheDocument();
});

test('navigator.share varsa onu kullanır', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });

  render(<InstallGuide />);
  await userEvent.click(screen.getByRole('button', { name: 'Uygulama linkini paylaş' }));

  expect(share).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Zirve Akademi — YKS Takip', url: expect.stringContaining('http') }),
  );
  expect(await screen.findByText('Bağlantı paylaşıldı.')).toBeInTheDocument();
});
