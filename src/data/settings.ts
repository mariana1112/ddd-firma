import { db } from './db';
import type { CompanySettings } from './types';

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

async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value, updatedAt: new Date().toISOString() });
}

export async function getCompany(): Promise<CompanySettings> {
  const row = await db.meta.get('company');
  return { ...DEFAULT_COMPANY, ...(row?.value as Partial<CompanySettings> | undefined) };
}

export async function saveCompany(company: CompanySettings): Promise<void> {
  await setMeta('company', company);
}

export async function getLastBackupAt(): Promise<string | null> {
  const row = await db.meta.get('lastBackupAt');
  return (row?.value as string | undefined) ?? null;
}

export async function markBackupDone(at = new Date().toISOString()): Promise<void> {
  await setMeta('lastBackupAt', at);
}

/** Kolejny numer w roczniku, np. Z/2026/0007. Licznik nigdy się nie cofa, także po usunięciu. */
export async function nextJobNumber(year: string): Promise<string> {
  return db.transaction('rw', db.meta, async () => {
    const key = `counter:job:${year}`;
    const row = await db.meta.get(key);
    const next = ((row?.value as number | undefined) ?? 0) + 1;
    await db.meta.put({ key, value: next, updatedAt: new Date().toISOString() });
    return `Z/${year}/${String(next).padStart(4, '0')}`;
  });
}
