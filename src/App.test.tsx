import { render, screen } from '@testing-library/react';
import App from './App';

test('uygulama adını gösterir', () => {
  render(<App />);
  expect(screen.getByText('Koçluk')).toBeInTheDocument();
});
