import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './app/AuthProvider';
import { AuthGate } from './features/auth/AuthGate';

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </HashRouter>
  );
}
