// Adapter Supabase. Ładowany dynamicznie, więc bez konfiguracji klient Supabase nie trafia do aplikacji.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SYNC_KEY, SYNC_URL } from './config';
import {
  accountPassword,
  CryptoError,
  inviteProof,
  newInviteCode,
  newTempLogin,
  newTempPassword,
  rewrapDataKey,
  sha256Hex,
  tempEmail,
  unwrapDataKey,
  type WrappedKey,
} from './crypto';
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
  BAD_INVITE: 'Kod zaproszenia jest nieprawidłowy, wykorzystany albo wygasł.',
  BAD_BRANCH: 'Nie ma takiego oddziału.',
  FORBIDDEN: 'To konto nie ma uprawnień w tej firmie (np. zostało zawieszone przez admina).',
  ORG_EXISTS: 'To konto ma już firmę.',
  NOT_AUTHENTICATED: 'Sesja wygasła. Zaloguj się ponownie.',
  NOT_PENDING: 'Ta prośba została już rozpatrzona.',
  EMAIL_TAKEN: 'Ten e-mail ma już konto. Podaj inny albo zaloguj się nim.',
  BAD_EMAIL: 'Podaj poprawny adres e-mail.',
  NOT_TEMP: 'To konto ma już własny e-mail.',
  BAD_ACCOUNT: 'Nie udało się przygotować danych konta. Spróbuj ponownie.',
  RECOVERY_PENDING: 'Najpierw odpowiedz na pytania pomocnicze (konto czeka na potwierdzenie po resecie hasła).',
  BAD_ANSWERS: 'Każda odpowiedź musi mieć co najmniej 2 znaki.',
};

/** Komunikat po polsku dla błędu sieci, serwera lub logowania. */
export function describeError(error: unknown): string {
  if (error instanceof CryptoError || error instanceof SyncError) return error.message;
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  for (const [code, text] of Object.entries(MESSAGES)) if (message.includes(code)) return text;
  if (/invalid login credentials/i.test(message)) return 'Nieprawidłowy e-mail lub hasło.';
  if (/could not find the function|PGRST202/i.test(message)) return 'Serwer nie ma jeszcze tej funkcji: trzeba wykonać migrację odzyskiwania konta admina.';
  if (/email not confirmed/i.test(message)) return 'Najpierw potwierdź adres linkiem z wiadomości e-mail, potem zaloguj się tutaj.';
  if (/already registered|already exists/i.test(message)) return 'Konto z tym adresem już istnieje. Zaloguj się.';
  if (/duplicate key/i.test(message)) return 'Taka nazwa już istnieje.';
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
  role: 'owner' | 'technik';
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
  role: 'owner' | 'technik';
  branchId: string | null;
  approved: boolean;
  email: string;
  /** Konto zawieszone przez admina: zostaje w firmie, ale nie widzi danych. */
  suspended?: boolean;
}

// Logowanie hasłem działa w całości w zainstalowanej aplikacji. Link z e-maila służy tylko
// do jednorazowego potwierdzenia adresu, więc nie szkodzi, że otworzy się w Safari.

/** Zakłada konto. Zwraca 'confirm', gdy trzeba jeszcze potwierdzić adres linkiem z e-maila. */
export async function signUp(email: string, password: string, name: string): Promise<'confirm' | 'signed-in'> {
  const { data, error } = await supabase().auth.signUp({ email, password, options: { data: { name } } });
  if (error) fail(error);
  return data.session ? 'signed-in' : 'confirm';
}

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
// ---------- Konta zakładane przez admina ----------

export interface IssuedAccount {
  /** Login tymczasowy, np. „gda-k7m2p4”. */
  login: string;
  /** Hasło tymczasowe (16 znaków). Odwija klucz firmy; serwer zna tylko jego skrót. */
  password: string;
  /** Kod regionu (jednorazowy, 14 dni). */
  code: string;
}

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

/** Kod z kluczem firmy zawiniętym hasłem tymczasowym, przypisany do jednego konta. */
async function accountInvite(opts: {
  orgId: string;
  branchId: string | null;
  role: 'technik' | 'owner';
  forUser: string;
  password: string;
  accountKey: WrappedKey;
  deviceKey: CryptoKey;
}): Promise<string> {
  const code = newInviteCode();
  const proofHash = await sha256Hex(await inviteProof(opts.deviceKey, code));
  const { error } = await supabase().rpc('create_account_invite', {
    p_org: opts.orgId,
    p_branch: opts.branchId,
    p_role: opts.role,
    p_code: code,
    p_proof_hash: proofHash,
    p_account_key: opts.accountKey,
    p_for_user: opts.forUser,
  });
  if (error) fail(error);
  return code;
}

