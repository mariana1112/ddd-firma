import Dexie, { type Table } from 'dexie';
import type {
  Attachment,
  BaseRecord,
  Client,
  Expense,
  Job,
  MetaRow,
  Payment,
  Preparation,
  Service,
  Site,
  Snapshot,
  StockMovement,
} from './types';

export const SCHEMA_VERSION = 2;

class AppDatabase extends Dexie {
  clients!: Table<Client, string>;
  sites!: Table<Site, string>;
  services!: Table<Service, string>;
  jobs!: Table<Job, string>;
  preparations!: Table<Preparation, string>;
  stockMovements!: Table<StockMovement, string>;
  payments!: Table<Payment, string>;
  expenses!: Table<Expense, string>;
  attachments!: Table<Attachment, string>;
  meta!: Table<MetaRow, string>;
  snapshots!: Table<Snapshot, string>;

  constructor() {
    super('ddd-firma');
    // Zmiana schematu to zawsze nowy this.version(n) z upgrade(). Starych wersji nie wolno
    // edytować ani usuwać, bo Dexie migruje na ich podstawie dane z urządzenia.
    // Numery wersji są wpisane na stałe: SCHEMA_VERSION to tylko najnowsza z nich.
    this.version(1).stores({
      clients: 'id, name, updatedAt',
      sites: 'id, clientId, updatedAt',
      services: 'id, updatedAt',
      jobs: 'id, clientId, siteId, status, start, updatedAt',
      preparations: 'id, updatedAt',
      stockMovements: 'id, preparationId, date, updatedAt',
      payments: 'id, jobId, date, updatedAt',
      expenses: 'id, date, movementId, updatedAt',
      attachments: 'id, jobId, updatedAt',
      meta: 'key',
      snapshots: 'id, createdAt',
    });
    // Stacje deratyzacyjne i ich przeglądy. updatedAt zostaje bez zmian: migracja nie jest edycją,
    // a scalanie kopii rozstrzyga konflikty właśnie po tym znaczniku.
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        await tx.table('sites').toCollection().modify((site: Partial<Site>) => {
          site.stations ??= [];
        });
        await tx.table('jobs').toCollection().modify((job: Partial<Job>) => {
          job.stationChecks ??= [];
        });
      });
  }
}

export const db = new AppDatabase();

/** Tabele z rekordami biznesowymi, czyli te, które mają kosz i trafiają do kopii. */
export const RECORD_TABLES = [
  'clients',
  'sites',
  'services',
  'jobs',
  'preparations',
  'stockMovements',
  'payments',
  'expenses',
  'attachments',
] as const;

export type RecordTableName = (typeof RECORD_TABLES)[number];

export function recordTable(name: RecordTableName): Table<BaseRecord, string> {
  return db.table(name);
}
