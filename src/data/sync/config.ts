// Adres i klucz publiczny projektu Supabase. Klucz publiczny jest jawny z założenia:
// dostęp do danych chronią zasady RLS na serwerze, a nie ukrycie klucza.
export const SYNC_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
export const SYNC_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

/**
 * Test połączenia z serwerem: czy telefon w ogóle dociera do Supabase. Zwraca czas odpowiedzi w ms albo opis błędu.
 * Pomaga odróżnić brak internetu od blokady adresu serwera przez sieć (filtr operatora, DNS) albo bloker treści.
 */
export async function checkServerConnection(): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    const response = await fetch(`${SYNC_URL}/auth/v1/health`, { headers: { apikey: SYNC_KEY }, cache: 'no-store' });
    if (!response.ok) return { ok: false, error: `serwer odpowiedział kodem ${response.status}` };
    return { ok: true, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Bez konfiguracji aplikacja działa jak dotąd, wyłącznie lokalnie. */
export const isSyncConfigured = Boolean(SYNC_URL && SYNC_KEY);
