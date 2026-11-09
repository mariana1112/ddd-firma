/**
 * Linki z e-maili Supabase (reset hasła, zmiana adresu) wracają do aplikacji z tokenami w części adresu po „#”.
 * Aplikacja używa „#” do nawigacji, więc link trzeba przechwycić przed routerem: tokeny trafiają do pamięci
 * sesji karty (nie do historii przeglądarki), a adres zmienia się na właściwy ekran.
 */

const RECOVERY_KEY = 'ddd-odzyskiwanie';
const INFO_KEY = 'ddd-link-info';

export interface RecoveryLink {
  accessToken?: string;
  refreshToken?: string;
  error?: string;
}

export function captureAuthLink(): void {
  const hash = window.location.hash.replace(/^#\/?/, '');
  if (!/(^|&)(access_token|error|error_description)=/.test(hash)) return;
  const params = new URLSearchParams(hash);
  const type = params.get('type');
  const go = (route: string) => window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${route}`);
  try {
    if (params.get('error') || params.get('error_description')) {
      sessionStorage.setItem(RECOVERY_KEY, JSON.stringify({ error: 'Link z e-maila wygasł albo był już użyty. Poproś o nowy.' }));
      go('/admin/odzyskiwanie');
    } else if (type === 'recovery') {
      sessionStorage.setItem(
        RECOVERY_KEY,
        JSON.stringify({ accessToken: params.get('access_token') ?? '', refreshToken: params.get('refresh_token') ?? '' }),
      );
      go('/admin/odzyskiwanie');
    } else if (type === 'email_change') {
      sessionStorage.setItem(INFO_KEY, 'Potwierdzono zmianę adresu e-mail. Jeśli serwer prosi o potwierdzenie z obu adresów, kliknij też link w drugiej wiadomości.');
      go('/admin/bezpieczenstwo');
    }
  } catch {
    // Bez pamięci sesji link po prostu nie zadziała; aplikacja otworzy się normalnie.
  }
}

export function takeRecoveryLink(): RecoveryLink | null {
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    return raw ? (JSON.parse(raw) as RecoveryLink) : null;
  } catch {
    return null;
  }
}

export function clearRecoveryLink(): void {
  try {
    sessionStorage.removeItem(RECOVERY_KEY);
  } catch {
    // nic
  }
}

export function takeLinkInfo(): string | null {
  try {
    const info = sessionStorage.getItem(INFO_KEY);
    sessionStorage.removeItem(INFO_KEY);
    return info;
  } catch {
    return null;
  }
}

/** Identyfikator i e-mail konta z tokenu (bez sprawdzania podpisu: tylko do porównania z kontem urządzenia). */
export function tokenUser(token: string): { userId: string; email: string } | null {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(decodeURIComponent(escape(atob(part)))) as { sub?: string; email?: string };
    return json.sub ? { userId: json.sub, email: json.email ?? '' } : null;
  } catch {
    return null;
  }
}
