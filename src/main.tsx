import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.css';

// Boot goes through AuthProvider → AuthGate: the gate opens the signed-in
// user's database before any screen can read from it. The legacy `kocluk`
// database is only opened by the one-time transfer screen.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
