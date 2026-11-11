// Uruchamia synchronizację w tle aplikacji: po starcie, po powrocie na pierwszy plan, po odzyskaniu
// sieci, po lokalnym zapisie i co minutę. iOS nie pozwala aplikacjom internetowym działać w tle,
// więc wszystko dzieje się wtedy, gdy aplikacja jest otwarta.
import { onLocalChange } from '../changes';
import { getSyncState, matchRegionsToServer, setSyncState } from '../settings';
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

let roleCheckedAt = 0;
let accountCheckedAt = 0;

/** Telefon, z którego konta admin usunął konto: tu zapisujemy, żeby ekran logowania powiedział dlaczego. */
export const ACCOUNT_REMOVED_KEY = 'ddd:konto-usuniete';

/**
 * Co minutę sprawdza, czy konto nadal jest w firmie. Usunięte konto (albo usunięte z firmy) jest od razu wylogowane,
 * a dane firmy znikają z telefonu: nie zostaje wgląd do starych zleceń.
 */
async function checkAccount(): Promise<boolean> {
  if (Date.now() - accountCheckedAt < 60 * 1000) return true;
  accountCheckedAt = Date.now();
  const state = await getSyncState();
  if (!state) return true;
  const api = await import('./supabase');
  let status: Awaited<ReturnType<typeof api.accountStatus>>;
  try {
    status = await api.accountStatus(state.orgId);
  } catch {
    return true;
  }
  if (status !== 'removed') return true;
  await api.signOut().catch(() => undefined);
  const { disableSync } = await import('./engine');
  await disableSync({ wipe: true });
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('ddd:')) localStorage.removeItem(key);
    localStorage.setItem(ACCOUNT_REMOVED_KEY, new Date().toISOString());
  } catch {
    // Bez pamięci przeglądarki ekran logowania po prostu nie poda powodu.
  }
  return false;
}

/** Co kilka minut sprawdza rolę konta na serwerze: nadanie albo odebranie admina działa bez ponownego logowania. */
async function refreshRole(): Promise<void> {
  if (Date.now() - roleCheckedAt < 5 * 60 * 1000) return;
  roleCheckedAt = Date.now();
  try {
    const state = await getSyncState();
    if (!state) return;
    const api = await import('./supabase');
    const membership = (await api.myMemberships()).find((m) => m.orgId === state.orgId);
    if (membership && membership.role !== state.role) await setSyncState({ ...state, role: membership.role });
    // Admin widzi wszystkie regiony z serwera: lista nazw w ustawieniach firmy idzie za nią (usunięte znikają u wszystkich).
    if ((membership?.role ?? state.role) === 'owner') {
      await matchRegionsToServer(await api.listBranches(state.orgId));
    }
  } catch {
    // Bez internetu rola zostaje do następnego sprawdzenia.
  }
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
      // Usunięte konto: dane są już skasowane z telefonu, synchronizacji nie ma czego robić.
      if (!(await checkAccount())) return;
      await syncNow(server);
      await refreshRole();
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
  // Zapis wysyła się po sekundzie, a inne urządzenia pobierają zmiany co 20 sekund i przy każdym przejściu
  // między ekranami (najwyżej raz na 10 sekund), więc karty zleceń i raporty są aktualne.
  onLocalChange(() => schedule(1000));
  let lastNav = 0;
  window.addEventListener('hashchange', () => {
    if (Date.now() - lastNav < 10_000) return;
    lastNav = Date.now();
    schedule(0);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(0);
  });
  window.addEventListener('online', () => schedule(0));
  setInterval(() => {
    if (document.visibilityState === 'visible') schedule(0);
  }, 20_000);
  schedule(0);
}
