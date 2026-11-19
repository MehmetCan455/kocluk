import { HashRouter } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { AppRoutes } from './app/routes';
import { SettingsProvider } from './app/SettingsProvider';

export default function App() {
  return (
    <HashRouter>
      <SettingsProvider>
        <AppShell>
          <AppRoutes />
        </AppShell>
      </SettingsProvider>
    </HashRouter>
  );
}
