-- Oddziały i technicy. Technik widzi rekordy swojego oddziału, właściciel (szef) wszystkie.
-- Nowy technik dołącza kodem zaproszenia przypisanym do oddziału.

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

alter table public.memberships
  add column display_name text not null default '',
  add column branch_id uuid references public.branches (id) on delete set null;

alter table public.records add column branch_id uuid references public.branches (id) on delete set null;
create index records_org_branch_rev on public.records (org_id, branch_id, rev);

create table public.invites (
  code text primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  branch_id uuid not null references public.branches (id) on delete cascade,
  role text not null default 'technik' check (role in ('owner', 'technik')),
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_by uuid,
  used_at timestamptz
);

-- Istniejące firmy dostają oddział „Główny” z wszystkimi członkami i rekordami.
insert into public.branches (org_id, name) select id, 'Główny' from public.orgs;
update public.memberships m set branch_id = b.id from public.branches b where b.org_id = m.org_id and b.name = 'Główny';
update public.records r set branch_id = b.id from public.branches b where b.org_id = r.org_id and b.name = 'Główny' and r.tbl <> 'meta';

-- ---------- Funkcje pomocnicze ----------

create function private.my_branch(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.branch_id from public.memberships m where m.org_id = p_org and m.user_id = (select auth.uid());
$$;

grant execute on function private.my_branch(uuid) to authenticated;

-- Rekord oddziału widzi szef i technicy tego oddziału. Rekordy bez oddziału (ustawienia firmy) widzą wszyscy.
create function private.can_see(p_org uuid, p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_member(p_org)
     and (p_branch is null or private.has_role(p_org, array['owner']) or p_branch = private.my_branch(p_org));
$$;

grant execute on function private.can_see(uuid, uuid) to authenticated;

-- ---------- Uprawnienia ----------

alter table public.branches enable row level security;
alter table public.invites enable row level security;
grant select on public.branches to authenticated;
revoke all on public.branches, public.invites from anon;

create policy "Członkowie widzą oddziały" on public.branches
  for select to authenticated
  using (private.has_role(org_id, array['owner']) or id = private.my_branch(org_id));

drop policy "Członkowie widzą członków firmy" on public.memberships;
create policy "Członkowie widzą członków oddziału" on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or private.can_see(org_id, branch_id));

drop policy "Członkowie czytają rekordy firmy" on public.records;
create policy "Członkowie czytają rekordy oddziału" on public.records
  for select to authenticated
  using (private.can_see(org_id, branch_id));

-- Historia zmian obejmuje całą firmę, więc czyta ją tylko szef.
drop policy "Członkowie czytają historię firmy" on public.changes;
create policy "Szef czyta historię" on public.changes
  for select to authenticated
  using (private.has_role(org_id, array['owner']));

-- ---------- Funkcje ----------

drop function public.create_org(text, jsonb);

create function public.create_org(p_name text, p_data_key jsonb, p_display_name text, p_branch text)
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
  insert into public.memberships (org_id, user_id, role, display_name, branch_id)
  values (v_org, auth.uid(), 'owner', trim(p_display_name), v_branch);
  return v_org;
end;
$$;

create function public.update_my_profile(p_org uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.memberships set display_name = trim(p_display_name)
  where org_id = p_org and user_id = auth.uid();
  if not found then
    raise exception 'FORBIDDEN';
  end if;
end;
$$;

create function public.create_branch(p_org uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.branches (org_id, name) values (p_org, trim(p_name)) returning id into v_id;
  return v_id;
end;
$$;

create function public.rename_branch(p_branch uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.branches where id = p_branch;
  if v_org is null or not private.has_role(v_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  update public.branches set name = trim(p_name) where id = p_branch;
end;
$$;

-- Przeniesienie technika do innego oddziału. Jego dotychczasowe rekordy zostają w starym oddziale.
create function public.set_member_branch(p_org uuid, p_user uuid, p_branch uuid)
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
end;
$$;

create function public.create_invite(p_org uuid, p_branch uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.branches where id = p_branch and org_id = p_org) then
    raise exception 'BAD_BRANCH';
  end if;
  -- Bez znaków łatwych do pomylenia: 0/O, 1/I/L.
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  into v_code from generate_series(1, 8);
  insert into public.invites (code, org_id, branch_id, created_by) values (v_code, p_org, p_branch, auth.uid());
  return v_code;
end;
$$;

create function public.join_with_invite(p_code text, p_display_name text)
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
  where code = upper(trim(p_code)) and used_by is null and expires_at > now()
  for update;
  if v_invite.code is null then
    raise exception 'BAD_INVITE';
  end if;
  insert into public.memberships (org_id, user_id, role, display_name, branch_id)
  values (v_invite.org_id, auth.uid(), v_invite.role, trim(p_display_name), v_invite.branch_id);
  update public.invites set used_by = auth.uid(), used_at = now() where code = v_invite.code;
  return v_invite.org_id;
end;
$$;

create or replace function public.reserve_numbers(p_org uuid, p_series text, p_min_next integer, p_count integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  if not private.is_member(p_org) then
    raise exception 'FORBIDDEN';
  end if;
  if p_count not between 1 and 100 then
    raise exception 'BAD_COUNT';
  end if;
  insert into public.number_counters (org_id, series, next)
  values (p_org, p_series, greatest(p_min_next, 1) + p_count)
  on conflict (org_id, series) do update
    set next = greatest(public.number_counters.next, excluded.next - p_count) + p_count
  returning next into v_next;
  return v_next - p_count;
end;
$$;

-- Zapis: każdy członek w swoim oddziale, szef wszędzie. Ustawienia firmy (meta) zmienia tylko szef.
-- Zmiany spoza uprawnień są pomijane, a nie odrzucane, żeby nie blokować kolejki urządzenia.
create or replace function public.sync_push(p_org uuid, p_device text, p_schema integer, p_changes jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb;
  v_rev bigint;
  v_last bigint := 0;
  v_inserted integer;
  v_min integer;
  v_owner boolean;
  v_branch uuid;
  v_existing public.records;
begin
  if not private.is_member(p_org) then
    raise exception 'FORBIDDEN';
  end if;
  v_owner := private.has_role(p_org, array['owner']);
  v_branch := private.my_branch(p_org);
  select (value #>> '{}')::integer into v_min from public.app_config where key = 'min_schema';
  if p_schema < coalesce(v_min, 0) then
    raise exception 'UPDATE_REQUIRED';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 500 then
    raise exception 'BAD_BATCH';
  end if;

  for c in select value from jsonb_array_elements(p_changes) loop
    if c ->> 'tbl' not in ('clients', 'sites', 'services', 'jobs', 'preparations', 'stockMovements',
                           'payments', 'expenses', 'attachments', 'orders', 'visits', 'trips', 'meta')
       or c ->> 'op' not in ('create', 'update', 'delete', 'restore', 'put', 'purge')
       or jsonb_typeof(c -> 'patch') <> 'object' then
      raise exception 'BAD_CHANGE';
    end if;
    -- Każda wartość pola musi być szyfrogramem aplikacji. Jawne dane są odrzucane.
    if exists (
      select 1 from jsonb_each(c -> 'patch') f
      where jsonb_typeof(f.value) <> 'string' or left(f.value #>> '{}', 3) <> 'e1:'
    ) then
      raise exception 'NOT_ENCRYPTED';
    end if;

    select * into v_existing from public.records
    where org_id = p_org and tbl = c ->> 'tbl' and id = c ->> 'recordId';
    if c ->> 'tbl' = 'meta' then
      continue when not v_owner;
    elsif v_existing.id is not null then
      continue when not v_owner and v_existing.branch_id is distinct from v_branch;
    end if;

    insert into public.changes (id, org_id, tbl, record_id, op, patch, user_id, device_id, client_at)
    values ((c ->> 'id')::uuid, p_org, c ->> 'tbl', c ->> 'recordId', c ->> 'op', c -> 'patch',
            auth.uid(), p_device, (c ->> 'at')::timestamptz)
    on conflict (id) do nothing;
    get diagnostics v_inserted = row_count;
    -- Ponownie wysłana zmiana, np. po zerwanym połączeniu: już przyjęta.
    continue when v_inserted = 0;

    v_rev := nextval('public.record_rev');
    if c ->> 'op' = 'purge' then
      insert into public.records (org_id, tbl, id, data, rev, purged, updated_by, branch_id)
      values (p_org, c ->> 'tbl', c ->> 'recordId', '{}'::jsonb, v_rev, true, auth.uid(), v_branch)
      on conflict (org_id, tbl, id) do update
        set data = '{}'::jsonb, rev = excluded.rev, purged = true,
            updated_by = excluded.updated_by, updated_at = now();
    else
      -- Nowy rekord należy do oddziału autora. Zmiana nadpisuje tylko pola, które zawiera.
      insert into public.records (org_id, tbl, id, data, rev, updated_by, branch_id)
      values (p_org, c ->> 'tbl', c ->> 'recordId', c -> 'patch', v_rev, auth.uid(),
              case when c ->> 'tbl' = 'meta' then null else v_branch end)
      on conflict (org_id, tbl, id) do update
        set data = public.records.data || excluded.data, rev = excluded.rev,
            updated_by = excluded.updated_by, updated_at = now()
        where not public.records.purged;
    end if;
    v_last := v_rev;
  end loop;
  return v_last;
end;
$$;

revoke all on function public.create_org(text, jsonb, text, text) from public, anon;
revoke all on function public.update_my_profile(uuid, text) from public, anon;
revoke all on function public.create_branch(uuid, text) from public, anon;
revoke all on function public.rename_branch(uuid, text) from public, anon;
revoke all on function public.set_member_branch(uuid, uuid, uuid) from public, anon;
revoke all on function public.create_invite(uuid, uuid) from public, anon;
revoke all on function public.join_with_invite(text, text) from public, anon;
grant execute on function public.create_org(text, jsonb, text, text) to authenticated;
grant execute on function public.update_my_profile(uuid, text) to authenticated;
grant execute on function public.create_branch(uuid, text) to authenticated;
grant execute on function public.rename_branch(uuid, text) to authenticated;
grant execute on function public.set_member_branch(uuid, uuid, uuid) to authenticated;
grant execute on function public.create_invite(uuid, uuid) to authenticated;
grant execute on function public.join_with_invite(text, text) to authenticated;

-- Zdjęcia: dodawać i usuwać mogą wszyscy członkowie, bo pliki są zaszyfrowane, a ich ścieżki
-- znają tylko urządzenia, które widzą rekord zdjęcia.
drop policy "Zdjęcia: dodawanie przez właściciela" on storage.objects;
drop policy "Zdjęcia: nadpisywanie przez właściciela" on storage.objects;
drop policy "Zdjęcia: usuwanie przez właściciela" on storage.objects;
create policy "Zdjęcia: dodawanie przez członków" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and private.is_member(private.path_org(name)));
create policy "Zdjęcia: nadpisywanie przez członków" on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and private.is_member(private.path_org(name)))
  with check (bucket_id = 'attachments' and private.is_member(private.path_org(name)));
create policy "Zdjęcia: usuwanie przez członków" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and private.is_member(private.path_org(name)));
