import { db } from './db';
import { getDataKey } from './settings';
import { decryptFields, encryptFields } from './sync/crypto';

/**
 * Hasła admina zapamiętane na tym telefonie (na życzenie admina): hasło do panelu i hasło szyfrowania firmy.
 * Leżą tylko w pamięci urządzenia, zaszyfrowane kluczem firmy z tego urządzenia; nie trafiają na serwer
 * ani do kopii zapasowej. Po zmianie klucza firmy stare zapisy nie dają się odczytać i po prostu znikają.
 */
export interface AdminSecrets {
  panel?: string;
  company?: string;
}

export const ADMIN_SECRETS_KEY = 'adminSecrets';
const CONTEXT = ['device', ADMIN_SECRETS_KEY] as const;

export async function getAdminSecrets(): Promise<AdminSecrets> {
  const row = (await db.meta.get(ADMIN_SECRETS_KEY))?.value as Record<string, string> | undefined;
  const key = await getDataKey();
  if (!row || !key) return {};
  try {
    const plain = await decryptFields(key, ...CONTEXT, row);
    const out: AdminSecrets = {};
    if (typeof plain.panel === 'string' && plain.panel) out.panel = plain.panel;
    if (typeof plain.company === 'string' && plain.company) out.company = plain.company;
    return out;
  } catch {
    return {};
  }
}

/** Zapisuje albo (pusty tekst) usuwa jedno hasło. */
export async function saveAdminSecret(kind: keyof AdminSecrets, value: string): Promise<void> {
  const key = await getDataKey();
  if (!key) throw new Error('Brak klucza firmy na tym urządzeniu. Odblokuj synchronizację w Koncie.');
  const next: AdminSecrets = { ...(await getAdminSecrets()), [kind]: value || undefined };
  const fields = Object.fromEntries(Object.entries(next).filter(([, v]) => v));
  if (Object.keys(fields).length === 0) {
    await db.meta.delete(ADMIN_SECRETS_KEY);
    return;
  }
  await db.meta.put({ key: ADMIN_SECRETS_KEY, value: await encryptFields(key, ...CONTEXT, fields), updatedAt: new Date().toISOString() });
}
