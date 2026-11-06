// Adres i klucz publiczny projektu Supabase. Klucz publiczny jest jawny z założenia:
// dostęp do danych chronią zasady RLS na serwerze, a nie ukrycie klucza.
export const SYNC_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
export const SYNC_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';

/** Bez konfiguracji aplikacja działa jak dotąd, wyłącznie lokalnie. */
export const isSyncConfigured = Boolean(SYNC_URL && SYNC_KEY);
