// Adapter Supabase. Ładowany dynamicznie, więc bez konfiguracji klient Supabase nie trafia do aplikacji.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SYNC_KEY, SYNC_URL } from './config';
import {
  codeSecretPassphrase,
  CryptoError,
  formatSignupCode,
  inviteProof,
  newInviteCode,
  newSignupCode,
  parseSignupCode,
  rewrapDataKey,
  sha256Hex,
  unwrapDataKey,
  type WrappedKey,
} from './crypto';
import type { Role } from '../types';
import { SyncError, type PushChange, type RemoteRecord, type SyncServer } from './engine';

let client: SupabaseClient | undefined;

/** Klucz, pod którym telefon trzyma sesję logowania. */
const AUTH_STORAGE_KEY = 'ddd-firma-auth';

/**
 * Czy telefon ma zapisaną sesję logowania. Bez internetu wygasła sesja zostaje zapisana (odświeży się później);
 * znika dopiero, gdy serwer ją odrzuci, np. po usunięciu konta przez admina.
 */
export function sessionStored(): boolean {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) !== null;
  } catch {
    return true;
  }
}

/** Powiadamia o zalogowaniu, wylogowaniu i odświeżeniu sesji (także gdy serwer odrzuci sesję). */
export function onAuthChange(listener: () => void): () => void {
  const { data } = supabase().auth.onAuthStateChange(() => listener());
  return () => data.subscription.unsubscribe();
}

function supabase(): SupabaseClient {
  client ??= createClient(SYNC_URL, SYNC_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY },
  });
  return client;
}

const MESSAGES: Record<string, string> = {
  UPDATE_REQUIRED: 'Zaktualizuj aplikację, żeby dalej synchronizować dane.',
  NOT_ENCRYPTED: 'Serwer odrzucił niezaszyfrowane dane. Zaktualizuj aplikację.',
  KEY_EXISTS: 'Firma ma już hasło szyfrowania. Odśwież ekran i wpisz to hasło.',
  BAD_INVITE: 'Kod weryfikacyjny jest nieprawidłowy, wykorzystany albo wygasł. Poproś admina o nowy kod.',
  WEAK_PASSWORD: 'Hasło musi mieć co najmniej 12 znaków.',
  BAD_BRANCH: 'Tego regionu nie ma na serwerze (mógł zostać usunięty). Odśwież panel admina i wybierz region z listy.',
  FORBIDDEN: 'To konto nie ma uprawnień w tej firmie (np. zostało zawieszone przez admina).',
  ORG_EXISTS: 'To konto ma już firmę.',
  NOT_AUTHENTICATED: 'Sesja wygasła. Zaloguj się ponownie.',
  SESSION_LOST: 'Sesja logowania na tym urządzeniu wygasła (np. po zmianie hasła). Zaloguj się ponownie w „Konto”. Dane na urządzeniu są bezpieczne.',
  NOT_PENDING: 'Ta prośba została już rozpatrzona.',
  EMAIL_TAKEN: 'Ten e-mail ma już konto. Zaloguj się nim, a kod wpiszesz po zalogowaniu.',
  BAD_EMAIL: 'Podaj poprawny adres e-mail.',
  NOT_TEMP: 'To konto ma już własny e-mail.',
  BAD_ACCOUNT: 'Nie udało się przygotować danych konta. Spróbuj ponownie.',
  RECOVERY_PENDING: 'Najpierw odpowiedz na pytania pomocnicze (konto czeka na potwierdzenie po resecie hasła).',
  BAD_ANSWERS: 'Każda odpowiedź musi mieć co najmniej 2 znaki.',
  BAD_ROLE: 'Nieznana rola konta.',
};

