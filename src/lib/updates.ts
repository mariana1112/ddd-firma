/**
 * Aktualizacje aplikacji. Nowa wersja trafia na GitHub Pages przy każdym wdrożeniu; zainstalowana aplikacja
 * (ikona na telefonie lub komputerze) pobiera ją sama w tle, bez ponownej instalacji. Przeglądarka sprawdza to
 * zwykle tylko przy uruchomieniu, a otwarta cały dzień aplikacja na telefonie rzadko się uruchamia od nowa,
 * więc sprawdzamy też co 15 minut i przy każdym powrocie do aplikacji. Pobrana wersja czeka na „Odśwież”,
 * żeby nie przerwać wypełniania formularza.
 */

declare const __APP_VERSION__: string;
declare const __APP_BUILT__: string;

/** Krótki identyfikator wersji (commit z GitHuba) i data zbudowania. */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
export const APP_BUILT = typeof __APP_BUILT__ === 'string' ? __APP_BUILT__ : '';

const CHECK_EVERY_MS = 15 * 60 * 1000;

let registration: ServiceWorkerRegistration | undefined;

/** Wywoływane po rejestracji service workera: ustawia regularne sprawdzanie aktualizacji. */
export function watchForUpdates(reg: ServiceWorkerRegistration | undefined): void {
  if (!reg || registration === reg) return;
  registration = reg;
  const check = () => {
    if (navigator.onLine) void reg.update().catch(() => undefined);
  };
  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  window.addEventListener('online', check);
}

/** Czeka, aż pobierana wersja się zainstaluje (albo minie limit czasu). */
function settled(reg: ServiceWorkerRegistration, timeoutMs: number): Promise<void> {
  const worker = reg.installing;
  if (!worker) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      if (worker.state !== 'installing') resolve();
    };
    worker.addEventListener('statechange', done);
    setTimeout(resolve, timeoutMs);
  });
}

/**
 * Sprawdza od razu, czy na GitHubie jest nowsza wersja.
 * - 'nowa': pobrana, czeka na „Odśwież” (pasek u dołu ekranu),
 * - 'aktualna': to jest najnowsza wersja,
 * - 'offline' / 'niedostepne': brak internetu albo przeglądarka bez obsługi aktualizacji w tle.
 */
export async function checkForUpdates(): Promise<'nowa' | 'aktualna' | 'offline' | 'niedostepne'> {
  const reg = registration ?? (await navigator.serviceWorker?.getRegistration().catch(() => undefined));
  if (!reg) return 'niedostepne';
  if (!navigator.onLine) return 'offline';
  try {
    await reg.update();
  } catch {
    return 'offline';
  }
  await settled(reg, 15000);
  return reg.waiting ? 'nowa' : 'aktualna';
}
