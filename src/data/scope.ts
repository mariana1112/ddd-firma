import { db } from './db';
import type { SyncState } from './types';

/**
 * Który region (oddział) pokazują listy. Technik dostaje z serwera tylko swój region, więc filtr niczego mu nie
 * ukrywa. Konto admina (szef) dostaje wszystkie regiony, ale zwykłe ekrany pokazują mu tylko jego własny region,
 * żeby praca w terenie wyglądała tak samo jak u technika. Wszystkie regiony widać w panelu admina.
 *
 * - 'own': region konta na tym urządzeniu (domyślnie),
 * - 'all': cała firma (panel admina),
 * - identyfikator oddziału: jeden wybrany region (panel admina).
 */
export type ViewScope = 'own' | 'all' | string;

let override: ViewScope | null = null;

/** Panel admina ustawia zakres na czas wyświetlania swoich ekranów; null wraca do własnego regionu. */
export function setViewScope(scope: ViewScope | null): void {
  override = scope;
}

export function currentViewScope(): ViewScope {
  return override ?? 'own';
}

/** Region rekordu: z serwera, a dla rekordu jeszcze niewysłanego (bez znacznika) region tego urządzenia. */
export function regionOf(record: { branchId?: string | null }, ownBranch: string | null): string | null {
  return record.branchId ?? ownBranch;
}

/**
 * Region konta na tym urządzeniu, trzymany w pamięci: listy czytają go bez sięgania do bazy, bo czytanie innej
 * tabeli w trakcie transakcji zapisu by ją przerwało. Ustawiany przy starcie i przy każdej zmianie stanu konta.
 */
let ownBranch: string | null = null;

export function setOwnBranch(state: Pick<SyncState, 'branchId'> | null): void {
  ownBranch = state?.branchId ?? null;
}

/**
 * Zlecenia i zabiegi z innych regionów, które admin udostępnił temu kontu (przydział do jednego zlecenia).
 * Lista przychodzi z serwera przy każdej synchronizacji, więc po odebraniu udostępnienia rekord znika z list.
 */
let granted = new Set<string>();
const GRANTS_KEY = 'grants';

export async function setGrantedRecords(ids: string[]): Promise<void> {
  granted = new Set(ids);
  await db.meta.put({ key: GRANTS_KEY, value: ids, updatedAt: new Date().toISOString() });
}

export function getOwnBranch(): string | null {
  return ownBranch;
}

/** Wczytuje region konta przed pierwszym wyświetleniem list. */
export async function initViewScope(): Promise<void> {
  setOwnBranch(((await db.meta.get('sync'))?.value as SyncState | undefined) ?? null);
  granted = new Set(((await db.meta.get(GRANTS_KEY))?.value as string[] | undefined) ?? []);
}

/** Filtr list według zakresu albo null, gdy nic nie trzeba odfiltrować (bez synchronizacji, cała firma). */
export function scopeFilter(): ((record: { id?: string; branchId?: string | null }) => boolean) | null {
  const scope = currentViewScope();
  if (scope === 'all' || (scope === 'own' && !ownBranch)) return null;
  const own = ownBranch;
  const target = scope === 'own' ? own : scope;
  const shared = granted;
  // Zlecenie z innego regionu udostępnione temu kontu (przydział do jednego zlecenia) też jest „moje”.
  return (record) => regionOf(record, own) === target || (scope === 'own' && Boolean(record.id) && shared.has(record.id!));
}
