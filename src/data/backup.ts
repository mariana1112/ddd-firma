import { z } from 'zod';
import { nowWarsaw } from '../lib/dates';
import { db, RECORD_TABLES, recordTable, SCHEMA_VERSION, type RecordTableName } from './db';
import { newId } from './repo';
import { markBackupDone } from './settings';
import type { Attachment, BaseRecord, MetaRow, Snapshot } from './types';

export const BACKUP_FORMAT = 'ddd-firma-backup';
const MAX_SNAPSHOTS = 3;

export class BackupError extends Error {}

type SerializedAttachment = Omit<Attachment, 'blob'> & { dataBase64: string };

export interface BackupTables {
  clients: BaseRecord[];
  sites: BaseRecord[];
  services: BaseRecord[];
  jobs: BaseRecord[];
  preparations: BaseRecord[];
  stockMovements: BaseRecord[];
  payments: BaseRecord[];
  expenses: BaseRecord[];
  attachments: SerializedAttachment[];
  meta: MetaRow[];
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  /** Wersja, w której powstał plik. Po parseBackup tabele mają już aktualny kształt. */
  schemaVersion: number;
  exportedAt: string;
  includesPhotos: boolean;
  checksum: string | null;
  tables: BackupTables;
}

// Sprawdzamy to, od czego zależy spójność bazy. Reszta pól przechodzi bez zmian,
// żeby kopia z nowszej aplikacji tej samej wersji schematu nie traciła danych.
const base = z.looseObject({
  id: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
const grosze = z.number().int();

const stationSchema = z.looseObject({
  id: z.string().min(1),
  number: z.string(),
  type: z.string(),
  location: z.string(),
  deletedAt: z.string().nullable(),
});

const stationCheckSchema = z.looseObject({
  stationId: z.string().min(1),
  number: z.string(),
  type: z.string(),
  location: z.string(),
  state: z.enum(['bez-sladow', 'slady-zerowania', 'wymiana-trutki', 'uszkodzona', 'brak']),
  notes: z.string(),
});

const tablesSchema = z.object({
  clients: z.array(base.extend({ name: z.string() })),
  sites: z.array(base.extend({ clientId: z.string(), stations: z.array(stationSchema) })),
  services: z.array(base.extend({ name: z.string(), priceNet: grosze })),
  jobs: z.array(
    base.extend({
      number: z.string(),
      clientId: z.string(),
      status: z.enum(['wycena', 'zaplanowane', 'wykonane', 'anulowane']),
      lines: z.array(z.looseObject({ qtyMilli: grosze, unitPriceNet: grosze })),
      materials: z.array(z.looseObject({ preparationId: z.string(), qtyMilli: grosze })),
      stationChecks: z.array(stationCheckSchema),
    }),
  ),
  preparations: z.array(base.extend({ name: z.string() })),
  stockMovements: z.array(base.extend({ preparationId: z.string(), qtyMilli: grosze, date: z.string() })),
  payments: z.array(base.extend({ jobId: z.string(), amount: grosze, date: z.string() })),
  expenses: z.array(base.extend({ amount: grosze, date: z.string() })),
  attachments: z.array(base.extend({ jobId: z.string(), mime: z.string(), dataBase64: z.string() })),
  meta: z.array(z.looseObject({ key: z.string().min(1), updatedAt: z.string() })),
});

const fileSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().positive(),
  exportedAt: z.string(),
  includesPhotos: z.boolean(),
  checksum: z.string().nullable(),
  tables: z.unknown(),
});

/** Listy, których nie ma w kopiach sprzed wersji 2 schematu. */
const LISTS_ADDED_IN_V2: Partial<Record<RecordTableName, string>> = { sites: 'stations', jobs: 'stationChecks' };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Doprowadza surowe tabele ze starszej kopii do aktualnego kształtu. Złe dane odrzuci dopiero walidacja. */
function upgradeTables(tables: unknown, fromVersion: number): unknown {
  if (fromVersion >= 2 || !isObject(tables)) return tables;
  const upgraded = { ...tables };
  for (const [name, field] of Object.entries(LISTS_ADDED_IN_V2)) {
    const rows = upgraded[name];
    if (Array.isArray(rows)) {
      upgraded[name] = rows.map((row: unknown) => (isObject(row) && !(field in row) ? { ...row, [field]: [] } : row));
    }
  }
  return upgraded;
}

