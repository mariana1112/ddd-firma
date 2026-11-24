-- Zabieg należy do regionu swojego zlecenia, a zdjęcie do regionu swojego zabiegu.
--
-- Dotąd nowy rekord dostawał region osoby, która go zapisała. Kolejny zabieg umówiony przez kogoś z innego regionu
-- (zastępstwo, admin z innym regionem, telefon przełączony na inny region) trafiał więc do innego regionu niż jego
-- zlecenie, a technicy z regionu zlecenia go nie dostawali (nie było go w ich kalendarzu).
--
-- Dane są szyfrowane, więc serwer nie zna zlecenia zabiegu. Aplikacja dołącza do zmiany jawny identyfikator rodzica
-- („parent”: losowy identyfikator zlecenia albo zabiegu, bez danych klienta). Serwer bierze region rodzica, gdy:
-- - rodzic istnieje w tej firmie i ma region,
-- - autor może zmieniać rodzica (admin/księgowa, ten sam region albo udostępnienie).
-- Rodzica serwer wybiera sam według tabeli (zabieg -> zlecenie, zdjęcie -> zabieg), więc nie da się wskazać innego.
-- Istniejący rekord w złym regionie przenosi się do regionu rodzica przy zapisie z „parent”, o ile autor i tak może
-- ten rekord zmieniać (aplikacja admina wysyła taki zapis raz dla każdego zabiegu w złym regionie).

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
  v_parent public.records;
  v_parent_tbl text;
  v_parent_branch uuid;
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

    -- Region rodzica (zabieg -> zlecenie, zdjęcie -> zabieg), gdy autor może rodzica zmieniać.
    v_parent_branch := null;
    v_parent_tbl := case c ->> 'tbl' when 'visits' then 'orders' when 'attachments' then 'visits' end;
    if v_parent_tbl is not null and jsonb_typeof(c -> 'parent') = 'string' then
      select * into v_parent from public.records
      where org_id = p_org and tbl = v_parent_tbl and id = c ->> 'parent' and not purged;
      if v_parent.id is not null and v_parent.branch_id is not null
         and (v_all or v_parent.branch_id = v_branch or private.has_record_grant(p_org, v_parent_tbl, v_parent.id)) then
        v_parent_branch := v_parent.branch_id;
        -- Technik z innego regionu z udostępnionym zleceniem umawia kolejny zabieg: zabieg idzie do regionu zlecenia,
        -- a technik dostaje do niego dostęp jak do udostępnionego (inaczej straciłby zabieg, który sam umówił).
        if c ->> 'tbl' = 'visits' and v_existing.id is null and not v_all and v_parent.branch_id is distinct from v_branch then
          insert into public.record_grants (org_id, tbl, record_id, user_id, granted_by)
          values (p_org, 'visits', c ->> 'recordId', auth.uid(), auth.uid())
          on conflict do nothing;
        end if;
      end if;
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
      values (p_org, c ->> 'tbl', c ->> 'recordId', '{}'::jsonb, v_rev, true, auth.uid(), coalesce(v_parent_branch, v_branch))
      on conflict (org_id, tbl, id) do update
        set data = '{}'::jsonb, rev = excluded.rev, purged = true,
            updated_by = excluded.updated_by, updated_at = now();
    else
      -- Nowy rekord należy do regionu rodzica (zabieg, zdjęcie), a bez niego do regionu autora. Zmiana nadpisuje tylko
      -- pola, które zawiera; z „parent” przenosi rekord do regionu rodzica.
      insert into public.records (org_id, tbl, id, data, rev, updated_by, branch_id)
      values (p_org, c ->> 'tbl', c ->> 'recordId', c -> 'patch', v_rev, auth.uid(),
              case when c ->> 'tbl' = 'meta' then null else coalesce(v_parent_branch, v_branch) end)
      on conflict (org_id, tbl, id) do update
        set data = public.records.data || excluded.data, rev = excluded.rev,
            updated_by = excluded.updated_by, updated_at = now(),
            branch_id = coalesce(v_parent_branch, public.records.branch_id)
        where not public.records.purged;
    end if;
    v_last := v_rev;
  end loop;
  return v_last;
end;
$$;
