import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

if (import.meta.env.VITE_DEMO === '1') {
  const { installDemoApi } = await import('./demo/shim.ts');
  installDemoApi();
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
