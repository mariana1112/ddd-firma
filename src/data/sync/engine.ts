// Silnik synchronizacji local-first. Urządzenie zawsze pracuje na własnej bazie, a ten moduł
// wysyła dziennik zmian na serwer i pobiera rekordy zmienione przez inne urządzenia.
// Na serwer trafiają wyłącznie wartości zaszyfrowane kluczem danych firmy (crypto.ts).
import { logChange, pendingChanges } from '../changes';
import { db, RECORD_TABLES, SCHEMA_VERSION, writeTransaction, type RecordTableName } from '../db';
import { attachments } from '../repo';
import {
  getDataKey,
  getDeviceId,
  getSyncState,
  localJobCounter,
  numberBlocksKey,
  setDataKey,
  setSyncState,
  SYNCED_META_KEYS,
} from '../settings';
import type { Attachment, ChangeOp, MetaRow, NumberBlock, SyncState, SyncTable } from '../types';
import { todayWarsaw } from '../../lib/dates';
import { decryptFields, decryptFile, encryptFields, encryptFile } from './crypto';

export interface PushChange {
  id: string;
  tbl: SyncTable;
  recordId: string;
  op: ChangeOp;
  patch: Record<string, unknown>;
  at: string;
}

export interface RemoteRecord {
  tbl: string;
  id: string;
  data: Record<string, unknown>;
  rev: number;
  purged: boolean;
}

/** Wszystko, czego silnik potrzebuje od serwera. Dostawcę można zmienić bez zmian w silniku. */
export interface SyncServer {
  /** Zapisuje zmiany w kolejności. Ponowne wysłanie tej samej zmiany (to samo id) nic nie robi. */
  push(orgId: string, deviceId: string, schema: number, changes: PushChange[]): Promise<void>;
  /** Rekordy z numerem wersji większym niż sinceRev, rosnąco. */
  pull(orgId: string, sinceRev: number, limit: number): Promise<RemoteRecord[]>;
  /** Rezerwuje count kolejnych numerów, nie mniejszych niż minNext. Zwraca pierwszy. */
  reserveNumbers(orgId: string, series: string, minNext: number, count: number): Promise<number>;
  uploadFile(path: string, blob: Blob): Promise<void>;
  /** Usuwa plik. Brak pliku nie jest błędem. */
  deleteFile(path: string): Promise<void>;
  downloadFile(path: string): Promise<Blob>;
}

export class SyncError extends Error {}

export type Account = Pick<SyncState, 'orgId' | 'orgName' | 'userId' | 'email'>;

const PUSH_BATCH = 200;
const PULL_PAGE = 500;
const NUMBER_BLOCK = 20;
const NUMBER_LOW_WATER = 5;

const recordTables = () => RECORD_TABLES.map((t) => db.table(t));

async function requireKey(): Promise<CryptoKey> {
  const key = await getDataKey();
  if (!key) throw new SyncError('Odblokuj synchronizację hasłem szyfrowania na ekranie konta.');
  return key;
}

/**
 * Włącza synchronizację na tym urządzeniu. Wszystkie lokalne rekordy, także te w koszu, trafiają
 * do kolejki w całości, a zdjęcia są wysyłane ponownie. Dzięki temu serwer dostaje komplet danych
 * w postaci zaszyfrowanej, także gdy urządzenie synchronizowało się wcześniej bez szyfrowania.
 */
export async function enableSync(server: SyncServer, account: Account): Promise<void> {
  await requireKey();
  await writeTransaction([...recordTables(), db.meta], async () => {
    // Dotychczasowy dziennik opisuje stan, który i tak idzie w całości.
    await db.changes.where('pushed').equals(0).modify({ pushed: 1 });
    // Bezpośrednio, bez dziennika: ścieżka i tak trafi na serwer po ponownym wysłaniu pliku.
    await db.attachments.filter((a) => Boolean(a.blob && a.remotePath)).modify({ remotePath: null });
    for (const name of RECORD_TABLES) {
      for (const row of await db.table(name).toArray()) await logChange(name, row.id, 'put', row);
    }
    for (const key of SYNCED_META_KEYS) {
      const row = await db.meta.get(key);
      if (row) await logChange('meta', key, 'put', row);
    }
    await setSyncState({ ...account, cursor: 0, lastSyncAt: null, lastError: null });
  });
  await syncNow(server);
}