/** Komunikat po polsku dla błędu sieci, serwera lub logowania. */
export function describeError(error: unknown): string {
  if (error instanceof CryptoError || error instanceof SyncError) return error.message;
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  for (const [code, text] of Object.entries(MESSAGES)) if (message.includes(code)) return text;
  if (/invalid login credentials/i.test(message)) return 'Nieprawidłowy e-mail lub hasło.';
  if (/permission denied for (table|function)/i.test(message)) return MESSAGES.SESSION_LOST;
  if (/could not find the function|PGRST202/i.test(message)) return 'Serwer nie ma jeszcze tej funkcji: trzeba wykonać migrację odzyskiwania konta admina.';
  if (/email not confirmed/i.test(message)) return 'Najpierw potwierdź adres linkiem z wiadomości e-mail, potem zaloguj się tutaj.';
  if (/already registered|already exists/i.test(message)) return 'Konto z tym adresem już istnieje. Zaloguj się.';
  if (/duplicate key/i.test(message)) return 'Taka nazwa już istnieje.';
  if (/signups? not allowed|signup is disabled/i.test(message)) return 'Zakładanie nowych kont jest wyłączone. Zaloguj się istniejącym kontem.';
  if (/password should|weak password/i.test(message)) return 'Hasło jest za słabe. Użyj co najmniej 12 znaków.';
  if (/fetch|network|load failed/i.test(message)) {
    return navigator.onLine === false
      ? 'Brak internetu. Zmiany wyślą się później.'
      : `Telefon nie łączy się z serwerem (${message}). Internet działa, więc połączenie może blokować sieć (np. filtr operatora) albo bloker w przeglądarce. Sprawdź połączenie na ekranie logowania.`;
  }
  if (/jwt|token|session/i.test(message)) return MESSAGES.NOT_AUTHENTICATED;
  if (/rate limit|too many/i.test(message)) return 'Za dużo prób. Odczekaj kilka minut.';
  return `Błąd serwera: ${message}`;
}

function fail(error: unknown): never {
  throw new SyncError(describeError(error));
}

/** Czy urządzenie ma sesję logowania. Bez niej zapytania szłyby jako anonim i serwer by je odrzucał. */
export async function hasSession(): Promise<boolean> {
  const { data } = await supabase().auth.getSession();
  return Boolean(data.session);
}

async function requireSession(): Promise<void> {
  if (!(await hasSession())) throw new SyncError(MESSAGES.SESSION_LOST);
}

export const supabaseServer: SyncServer = {
  async push(orgId: string, deviceId: string, schema: number, changes: PushChange[]) {
    await requireSession();
    const { error } = await supabase().rpc('sync_push', {
      p_org: orgId,
      p_device: deviceId,
      p_schema: schema,
      p_changes: changes,
    });
    if (error) fail(error);
  },

  async pull(orgId: string, sinceRev: number, limit: number): Promise<RemoteRecord[]> {
    await requireSession();
    const { data, error } = await supabase()
      .from('records')
      .select('tbl, id, data, rev, purged, branch_id')
      .eq('org_id', orgId)
      .gt('rev', sinceRev)
      .order('rev')
      .limit(limit);
    if (error) fail(error);
    return (data ?? []).map(
      ({ branch_id, ...row }) => ({ ...row, rev: Number(row.rev), branchId: (branch_id as string | null) ?? null }) as RemoteRecord,
    );
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
  role: Role;
  displayName: string;
  branchId: string | null;
  branchName: string;
  /** Klucz danych zawinięty hasłem szyfrowania; null dla firmy założonej przed szyfrowaniem. */
  dataKey: WrappedKey | null;
  /** false: konto czeka na zgodę szefa i nie widzi danych firmy. */
  approved: boolean;
}

export interface Branch {
  id: string;
  name: string;
}

export interface Member {
  userId: string;
  displayName: string;
  role: Role;
  branchId: string | null;
  approved: boolean;
  email: string;
  /** Konto zawieszone przez admina: zostaje w firmie, ale nie widzi danych. */
  suspended?: boolean;
}

// Logowanie hasłem działa w całości w zainstalowanej aplikacji. Link z e-maila służy tylko
// do jednorazowego potwierdzenia adresu, więc nie szkodzi, że otworzy się w Safari.

export interface SignedIn {
  userId: string;
  email: string;
  /** Imię podane przy zakładaniu konta. */
  name: string;
}

export async function signIn(email: string, password: string): Promise<SignedIn> {
  const { data, error } = await supabase().auth.signInWithPassword({ email, password });
  if (error || !data.user) fail(error ?? 'Brak użytkownika');
  return { userId: data.user.id, email: data.user.email ?? email, name: (data.user.user_metadata?.name as string | undefined) ?? '' };
}

// ---------- Konto admina: hasło, e-mail, odzyskiwanie ----------

/** Zmiana hasła: najpierw sprawdzenie obecnego (ponowne logowanie tym samym kontem), potem nowe hasło. */
export async function changePassword(email: string, current: string, next: string): Promise<void> {
  await signIn(email, current);
  const { error } = await supabase().auth.updateUser({ password: next });
  if (error) fail(error);
}

/** Zmiana e-maila (loginu). Serwer wysyła link potwierdzający; do tego czasu działa dotychczasowy adres. */
export async function changeEmail(email: string, redirectTo: string): Promise<void> {
  const { error } = await supabase().auth.updateUser({ email }, { emailRedirectTo: redirectTo });
  if (error) fail(error);
}

/** Wysyła link do ustawienia nowego hasła na adres konta. */
export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  const { error } = await supabase().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) fail(error);
}

