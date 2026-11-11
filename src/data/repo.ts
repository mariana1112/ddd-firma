import type { Table } from 'dexie';
import { newId } from '../lib/ids';
import { logChange } from './changes';
import { db, type RecordTableName } from './db';
import { scopeFilter } from './scope';
import type {
  Attachment,
  BaseRecord,
  Client,
  Expense,
  Job,
  Payment,
  Preparation,
  Service,
  Site,
  StockMovement,
  Order,
  Visit,
  Trip,
  Message,
} from './types';

export { newId };

/** Porównanie wartości pól rekordu: tekstów, liczb, list i obiektów. Pliki porównuje po tożsamości. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Blob || b instanceof Blob) return false;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export type NewRecord<T extends BaseRecord> = Omit<T, keyof BaseRecord>;

/**
 * Jedyna droga zapisu rekordów. Każdy zapis dopisuje zmienione pola do dziennika zmian w tej samej
 * transakcji, więc synchronizacja i historia widzą wszystko, co zmieniło się na urządzeniu.
 */
export class Repository<T extends BaseRecord> {
  constructor(readonly table: Table<T, string>) {}

  private get name(): RecordTableName {
    return this.table.name as RecordTableName;
  }

  private write<R>(scope: () => Promise<R>): Promise<R> {
    return db.transaction('rw', this.table, db.changes, scope);
  }

  /** Rekordy nieusunięte z regionu, który teraz pokazują ekrany (zob. scope.ts). */
  async all(): Promise<T[]> {
    const rows = await this.table.toArray();
    const inScope = scopeFilter();
    return rows.filter((r) => !r.deletedAt && (!inScope || inScope(r)));
  }

  /** Rekordy nieusunięte ze wszystkich regionów, bez względu na widok (kopie, eksport, liczniki). */
  async allRegions(): Promise<T[]> {
    const rows = await this.table.toArray();
    return rows.filter((r) => !r.deletedAt);
  }

  async get(id: string): Promise<T | undefined> {
    return this.table.get(id);
  }

  async where(index: string, value: string): Promise<T[]> {
    const rows = await this.table.where(index).equals(value).toArray();
    return rows.filter((r) => !r.deletedAt);
  }

  async create(data: NewRecord<T>, id: string = newId()): Promise<T> {
    const now = new Date().toISOString();
    const record = { ...data, id, createdAt: now, updatedAt: now, deletedAt: null } as T;
    await this.write(async () => {
      await this.table.add(record);
      await logChange(this.name, id, 'create', record);
    });
    return record;
  }

  async update(id: string, patch: Partial<NewRecord<T>>): Promise<void> {
    await this.modify(id, 'update', { ...patch, updatedAt: new Date().toISOString() } as Partial<T>);
  }

  /** Rekordy usuwane razem dostają ten sam znacznik, dzięki czemu można je razem przywrócić. */
  async softDelete(id: string, at: string = new Date().toISOString()): Promise<void> {
    await this.modify(id, 'delete', { deletedAt: at, updatedAt: at } as Partial<T>);
  }

  async restore(id: string): Promise<void> {
    await this.modify(id, 'restore', { deletedAt: null, updatedAt: new Date().toISOString() } as Partial<T>);
  }

  private async modify(id: string, op: 'update' | 'delete' | 'restore', patch: Partial<T>): Promise<void> {
    await this.write(async () => {
      const current = await this.table.get(id);
      if (!current) throw new Error('Nie znaleziono rekordu.');
      // Formularze zapisują wszystkie pola naraz. Do dziennika trafiają tylko te zmienione, bo inaczej
      // niezmienione pole nadpisałoby na serwerze zmianę zrobioną w międzyczasie na innym urządzeniu.
      const changed = Object.fromEntries(
        Object.entries(patch).filter(([key, value]) => key === 'updatedAt' || !sameValue(value, current[key as keyof T])),
      ) as Partial<T>;
      if (Object.keys(changed).every((key) => key === 'updatedAt')) return;
      await this.table.put({ ...current, ...changed });
      await logChange(this.name, id, op, changed);
    });
  }
}

export const clients = new Repository<Client>(db.clients);
export const sites = new Repository<Site>(db.sites);
export const services = new Repository<Service>(db.services);
export const jobs = new Repository<Job>(db.jobs);
export const preparations = new Repository<Preparation>(db.preparations);
export const stockMovements = new Repository<StockMovement>(db.stockMovements);
export const payments = new Repository<Payment>(db.payments);
export const expenses = new Repository<Expense>(db.expenses);
export const attachments = new Repository<Attachment>(db.attachments);
export const messages = new Repository<Message>(db.messages);
export const orders = new Repository<Order>(db.orders);
export const visits = new Repository<Visit>(db.visits);
export const trips = new Repository<Trip>(db.trips);
