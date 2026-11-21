-- Jedno zlecenie dla technika z innego regionu (bez przenoszenia go do regionu zlecenia).
--
-- - Admin udostępnia technikowi konkretne rekordy: zlecenie i zabieg (public.record_grants). Technik widzi je obok
--   rekordów swojego regionu i może je zmieniać (np. zakończyć zabieg). Usuwać ich nie może (jak dotąd: tylko admin).
-- - Region rekordu się nie zmienia, więc zabieg liczy się do raportu regionu zlecenia.
-- - Udostępnienie podbija numer zmiany rekordu (rev), żeby telefon technika pobrał rekord przy najbliższej
--   synchronizacji (inaczej rekord byłby „starszy” niż to, co technik już pobrał).
-- - Cofnięcie udostępnienia odbiera wgląd w kolejne zmiany i blokuje dalsze zapisy technika w tych rekordach.

create table public.record_grants (
  org_id uuid not null references public.orgs (id) on delete cascade,
  tbl text not null check (tbl in ('orders', 'visits')),
  record_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid,
  created_at timestamptz not null default now(),
  primary key (org_id, tbl, record_id, user_id)
);
create index record_grants_user on public.record_grants (org_id, user_id);

alter table public.record_grants enable row level security;
create policy "Admin i technik widzą swoje udostępnienia" on public.record_grants
  for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(org_id, array['owner']));
revoke insert, update, delete on public.record_grants from anon, authenticated;

-- Czy zalogowane konto ma udostępniony ten rekord.
create function private.has_record_grant(p_org uuid, p_tbl text, p_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_tbl in ('orders', 'visits')
     and private.is_member(p_org)
     and exists (
       select 1 from public.record_grants g
       where g.org_id = p_org and g.tbl = p_tbl and g.record_id = p_id and g.user_id = (select auth.uid())
     );
$$;
revoke all on function private.has_record_grant(uuid, text, text) from public, anon;
grant execute on function private.has_record_grant(uuid, text, text) to authenticated;

drop policy "Członkowie czytają rekordy regionu" on public.records;
create policy "Członkowie czytają rekordy regionu" on public.records
  for select to authenticated
  using (private.can_see_record(org_id, tbl, branch_id) or private.has_record_grant(org_id, tbl, id));

-- Admin udostępnia (p_grant = true) albo odbiera (false) technikowi rekordy: [{"tbl": "orders", "id": "…"}, …].
create function public.set_record_access(p_org uuid, p_user uuid, p_records jsonb, p_grant boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
begin
  if not private.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  if not exists (select 1 from public.memberships where org_id = p_org and user_id = p_user and approved) then
    raise exception 'BAD_USER';
  end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records) > 50 then
    raise exception 'BAD_BATCH';
  end if;
  for r in select value from jsonb_array_elements(p_records) loop
    if r ->> 'tbl' not in ('orders', 'visits') or coalesce(r ->> 'id', '') = '' then
      raise exception 'BAD_RECORD';
    end if;
    if p_grant then
      insert into public.record_grants (org_id, tbl, record_id, user_id, granted_by)
      values (p_org, r ->> 'tbl', r ->> 'id', p_user, auth.uid())
      on conflict do nothing;
      update public.records set rev = nextval('public.record_rev')
      where org_id = p_org and tbl = r ->> 'tbl' and id = r ->> 'id';
    else
      delete from public.record_grants
      where org_id = p_org and tbl = r ->> 'tbl' and record_id = r ->> 'id' and user_id = p_user;
    end if;
  end loop;
end;
$$;
revoke all on function public.set_record_access(uuid, uuid, jsonb, boolean) from public, anon;
grant execute on function public.set_record_access(uuid, uuid, jsonb, boolean) to authenticated;

-- Zapis: jak dotąd, a do tego technik zmienia udostępnione mu zlecenie i zabieg (bez usuwania).
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
  v_all boolean;
  v_branch uuid;
  v_existing public.records;
begin
  if not private.is_member(p_org) then
    raise exception 'FORBIDDEN';
  end if;
  v_owner := private.has_role(p_org, array['owner']);
  -- Księgowa poprawia rekordy wszystkich regionów (koszty, kilometry, kwoty, statusy faktur), ale nie ustawienia firmy.
  v_all := private.has_role(p_org, array['owner', 'ksiegowosc']);
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
                           'payments', 'expenses', 'attachments', 'orders', 'visits', 'trips', 'meta', 'messages')
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
    -- Zlecenia i zabiegi usuwa tylko admin (technik prosi o usunięcie, admin zatwierdza).
    continue when c ->> 'tbl' in ('orders', 'visits') and c ->> 'op' in ('delete', 'purge') and not v_owner;
    if c ->> 'tbl' = 'meta' then
      continue when not v_owner;
    elsif v_existing.id is not null then
      continue when not v_all and v_existing.branch_id is distinct from v_branch
        and not private.has_record_grant(p_org, c ->> 'tbl', c ->> 'recordId');
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
