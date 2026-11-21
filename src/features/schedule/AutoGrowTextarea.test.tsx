import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { AutoGrowTextarea } from './AutoGrowTextarea';

test('etiketiyle görünür ve değerini textarea olarak gösterir', () => {
  render(
    <AutoGrowTextarea
      value="2 saat"
      onChange={() => {}}
      label="1. satır Pazartesi"
      maxLength={120}
    />,
  );

  const field = screen.getByLabelText('1. satır Pazartesi');
  expect(field.tagName).toBe('TEXTAREA');
  expect(field).toHaveValue('2 saat');
  expect(field).toHaveAttribute('maxlength', '120');
});

test('Enter yeni satır eklemez ve odağı bırakır', async () => {
  const onChange = vi.fn();
  render(
    <AutoGrowTextarea
      value="Matematik"
      onChange={onChange}
      label="1. satır ders"
      maxLength={80}
    />,
  );

  const field = screen.getByLabelText('1. satır ders');
  field.focus();
  await userEvent.keyboard('{Enter}');

  expect(field).not.toHaveFocus();
  expect(field).toHaveValue('Matematik');
  expect(onChange).not.toHaveBeenCalled();
});

test('içerik uzadıkça yüksekliği büyür', () => {
  const { rerender } = render(
    <AutoGrowTextarea
      value="kısa"
      onChange={() => {}}
      label="1. satır Salı"
      maxLength={120}
    />,
  );
  const field = screen.getByLabelText('1. satır Salı');
  Object.defineProperty(field, 'scrollHeight', { configurable: true, value: 96 });
  Object.defineProperty(field, 'offsetHeight', { configurable: true, value: 46 });
  Object.defineProperty(field, 'clientHeight', { configurable: true, value: 44 });

  rerender(
    <AutoGrowTextarea
      value="daha uzun bir metin"
      onChange={() => {}}
      label="1. satır Salı"
      maxLength={120}
    />,
  );

  expect(field).toHaveStyle({ height: '98px' });
});

test('subject varyantı 18 px, ortalı ve ferah metin kullanır', () => {
  render(
    <AutoGrowTextarea
      variant="subject"
      value="Matematik"
      onChange={() => {}}
      label="1. satır ders"
      maxLength={80}
    />,
  );

  expect(screen.getByLabelText('1. satır ders')).toHaveClass(
    'text-lg',
    'text-center',
    'py-3',
    'font-semibold',
  );
});

test('varsayılan cell varyantı 14 px ve sola dayalı metin kullanır', () => {
  render(
    <AutoGrowTextarea
      value="2 saat"
      onChange={() => {}}
      label="1. satır Pazartesi"
      maxLength={120}
    />,
  );

  const field = screen.getByLabelText('1. satır Pazartesi');
  expect(field).toHaveClass('text-sm', 'text-left', 'py-2');
  expect(field).not.toHaveClass('text-lg');
});
