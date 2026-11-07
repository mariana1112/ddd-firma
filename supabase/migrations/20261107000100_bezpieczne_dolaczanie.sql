-- Dołączanie do firmy w trzech krokach:
-- 1. Kod zaproszenia od szefa: jednorazowy, ważny 14 dni, przypisany do oddziału.
-- 2. Hasło szyfrowania od szefa. Urządzenie technika odwija nim klucz firmy i wysyła dowód, że go ma
--    (szyfrogram stałej wartości związany z kodem). Serwer porównuje skrót dowodu ze skrótem zapisanym
--    przez szefa przy tworzeniu kodu, więc sprawdza hasło, nie znając ani hasła, ani klucza.
--    Po 5 błędnych dowodach kod przestaje działać.
-- 3. Zgoda szefa w aplikacji. Do tego czasu konto nie jest członkiem: nie czyta ani nie zapisuje danych.

alter table public.memberships
  add column approved boolean not null default true,
  add column email text not null default '';
-- Istniejący członkowie są zatwierdzeni. Każde nowe członkostwo musi zatwierdzić szef.
alter table public.memberships alter column approved set default false;

alter table public.invites
  add column proof_hash text,
  add column attempts integer not null default 0;

-- Kody sprzed tej zmiany nie mają dowodu hasła, więc przestają działać.
delete from public.invites where used_by is null;

-- ---------- Członkostwo liczy się dopiero po zgodzie szefa ----------
-- create or replace zachowuje identyfikatory funkcji, więc polityki RLS działają dalej.

create or replace function private.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.approved
  );
$$;

create or replace function private.has_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.approved and m.role = any (p_roles)
  );
$$;

-- ---------- Funkcje ----------

create or replace function public.create_org(p_name text, p_data_key jsonb, p_display_name text, p_branch text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_branch uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if exists (select 1 from public.memberships where user_id = auth.uid()) then
    raise exception 'ORG_EXISTS';
  end if;
  if jsonb_typeof(p_data_key) <> 'object' or p_data_key ->> 'wrapped' is null then
    raise exception 'BAD_KEY';
  end if;
  insert into public.orgs (name, data_key) values (p_name, p_data_key) returning id into v_org;
  insert into public.branches (org_id, name) values (v_org, coalesce(nullif(trim(p_branch), ''), 'Główny')) returning id into v_branch;
  insert into public.memberships (org_id, user_id, role, display_name, branch_id, approved, email)
  values (v_org, auth.uid(), 'owner', trim(p_display_name), v_branch, true,
          coalesce((select u.email from auth.users u where u.id = auth.uid()), ''));
  return v_org;
end;
$$;

drop function public.create_invite(uuid, uuid);

-- Kod tworzy urządzenie szefa, bo dowód hasła wylicza się z kodu i klucza firmy, którego serwer nie zna.
create function public.create_invite(p_org uuid, p_branch uuid, p_code text, p_proof_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.branches where id = p_branch and org_id = p_org) then
    raise exception 'BAD_BRANCH';
  end if;
  if p_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$' or p_proof_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'BAD_INVITE';
  end if;
  insert into public.invites (code, org_id, branch_id, created_by, proof_hash)
  values (p_code, p_org, p_branch, auth.uid(), p_proof_hash);
  return p_code;
end;
$$;

-- Krok 1: kod prowadzi do firmy. Zwraca nazwę firmy i oddziału oraz klucz zawinięty hasłem,
-- bezużyteczny bez hasła szyfrowania (PBKDF2, 600 000 iteracji).
create function public.invite_preview(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select jsonb_build_object('org_name', o.name, 'branch_name', b.name, 'data_key', o.data_key)
  into v
  from public.invites i
  join public.orgs o on o.id = i.org_id
  join public.branches b on b.id = i.branch_id
  where i.code = upper(trim(p_code)) and i.used_by is null and i.expires_at > now()
    and i.proof_hash is not null and i.attempts < 5;
  if v is null then
    raise exception 'BAD_INVITE';
  end if;
  return v;
end;
$$;

drop function public.join_with_invite(text, text);

-- Krok 2: dowód hasła. Zły dowód zwraca null zamiast błędu, bo błąd cofnąłby licznik prób.
create function public.join_with_invite(p_code text, p_display_name text, p_proof text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.invites;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if exists (select 1 from public.memberships where user_id = auth.uid()) then
    raise exception 'ORG_EXISTS';
  end if;
  select * into v_invite from public.invites
  where code = upper(trim(p_code)) and used_by is null and expires_at > now() and proof_hash is not null
  for update;
  if v_invite.code is null or v_invite.attempts >= 5 then
    raise exception 'BAD_INVITE';
  end if;
  if encode(sha256(convert_to(coalesce(p_proof, ''), 'UTF8')), 'hex') <> v_invite.proof_hash then
    update public.invites set attempts = attempts + 1 where code = v_invite.code;
    return null;
  end if;
  -- Krok 3: członkostwo czeka na zgodę szefa.
  insert into public.memberships (org_id, user_id, role, display_name, branch_id, approved, email)
  values (v_invite.org_id, auth.uid(), v_invite.role, trim(p_display_name), v_invite.branch_id, false,
          coalesce((select u.email from auth.users u where u.id = auth.uid()), ''));
  update public.invites set used_by = auth.uid(), used_at = now() where code = v_invite.code;
  return v_invite.org_id;
end;
$$;

create function public.approve_member(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  update public.memberships set approved = true where org_id = p_org and user_id = p_user and not approved;
  if not found then
    raise exception 'NOT_PENDING';
  end if;
end;
$$;

-- Odrzucenie prośby albo usunięcie technika z firmy. Szefa nie da się usunąć.
create function public.remove_member(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.memberships where org_id = p_org and user_id = p_user and role <> 'owner';
  if not found then
    raise exception 'FORBIDDEN';
  end if;
end;
$$;

revoke all on function public.create_invite(uuid, uuid, text, text) from public, anon;
revoke all on function public.invite_preview(text) from public, anon;
revoke all on function public.join_with_invite(text, text, text) from public, anon;
revoke all on function public.approve_member(uuid, uuid) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.create_invite(uuid, uuid, text, text) to authenticated;
grant execute on function public.invite_preview(text) to authenticated;
grant execute on function public.join_with_invite(text, text, text) to authenticated;
grant execute on function public.approve_member(uuid, uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