/** Wyłącza synchronizację i usuwa klucz. Z wipe usuwa też dane firmy z urządzenia. */
export async function disableSync(options: { wipe: boolean }): Promise<void> {
  if (!options.wipe) {
    await setSyncState(null);
    await setDataKey(null);
    return;
  }
  await db.transaction('rw', [...recordTables(), db.meta, db.changes, db.snapshots], async () => {
    for (const table of recordTables()) await table.clear();
    await db.changes.clear();
    await db.snapshots.clear();
    const keep = await db.meta.get('deviceId');
    await db.meta.clear();
    if (keep) await db.meta.put(keep);
  });
}

/** Pełny cykl: wysłanie zmian i zdjęć, pobranie zmian z serwera, uzupełnienie puli numerów. */
export async function syncNow(server: SyncServer): Promise<void> {
  const state = await getSyncState();
  if (!state) throw new SyncError('Synchronizacja nie jest włączona na tym urządzeniu.');
  const key = await requireKey();
  const deviceId = await getDeviceId();

  await pushPending(server, state, deviceId, key);
  if (await uploadPhotos(server, state, key)) await pushPending(server, state, deviceId, key);
  const unreadable = await pullAll(server, state, key);
  await topUpNumbers(server, state);

  const latest = await getSyncState();
  if (latest) await setSyncState({ ...latest, lastSyncAt: new Date().toISOString(), lastError: null });
  if (unreadable > 0) {
    throw new SyncError(`Nie udało się odszyfrować rekordów z serwera: ${unreadable}. Pozostałe dane są zsynchronizowane.`);
  }
}

async function pushPending(server: SyncServer, state: SyncState, deviceId: string, key: CryptoKey): Promise<void> {
  for (;;) {
    const batch = (await pendingChanges()).slice(0, PUSH_BATCH);
    if (batch.length === 0) return;
    const sealed: PushChange[] = [];
    for (const { id, tbl, recordId, op, patch, at } of batch) {
      sealed.push({ id, tbl, recordId, op, patch: await encryptFields(key, tbl, recordId, patch), at });
    }
    await server.push(state.orgId, deviceId, SCHEMA_VERSION, sealed);
    // Trwale usunięte zdjęcie znika też z magazynu plików. Gdy to się nie uda, zmiana zostaje
    // w kolejce i usunięcie zostanie ponowione przy następnej synchronizacji.
    for (const change of batch) {
      const path = change.patch.remotePath;
      if (change.op === 'purge' && change.tbl === 'attachments' && typeof path === 'string') {
        await server.deleteFile(path);
      }
    }
    // Gdy połączenie zerwie się po zapisie na serwerze, a przed tym miejscem, zmiany zostaną
    // wysłane ponownie. Serwer rozpozna je po id i pominie.
    await db.changes.bulkUpdate(batch.map((c) => ({ key: c.seq!, changes: { pushed: 1 as const } })));
  }
}

/** Wysyła zaszyfrowane pliki zdjęć, których serwer jeszcze nie ma. Zwraca true, gdy coś wysłało. */
async function uploadPhotos(server: SyncServer, state: SyncState, key: CryptoKey): Promise<boolean> {
  const waiting = (await db.attachments.toArray()).filter((a) => a.blob && !a.remotePath && !a.deletedAt);
  for (const photo of waiting) {
    const path = `${state.orgId}/${photo.id}`;
    await server.uploadFile(path, await encryptFile(key, photo.id, photo.blob!));
    await attachments.update(photo.id, { remotePath: path });
  }
  return waiting.length > 0;
}

const KNOWN_TABLES = new Set<string>([...RECORD_TABLES, 'meta']);

/** Zwraca liczbę rekordów, których nie dało się odszyfrować. */
async function pullAll(server: SyncServer, state: SyncState, key: CryptoKey): Promise<number> {
  let cursor = state.cursor;
  let unreadable = 0;
  for (;;) {
    const rows = await server.pull(state.orgId, cursor, PULL_PAGE);
    if (rows.length === 0) return unreadable;
    // Odszyfrowanie przed transakcją: IndexedDB zamyka transakcję, gdy czeka ona na WebCrypto.
    const { readable, failed } = await decryptRows(key, rows);
    unreadable += failed;
    await applyRemote(readable);
    cursor = rows[rows.length - 1].rev;
    const latest = await getSyncState();
    if (!latest) return unreadable;
    await setSyncState({ ...latest, cursor });
    if (rows.length < PULL_PAGE) return unreadable;
  }
}

