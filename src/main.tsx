import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource-variable/inter';
import './index.css';
import App from './App.tsx';
import { initTheme } from './lib/ui.ts';

initTheme();

registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    // Installed apps can stay open for days; look for updates every hour.
    if (reg) setInterval(() => void reg.update(), 3_600_000);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