/**
 * Admin zakłada konto: login i hasło tymczasowe oraz kod regionu (albo kod admina). Hasło firmy jest potrzebne,
 * żeby przepakować klucz firmy pod hasło tymczasowe; sprawdzane jest przed utworzeniem konta.
 */
export async function issueAccount(opts: {
  orgId: string;
  branchId: string | null;
  role: 'technik' | 'owner';
  prefix: string;
  companyPassword: string;
  orgWrapped: WrappedKey;
  deviceKey: CryptoKey;
}): Promise<IssuedAccount> {
  const password = newTempPassword();
  const login = newTempLogin(opts.role === 'owner' ? 'adm' : opts.prefix);
  const accountKey = await rewrapDataKey(opts.companyPassword, opts.orgWrapped, password);
  const created = await invokeKonta({ action: 'create', org_id: opts.orgId, login, password: await accountPassword(password) });
  const code = await accountInvite({ ...opts, forUser: String(created.user_id), password, accountKey });
  return { login, password, code };
}

/** Kod na nowe urządzenie istniejącej osoby: hasło tymczasowe i kod przenoszą klucz firmy bez hasła firmy. */
export async function issueDeviceCode(opts: {
  orgId: string;
  branchId: string | null;
  userId: string;
  role: 'technik' | 'owner';
  companyPassword: string;
  orgWrapped: WrappedKey;
  deviceKey: CryptoKey;
}): Promise<{ password: string; code: string }> {
  const password = newTempPassword();
  const accountKey = await rewrapDataKey(opts.companyPassword, opts.orgWrapped, password);
  const code = await accountInvite({ ...opts, forUser: opts.userId, password, accountKey });
  return { password, code };
}

/** Klucz firmy z kodu od admina: odwinięty hasłem tymczasowym, a dołączenie potwierdza go dowodem. */
async function keyFromAccountCode(password: string, code: string): Promise<{ key: CryptoKey; orgId: string }> {
  const normalized = code.trim().toUpperCase();
  const { data, error } = await supabase().rpc('invite_preview', { p_code: normalized });
  if (error) fail(error);
  const preview = data as { account_key: WrappedKey | null };
  if (!preview.account_key) throw new SyncError('To nie jest kod do konta od admina.');
  let key: CryptoKey;
  try {
    key = await unwrapDataKey(password, preview.account_key);
  } catch {
    throw new SyncError('Hasło nie pasuje do kodu.');
  }
  const orgId = await joinWithInvite(normalized, '', await inviteProof(key, normalized));
  if (!orgId) throw new SyncError('Hasło nie pasuje do kodu.');
  return { key, orgId };
}

/** Logowanie danymi od admina: login, hasło tymczasowe i kod regionu. */
export async function signInWithAdminData(login: string, password: string, code: string): Promise<{ key: CryptoKey; orgId: string; user: SignedIn }> {
  const user = await signIn(tempEmail(login), await accountPassword(password));
  return { ...(await keyFromAccountCode(password, code)), user };
}

/** Zalogowana osoba bez klucza na tym urządzeniu: hasło i kod od admina. */
export async function redeemDeviceCode(password: string, code: string): Promise<CryptoKey> {
  return (await keyFromAccountCode(password, code)).key;
}

/** Konto tymczasowe ustawia własne hasło i e-mail; potem loguje się nimi jak każde konto. */
export async function claimAccount(email: string, newPassword: string): Promise<void> {
  const { error } = await supabase().auth.updateUser({ password: newPassword });
  if (error) fail(error);
  await invokeKonta({ action: 'claim', email });
  await supabase().auth.refreshSession();
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

/** Członek firmy dołącza do kolejnego regionu samym kodem: dowód hasła liczy z klucza firmy na urządzeniu. */
export async function joinAnotherRegion(code: string, dataKey: CryptoKey): Promise<boolean> {
  const normalized = code.trim().toUpperCase();
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
