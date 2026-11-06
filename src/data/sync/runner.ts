// Uruchamia synchronizację w tle aplikacji: po starcie, po powrocie na pierwszy plan, po odzyskaniu
// sieci, po lokalnym zapisie i co minutę. iOS nie pozwala aplikacjom internetowym działać w tle,
// więc wszystko dzieje się wtedy, gdy aplikacja jest otwarta.
import { onLocalChange } from '../changes';
import { getSyncState, setSyncState } from '../settings';
import { isSyncConfigured } from './config';
import type { SyncServer } from './engine';

type Status = { running: boolean };

let status: Status = { running: false };
const statusListeners = new Set<() => void>();
let current: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

function setStatus(next: Status) {
  status = next;
  statusListeners.forEach((listener) => listener());
}

export function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function getSyncStatus(): Status {
  return status;
}

let serverPromise: Promise<SyncServer> | undefined;

/** Adapter Supabase ładowany przy pierwszym użyciu. */
export function loadServer(): Promise<SyncServer> {
  serverPromise ??= import('./supabase').then((m) => m.supabaseServer);
  return serverPromise;
}

/** Jeden cykl naraz. Wywołanie w trakcie trwającego cyklu czeka na jego koniec. */
export function syncInBackground(): Promise<void> {
  current ??= (async () => {
    const state = await getSyncState();
    if (!state) return;
    setStatus({ running: true });
    const [{ syncNow }, { describeError }, server] = await Promise.all([
      import('./engine'),
      import('./supabase'),
      loadServer(),
    ]);
    try {
      await syncNow(server);
    } catch (error) {
      console.warn('Synchronizacja nie powiodła się', error);
      const latest = await getSyncState();
      if (latest) await setSyncState({ ...latest, lastError: describeError(error) });
      throw error;
    }
  })().finally(() => {
    current = null;
    setStatus({ running: false });
  });
  return current;
}

function schedule(delayMs: number) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    syncInBackground().catch(() => {
      // Błąd jest zapisany w stanie synchronizacji i widoczny na ekranie konta.
    });
  }, delayMs);
}

export function startSyncRunner(): void {
  if (!isSyncConfigured) return;
  onLocalChange(() => schedule(3000));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(0);
  });
  window.addEventListener('online', () => schedule(0));
  setInterval(() => {
    if (document.visibilityState === 'visible') schedule(0);
  }, 60_000);
  schedule(0);
}
