import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { KoclukDB, setActiveDb } from './db/db';
import './styles/index.css';

// Until the account screens land (Task 10), the app keeps using the legacy
// local database so existing installs and E2E flows keep working. Signing in
// will replace this with `openUserDb()` from the database manager.
setActiveDb(new KoclukDB());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