/** Sesja z linku do resetu hasła (tokeny z adresu). */
export async function startRecoverySession(accessToken: string, refreshToken: string): Promise<SignedIn> {
  const { data, error } = await supabase().auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error || !data.user) fail(error ?? 'Brak użytkownika');
  return { userId: data.user.id, email: data.user.email ?? '', name: (data.user.user_metadata?.name as string | undefined) ?? '' };
}

export async function setNewPassword(password: string): Promise<void> {
  const { error } = await supabase().auth.updateUser({ password });
  if (error) fail(error);
}

export interface RecoveryStatus {
  configured: boolean;
  /** Ktoś prosił o reset hasła po ostatnim potwierdzeniu pytaniami: uprawnienia admina czekają na odpowiedzi. */
  pending: boolean;
  lockedUntil: string | null;
}

/** Serwer bez migracji odzyskiwania (funkcji jeszcze nie ma): pytania nieustawione, nic nie blokuje logowania. */
function missingFunction(error: { message?: string; code?: string }): boolean {
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');
}

export async function recoveryStatus(): Promise<RecoveryStatus> {
  const { data, error } = await supabase().rpc('recovery_status');
  if (error && missingFunction(error)) return { configured: false, pending: false, lockedUntil: null };
  if (error) fail(error);
  const row = data as { configured: boolean; pending: boolean; locked_until: string | null };
  return { configured: row.configured, pending: row.pending, lockedUntil: row.locked_until };
}

export async function setRecoveryAnswers(answers: [string, string, string]): Promise<void> {
  const { error } = await supabase().rpc('set_recovery_answers', { p_answers: answers });
  if (error) fail(error);
}

export async function verifyRecoveryAnswers(answers: [string, string, string]): Promise<'ok' | 'zle' | 'blokada' | 'brak'> {
  const { data, error } = await supabase().rpc('verify_recovery_answers', { p_answers: answers });
  if (error) fail(error);
  return data as 'ok' | 'zle' | 'blokada' | 'brak';
}

export async function currentUser(): Promise<SignedIn | null> {
  const { data } = await supabase().auth.getSession();
  const user = data.session?.user;
  return user ? { userId: user.id, email: user.email ?? '', name: (user.user_metadata?.name as string | undefined) ?? '' } : null;
}

export async function signOut(): Promise<void> {
  // Wylogowanie lokalne działa także bez internetu.
  await supabase().auth.signOut({ scope: 'local' });
}

/**
 * Czy konto tego urządzenia nadal należy do firmy. „removed”, gdy serwer potwierdza, że konto usunięto (albo usunięto
 * je z tej firmy); „unknown” przy braku internetu albo innym błędzie, żeby nie kasować danych przez chwilowy problem.
 */
export async function accountStatus(orgId: string): Promise<'ok' | 'removed' | 'no-session' | 'unknown'> {
  const { data: session } = await supabase().auth.getSession();
  if (!session.session) return 'no-session';
  const { data, error } = await supabase().auth.getUser();
  if (error) {
    const code = (error as { code?: string }).code ?? '';
    return code === 'user_not_found' || /user from sub claim|user not found/i.test(error.message) ? 'removed' : 'unknown';
  }
  if (!data.user) return 'unknown';
  const { data: rows, error: rowsError } = await supabase().from('memberships').select('org_id').eq('user_id', data.user.id).eq('org_id', orgId);
  if (rowsError) return 'unknown';
  return (rows ?? []).length === 0 ? 'removed' : 'ok';
}

export async function myMemberships(): Promise<Membership[]> {
  const user = await currentUser();
  if (!user) return [];
  const { data, error } = await supabase()
    .from('memberships')
    .select('org_id, role, display_name, branch_id, approved, orgs(name, data_key), branches(name)')
    .eq('user_id', user.userId);
  if (error) fail(error);
  return (data ?? []).map((row) => {
    const org = row.orgs as unknown as { name: string; data_key: WrappedKey | null } | null;
    const branch = row.branches as unknown as { name: string } | null;
    return {
      orgId: row.org_id as string,
      role: row.role as Membership['role'],
      displayName: (row.display_name as string) ?? '',
      branchId: (row.branch_id as string | null) ?? null,
      branchName: branch?.name ?? '',
      orgName: org?.name ?? '',
      dataKey: org?.data_key ?? null,
      approved: row.approved !== false,
    };
  });
}