async function sha256(text: string): Promise<string | null> {
  // crypto.subtle istnieje tylko w bezpiecznym kontekście (https lub localhost).
  if (!crypto.subtle) return null;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
  }
  return btoa(chunks.join(''));
}

function base64ToBlob(data: string, mime: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function buildBackup(options: { includePhotos: boolean }): Promise<BackupFile> {
  return db.transaction('r', [...RECORD_TABLES.map((t) => db.table(t)), db.meta], async () => {
    const rows = {} as Record<Exclude<RecordTableName, 'attachments'>, BaseRecord[]>;
    for (const name of RECORD_TABLES) {
      if (name !== 'attachments') rows[name] = await recordTable(name).toArray();
    }
    const attachmentRows = options.includePhotos ? await db.attachments.toArray() : [];
    const meta = await db.meta.toArray();
    return { rows, attachmentRows, meta };
  }).then(async ({ rows, attachmentRows, meta }) => {
    // Odczyt blobów kończy transakcję IndexedDB, więc kodowanie idzie już poza nią.
    const serialized: SerializedAttachment[] = await Promise.all(
      attachmentRows.map(async ({ blob, ...rest }) => ({ ...rest, dataBase64: await blobToBase64(blob) })),
    );
    const tables: BackupTables = { ...rows, attachments: serialized, meta };
    return {
      format: BACKUP_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      includesPhotos: options.includePhotos,
      checksum: await sha256(JSON.stringify(tables)),
      tables,
    } satisfies BackupFile;
  });
}

export function backupFileName(exportedAt: string): string {
  const stamp = nowWarsaw(new Date(exportedAt)).replace(/[-:]/g, '').replace('T', '-');
  return `ddd-firma-kopia-${stamp}.json`;
}

/** Eksport dla użytkownika. Zapisuje też datę kopii, żeby pulpit przestał przypominać. */
export async function exportBackup(options: { includePhotos: boolean }): Promise<{ blob: Blob; filename: string }> {
  const backup = await buildBackup(options);
  await markBackupDone(backup.exportedAt);
  return {
    blob: new Blob([JSON.stringify(backup)], { type: 'application/json' }),
    filename: backupFileName(backup.exportedAt),
  };
}

export interface BackupSummary {
  exportedAt: string;
  includesPhotos: boolean;
  counts: Record<'clients' | 'sites' | 'services' | 'jobs' | 'preparations' | 'payments' | 'expenses' | 'attachments', number>;
}

/** Odczytuje plik kopii i sprawdza go w całości, zanim cokolwiek zostanie zapisane. */
export async function parseBackup(text: string): Promise<{ backup: BackupFile; summary: BackupSummary }> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('To nie jest poprawny plik kopii: nie można odczytać JSON.');
  }
  const file = fileSchema.safeParse(raw);
  if (!file.success) throw new BackupError('To nie jest plik kopii zapasowej tej aplikacji.');
  if (file.data.schemaVersion > SCHEMA_VERSION) {
    throw new BackupError('Kopia pochodzi z nowszej wersji aplikacji. Najpierw zaktualizuj aplikację.');
  }
  if (file.data.checksum) {
    const actual = await sha256(JSON.stringify(file.data.tables));
    if (actual && actual !== file.data.checksum) {
      throw new BackupError('Plik kopii jest uszkodzony: suma kontrolna się nie zgadza.');
    }
  }
  // Suma kontrolna dotyczy pliku takiego, jaki zapisano, więc migracja idzie dopiero po jej sprawdzeniu.
  const tables = tablesSchema.safeParse(upgradeTables(file.data.tables, file.data.schemaVersion));
  if (!tables.success) {
    const where = tables.error.issues[0]?.path.slice(0, 2).join(', rekord ');
    throw new BackupError(`Plik kopii ma niepoprawne dane (${where}).`);
  }
  const backup = { ...file.data, tables: tables.data } as unknown as BackupFile;
  const t = backup.tables;
  return {
    backup,
    summary: {
      exportedAt: backup.exportedAt,
      includesPhotos: backup.includesPhotos,
      counts: {
        clients: active(t.clients),
        sites: active(t.sites),
        services: active(t.services),
        jobs: active(t.jobs),
        preparations: active(t.preparations),
        payments: active(t.payments),
        expenses: active(t.expenses),
        attachments: active(t.attachments),
      },
    },
  };
}

function active(rows: BaseRecord[]): number {
  return rows.filter((r) => !r.deletedAt).length;
}

