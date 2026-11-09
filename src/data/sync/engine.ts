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
  localOrderCounter,
  saveProfile,
  ORDER_NUMBERS_KEY,
  setDataKey,
  setSyncState,
  SYNCED_META_KEYS,
} from '../settings';
import type { Attachment, ChangeOp, MetaRow, NumberBlock, SyncState, SyncTable } from '../types';
import { createDataKey, decryptFields, decryptFile, encryptFields, encryptFile, type WrappedKey } from './crypto';

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
  /** Region (oddział) rekordu na serwerze. */
  branchId?: string | null;
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

export type Account = Pick<SyncState, 'orgId' | 'orgName' | 'userId' | 'email' | 'role' | 'displayName' | 'branchId' | 'branchName'>;

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
    // Imię z konta podpisuje zlecenia, zabiegi i raporty tego urządzenia.
    await saveProfile({ name: account.displayName ?? '', userId: account.userId });
  });
  await syncNow(server);
}

/**
 * Zmiana hasła szyfrowania na urządzeniu admina, które ma klucz i komplet danych (np. gdy nikt nie pamięta hasła).
 * 1. Pełna synchronizacja starym kluczem: urządzenie dostaje wszystkie rekordy firmy.
 * 2. Pobranie i odszyfrowanie zdjęć, których plików jeszcze tu nie ma.
 * 3. Nowy klucz z nowego hasła, zapisany na serwerze i na urządzeniu.
 * 4. Wysłanie wszystkich rekordów i zdjęć ponownie, zaszyfrowanych nowym kluczem.
 * Gdy coś przerwie krok 4, ponowna synchronizacja z tego urządzenia go dokończy (dane są tu w całości).
 */
export async function rotateDataKey(
  server: SyncServer,
  newPassphrase: string,
  saveOrgKey: (orgId: string, wrapped: WrappedKey) => Promise<void>,
  onStep: (text: string) => void = () => undefined,
): Promise<{ photosMissing: number }> {
  const state = await getSyncState();
  if (!state) throw new SyncError('Synchronizacja nie jest włączona na tym urządzeniu.');
  if (state.role !== 'owner') throw new SyncError('Hasło szyfrowania zmienia tylko admin.');
  await requireKey();

  onStep('Pobieram wszystkie dane firmy…');
  await setSyncState({ ...state, regionsTagged: false });
  await syncNow(server);

  onStep('Pobieram zdjęcia…');
  let photosMissing = 0;
  for (const photo of await db.attachments.toArray()) {
    if (photo.blob || !photo.remotePath || photo.deletedAt) continue;
    try {
      if (!(await ensurePhoto(server, photo))) photosMissing++;
    } catch {
      photosMissing++;
    }
  }

  onStep('Tworzę nowy klucz…');
  const { key, wrapped } = await createDataKey(newPassphrase);
  await saveOrgKey(state.orgId, wrapped);
  await setDataKey(key);

  onStep('Wysyłam dane zaszyfrowane nowym kluczem…');
  const latest = (await getSyncState()) ?? state;
  await enableSync(server, {
    orgId: latest.orgId,
    orgName: latest.orgName,
    userId: latest.userId,
    email: latest.email,
    role: latest.role,
    displayName: latest.displayName,
    branchId: latest.branchId,
    branchName: latest.branchName,
  });
  return { photosMissing };
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
  // Rekordy pobrane przed wersją z regionami nie mają znacznika regionu: jednorazowo pobieramy wszystko od nowa.
  let cursor = state.regionsTagged ? state.cursor : 0;
  let unreadable = 0;
  for (;;) {
    const rows = await server.pull(state.orgId, cursor, PULL_PAGE);
    if (rows.length === 0) {
      const latest = await getSyncState();
      if (latest && !latest.regionsTagged) await setSyncState({ ...latest, regionsTagged: true });
      return unreadable;
    }
    // Odszyfrowanie przed transakcją: IndexedDB zamyka transakcję, gdy czeka ona na WebCrypto.
    const { readable, failed } = await decryptRows(key, rows);
    unreadable += failed;
    await applyRemote(readable);
    cursor = rows[rows.length - 1].rev;
    const latest = await getSyncState();
    if (!latest) return unreadable;
    await setSyncState({ ...latest, cursor, regionsTagged: true });
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
      // Region rekordu nadaje serwer; zapisany tylko lokalnie, bez wpisu w dzienniku zmian.
      if (row.branchId !== undefined) merged.branchId = row.branchId;
      if (row.tbl === 'attachments') {
        // Plik zdjęcia nie jest częścią rekordu. Zostaje ten, który już jest na urządzeniu.
        const existing = (await table.get(row.id)) as Attachment | undefined;
        merged.blob = existing?.blob ?? null;
      }
      await table.put(merged);
    }
  });
}

/** Pula numerów zleceń (#210) zarezerwowana na serwerze, żeby urządzenia nie nadawały tych samych. */
async function topUpNumbers(server: SyncServer, state: SyncState): Promise<void> {
  const blocks = (((await db.meta.get(ORDER_NUMBERS_KEY))?.value as NumberBlock[] | undefined) ?? []).filter((b) => b.next <= b.end);
  const left = blocks.reduce((sum, b) => sum + b.end - b.next + 1, 0);
  if (left >= NUMBER_LOW_WATER) return;
  // Numery nadane przed włączeniem synchronizacji albo bez internetu nie mogą się powtórzyć.
  const minNext = (await localOrderCounter()) + 1;
  const first = await server.reserveNumbers(state.orgId, 'order', minNext, NUMBER_BLOCK);
  blocks.push({ next: first, end: first + NUMBER_BLOCK - 1 });
  await db.meta.put({ key: ORDER_NUMBERS_KEY, value: blocks, updatedAt: new Date().toISOString() });
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
