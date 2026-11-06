-- Funkcje pomocnicze polityk dostępu nie są potrzebne w API. Schemat private nie jest
-- udostępniany przez API Supabase, więc nikt nie wywoła ich bezpośrednio, a polityki działają dalej.
-- Polityki odwołują się do funkcji po identyfikatorze, więc przeniesienie ich nie psuje.
create schema if not exists private;
grant usage on schema private to authenticated;

alter function public.is_member(uuid) set schema private;
alter function public.has_role(uuid, text[]) set schema private;
alter function public.path_org(text) set schema private;

-- sync_push i reserve_numbers wołają has_role po nazwie, więc muszą wskazywać nowe miejsce.
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

create or replace function public.reserve_numbers(p_org uuid, p_series text, p_min_next integer, p_count integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  if not private.has_role(p_org, array['owner']) then
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
