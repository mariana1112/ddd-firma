-- Konto księgowej (rola „ksiegowosc”): widzi zlecenia, zabiegi, koszty i przejazdy wszystkich regionów,
-- poprawia je (faktury, protokoły, koszty, kilometry, kwoty), ale nie zmienia ustawień firmy i nie wchodzi do panelu
-- admina. Admin zaprasza księgową kodem weryfikacyjnym, tak jak techników.

-- Rekordy: admin i księgowa wszystkie, pozostali swój aktywny region; ustawienia firmy (meta) wszyscy członkowie.
create or replace function private.can_see_record(p_org uuid, p_tbl text, p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_member(p_org)
     and (p_tbl = 'meta'
          or private.has_role(p_org, array['owner', 'ksiegowosc'])
          or (p_branch is not null and p_branch = private.my_branch(p_org)));
$$;

-- Regiony: księgowa widzi wszystkie (nazwy regionów przy zleceniach).
drop policy "Członkowie widzą swoje regiony" on public.branches;
create policy "Członkowie widzą swoje regiony" on public.branches
  for select to authenticated
  using (
    private.has_role(org_id, array['owner', 'ksiegowosc'])
    or id = private.my_branch(org_id)
    or exists (
      select 1 from public.member_branches mb
      where mb.org_id = branches.org_id and mb.user_id = (select auth.uid()) and mb.branch_id = branches.id
    )
  );

-- Zapis zmian: księgowa może zmieniać istniejące rekordy każdego regionu.
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

-- Kod weryfikacyjny także dla księgowej (bez regionu).
create or replace function public.create_signup_code(
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
  if p_role not in ('owner', 'technik', 'ksiegowosc') then
    raise exception 'BAD_INVITE';
  end if;
  if p_branch is null and p_role = 'technik' then
    raise exception 'BAD_BRANCH';
  end if;
  if p_branch is not null and not exists (select 1 from public.branches where id = p_branch and org_id = p_org) then
    raise exception 'BAD_BRANCH';
  end if;
  if p_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$' or p_proof_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_account_key) <> 'object' or p_account_key ->> 'wrapped' is null then
    raise exception 'BAD_INVITE';
  end if;
  if p_for_user is not null and not exists (select 1 from public.memberships where org_id = p_org and user_id = p_for_user) then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.invites (code, org_id, branch_id, role, created_by, proof_hash, account_key, for_user)
  values (p_code, p_org, p_branch, p_role, auth.uid(), p_proof_hash, p_account_key, p_for_user);
  return p_code;
end;
$$;
