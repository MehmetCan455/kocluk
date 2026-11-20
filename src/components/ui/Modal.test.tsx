import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { Modal } from './Modal';

afterEach(() => {
  document.body.style.overflow = '';
});

test('modal açıkken sayfa kaydırma kilitlenir ve kapanınca geri açılır', () => {
  const { rerender, unmount } = render(
    <Modal open title="Test" onClose={() => undefined}>
      <p>İçerik</p>
    </Modal>,
  );

  expect(document.body.style.overflow).toBe('hidden');

  rerender(
    <Modal open={false} title="Test" onClose={() => undefined}>
      <p>İçerik</p>
    </Modal>,
  );
  expect(document.body.style.overflow).toBe('');

  rerender(
    <Modal open title="Test" onClose={() => undefined}>
      <p>İçerik</p>
    </Modal>,
  );
  expect(document.body.style.overflow).toBe('hidden');
  unmount();
  expect(document.body.style.overflow).toBe('');
});

test('Tab ve Shift+Tab odağı modal içinde döndürür', async () => {
  render(
    <Modal
      open
      title="Odak testi"
      onClose={() => undefined}
      footer={<button type="button">Kaydet</button>}
    >
      <button type="button">İç düğme</button>
    </Modal>,
  );

  const dialog = screen.getByRole('dialog', { name: 'Odak testi' });
  expect(dialog).toHaveFocus();

  await userEvent.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Kaydet' })).toHaveFocus();

  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Kapat' })).toHaveFocus();

  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'İç düğme' })).toHaveFocus();

  await userEvent.tab();
  expect(screen.getByRole('button', { name: 'Kaydet' })).toHaveFocus();

  await userEvent.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'İç düğme' })).toHaveFocus();
});
