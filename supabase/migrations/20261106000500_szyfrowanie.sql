-- Szyfrowanie end-to-end. Serwer przechowuje klucz danych firmy wyłącznie zawinięty hasłem
-- szyfrowania, którego nie zna, i przyjmuje tylko zaszyfrowane wartości pól.

alter table public.orgs add column data_key jsonb;

-- Aplikacje bez szyfrowania (schemat 3) nie mogą już wysyłać zmian.
update public.app_config set value = '4' where key = 'min_schema';

drop function public.create_org(text);

create function public.create_org(p_name text, p_data_key jsonb)
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
  if jsonb_typeof(p_data_key) <> 'object' or p_data_key ->> 'wrapped' is null then
    raise exception 'BAD_KEY';
  end if;
  insert into public.orgs (name, data_key) values (p_name, p_data_key) returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  return v_org;
end;
$$;

-- Klucz ustawia się raz. Nadpisanie kluczem innego hasła odcięłoby pozostałe urządzenia od danych.
create function public.set_org_key(p_org uuid, p_data_key jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  if jsonb_typeof(p_data_key) <> 'object' or p_data_key ->> 'wrapped' is null then
    raise exception 'BAD_KEY';
  end if;
  update public.orgs set data_key = p_data_key where id = p_org and data_key is null;
  if not found then
    raise exception 'KEY_EXISTS';
  end if;
end;
$$;

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
begin
  -- Etap C dopisze tu uprawnienia pracowników do wybranych tabel i rekordów.
  if not private.has_role(p_org, array['owner']) then
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
    -- Każda wartość pola musi być szyfrogramem aplikacji. Jawne dane są odrzucane.
    if exists (
      select 1 from jsonb_each(c -> 'patch') f
      where jsonb_typeof(f.value) <> 'string' or left(f.value #>> '{}', 3) <> 'e1:'
    ) then
      raise exception 'NOT_ENCRYPTED';
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

-- Dane zapisane przed włączeniem szyfrowania nie mogą zostać na serwerze w jawnej postaci.
-- Aplikacja po ustawieniu hasła wysyła wszystko ponownie w postaci zaszyfrowanej.
update public.records set data = '{}'::jsonb
where exists (select 1 from jsonb_each(data) f where jsonb_typeof(f.value) <> 'string' or left(f.value #>> '{}', 3) <> 'e1:');
update public.changes set patch = '{}'::jsonb
where exists (select 1 from jsonb_each(patch) f where jsonb_typeof(f.value) <> 'string' or left(f.value #>> '{}', 3) <> 'e1:');

revoke all on function public.create_org(text, jsonb) from public, anon;
revoke all on function public.set_org_key(uuid, jsonb) from public, anon;
grant execute on function public.create_org(text, jsonb) to authenticated;
grant execute on function public.set_org_key(uuid, jsonb) to authenticated;
