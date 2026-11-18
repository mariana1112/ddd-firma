import { getSyncState, localOrderCounter, orderSeries } from '../settings';
import { isSyncConfigured } from './config';

/** Ile czekamy na numer z serwera, zanim nadamy go na telefonie (np. przy słabym zasięgu). */
const RESERVE_TIMEOUT_MS = 5000;

type NumberServer = { reserveNumbers(orgId: string, series: string, minNext: number, count: number): Promise<number> };

/** Serwer ostatniej synchronizacji (ustawia go silnik synchronizacji); bez niego numer bierzemy z Supabase. */
let registered: NumberServer | null = null;

export function registerNumberServer(server: NumberServer): void {
  registered = server;
}

/**
 * Kolejny numer zlecenia prosto z serwera, w chwili zapisu zlecenia. Serwer prowadzi jeden licznik regionu, więc
 * zlecenia dodawane przez szefa i technika dostają numery po kolei (bez zapasów trzymanych na telefonach, które
 * robiły przeskoki). Bez internetu albo konta: null, wtedy numer nadaje telefon.
 */
export async function reserveOrderNumber(): Promise<number | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  const state = await getSyncState();
  if (!state) return null;
  try {
    const server: NumberServer | null = registered ?? (isSyncConfigured ? (await import('./supabase')).supabaseServer : null);
    if (!server) return null;
    const counter = await localOrderCounter(state.branchId ?? null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), RESERVE_TIMEOUT_MS));
    const number = await Promise.race([server.reserveNumbers(state.orgId, orderSeries(state.branchId), counter + 1, 1), timeout]);
    return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : null;
  } catch {
    return null;
  }
}
