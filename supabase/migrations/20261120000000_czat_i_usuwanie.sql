-- Czat (księgowość, cała firma, region) i usuwanie zleceń tylko przez admina.
--
-- - Wiadomości czatu to zwykłe zaszyfrowane rekordy (tbl = 'messages'). Widzą je wszyscy członkowie firmy, bo czat
--   łączy regiony i księgową; serwer i tak nie zna ich treści.
-- - Usunięcie zlecenia albo zabiegu (op delete/purge) przyjmuje tylko od admina. Technik prosi o usunięcie
--   (pole w zleceniu), a admin zatwierdza w powiadomieniach.

create or replace function private.can_see_record(p_org uuid, p_tbl text, p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_member(p_org)
     and (p_tbl in ('meta', 'messages')
          or private.has_role(p_org, array['owner', 'ksiegowosc'])
          or (p_branch is not null and p_branch = private.my_branch(p_org)));
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
      continue when not v_all and v_existing.branch_id is distinct from v_branch;
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