/** Odszyfrowuje rekordy z serwera. Rekord, którego nie da się odszyfrować, jest pomijany. */
export async function decryptRows(key: CryptoKey, rows: RemoteRecord[]): Promise<{ readable: RemoteRecord[]; failed: number }> {
  const readable: RemoteRecord[] = [];
  let failed = 0;
  for (const row of rows) {
    if (row.purged || !KNOWN_TABLES.has(row.tbl)) {
      readable.push(row);
      continue;
    }
    try {
      readable.push({ ...row, data: await decryptFields(key, row.tbl, row.id, row.data) });
    } catch (error) {
      console.warn(`Pominięto rekord ${row.tbl}/${row.id}`, error);
      failed++;
    }
  }
  return { readable, failed };
}

/**
 * Zapisuje odszyfrowane rekordy z serwera. Niewysłane jeszcze zmiany tego urządzenia są nakładane
 * na wersję z serwera, więc edycja zrobiona w trakcie synchronizacji nie znika, a po jej wysłaniu
 * wszystkie urządzenia dochodzą do tego samego stanu.
 */
export async function applyRemote(rows: RemoteRecord[]): Promise<void> {
  await writeTransaction([...recordTables(), db.meta], async () => {
    for (const row of rows) {
      // Tabela z nowszej wersji aplikacji: zostaje na serwerze, aż to urządzenie się zaktualizuje.
      if (!KNOWN_TABLES.has(row.tbl)) continue;
      const pending = await db.changes
        .where('[tbl+recordId]')
        .equals([row.tbl, row.id])
        .filter((c) => c.pushed === 0)
        .sortBy('seq');
      const local = Object.assign({}, ...pending.map((c) => c.patch)) as Record<string, unknown>;

      if (row.tbl === 'meta') {
        if (!SYNCED_META_KEYS.includes(row.id)) continue;
        if (row.purged) await db.meta.delete(row.id);
        else await db.meta.put({ ...(row.data as unknown as MetaRow), ...local, key: row.id });
        continue;
      }

      const table = db.table(row.tbl as RecordTableName);
      if (row.purged) {
        await table.delete(row.id);
        continue;
      }
      const merged: Record<string, unknown> = { ...row.data, ...local, id: row.id };
      if (row.tbl === 'attachments') {
        // Plik zdjęcia nie jest częścią rekordu. Zostaje ten, który już jest na urządzeniu.
        const existing = (await table.get(row.id)) as Attachment | undefined;
        merged.blob = existing?.blob ?? null;
      }
      await table.put(merged);
    }
  });
}

/** Pula numerów zleceń na bieżący rok, a w grudniu także na następny. */
async function topUpNumbers(server: SyncServer, state: SyncState): Promise<void> {
  const today = todayWarsaw();
  const year = today.slice(0, 4);
  const years = today.slice(5, 7) === '12' ? [year, String(Number(year) + 1)] : [year];
  for (const y of years) {
    const key = numberBlocksKey(y);
    const blocks = (((await db.meta.get(key))?.value as NumberBlock[] | undefined) ?? []).filter((b) => b.next <= b.end);
    const left = blocks.reduce((sum, b) => sum + b.end - b.next + 1, 0);
    if (left >= NUMBER_LOW_WATER) continue;
    // Numery nadane przed włączeniem synchronizacji nie mogą się powtórzyć.
    const minNext = (await localJobCounter(y)) + 1;
    const first = await server.reserveNumbers(state.orgId, `job:${y}`, minNext, NUMBER_BLOCK);
    blocks.push({ next: first, end: first + NUMBER_BLOCK - 1 });
    await db.meta.put({ key, value: blocks, updatedAt: new Date().toISOString() });
  }
}

/** Plik zdjęcia zrobionego na innym urządzeniu, pobierany i odszyfrowywany przy pierwszym wyświetleniu. */
export async function ensurePhoto(server: SyncServer, photo: Attachment): Promise<Blob | null> {
  if (photo.blob) return photo.blob;
  if (!photo.remotePath) return null;
  const key = await requireKey();
  const blob = await decryptFile(key, photo.id, await server.downloadFile(photo.remotePath), photo.mime);
  // Bezpośredni zapis, bez wpisu w dzienniku: plik nie jest synchronizowanym polem rekordu.
  await db.attachments.update(photo.id, { blob });
  return blob;
}
