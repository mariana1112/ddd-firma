import type { Table } from 'dexie';
import { db } from './db';
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
} from './types';

export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID istnieje tylko w bezpiecznym kontekście, a testy przez LAN działają na http.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type NewRecord<T extends BaseRecord> = Omit<T, keyof BaseRecord>;

/**
 * Jedyna droga zapisu rekordów. UI nie dotyka Dexie bezpośrednio przy zapisie, więc przyszła
 * synchronizacja lub historia zmian wymagałaby rozbudowy tylko w tym miejscu.
 */
export class Repository<T extends BaseRecord> {
  constructor(readonly table: Table<T, string>) {}

  /** Rekordy nieusunięte. */
  async all(): Promise<T[]> {
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
    await this.table.add(record);
    return record;
  }

  async update(id: string, patch: Partial<NewRecord<T>>): Promise<void> {
    await this.modify(id, { ...patch, updatedAt: new Date().toISOString() } as Partial<T>);
  }

  /** Rekordy usuwane razem dostają ten sam znacznik, dzięki czemu można je razem przywrócić. */
  async softDelete(id: string, at: string = new Date().toISOString()): Promise<void> {
    await this.modify(id, { deletedAt: at, updatedAt: at } as Partial<T>);
  }

  async restore(id: string): Promise<void> {
    await this.modify(id, { deletedAt: null, updatedAt: new Date().toISOString() } as Partial<T>);
  }

  private async modify(id: string, patch: Partial<T>): Promise<void> {
    const current = await this.table.get(id);
    if (!current) throw new Error('Nie znaleziono rekordu.');
    await this.table.put({ ...current, ...patch });
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
