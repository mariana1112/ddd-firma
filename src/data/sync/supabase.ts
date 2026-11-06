// Adapter Supabase. Ładowany dynamicznie, więc bez konfiguracji klient Supabase nie trafia do aplikacji.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SYNC_KEY, SYNC_URL } from './config';
import { CryptoError, type WrappedKey } from './crypto';
import { SyncError, type PushChange, type RemoteRecord, type SyncServer } from './engine';

let client: SupabaseClient | undefined;

function supabase(): SupabaseClient {
  client ??= createClient(SYNC_URL, SYNC_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'ddd-firma-auth' },
  });
  return client;
}

const MESSAGES: Record<string, string> = {
  UPDATE_REQUIRED: 'Zaktualizuj aplikację, żeby dalej synchronizować dane.',
  NOT_ENCRYPTED: 'Serwer odrzucił niezaszyfrowane dane. Zaktualizuj aplikację.',
  KEY_EXISTS: 'Firma ma już hasło szyfrowania. Odśwież ekran i wpisz to hasło.',
  FORBIDDEN: 'To konto nie ma uprawnień do zapisu w tej firmie.',
  ORG_EXISTS: 'To konto ma już firmę.',
  NOT_AUTHENTICATED: 'Sesja wygasła. Zaloguj się ponownie.',
};

/** Komunikat po polsku dla błędu sieci, serwera lub logowania. */
export function describeError(error: unknown): string {
  if (error instanceof CryptoError || error instanceof SyncError) return error.message;
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  for (const [code, text] of Object.entries(MESSAGES)) if (message.includes(code)) return text;
  if (/invalid login credentials/i.test(message)) return 'Nieprawidłowy e-mail lub hasło.';
  if (/email not confirmed/i.test(message)) return 'Najpierw potwierdź adres linkiem z wiadomości e-mail, potem zaloguj się tutaj.';
  if (/already registered|already exists/i.test(message)) return 'Konto z tym adresem już istnieje. Zaloguj się.';
  if (/signups? not allowed|signup is disabled/i.test(message)) return 'Zakładanie nowych kont jest wyłączone. Zaloguj się istniejącym kontem.';
  if (/password should|weak password/i.test(message)) return 'Hasło jest za słabe. Użyj co najmniej 12 znaków.';
  if (/fetch|network|load failed/i.test(message)) return 'Brak połączenia z serwerem. Zmiany wyślą się później.';
  if (/jwt|token|session/i.test(message)) return MESSAGES.NOT_AUTHENTICATED;
  if (/rate limit|too many/i.test(message)) return 'Za dużo prób. Odczekaj kilka minut.';
  return `Błąd serwera: ${message}`;
}

function fail(error: unknown): never {
  throw new SyncError(describeError(error));
}

export const supabaseServer: SyncServer = {
  async push(orgId: string, deviceId: string, schema: number, changes: PushChange[]) {
    const { error } = await supabase().rpc('sync_push', {
      p_org: orgId,
      p_device: deviceId,
      p_schema: schema,
      p_changes: changes,
    });
    if (error) fail(error);
  },

  async pull(orgId: string, sinceRev: number, limit: number): Promise<RemoteRecord[]> {
    const { data, error } = await supabase()
      .from('records')
      .select('tbl, id, data, rev, purged')
      .eq('org_id', orgId)
      .gt('rev', sinceRev)
      .order('rev')
      .limit(limit);
    if (error) fail(error);
    return (data ?? []).map((row) => ({ ...row, rev: Number(row.rev) }) as RemoteRecord);
  },

  async reserveNumbers(orgId: string, series: string, minNext: number, count: number) {
    const { data, error } = await supabase().rpc('reserve_numbers', {
      p_org: orgId,
      p_series: series,
      p_min_next: minNext,
      p_count: count,
    });
    if (error) fail(error);
    return Number(data);
  },

  async uploadFile(path: string, blob: Blob) {
    const { error } = await supabase()
      .storage.from('attachments')
      .upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
    if (error) fail(error);
  },

  async deleteFile(path: string) {
    // Usunięcie nieistniejącego pliku nie zwraca błędu, więc ponowienie jest bezpieczne.
    const { error } = await supabase().storage.from('attachments').remove([path]);
    if (error) fail(error);
  },

  async downloadFile(path: string) {
    const { data, error } = await supabase().storage.from('attachments').download(path);
    if (error || !data) fail(error ?? 'Brak pliku');
    return data;
  },
};

// ---------- Konto ----------

export interface Membership {
  orgId: string;
  orgName: string;
  role: string;
  /** Klucz danych zawinięty hasłem szyfrowania; null dla firmy założonej przed szyfrowaniem. */
  dataKey: WrappedKey | null;
}

// Logowanie hasłem działa w całości w zainstalowanej aplikacji. Link z e-maila służy tylko
// do jednorazowego potwierdzenia adresu, więc nie szkodzi, że otworzy się w Safari.

/** Zakłada konto. Zwraca 'confirm', gdy trzeba jeszcze potwierdzić adres linkiem z e-maila. */
export async function signUp(email: string, password: string): Promise<'confirm' | 'signed-in'> {
  const { data, error } = await supabase().auth.signUp({ email, password });
  if (error) fail(error);
  return data.session ? 'signed-in' : 'confirm';
}

export async function signIn(email: string, password: string): Promise<{ userId: string; email: string }> {
  const { data, error } = await supabase().auth.signInWithPassword({ email, password });
  if (error || !data.user) fail(error ?? 'Brak użytkownika');
  return { userId: data.user.id, email: data.user.email ?? email };
}

export async function currentUser(): Promise<{ userId: string; email: string } | null> {
  const { data } = await supabase().auth.getSession();
  const user = data.session?.user;
  return user ? { userId: user.id, email: user.email ?? '' } : null;
}

export async function signOut(): Promise<void> {
  // Wylogowanie lokalne działa także bez internetu.
  await supabase().auth.signOut({ scope: 'local' });
}

export async function myMemberships(): Promise<Membership[]> {
  const { data, error } = await supabase().from('memberships').select('org_id, role, orgs(name, data_key)');
  if (error) fail(error);
  return (data ?? []).map((row) => {
    const org = row.orgs as unknown as { name: string; data_key: WrappedKey | null } | null;
    return { orgId: row.org_id as string, role: row.role as string, orgName: org?.name ?? '', dataKey: org?.data_key ?? null };
  });
}

export async function createOrg(name: string, dataKey: WrappedKey): Promise<string> {
  const { data, error } = await supabase().rpc('create_org', { p_name: name, p_data_key: dataKey });
  if (error) fail(error);
  return data as string;
}

/** Hasło szyfrowania dla firmy założonej przed włączeniem szyfrowania. Ustawia się raz. */
export async function setOrgKey(orgId: string, dataKey: WrappedKey): Promise<void> {
  const { error } = await supabase().rpc('set_org_key', { p_org: orgId, p_data_key: dataKey });
  if (error) fail(error);
}
