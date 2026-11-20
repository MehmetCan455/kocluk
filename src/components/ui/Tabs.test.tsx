import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Tabs } from './Tabs';

const TABS = [
  { id: 'bir', label: 'Bir', content: <p>Bir içerik</p> },
  { id: 'iki', label: 'İki', content: <p>İki içerik</p> },
  { id: 'uc', label: 'Üç', content: <p>Üç içerik</p> },
];

function Harness() {
  const [value, setValue] = useState('bir');
  return <Tabs tabs={TABS} value={value} onChange={setValue} />;
}

test('ok tuşları, Home ve End sekmeler arasında dolaşır', async () => {
  render(<Harness />);

  const first = screen.getByRole('tab', { name: 'Bir' });
  first.focus();

  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'İki' })).toHaveFocus();
  expect(screen.getByRole('tab', { name: 'İki' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('İki içerik')).toBeInTheDocument();

  await userEvent.keyboard('{End}');
  expect(screen.getByRole('tab', { name: 'Üç' })).toHaveFocus();
  expect(screen.getByRole('tab', { name: 'Üç' })).toHaveAttribute('aria-selected', 'true');

  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Bir' })).toHaveFocus();

  await userEvent.keyboard('{ArrowLeft}');
  expect(screen.getByRole('tab', { name: 'Üç' })).toHaveFocus();

  await userEvent.keyboard('{Home}');
  expect(screen.getByRole('tab', { name: 'Bir' })).toHaveFocus();
  expect(screen.getByRole('tab', { name: 'Bir' })).toHaveAttribute('aria-selected', 'true');
});
