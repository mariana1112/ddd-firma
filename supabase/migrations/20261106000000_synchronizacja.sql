-- DDD Firma: synchronizacja rekordów między urządzeniami firmy.
--
-- Serwer przechowuje rekordy aplikacji jako JSON i nie zna ich struktury. Zmiana modelu danych
-- w aplikacji nie wymaga więc migracji serwera. Zapisy idą wyłącznie przez funkcje sync_push
-- i reserve_numbers, które sprawdzają członkostwo i rolę. Bezpośredni zapis do tabel jest
-- zablokowany przez RLS. Semantykę funkcji odwzorowuje src/test/memory-server.ts.

-- ---------- Firmy i członkostwo ----------

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'technik', 'ksiegowosc')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index memberships_user on public.memberships (user_id);

-- ---------- Rekordy i dziennik zmian ----------

create sequence public.record_rev;

create table public.records (
  org_id uuid not null references public.orgs (id) on delete cascade,
  tbl text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  rev bigint not null,
  purged boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (org_id, tbl, id)
);

create index records_org_rev on public.records (org_id, rev);

-- Każda przyjęta zmiana, w kolejności przyjęcia. Nic stąd nie jest usuwane: to jest historia.
create table public.changes (
  id uuid primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  seq bigint generated always as identity,
  tbl text not null,
  record_id text not null,
  op text not null,
  patch jsonb not null,
  user_id uuid,
  device_id text,
  client_at timestamptz,
  server_at timestamptz not null default now()
);

create index changes_record on public.changes (org_id, tbl, record_id, seq);

create table public.number_counters (
  org_id uuid not null references public.orgs (id) on delete cascade,
  series text not null,
  next integer not null,
  primary key (org_id, series)
);

create table public.app_config (
  key text primary key,
  value jsonb not null
);

-- Najniższa wersja schematu aplikacji, która może wysyłać zmiany.
insert into public.app_config (key, value) values ('min_schema', '3');

-- ---------- Uprawnienia ----------

alter table public.orgs enable row level security;
alter table public.memberships enable row level security;
alter table public.records enable row level security;
alter table public.changes enable row level security;
alter table public.number_counters enable row level security;
alter table public.app_config enable row level security;

-- security definer omija RLS na memberships, dzięki czemu polityki nie wywołują się rekurencyjnie.
create function public.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m where m.org_id = p_org and m.user_id = (select auth.uid())
  );
$$;

create function public.has_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role = any (p_roles)
  );
$$;

create policy "Członkowie widzą swoją firmę" on public.orgs
  for select to authenticated using (public.is_member(id));

create policy "Członkowie widzą członków firmy" on public.memberships
  for select to authenticated using (user_id = (select auth.uid()) or public.is_member(org_id));

create policy "Członkowie czytają rekordy firmy" on public.records
  for select to authenticated using (public.is_member(org_id));

create policy "Członkowie czytają historię firmy" on public.changes
  for select to authenticated using (public.is_member(org_id));

create policy "Zalogowani czytają konfigurację" on public.app_config
  for select to authenticated using (true);

-- ---------- Funkcje ----------

-- Etap B: każdy użytkownik zakłada jedną firmę i jest jej właścicielem.
create function public.create_org(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if exists (select 1 from public.memberships where user_id = auth.uid()) then
    raise exception 'ORG_EXISTS';
  end if;
  insert into public.orgs (name) values (p_name) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  return v_org;
end;
$$;

create function public.sync_push(p_org uuid, p_device text, p_schema integer, p_changes jsonb)
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
begin
  -- Etap C dopisze tu uprawnienia pracowników do wybranych tabel i rekordów.
  if not public.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  select (value #>> '{}')::integer into v_min from public.app_config where key = 'min_schema';
  if p_schema < coalesce(v_min, 0) then
    raise exception 'UPDATE_REQUIRED';
  end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 500 then
    raise exception 'BAD_BATCH';
  end if;

  for c in select value from jsonb_array_elements(p_changes) loop
    if c ->> 'tbl' not in ('clients', 'sites', 'services', 'jobs', 'preparations', 'stockMovements',
                           'payments', 'expenses', 'attachments', 'meta')
       or c ->> 'op' not in ('create', 'update', 'delete', 'restore', 'put', 'purge')
       or jsonb_typeof(c -> 'patch') <> 'object' then
      raise exception 'BAD_CHANGE';
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
      insert into public.records (org_id, tbl, id, data, rev, purged, updated_by)
      values (p_org, c ->> 'tbl', c ->> 'recordId', '{}'::jsonb, v_rev, true, auth.uid())
      on conflict (org_id, tbl, id) do update
        set data = '{}'::jsonb, rev = excluded.rev, purged = true,
            updated_by = excluded.updated_by, updated_at = now();
    else
      -- Zmiana nadpisuje tylko pola, które zawiera. Rekord usunięty trwale nie wraca.
      insert into public.records (org_id, tbl, id, data, rev, updated_by)
      values (p_org, c ->> 'tbl', c ->> 'recordId', c -> 'patch', v_rev, auth.uid())
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

-- Pula kolejnych numerów zleceń, żeby urządzenia nadawały numery bez internetu i bez powtórzeń.
create function public.reserve_numbers(p_org uuid, p_series text, p_min_next integer, p_count integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  if not public.has_role(p_org, array['owner']) then
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

revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.has_role(uuid, text[]) from public, anon;
revoke all on function public.create_org(text) from public, anon;
revoke all on function public.sync_push(uuid, text, integer, jsonb) from public, anon;
revoke all on function public.reserve_numbers(uuid, text, integer, integer) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, text[]) to authenticated;
grant execute on function public.create_org(text) to authenticated;
grant execute on function public.sync_push(uuid, text, integer, jsonb) to authenticated;
grant execute on function public.reserve_numbers(uuid, text, integer, integer) to authenticated;

-- ---------- Zdjęcia ----------

-- Firma z pierwszego segmentu ścieżki pliku. Gdy segment nie jest identyfikatorem, wynik to null
-- zamiast błędu rzutowania, więc polityka po prostu odmawia dostępu.
create function public.path_org(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- Prywatny magazyn. Ścieżka pliku zaczyna się od identyfikatora firmy: <org_id>/<id_zdjęcia>.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "Zdjęcia: odczyt członków firmy" on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments' and public.is_member(public.path_org(name)));

create policy "Zdjęcia: dodawanie przez właściciela" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments' and public.has_role(public.path_org(name), array['owner']));

create policy "Zdjęcia: nadpisywanie przez właściciela" on storage.objects
  for update to authenticated
  using (bucket_id = 'attachments' and public.has_role(public.path_org(name), array['owner']))
  with check (bucket_id = 'attachments' and public.has_role(public.path_org(name), array['owner']));
