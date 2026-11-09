import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureAuthLink, clearRecoveryLink, takeLinkInfo, takeRecoveryLink, tokenUser } from './auth-link';

/** Minimalne okno przeglądarki: adres, historia i pamięć sesji. */
function fakeWindow(hash: string) {
  const store = new Map<string, string>();
  const location = { hash, pathname: '/ddd-firma/', search: '' };
  vi.stubGlobal('window', {
    location,
    history: { replaceState: (_s: unknown, _t: string, url: string) => (location.hash = url.slice(url.indexOf('#'))) },
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  return location;
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('linki z e-maili Supabase', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('link do resetu hasła: tokeny do pamięci sesji, adres na ekran odzyskiwania', () => {
    const location = fakeWindow('#access_token=AAA&expires_in=3600&refresh_token=RRR&token_type=bearer&type=recovery');
    captureAuthLink();
    expect(location.hash).toBe('#/admin/odzyskiwanie');
    expect(takeRecoveryLink()).toEqual({ accessToken: 'AAA', refreshToken: 'RRR' });
    clearRecoveryLink();
    expect(takeRecoveryLink()).toBeNull();
  });

  it('wygasły link i potwierdzenie zmiany e-maila', () => {
    const location = fakeWindow('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
    captureAuthLink();
    expect(location.hash).toBe('#/admin/odzyskiwanie');
    expect(takeRecoveryLink()?.error).toMatch(/wygasł/);

    const second = fakeWindow('#access_token=A&refresh_token=R&type=email_change');
    captureAuthLink();
    expect(second.hash).toBe('#/admin/bezpieczenstwo');
    expect(takeLinkInfo()).toMatch(/Potwierdzono zmianę/);
  });

  it('zwykła nawigacja aplikacji zostaje bez zmian', () => {
    const location = fakeWindow('#/zlecenia?q=500');
    captureAuthLink();
    expect(location.hash).toBe('#/zlecenia?q=500');
  });

  it('konto z tokenu do porównania z kontem urządzenia', () => {
    const token = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u-1', email: 'admin@example.com' })}.podpis`;
    expect(tokenUser(token)).toEqual({ userId: 'u-1', email: 'admin@example.com' });
    expect(tokenUser('zly')).toBeNull();
  });
});
