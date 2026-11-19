import { act, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

function Probe({ value }: { value: string }) {
  const debounced = useDebouncedValue(value, 200);
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    setHistory((previous) =>
      previous[previous.length - 1] === debounced ? previous : [...previous, debounced],
    );
  }, [debounced]);

  return (
    <>
      <span data-testid="value">{debounced}</span>
      <span data-testid="history">{history.join('|')}</span>
    </>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

test('hızlı değişimlerde yalnızca son değeri 200 ms sonra yayınlar', () => {
  vi.useFakeTimers();
  const { rerender } = render(<Probe value="t" />);

  rerender(<Probe value="tü" />);
  rerender(<Probe value="tür" />);
  rerender(<Probe value="türe" />);
  rerender(<Probe value="türev" />);

  expect(screen.getByTestId('value')).toHaveTextContent('t');

  act(() => {
    vi.advanceTimersByTime(199);
  });
  expect(screen.getByTestId('value')).toHaveTextContent('t');

  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.getByTestId('value')).toHaveTextContent('türev');
  expect(screen.getByTestId('history')).toHaveTextContent('t|türev');
});