export async function createOrg(name: string, dataKey: WrappedKey, displayName: string, branch: string): Promise<string> {
  const { data, error } = await supabase().rpc('create_org', {
    p_name: name,
    p_data_key: dataKey,
    p_display_name: displayName,
    p_branch: branch,
  });
  if (error) fail(error);
  return data as string;
}

/** Hasło szyfrowania dla firmy założonej przed włączeniem szyfrowania. Ustawia się raz. */
export async function setOrgKey(orgId: string, dataKey: WrappedKey): Promise<void> {
  const { error } = await supabase().rpc('set_org_key', { p_org: orgId, p_data_key: dataKey });
  if (error) fail(error);
}

/** Admin zapisuje nowy klucz firmy (zawinięty nowym hasłem szyfrowania). */
export async function replaceOrgKey(orgId: string, dataKey: WrappedKey): Promise<void> {
  const { error } = await supabase().rpc('replace_org_key', { p_org: orgId, p_data_key: dataKey });
  if (error) fail(error);
}

export interface InvitePreview {
  orgName: string;
  branchName: string;
  dataKey: WrappedKey | null;
}

/** Krok 1 dołączania: dokąd prowadzi kod. Zły, wykorzystany albo wygasły kod kończy się błędem. */
export async function invitePreview(code: string): Promise<InvitePreview> {
  const { data, error } = await supabase().rpc('invite_preview', { p_code: code });
  if (error) fail(error);
  const row = data as { org_name: string; branch_name: string; data_key: WrappedKey | null };
  return { orgName: row.org_name, branchName: row.branch_name, dataKey: row.data_key };
}

/** Krok 2: dowód hasła. Zwraca null, gdy hasło nie pasuje do zaproszenia. */
export async function joinWithInvite(code: string, displayName: string, proof: string): Promise<string | null> {
  const { data, error } = await supabase().rpc('join_with_invite', { p_code: code, p_display_name: displayName, p_proof: proof });
  if (error) fail(error);
  return (data as string | null) ?? null;
}

export async function approveMember(orgId: string, userId: string): Promise<void> {
  const { error } = await supabase().rpc('approve_member', { p_org: orgId, p_user: userId });
  if (error) fail(error);
}

/** Odrzuca prośbę o dołączenie albo usuwa technika z firmy. */
export async function removeMember(orgId: string, userId: string): Promise<void> {
  const { error } = await supabase().rpc('remove_member', { p_org: orgId, p_user: userId });
  if (error) fail(error);
}

export async function updateMyProfile(orgId: string, displayName: string): Promise<void> {
  const { error } = await supabase().rpc('update_my_profile', { p_org: orgId, p_display_name: displayName });
  if (error) fail(error);
}

export async function listBranches(orgId: string): Promise<Branch[]> {
  const { data, error } = await supabase().from('branches').select('id, name').eq('org_id', orgId).order('name');
  if (error) fail(error);
  return (data ?? []) as Branch[];
}

export async function listMembers(orgId: string): Promise<Member[]> {
  // Kolumna suspended jest od migracji zawieszania; bez niej lista działa jak dotąd.
  type Row = Record<string, unknown>;
  let { data, error }: { data: Row[] | null; error: { message?: string } | null } = await supabase()
    .from('memberships')
    .select('user_id, display_name, role, branch_id, approved, email, suspended')
    .eq('org_id', orgId);
  if (error && /suspended/.test(error.message ?? '')) {
    ({ data, error } = await supabase().from('memberships').select('user_id, display_name, role, branch_id, approved, email').eq('org_id', orgId));
  }
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    userId: row.user_id as string,
    displayName: (row.display_name as string) ?? '',
    role: row.role as Member['role'],
    branchId: (row.branch_id as string | null) ?? null,
    approved: row.approved !== false,
    email: (row.email as string) ?? '',
    suspended: (row as { suspended?: boolean }).suspended === true,
  }));
}

export async function createBranch(orgId: string, name: string): Promise<string> {
  const { data, error } = await supabase().rpc('create_branch', { p_org: orgId, p_name: name });
  if (error) fail(error);
  return data as string;
}

