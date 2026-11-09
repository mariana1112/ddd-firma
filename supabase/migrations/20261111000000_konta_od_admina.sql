-- Konta zakładane przez admina: login, hasło tymczasowe i kod regionu.
--
-- Admin tworzy konto przez funkcję serwera `konta` (Supabase Auth, klucz serwisowy tylko w Supabase) i kod
-- przypisany do tego konta. Kod niesie klucz firmy zawinięty hasłem tymczasowym (PBKDF2 na urządzeniu admina);
-- serwer dostaje tylko skrót hasła, więc nadal nie może odczytać danych. Konto z kodem dla siebie wchodzi do firmy
-- od razu (zgodę wyraził admin, tworząc konto), z rolą z kodu: technik albo admin (drugi admin).
-- Taki kod (bez nowego konta) służy też do przeniesienia klucza firmy na nowe urządzenie istniejącej osoby.

alter table public.invites
  add column account_key jsonb,
  add column for_user uuid;

-- Kod dla drugiego admina nie musi wskazywać regionu.
alter table public.invites alter column branch_id drop not null;

create function public.create_account_invite(
  p_org uuid, p_branch uuid, p_role text, p_code text, p_proof_hash text, p_account_key jsonb, p_for_user uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  if p_role not in ('owner', 'technik') then
    raise exception 'BAD_INVITE';
  end if;
  if p_branch is null and p_role <> 'owner' then
    raise exception 'BAD_BRANCH';
  end if;
  if p_branch is not null and not exists (select 1 from public.branches where id = p_branch and org_id = p_org) then
    raise exception 'BAD_BRANCH';
  end if;
  if p_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$' or p_proof_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_account_key) <> 'object' or p_account_key ->> 'wrapped' is null or p_for_user is null then
    raise exception 'BAD_INVITE';
  end if;
  insert into public.invites (code, org_id, branch_id, role, created_by, proof_hash, account_key, for_user)
  values (p_code, p_org, p_branch, p_role, auth.uid(), p_proof_hash, p_account_key, p_for_user);
  return p_code;
end;
$$;

-- Podgląd kodu: kod dla konkretnego konta pokazuje się tylko temu kontu i niesie klucz zawinięty hasłem tymczasowym.
create or replace function public.invite_preview(p_code text)
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
  select jsonb_build_object(
    'org_name', o.name,
    'branch_name', coalesce(b.name, ''),
    'data_key', o.data_key,
    'account_key', i.account_key,
    'role', i.role
  )
  into v
  from public.invites i
  join public.orgs o on o.id = i.org_id
  left join public.branches b on b.id = i.branch_id
  where i.code = upper(trim(p_code)) and i.used_by is null and i.expires_at > now()
    and i.proof_hash is not null and i.attempts < 5
    and (i.for_user is null or i.for_user = auth.uid());
  if v is null then
    raise exception 'BAD_INVITE';
  end if;
  return v;
end;
$$;

-- Dołączenie z kodem: konto z kodem dla siebie wchodzi od razu z rolą z kodu; pozostałe jak dotąd.
create or replace function public.join_with_invite(p_code text, p_display_name text, p_proof text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.invites;
  v_member public.memberships;
  v_own boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select * into v_invite from public.invites
  where code = upper(trim(p_code)) and used_by is null and expires_at > now() and proof_hash is not null
  for update;
  if v_invite.code is null or v_invite.attempts >= 5 or (v_invite.for_user is not null and v_invite.for_user <> auth.uid()) then
    raise exception 'BAD_INVITE';
  end if;
  v_own := v_invite.for_user is not null;
  select * into v_member from public.memberships where user_id = auth.uid() limit 1;
  if v_member.user_id is not null and v_member.org_id <> v_invite.org_id then
    raise exception 'ORG_EXISTS';
  end if;
  if encode(sha256(convert_to(coalesce(p_proof, ''), 'UTF8')), 'hex') <> v_invite.proof_hash then
    update public.invites set attempts = attempts + 1 where code = v_invite.code;
    return null;
  end if;
  if v_member.user_id is not null then
    -- Członek tej firmy: kolejny region (albo nowe urządzenie z kodem od admina).
    if v_invite.branch_id is not null then
      insert into public.member_branches (org_id, user_id, branch_id) values (v_invite.org_id, auth.uid(), v_invite.branch_id)
      on conflict do nothing;
      if v_member.branch_id is null then
        update public.memberships set branch_id = v_invite.branch_id where org_id = v_invite.org_id and user_id = auth.uid();
      end if;
    end if;
    if v_own and v_invite.role = 'owner' and v_member.role <> 'owner' then
      update public.memberships set role = 'owner', approved = true where org_id = v_invite.org_id and user_id = auth.uid();
    end if;
  else
    -- Konto od admina wchodzi od razu; inne czeka na zgodę admina.
    insert into public.memberships (org_id, user_id, role, display_name, branch_id, approved, email)
    values (v_invite.org_id, auth.uid(), v_invite.role, trim(coalesce(p_display_name, '')), v_invite.branch_id, v_own,
            coalesce((select u.email from auth.users u where u.id = auth.uid()), ''));
    if v_invite.branch_id is not null then
      insert into public.member_branches (org_id, user_id, branch_id) values (v_invite.org_id, auth.uid(), v_invite.branch_id)
      on conflict do nothing;
    end if;
  end if;
  update public.invites set used_by = auth.uid(), used_at = now() where code = v_invite.code;
  return v_invite.org_id;
end;
$$;

-- Po zmianie loginu na własny e-mail lista członków pokazuje nowy adres.
create function public.refresh_my_email()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.memberships
    set email = coalesce((select u.email from auth.users u where u.id = (select auth.uid())), email)
  where user_id = (select auth.uid());
$$;

revoke all on function public.create_account_invite(uuid, uuid, text, text, text, jsonb, uuid), public.refresh_my_email()
  from public, anon;
grant execute on function public.create_account_invite(uuid, uuid, text, text, text, jsonb, uuid), public.refresh_my_email()
  to authenticated;
