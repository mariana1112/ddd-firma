import Dexie, { type Table } from 'dexie';
import type {
  Attachment,
  BaseRecord,
  ChangeRow,
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
  Order,
  Visit,
  Trip,
} from './types';

export const SCHEMA_VERSION = 5;

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
  orders!: Table<Order, string>;
  visits!: Table<Visit, string>;
  trips!: Table<Trip, string>;
  changes!: Table<ChangeRow, number>;

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
    // Dziennik zmian, który jest też kolejką wysyłki na serwer. Istniejące dane nie trafiają do niego
    // przy migracji: pierwsze włączenie synchronizacji wysyła wszystkie rekordy w całości.
    this.version(3).stores({
      changes: '++seq, id, pushed, [tbl+recordId]',
    });
    // Szyfrowanie end-to-end. Bez zmian w tabelach: wersja mówi serwerowi, że aplikacja szyfruje,
    // a serwer odrzuca zmiany z wersji niższych (app_config.min_schema).
    this.version(4).stores({});
    // Przebudowa pod Pogromców Insektów: zlecenia z danymi klienta, zabiegi i kilometrówka.
    // Dawne tabele zostają, żeby aktualizacja nie usunęła żadnych danych z urządzenia.
    this.version(5).stores({
      orders: 'id, number, updatedAt',
      visits: 'id, orderId, start, status, doneOn, updatedAt',
      trips: 'id, date, updatedAt',
    });
  }
}

export const db = new AppDatabase();

/**
 * Transakcja zapisu. Zawsze obejmuje dziennik zmian, bo każdy zapis przez Repository dopisuje
 * do niego wpis, a Dexie odrzuca zapis do tabeli spoza transakcji nadrzędnej.
 */
export function writeTransaction<T>(tables: Table[], scope: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [...tables, db.changes], scope);
}

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
  'orders',
  'visits',
  'trips',
] as const;

export type RecordTableName = (typeof RECORD_TABLES)[number];

export function recordTable(name: RecordTableName): Table<BaseRecord, string> {
  return db.table(name);
}
