import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ADMIN_SECRETS_KEY, getAdminSecrets, saveAdminSecret } from './admin-secrets';
import { db } from './db';
import { isDeviceMetaKey, setDataKey } from './settings';
import { createDataKey } from './sync/crypto';

describe('hasła admina zapamiętane na telefonie', () => {
  it('zapis zaszyfrowany kluczem firmy, odczyt, usunięcie; nie trafiają do kopii ani na serwer', async () => {
    const { key } = await createDataKey('hasło-firmy-testowe-123');
    await setDataKey(key);
    await saveAdminSecret('panel', 'HasloPanelu123');
    await saveAdminSecret('company', 'hasło-firmy-testowe-123');
    expect(await getAdminSecrets()).toEqual({ panel: 'HasloPanelu123', company: 'hasło-firmy-testowe-123' });
    const raw = JSON.stringify((await db.meta.get(ADMIN_SECRETS_KEY))?.value);
    expect(raw).not.toContain('HasloPanelu123');
    expect(raw).not.toContain('hasło-firmy');
    expect(isDeviceMetaKey(ADMIN_SECRETS_KEY)).toBe(true);

    await saveAdminSecret('panel', '');
    expect(await getAdminSecrets()).toEqual({ company: 'hasło-firmy-testowe-123' });

    // Inny klucz firmy (po zmianie hasła szyfrowania): stary zapis jest nieczytelny i nic nie zwraca.
    await setDataKey((await createDataKey('inne-haslo-firmy-456')).key);
    expect(await getAdminSecrets()).toEqual({});
    await saveAdminSecret('company', '');
    expect(await db.meta.get(ADMIN_SECRETS_KEY)).toBeUndefined();
  });
});
