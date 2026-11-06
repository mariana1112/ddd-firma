import { newId } from '../lib/ids';
import { logChange } from './changes';
import { db, writeTransaction } from './db';
import type { CompanySettings, NumberBlock, SyncState } from './types';

export const DEFAULT_COMPANY: CompanySettings = {
  name: '',
  owner: '',
  nip: '',
  regon: '',
  street: '',
  postalCode: '',
  city: '',
  phone: '',
  email: '',
  bankAccount: '',
  logoDataUrl: null,
  vatPayer: true,
  defaultVatRate: 23,
  offerValidityDays: 30,
  protocolFooter: '',
};

/** Klucze meta wspólne dla wszystkich urządzeń firmy. */
export const SYNCED_META_KEYS = ['company'];

/** Klucze opisujące to jedno urządzenie. Nie trafiają do kopii zapasowej ani na serwer. */
export function isDeviceMetaKey(key: string): boolean {
  return (
    key === 'sync' ||
    key === 'deviceId' ||
    key === 'dataKey' ||
    key.startsWith('numbers:') ||
    key.startsWith('counter:offline:')
  );
}

async function setMeta(key: string, value: unknown): Promise<void> {
  await writeTransaction([db.meta], async () => {
    const row = { key, value, updatedAt: new Date().toISOString() };
    await db.meta.put(row);
    if (SYNCED_META_KEYS.includes(key)) await logChange('meta', key, 'put', row);
  });
}

async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function getCompany(): Promise<CompanySettings> {
  return { ...DEFAULT_COMPANY, ...(await getMeta<Partial<CompanySettings>>('company')) };
}

export async function saveCompany(company: CompanySettings): Promise<void> {
  await setMeta('company', company);
}

export async function getLastBackupAt(): Promise<string | null> {
  return (await getMeta<string>('lastBackupAt')) ?? null;
}

export async function markBackupDone(at = new Date().toISOString()): Promise<void> {
  await setMeta('lastBackupAt', at);
}

export async function getSyncState(): Promise<SyncState | null> {
  return (await getMeta<SyncState>('sync')) ?? null;
}

export async function setSyncState(state: SyncState | null): Promise<void> {
  if (state) await db.meta.put({ key: 'sync', value: state, updatedAt: new Date().toISOString() });
  else await db.meta.delete('sync');
}

/** Klucz danych firmy. Nieeksportowalny CryptoKey: skrypt może nim szyfrować, ale nie może go odczytać. */
export async function getDataKey(): Promise<CryptoKey | null> {
  return (await getMeta<CryptoKey>('dataKey')) ?? null;
}

export async function setDataKey(key: CryptoKey | null): Promise<void> {
  if (key) await db.meta.put({ key: 'dataKey', value: key, updatedAt: new Date().toISOString() });
  else await db.meta.delete('dataKey');
}

export async function getDeviceId(): Promise<string> {
  const existing = await getMeta<string>('deviceId');
  if (existing) return existing;
  const id = newId();
  await db.meta.put({ key: 'deviceId', value: id, updatedAt: new Date().toISOString() });
  return id;
}

export const numberBlocksKey = (year: string) => `numbers:job:${year}`;

const formatNumber = (year: string, n: number) => `Z/${year}/${String(n).padStart(4, '0')}`;

/** Najwyższy numer nadany na tym urządzeniu w danym roku z lokalnego licznika. */
export async function localJobCounter(year: string): Promise<number> {
  return (await getMeta<number>(`counter:job:${year}`)) ?? 0;
}

/**
 * Kolejny numer w roczniku, np. Z/2026/0007. Licznik nigdy się nie cofa, także po usunięciu.
 * Przy synchronizacji numery pochodzą z puli zarezerwowanej na serwerze, więc dwa urządzenia
 * nie nadadzą tego samego numeru. Gdy pula się skończy bez internetu, numer dostaje znacznik
 * urządzenia, np. Z/2026/7F3A-0001. Jest wtedy dłuższy, ale nadal unikalny.
 */
export async function nextJobNumber(year: string): Promise<string> {
  return db.transaction('rw', db.meta, async () => {
    const sync = await getMeta<SyncState>('sync');
    if (sync) {
      const blocks = (await getMeta<NumberBlock[]>(numberBlocksKey(year))) ?? [];
      const block = blocks.find((b) => b.next <= b.end);
      if (block) {
        const number = block.next;
        block.next += 1;
        await db.meta.put({ key: numberBlocksKey(year), value: blocks, updatedAt: new Date().toISOString() });
        return formatNumber(year, number);
      }
      const deviceTag = ((await getMeta<string>('deviceId')) ?? 'XXXX').slice(0, 4).toUpperCase();
      const key = `counter:offline:${year}`;
      const next = ((await getMeta<number>(key)) ?? 0) + 1;
      await db.meta.put({ key, value: next, updatedAt: new Date().toISOString() });
      return `Z/${year}/${deviceTag}-${String(next).padStart(4, '0')}`;
    }
    const key = `counter:job:${year}`;
    const next = (await localJobCounter(year)) + 1;
    await db.meta.put({ key, value: next, updatedAt: new Date().toISOString() });
    return formatNumber(year, next);
  });
}
