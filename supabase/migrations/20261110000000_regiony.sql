-- Regiony: jedno konto może należeć do kilku regionów (oddziałów) firmy i przełączać aktywny region.
--
-- - public.member_branches: regiony, do których konto ma dostęp. Aktywny region to dalej memberships.branch_id
--   (private.my_branch): od niego zależy, które rekordy konto widzi i do którego regionu trafiają nowe rekordy.
-- - switch_branch: przełączenie aktywnego regionu (technik tylko na swoje regiony, admin na każdy).
-- - join_with_invite: członek firmy z kodem do innego regionu dostaje ten region, bez ponownej zgody admina
--   (hasło szyfrowania dalej sprawdza dowód).
-- - delete_branch: admin usuwa region. Jego rekordy zostają bez regionu i widzi je wtedy tylko admin.
-- - Rekordy bez regionu (poza ustawieniami firmy w meta) widzi tylko admin, a nie wszyscy członkowie.

create table public.member_branches (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null,
  branch_id uuid not null references public.branches (id) on delete cascade,
  primary key (org_id, user_id, branch_id)
);

alter table public.member_branches enable row level security;
revoke all on public.member_branches from public, anon;
grant select on public.member_branches to authenticated;

create policy "Swoje regiony, admin wszystkie" on public.member_branches
  for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(org_id, array['owner']));

insert into public.member_branches (org_id, user_id, branch_id)
select org_id, user_id, branch_id from public.memberships where branch_id is not null
on conflict do nothing;

-- Regiony widoczne dla konta: admin wszystkie, pozostali swoje.
drop policy "Członkowie widzą oddziały" on public.branches;
create policy "Członkowie widzą swoje regiony" on public.branches
  for select to authenticated
  using (
    private.has_role(org_id, array['owner'])
    or id = private.my_branch(org_id)
    or exists (
      select 1 from public.member_branches mb
      where mb.org_id = branches.org_id and mb.user_id = (select auth.uid()) and mb.branch_id = branches.id
    )
  );

-- Rekord widzi admin i konta z aktywnym regionem rekordu. Ustawienia firmy (meta) widzą wszyscy członkowie,
-- a inne rekordy bez regionu tylko admin.
create function private.can_see_record(p_org uuid, p_tbl text, p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_member(p_org)
     and (p_tbl = 'meta'
          or private.has_role(p_org, array['owner'])
          or (p_branch is not null and p_branch = private.my_branch(p_org)));
$$;

revoke all on function private.can_see_record(uuid, text, uuid) from public, anon;
grant execute on function private.can_see_record(uuid, text, uuid) to authenticated;

drop policy "Członkowie czytają rekordy oddziału" on public.records;
create policy "Członkowie czytają rekordy regionu" on public.records
  for select to authenticated
  using (private.can_see_record(org_id, tbl, branch_id));

-- Przełączenie aktywnego regionu konta.
create function public.switch_branch(p_org uuid, p_branch uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_org) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.branches where id = p_branch and org_id = p_org) then
    raise exception 'BAD_BRANCH';
  end if;
  if not private.has_role(p_org, array['owner']) and not exists (
    select 1 from public.member_branches where org_id = p_org and user_id = auth.uid() and branch_id = p_branch
  ) then
    raise exception 'FORBIDDEN';
  end if;
  update public.memberships set branch_id = p_branch where org_id = p_org and user_id = auth.uid();
  insert into public.member_branches (org_id, user_id, branch_id) values (p_org, auth.uid(), p_branch)
  on conflict do nothing;
end;
$$;

-- Admin przenosi technika: nowy region staje się aktywny i trafia na listę jego regionów.
create or replace function public.set_member_branch(p_org uuid, p_user uuid, p_branch uuid)
returns void
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
  update public.memberships set branch_id = p_branch where org_id = p_org and user_id = p_user;
  insert into public.member_branches (org_id, user_id, branch_id) values (p_org, p_user, p_branch)
  on conflict do nothing;
end;
$$;

-- Admin odbiera kontu dostęp do regionu. Gdy był aktywny, aktywny staje się inny region konta albo żaden.
create function public.remove_member_branch(p_org uuid, p_user uuid, p_branch uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.member_branches where org_id = p_org and user_id = p_user and branch_id = p_branch;
  update public.memberships m
    set branch_id = (select mb.branch_id from public.member_branches mb where mb.org_id = p_org and mb.user_id = p_user limit 1)
  where m.org_id = p_org and m.user_id = p_user and m.branch_id = p_branch;
end;
$$;

-- Usunięcie regionu przez admina. Zaproszenia i dostęp do regionu znikają, rekordy zostają bez regionu
-- (widzi je tylko admin), a konta z tym aktywnym regionem przechodzą na inny swój region albo żaden.
create function public.delete_branch(p_branch uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.branches where id = p_branch;
  if v_org is null then
    raise exception 'BAD_BRANCH';
  end if;
  if not private.has_role(v_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.member_branches where org_id = v_org and branch_id = p_branch;
  update public.memberships m
    set branch_id = (select mb.branch_id from public.member_branches mb where mb.org_id = v_org and mb.user_id = m.user_id limit 1)
  where m.org_id = v_org and m.branch_id = p_branch;
  delete from public.branches where id = p_branch;
end;
$$;

-- Dołączenie z kodem. Nowe konto czeka na zgodę admina; członek tej firmy dostaje kolejny region od razu.
create or replace function public.join_with_invite(p_code text, p_display_name text, p_proof text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.invites;
  v_member public.memberships;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select * into v_invite from public.invites
  where code = upper(trim(p_code)) and used_by is null and expires_at > now() and proof_hash is not null
  for update;
  if v_invite.code is null or v_invite.attempts >= 5 then
    raise exception 'BAD_INVITE';
  end if;
  select * into v_member from public.memberships where user_id = auth.uid() limit 1;
  if v_member.user_id is not null and v_member.org_id <> v_invite.org_id then
    raise exception 'ORG_EXISTS';
  end if;
  if encode(sha256(convert_to(coalesce(p_proof, ''), 'UTF8')), 'hex') <> v_invite.proof_hash then
    update public.invites set attempts = attempts + 1 where code = v_invite.code;
    return null;
  end if;
  if v_member.user_id is not null then
    -- Kolejny region dla członka tej firmy (np. jeden e-mail w kilku regionach).
    insert into public.member_branches (org_id, user_id, branch_id) values (v_invite.org_id, auth.uid(), v_invite.branch_id)
    on conflict do nothing;
    if v_member.branch_id is null then
      update public.memberships set branch_id = v_invite.branch_id where org_id = v_invite.org_id and user_id = auth.uid();
    end if;
  else
    -- Krok 3: członkostwo czeka na zgodę admina.
    insert into public.memberships (org_id, user_id, role, display_name, branch_id, approved, email)
    values (v_invite.org_id, auth.uid(), v_invite.role, trim(p_display_name), v_invite.branch_id, false,
            coalesce((select u.email from auth.users u where u.id = auth.uid()), ''));
    insert into public.member_branches (org_id, user_id, branch_id) values (v_invite.org_id, auth.uid(), v_invite.branch_id)
    on conflict do nothing;
  end if;
  update public.invites set used_by = auth.uid(), used_at = now() where code = v_invite.code;
  return v_invite.org_id;
end;
$$;

revoke all on function public.switch_branch(uuid, uuid), public.remove_member_branch(uuid, uuid, uuid), public.delete_branch(uuid)
  from public, anon;
grant execute on function public.switch_branch(uuid, uuid), public.remove_member_branch(uuid, uuid, uuid), public.delete_branch(uuid)
  to authenticated;
