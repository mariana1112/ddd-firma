import { newId } from '../lib/ids';
import { db } from './db';
import type { ChangeOp, ChangeRow, SyncTable } from './types';

const listeners = new Set<() => void>();

/** Powiadomienie o lokalnym zapisie, np. żeby zaplanować synchronizację. */
export function onLocalChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Pola, które nie wychodzą z urządzenia: pliki idą na serwer osobną drogą. */
export function toPatch(record: object): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== 'blob' && !(value instanceof Blob)) patch[key] = value;
  }
  return patch;
}

/** Dopisuje zmianę do dziennika. Musi działać w transakcji, która obejmuje db.changes. */
export async function logChange(tbl: SyncTable, recordId: string, op: ChangeOp, patch: object): Promise<void> {
  const row: ChangeRow = {
    id: newId(),
    tbl,
    recordId,
    op,
    patch: toPatch(patch),
    at: new Date().toISOString(),
    pushed: 0,
  };
  await db.changes.add(row);
  // Po zatwierdzeniu transakcji, nie w jej trakcie.
  setTimeout(() => listeners.forEach((listener) => listener()), 0);
}

export function pendingChanges(): Promise<ChangeRow[]> {
  return db.changes.where('pushed').equals(0).sortBy('seq');
}

export function pendingCount(): Promise<number> {
  return db.changes.where('pushed').equals(0).count();
}