export async function renameBranch(branchId: string, name: string): Promise<void> {
  const { error } = await supabase().rpc('rename_branch', { p_branch: branchId, p_name: name });
  if (error) fail(error);
}

export async function setMemberBranch(orgId: string, userId: string, branchId: string): Promise<void> {
  const { error } = await supabase().rpc('set_member_branch', { p_org: orgId, p_user: userId, p_branch: branchId });
  if (error) fail(error);
}

/**
 * Jednorazowy kod, którym nowy technik dołącza do oddziału. Ważny 14 dni. Działa tylko razem z hasłem
 * szyfrowania: serwer dostaje skrót dowodu wyliczonego kluczem firmy z tego urządzenia.
 */
// ---------- Rejestracja z kodem weryfikacyjnym od admina ----------

/** Wywołanie funkcji serwera „konta” z czytelnym komunikatem błędu. */
async function invokeKonta(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase().functions.invoke('konta', { body });
  if (error) {
    let message = error.message;
    try {
      const context = (error as { context?: Response }).context;
      const parsed = (await context?.json()) as { error?: string } | undefined;
      if (parsed?.error) message = parsed.error;
    } catch {
      // Zostaje ogólny komunikat.
    }
    fail(message);
  }
  return (data ?? {}) as Record<string, unknown>;
}

/**
 * Admin generuje kod weryfikacyjny: 16 znaków, ważny 14 dni, jednorazowy. Pierwsze 8 znaków to identyfikator
 * na serwerze, kolejne 8 zawija klucz firmy (przepakowany z hasła firmy na urządzeniu admina) i nie trafia na serwer.
 * forUser: kod tylko dla tego konta (np. nowe urządzenie istniejącej osoby).
 */
export async function issueSignupCode(opts: {
  orgId: string;
  branchId: string | null;
  role: Role;
  companyPassword: string;
  orgWrapped: WrappedKey;
  deviceKey: CryptoKey;
  forUser?: string;
}): Promise<string> {
  // Bez sesji zapytanie poszłoby jako anonim i serwer odpowiedziałby niezrozumiałym błędem uprawnień.
  await requireSession();
  const code = newSignupCode();
  const accountKey = await rewrapDataKey(opts.companyPassword, opts.orgWrapped, codeSecretPassphrase(code.id, code.secret));
  const proofHash = await sha256Hex(await inviteProof(opts.deviceKey, code.id));
  const { error } = await supabase().rpc('create_signup_code', {
    p_org: opts.orgId,
    p_branch: opts.branchId,
    p_role: opts.role,
    p_code: code.id,
    p_proof_hash: proofHash,
    p_account_key: accountKey,
    p_for_user: opts.forUser ?? null,
  });
  if (error) fail(error);
  return formatSignupCode(code.full);
}

function parseOrFail(code: string): { id: string; secret: string } {
  const parsed = parseSignupCode(code);
  if (!parsed) throw new SyncError('Kod weryfikacyjny ma 16 znaków (litery i cyfry), np. ABCD-EFGH-JKMN-PQRS.');
  return parsed;
}

/**
 * Dołączenie zalogowanego konta kodem: klucz firmy odwinięty częścią tajną kodu, a dołączenie potwierdza go dowodem.
 * Nowe konto wchodzi do regionu z kodu, istniejące dostaje kolejny region (albo klucz na nowym urządzeniu).
 */
export async function redeemSignupCode(code: string, displayName = ''): Promise<{ key: CryptoKey; orgId: string }> {
  const { id, secret } = parseOrFail(code);
  const { data, error } = await supabase().rpc('invite_preview', { p_code: id });
  if (error) fail(error);
  const preview = data as { account_key: WrappedKey | null };
  if (!preview.account_key) throw new SyncError('To stary kod. Poproś admina o nowy kod weryfikacyjny.');
  let key: CryptoKey;
  try {
    key = await unwrapDataKey(codeSecretPassphrase(id, secret), preview.account_key);
  } catch {
    throw new SyncError('Kod weryfikacyjny jest błędny. Sprawdź wszystkie 16 znaków.');
  }
  const orgId = await joinWithInvite(id, displayName.trim(), await inviteProof(key, id));
  if (!orgId) throw new SyncError('Kod weryfikacyjny jest błędny. Sprawdź wszystkie 16 znaków.');
  return { key, orgId };
}

