import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initViewScope } from './data/scope';
import { startSyncRunner } from './data/sync/runner';
import './styles.css';

// Region konta musi być znany przed pierwszym wyświetleniem list (konto admina widzi tam tylko swój region).
void initViewScope()
  .catch(() => undefined)
  .then(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );

// Prośba o trwały zapis, żeby przeglądarka nie usunęła danych przy braku miejsca.
void navigator.storage?.persist?.();

startSyncRunner();
