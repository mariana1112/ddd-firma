-- Test regionu zabiegu ze zlecenia (migracja 20261124000000_region_zabiegu_ze_zlecenia.sql).
-- Wszystko jest cofane wyjątkiem na końcu.
do $$
declare
  o uuid := gen_random_uuid();   -- admin, region R1
  t1 uuid := gen_random_uuid();  -- technik R1
  t2 uuid := gen_random_uuid();  -- technik R2
  org uuid;
  b1 uuid;
  b2 uuid;
  res text[] := '{}';
  n integer;
  br uuid;
  as_user text := 'select set_config(''request.jwt.claims'', json_build_object(''sub'', %L, ''role'', ''authenticated'')::text, true), set_config(''role'', ''authenticated'', true)';
  ch text := '{"status":"e1:p"}';
begin
  insert into auth.users (id, email, aud, role) values
    (o, 'o@test.invalid', 'authenticated', 'authenticated'),
    (t1, 't1@test.invalid', 'authenticated', 'authenticated'),
    (t2, 't2@test.invalid', 'authenticated', 'authenticated');
  insert into public.orgs (name) values ('Test regionu zabiegu') returning id into org;
  insert into public.branches (org_id, name) values (org, 'R1') returning id into b1;
  insert into public.branches (org_id, name) values (org, 'R2') returning id into b2;
  insert into public.memberships (org_id, user_id, role, branch_id, approved) values
    (org, o, 'owner', b1, true), (org, t1, 'technik', b1, true), (org, t2, 'technik', b2, true);

  -- Technik R2 zakłada zlecenie z1 (region R2).
  execute format(as_user, t2);
  perform public.sync_push(org, 'urz-t2', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'orders', 'recordId', 'z1', 'op', 'create', 'patch', '{"clientName":"e1:x"}'::jsonb, 'at', now())));

  -- Admin (R1) umawia kolejny zabieg zlecenia z1: zabieg trafia do R2, nie do R1.
  execute format(as_user, o);
  perform public.sync_push(org, 'urz-o', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'visits', 'recordId', 'w1', 'op', 'create', 'patch', ch::jsonb, 'at', now(), 'parent', 'z1'),
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'attachments', 'recordId', 'f1', 'op', 'create', 'patch', ch::jsonb, 'at', now(), 'parent', 'w1'),
    -- Stara wersja aplikacji (bez „parent”): jak dotąd region autora.
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'visits', 'recordId', 'w0', 'op', 'create', 'patch', ch::jsonb, 'at', now())));
  perform set_config('role', 'postgres', true);
  select branch_id into br from public.records where org_id = org and id = 'w1';
  res := array_append(res, 'zabieg admina w regionie zlecenia R2 (t): ' || (br = b2));
  select branch_id into br from public.records where org_id = org and id = 'f1';
  res := array_append(res, 'zdjęcie w regionie zabiegu R2 (t): ' || (br = b2));
  select branch_id into br from public.records where org_id = org and id = 'w0';
  res := array_append(res, 'bez parent region autora R1 (t): ' || (br = b1));

  -- Technik R2 widzi zabieg i zdjęcie zlecenia ze swojego regionu.
  execute format(as_user, t2);
  select count(*) into n from public.records where org_id = org and id in ('w1', 'f1');
  res := array_append(res, 'R2 widzi zabieg i zdjęcie (2): ' || n);

  -- Admin naprawia zabieg w złym regionie: pusta zmiana z parent przenosi go do R2.
  execute format(as_user, o);
  perform public.sync_push(org, 'urz-o', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'visits', 'recordId', 'w0', 'op', 'update', 'patch', '{}'::jsonb, 'at', now(), 'parent', 'z1')));
  perform set_config('role', 'postgres', true);
  select branch_id into br from public.records where org_id = org and id = 'w0';
  res := array_append(res, 'naprawa przenosi do R2 (t): ' || (br = b2));
  select count(*) into n from public.records where org_id = org and id = 'w0' and data ->> 'status' = 'e1:p';
  res := array_append(res, 'naprawa nie zmienia treści (1): ' || n);

  -- Technik R1 bez udostępnienia: zabieg z parent z1 (R2) zostaje w R1, bez udostępnienia dla niego.
  execute format(as_user, t1);
  perform public.sync_push(org, 'urz-t1', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'visits', 'recordId', 'w2', 'op', 'create', 'patch', ch::jsonb, 'at', now(), 'parent', 'z1')));
  perform set_config('role', 'postgres', true);
  select branch_id into br from public.records where org_id = org and id = 'w2';
  res := array_append(res, 'technik bez prawa do zlecenia: region własny R1 (t): ' || (br = b1));
  select count(*) into n from public.record_grants where org_id = org and record_id = 'w2';
  res := array_append(res, 'bez udostępnienia dla niego (0): ' || n);

  -- Technik R1 nie przeniesie cudzego zabiegu: aktualizacja w1 (R2) z parent jest pomijana.
  execute format(as_user, t1);
  perform public.sync_push(org, 'urz-t1', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'visits', 'recordId', 'w1', 'op', 'update', 'patch', '{"status":"e1:zle"}'::jsonb, 'at', now(), 'parent', 'z1')));
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.records where org_id = org and id = 'w1' and branch_id = b2 and data ->> 'status' = 'e1:p';
  res := array_append(res, 'cudzy zabieg bez zmian (1): ' || n);

  -- Admin udostępnia technikowi R1 zlecenie z1 (zastępstwo). Technik umawia kolejny zabieg: zabieg w R2, a technik
  -- dostaje do niego dostęp.
  execute format(as_user, o);
  perform public.set_record_access(org, t1, '[{"tbl":"orders","id":"z1"}]'::jsonb, true);
  execute format(as_user, t1);
  perform public.sync_push(org, 'urz-t1', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'visits', 'recordId', 'w3', 'op', 'create', 'patch', ch::jsonb, 'at', now(), 'parent', 'z1')));
  select count(*) into n from public.records where org_id = org and id = 'w3';
  res := array_append(res, 'zastępca widzi umówiony zabieg (1): ' || n);
  perform set_config('role', 'postgres', true);
  select branch_id into br from public.records where org_id = org and id = 'w3';
  res := array_append(res, 'zabieg zastępcy w regionie zlecenia R2 (t): ' || (br = b2));
  execute format(as_user, t2);
  select count(*) into n from public.records where org_id = org and id = 'w3';
  res := array_append(res, 'R2 widzi zabieg zastępcy (1): ' || n);

  -- Nieistniejący rodzic: region autora.
  perform public.sync_push(org, 'urz-t2', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'visits', 'recordId', 'w4', 'op', 'create', 'patch', ch::jsonb, 'at', now(), 'parent', 'nie-ma')));
  perform set_config('role', 'postgres', true);
  select branch_id into br from public.records where org_id = org and id = 'w4';
  res := array_append(res, 'nieistniejący rodzic: region autora R2 (t): ' || (br = b2));

  raise exception E'WYNIKI TESTU\n%', array_to_string(res, E'\n');
end;
$$;
