// Funkcja serwera „konta” (Supabase Edge Function).
//
// - create: admin firmy zakłada konto z loginem tymczasowym. Hasło przychodzi już jako skrót wyliczony na
//   urządzeniu admina z hasła tymczasowego, więc serwer nie zna hasła, którym zawinięty jest klucz firmy.
// - claim: konto tymczasowe ustawia własny e-mail (hasło zmienia wcześniej samo, przez Supabase Auth).
// - delete: admin usuwa konto z firmy i z logowania (nie siebie).
// - register: rejestracja z kodem weryfikacyjnym od admina (bez logowania). Konto powstaje tylko z ważnym,
//   niewykorzystanym kodem; kod zostaje przypisany do nowego konta, które dołącza nim do firmy i regionu.
//
// Klucz serwisowy (SUPABASE_SERVICE_ROLE_KEY) jest tylko w środowisku funkcji, nigdy w aplikacji.

import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const TEMP_DOMAIN = 'konta.pogromcy.invalid';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'BAD_ACTION' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'BAD_ACTION' }, 400);
  }

  if (body.action === 'register') {
    const codeId = String(body.code_id ?? '').toUpperCase();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const name = String(body.name ?? '').trim().slice(0, 80);
    if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(codeId)) return json({ error: 'BAD_INVITE' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith(`@${TEMP_DOMAIN}`)) return json({ error: 'BAD_EMAIL' }, 400);
    if (password.length < 12) return json({ error: 'WEAK_PASSWORD' }, 400);
    const { data: invite } = await admin
      .from('invites')
      .select('code, used_by, expires_at, attempts, account_key, for_user')
      .eq('code', codeId)
      .maybeSingle();
    if (!invite || invite.used_by || invite.for_user || !invite.account_key || invite.attempts >= 5 || new Date(invite.expires_at) < new Date()) {
      return json({ error: 'BAD_INVITE' }, 400);
    }
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
    if (error || !data.user) {
      return json({ error: /already|exists|registered/i.test(error?.message ?? '') ? 'EMAIL_TAKEN' : error?.message ?? 'CREATE_FAILED' }, 400);
    }
    // Kod należy teraz do tego konta: tylko ono nim dołączy (od razu, bez czekania na zgodę admina).
    const { data: bound } = await admin
      .from('invites')
      .update({ for_user: data.user.id })
      .eq('code', codeId)
      .is('for_user', null)
      .is('used_by', null)
      .select('code');
    if (!bound?.length) {
      // Ktoś użył kodu w tej samej chwili: konto bez kodu nie może zostać.
      await admin.auth.admin.deleteUser(data.user.id);
      return json({ error: 'BAD_INVITE' }, 400);
    }
    return json({ ok: true });
  }

  const authorization = req.headers.get('Authorization') ?? '';
  const caller = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: who } = await caller.auth.getUser();
  const user = who.user;
  if (!user) return json({ error: 'NOT_AUTHENTICATED' }, 401);

  /** Tylko zatwierdzony, niezawieszony admin tej firmy, bez czekającego potwierdzenia po resecie hasła. */
  const isAdmin = async (orgId: string): Promise<boolean> => {
    const { data: member } = await admin
      .from('memberships')
      .select('role, approved, suspended')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!member || member.role !== 'owner' || !member.approved || member.suspended) return false;
    const { data: status } = await caller.rpc('recovery_status');
    return !(status as { pending?: boolean } | null)?.pending;
  };

  if (body.action === 'delete') {
    const orgId = String(body.org_id ?? '');
    const target = String(body.user_id ?? '');
    if (!target || target === user.id || !(await isAdmin(orgId))) return json({ error: 'FORBIDDEN' }, 403);
    const { data: inOrg } = await admin.from('memberships').select('user_id').eq('org_id', orgId).eq('user_id', target).maybeSingle();
    if (!inOrg) return json({ error: 'FORBIDDEN' }, 403);
    const { count } = await admin.from('memberships').select('user_id', { count: 'exact', head: true }).eq('user_id', target);
    await admin.from('member_branches').delete().eq('org_id', orgId).eq('user_id', target);
    await admin.from('memberships').delete().eq('org_id', orgId).eq('user_id', target);
    // Konto jest tylko w tej firmie: usuwamy je też z logowania.
    if ((count ?? 0) <= 1) {
      const { error } = await admin.auth.admin.deleteUser(target);
      if (error) return json({ error: error.message }, 400);
    }
    return json({ ok: true });
  }

  if (body.action === 'create') {
    const orgId = String(body.org_id ?? '');
    const login = String(body.login ?? '').toLowerCase();
    const password = String(body.password ?? '');
    if (!/^[a-z]{2,5}-[a-z0-9]{6,12}$/.test(login) || password.length < 32) return json({ error: 'BAD_ACCOUNT' }, 400);
    if (!(await isAdmin(orgId))) return json({ error: 'FORBIDDEN' }, 403);
    const { data, error } = await admin.auth.admin.createUser({
      email: `${login}@${TEMP_DOMAIN}`,
      password,
      email_confirm: true,
      user_metadata: { temp: true, created_by: user.id, org_id: orgId },
    });
    if (error || !data.user) return json({ error: error?.message ?? 'CREATE_FAILED' }, 400);
    return json({ user_id: data.user.id, email: data.user.email });
  }

  if (body.action === 'claim') {
    if (!user.user_metadata?.temp) return json({ error: 'NOT_TEMP' }, 400);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith(`@${TEMP_DOMAIN}`)) return json({ error: 'BAD_EMAIL' }, 400);
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      email,
      email_confirm: true,
      user_metadata: { ...user.user_metadata, temp: false },
    });
    if (error) return json({ error: /already|exists|registered/i.test(error.message) ? 'EMAIL_TAKEN' : error.message }, 400);
    await admin.from('memberships').update({ email }).eq('user_id', user.id);
    return json({ ok: true });
  }

  return json({ error: 'BAD_ACTION' }, 400);
});