function restoreAttachments(rows: SerializedAttachment[]): Attachment[] {
  return rows.map(({ dataBase64, ...rest }) => ({ ...rest, blob: base64ToBlob(dataBase64, rest.mime) }));
}

export async function createSnapshot(reason: string): Promise<void> {
  const backup = await buildBackup({ includePhotos: true });
  const snapshot: Snapshot = {
    id: newId(),
    createdAt: backup.exportedAt,
    reason,
    data: JSON.stringify(backup),
  };
  await db.transaction('rw', db.snapshots, async () => {
    await db.snapshots.add(snapshot);
    const keys = await db.snapshots.orderBy('createdAt').reverse().primaryKeys();
    await db.snapshots.bulkDelete(keys.slice(MAX_SNAPSHOTS));
  });
}

export type RestoreMode = 'merge' | 'replace';

function keepList(incoming: BaseRecord[], current: BaseRecord[], list: string): BaseRecord[] {
  const byId = new Map<string, unknown>(current.map((row) => [row.id, row]));
  return incoming.map((row) => {
    const existing = byId.get(row.id) as Record<string, unknown> | undefined;
    return existing ? { ...row, [list]: existing[list] } : row;
  });
}

function mergeNewest<T extends { updatedAt: string }>(current: T[], incoming: T[], key: (row: T) => string): T[] {
  const byKey = new Map(current.map((row) => [key(row), row]));
  return incoming.filter((row) => {
    const existing = byKey.get(key(row));
    return !existing || existing.updatedAt < row.updatedAt;
  });
}

/**
 * Przywraca kopię w jednej transakcji, a wcześniej zapisuje migawkę obecnych danych.
 * "merge" nigdy nie nadpisuje nowszych rekordów, a kopia sprzed wersji 2 nie kasuje stacji
 * ani przeglądów, o których nic nie wie. "replace" ustawia bazę na stan z kopii,
 * ale kopia bez zdjęć zostawia zdjęcia z urządzenia.
 */
export async function restoreBackup(backup: BackupFile, mode: RestoreMode): Promise<void> {
  await createSnapshot(mode === 'replace' ? 'Przed zastąpieniem danych kopią' : 'Przed scaleniem z kopią');
  const attachmentRows = restoreAttachments(backup.tables.attachments);

  await db.transaction('rw', [...RECORD_TABLES.map((t) => db.table(t)), db.meta], async () => {
    for (const name of RECORD_TABLES) {
      if (name === 'attachments') continue;
      const incoming = backup.tables[name];
      const table = recordTable(name);
      if (mode === 'replace') {
        await table.clear();
        await table.bulkPut(incoming);
      } else {
        const current = await table.toArray();
        const newer = mergeNewest(current, incoming, (r) => r.id);
        const list = backup.schemaVersion < 2 ? LISTS_ADDED_IN_V2[name] : undefined;
        await table.bulkPut(list ? keepList(newer, current, list) : newer);
      }
    }

    if (mode === 'replace' && backup.includesPhotos) {
      await db.attachments.clear();
      await db.attachments.bulkPut(attachmentRows);
    } else {
      await db.attachments.bulkPut(mergeNewest(await db.attachments.toArray(), attachmentRows, (r) => r.id));
    }

    const currentMeta = await db.meta.toArray();
    const metaRows = mergeNewest(currentMeta, backup.tables.meta, (r) => r.key).map((row) => {
      // Licznik numerów zleceń nie może się cofnąć, bo powstałyby duplikaty numerów.
      if (!row.key.startsWith('counter:')) return row;
      const existing = currentMeta.find((c) => c.key === row.key);
      return { ...row, value: Math.max(Number(row.value), Number(existing?.value ?? 0)) };
    });
    await db.meta.bulkPut(metaRows);
  });
}

export async function listSnapshots(): Promise<Array<Omit<Snapshot, 'data'> & { sizeBytes: number }>> {
  const rows = await db.snapshots.orderBy('createdAt').reverse().toArray();
  return rows.map(({ data, ...rest }) => ({ ...rest, sizeBytes: data.length }));
}

export async function restoreSnapshot(id: string): Promise<void> {
  const snapshot = await db.snapshots.get(id);
  if (!snapshot) throw new BackupError('Nie znaleziono migawki.');
  const { backup } = await parseBackup(snapshot.data);
  await restoreBackup(backup, 'replace');
}
