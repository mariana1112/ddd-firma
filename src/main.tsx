import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startSyncRunner } from './data/sync/runner';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Prośba o trwały zapis, żeby przeglądarka nie usunęła danych przy braku miejsca.
void navigator.storage?.persist?.();

startSyncRunner();
