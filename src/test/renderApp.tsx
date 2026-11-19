import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '@/app/AppShell';
import { AppRoutes } from '@/app/routes';
import { SettingsProvider } from '@/app/SettingsProvider';

export function renderApp(path = '/'): RenderResult {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SettingsProvider>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </SettingsProvider>
    </MemoryRouter>,
  );
}