/**
 * Zakładanie konta: własny e-mail i hasło oraz kod weryfikacyjny od admina. Bez ważnego kodu serwer nie założy
 * konta (zwykła rejestracja w Supabase jest wyłączona). Po założeniu: logowanie i dołączenie do regionu z kodu.
 */
export async function registerWithCode(opts: {
  name: string;
  email: string;
  password: string;
  code: string;
}): Promise<{ key: CryptoKey; orgId: string; user: SignedIn }> {
  const { id } = parseOrFail(opts.code);
  const email = opts.email.trim().toLowerCase();
  await invokeKonta({ action: 'register', code_id: id, email, password: opts.password, name: opts.name.trim() });
  const user = await signIn(email, opts.password);
  return { ...(await redeemSignupCode(opts.code, opts.name)), user };
}

/** Konto tymczasowe ustawia własne hasło i e-mail; potem loguje się nimi jak każde konto. */
export async function claimAccount(email: string, newPassword: string): Promise<void> {
  const { error } = await supabase().auth.updateUser({ password: newPassword });
  if (error) fail(error);
  await invokeKonta({ action: 'claim', email });
  await supabase().auth.refreshSession();
}

/** Admin nadaje innemu kontu uprawnienia admina albo je odbiera (siebie nie zmieni). */
export async function setMemberRole(orgId: string, userId: string, role: 'owner' | 'technik'): Promise<void> {
  const { error } = await supabase().rpc('set_member_role', { p_org: orgId, p_user: userId, p_role: role });
  if (error) fail(error);
}

/** Admin zawiesza (tymczasowo blokuje) albo przywraca konto. */
export async function suspendMember(orgId: string, userId: string, suspended: boolean): Promise<void> {
  const { error } = await supabase().rpc('suspend_member', { p_org: orgId, p_user: userId, p_suspended: suspended });
  if (error) fail(error);
}

/** Admin usuwa konto z firmy i z logowania (funkcja serwera). */
export async function deleteAccount(orgId: string, userId: string): Promise<void> {
  await invokeKonta({ action: 'delete', org_id: orgId, user_id: userId });
}

export async function isTempAccount(): Promise<boolean> {
  const { data } = await supabase().auth.getSession();
  return Boolean(data.session?.user?.user_metadata?.temp);
}

/** Przełącza aktywny region konta (technik: tylko swoje regiony, admin: każdy). */
export async function switchBranch(orgId: string, branchId: string): Promise<void> {
  const { error } = await supabase().rpc('switch_branch', { p_org: orgId, p_branch: branchId });
  if (error) fail(error);
}

/** Admin usuwa region. Rekordy regionu zostają bez regionu i widzi je tylko admin. */
export async function deleteBranch(branchId: string): Promise<void> {
  const { error } = await supabase().rpc('delete_branch', { p_branch: branchId });
  if (error) fail(error);
}

/** Admin odbiera kontu dostęp do jednego regionu. */
export async function removeMemberBranch(orgId: string, userId: string, branchId: string): Promise<void> {
  const { error } = await supabase().rpc('remove_member_branch', { p_org: orgId, p_user: userId, p_branch: branchId });
  if (error) fail(error);
}

/** Regiony każdego konta firmy (dla admina) albo własne (dla technika). */
export async function listMemberBranches(orgId: string): Promise<Array<{ userId: string; branchId: string }>> {
  const { data, error } = await supabase().from('member_branches').select('user_id, branch_id').eq('org_id', orgId);
  if (error && /member_branches/.test(error.message ?? '')) return [];
  if (error) fail(error);
  return (data ?? []).map((r) => ({ userId: r.user_id as string, branchId: r.branch_id as string }));
}

/** Członek firmy dołącza do kolejnego regionu samym kodem: dowód liczy z klucza firmy na urządzeniu. */
export async function joinAnotherRegion(code: string, dataKey: CryptoKey): Promise<boolean> {
  const parsed = parseSignupCode(code);
  const normalized = parsed ? parsed.id : code.trim().toUpperCase();
  const org = await joinWithInvite(normalized, '', await inviteProof(dataKey, normalized));
  return org !== null;
}

export async function createInvite(orgId: string, branchId: string, dataKey: CryptoKey): Promise<string> {
  const code = newInviteCode();
  const proofHash = await sha256Hex(await inviteProof(dataKey, code));
  const { data, error } = await supabase().rpc('create_invite', { p_org: orgId, p_branch: branchId, p_code: code, p_proof_hash: proofHash });
  if (error) fail(error);
  return data as string;
}
