-- Test udostępniania jednego zlecenia technikowi z innego regionu (migracja 20261122000000_zlecenie_dla_technika.sql).
-- Wszystko jest cofane wyjątkiem na końcu.
do $$
declare
  o uuid := gen_random_uuid();   -- admin
  t1 uuid := gen_random_uuid();  -- technik R1
  t2 uuid := gen_random_uuid();  -- technik R2
  org uuid;
  b1 uuid;
  b2 uuid;
  res text[] := '{}';
  n integer;
  r0 bigint;
  r1 bigint;
  ok boolean;
  as_user text := 'select set_config(''request.jwt.claims'', json_build_object(''sub'', %L, ''role'', ''authenticated'')::text, true), set_config(''role'', ''authenticated'', true)';
begin
  insert into auth.users (id, email, aud, role) values
    (o, 'o@test.invalid', 'authenticated', 'authenticated'),
    (t1, 't1@test.invalid', 'authenticated', 'authenticated'),
    (t2, 't2@test.invalid', 'authenticated', 'authenticated');
  insert into public.orgs (name) values ('Test udostępnienia') returning id into org;
  insert into public.branches (org_id, name) values (org, 'R1') returning id into b1;
  insert into public.branches (org_id, name) values (org, 'R2') returning id into b2;
  insert into public.memberships (org_id, user_id, role, branch_id, approved) values
    (org, o, 'owner', b1, true), (org, t1, 'technik', b1, true), (org, t2, 'technik', b2, true);

  -- Technik R1: dwa zlecenia i zabieg.
  execute format(as_user, t1);
  perform public.sync_push(org, 'urz-t1', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'orders', 'recordId', 'z1', 'op', 'create', 'patch', '{"clientName":"e1:x"}'::jsonb, 'at', now()),
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'orders', 'recordId', 'z2', 'op', 'create', 'patch', '{"clientName":"e1:y"}'::jsonb, 'at', now()),
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'visits', 'recordId', 'w1', 'op', 'create', 'patch', '{"status":"e1:p"}'::jsonb, 'at', now())));

  -- Przed udostępnieniem technik R2 nic nie widzi.
  execute format(as_user, t2);
  select count(*) into n from public.records where org_id = org and tbl in ('orders', 'visits');
  res := array_append(res, 'R2 przed udostępnieniem widzi (0): ' || n);

  -- Technik nie może sam sobie udostępnić.
  begin
    perform public.set_record_access(org, t2, '[{"tbl":"orders","id":"z1"}]'::jsonb, true);
    res := array_append(res, 'technik udostępnił sobie: TAK (BŁĄD)');
  exception when others then
    res := array_append(res, 'technik udostępnił sobie: nie (' || sqlerrm || ')');
  end;

  -- Admin udostępnia z1 i w1 technikowi R2.
  perform set_config('role', 'postgres', true);
  select rev into r0 from public.records where org_id = org and tbl = 'orders' and id = 'z1';
  execute format(as_user, o);
  perform public.set_record_access(org, t2, '[{"tbl":"orders","id":"z1"},{"tbl":"visits","id":"w1"}]'::jsonb, true);
  perform set_config('role', 'postgres', true);
  select rev into r1 from public.records where org_id = org and tbl = 'orders' and id = 'z1';
  res := array_append(res, 'rev podbity (t): ' || (r1 > r0));

  execute format(as_user, t2);
  select count(*) into n from public.records where org_id = org and tbl in ('orders', 'visits');
  res := array_append(res, 'R2 po udostępnieniu widzi (2): ' || n);
  select count(*) into n from public.records where org_id = org and id = 'z2';
  res := array_append(res, 'R2 widzi inne zlecenie R1 (0): ' || n);

  -- Technik R2 kończy zabieg; zabieg zostaje w regionie R1. Usunąć go nie może.
  perform public.sync_push(org, 'urz-t2', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'visits', 'recordId', 'w1', 'op', 'update', 'patch', '{"status":"e1:w"}'::jsonb, 'at', now()),
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'orders', 'recordId', 'z2', 'op', 'update', 'patch', '{"clientName":"e1:zle"}'::jsonb, 'at', now()),
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'orders', 'recordId', 'z1', 'op', 'delete', 'patch', '{"deletedAt":"e1:teraz"}'::jsonb, 'at', now())));
  perform set_config('role', 'postgres', true);
  select (data ->> 'status') = 'e1:w' and branch_id = b1 into ok from public.records where org_id = org and id = 'w1';
  res := array_append(res, 'zmiana zabiegu przyjęta, region R1 (t): ' || ok);
  select (data ->> 'clientName') = 'e1:y' into ok from public.records where org_id = org and id = 'z2';
  res := array_append(res, 'zmiana nieudostępnionego odrzucona (t): ' || ok);
  select count(*) into n from public.records where org_id = org and id = 'z1' and data ? 'deletedAt';
  res := array_append(res, 'usunięcie przez technika R2 (0): ' || n);

  -- Technik R1 (region zlecenia) nadal widzi wszystko ze swojego regionu.
  execute format(as_user, t1);
  select count(*) into n from public.records where org_id = org and tbl in ('orders', 'visits');
  res := array_append(res, 'R1 widzi (3): ' || n);
  select count(*) into n from public.record_grants;
  res := array_append(res, 'R1 widzi cudze udostępnienia (0): ' || n);

  -- Admin odbiera udostępnienie.
  execute format(as_user, o);
  perform public.set_record_access(org, t2, '[{"tbl":"orders","id":"z1"},{"tbl":"visits","id":"w1"}]'::jsonb, false);
  execute format(as_user, t2);
  select count(*) into n from public.records where org_id = org and tbl in ('orders', 'visits');
  res := array_append(res, 'R2 po odebraniu widzi (0): ' || n);
  perform public.sync_push(org, 'urz-t2', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'visits', 'recordId', 'w1', 'op', 'update', 'patch', '{"status":"e1:po"}'::jsonb, 'at', now())));
  perform set_config('role', 'postgres', true);
  select (data ->> 'status') = 'e1:w' into ok from public.records where org_id = org and id = 'w1';
  res := array_append(res, 'zapis po odebraniu odrzucony (t): ' || ok);

  raise exception E'WYNIKI TESTU\n%', array_to_string(res, E'\n');
end;
$$;
