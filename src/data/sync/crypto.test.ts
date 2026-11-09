import { describe, expect, it } from 'vitest';

describe('konta od admina', () => {
  it('przepakowanie klucza firmy pod hasło tymczasowe, złe hasło firmy odrzucone', async () => {
    const { createDataKey, rewrapDataKey, unwrapDataKey, encryptFields, decryptFields } = await import('./crypto');
    const { key, wrapped } = await createDataKey('hasło-firmy-testowe-123');
    const accountKey = await rewrapDataKey('hasło-firmy-testowe-123', wrapped, 'TymczasoweHaslo16');
    const fromAccount = await unwrapDataKey('TymczasoweHaslo16', accountKey);
    const sealed = await encryptFields(key, 'orders', 'r1', { street: 'Piotrkowska' });
    expect(await decryptFields(fromAccount, 'orders', 'r1', sealed)).toEqual({ street: 'Piotrkowska' });
    await expect(rewrapDataKey('zle-haslo-firmy-xx', wrapped, 'x')).rejects.toThrow('Nieprawidłowe hasło firmy');
    await expect(unwrapDataKey('InneHasloTymczas', accountKey)).rejects.toThrow();
  });

  it('hasło konta dla serwera jest stałe dla hasła tymczasowego i nie jest nim samym', async () => {
    const { accountPassword, newTempLogin, newTempPassword, tempEmail } = await import('./crypto');
    const a = await accountPassword('TymczasoweHaslo16');
    expect(a).toBe(await accountPassword('TymczasoweHaslo16'));
    expect(a).not.toContain('Tymczasowe');
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(newTempLogin('ŁDZ')).toMatch(/^ldz-[a-z0-9]{6}$/);
    expect(newTempLogin('GDA')).toMatch(/^gda-[a-z0-9]{6}$/);
    expect(newTempLogin('')).toMatch(/^pi-[a-z0-9]{6}$/);
    expect(newTempPassword()).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(tempEmail(' GDA-k7m2p4 ')).toBe('gda-k7m2p4@konta.pogromcy.invalid');
  });
});
