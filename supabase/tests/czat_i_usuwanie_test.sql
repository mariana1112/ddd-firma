-- Test czatu i usuwania (migracja 20261120000000_czat_i_usuwanie.sql). Wszystko jest cofane wyjątkiem na końcu.
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
  as_user text := 'select set_config(''request.jwt.claims'', json_build_object(''sub'', %L, ''role'', ''authenticated'')::text, true), set_config(''role'', ''authenticated'', true)';
begin
  insert into auth.users (id, email, aud, role) values
    (o, 'o@test.invalid', 'authenticated', 'authenticated'),
    (t1, 't1@test.invalid', 'authenticated', 'authenticated'),
    (t2, 't2@test.invalid', 'authenticated', 'authenticated');
  insert into public.orgs (name) values ('Test czatu') returning id into org;
  insert into public.branches (org_id, name) values (org, 'R1') returning id into b1;
  insert into public.branches (org_id, name) values (org, 'R2') returning id into b2;
  insert into public.memberships (org_id, user_id, role, branch_id, approved) values
    (org, o, 'owner', b1, true), (org, t1, 'technik', b1, true), (org, t2, 'technik', b2, true);

  -- Technik R1: zlecenie i wiadomość na czacie.
  execute format(as_user, t1);
  perform public.sync_push(org, 'urz-t1', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'orders', 'recordId', 'z1', 'op', 'create', 'patch', '{"clientName":"e1:x"}'::jsonb, 'at', now()),
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'messages', 'recordId', 'm1', 'op', 'create', 'patch', '{"text":"e1:hej"}'::jsonb, 'at', now())));
  -- Próba usunięcia własnego zlecenia przez technika: ignorowana.
  perform public.sync_push(org, 'urz-t1', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'orders', 'recordId', 'z1', 'op', 'delete', 'patch', '{"deletedAt":"e1:teraz"}'::jsonb, 'at', now())));
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.records where org_id = org and id = 'z1' and data ? 'deletedAt';
  res := array_append(res, 'usunięcie przez technika przyjęte: ' || n);

  -- Technik z innego regionu widzi wiadomość, ale nie zlecenie.
  execute format(as_user, t2);
  select count(*) into n from public.records where org_id = org and tbl = 'messages';
  res := array_append(res, 'technik R2 widzi wiadomości: ' || n);
  select count(*) into n from public.records where org_id = org and tbl = 'orders';
  res := array_append(res, 'technik R2 widzi zlecenia R1: ' || n);

  -- Admin usuwa zlecenie.
  execute format(as_user, o);
  perform public.sync_push(org, 'urz-o', 999, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'orders', 'recordId', 'z1', 'op', 'delete', 'patch', '{"deletedAt":"e1:teraz"}'::jsonb, 'at', now())));
  perform set_config('role', 'postgres', true);
  select count(*) into n from public.records where org_id = org and id = 'z1' and data ? 'deletedAt';
  res := array_append(res, 'usunięcie przez admina przyjęte: ' || n);

  raise exception E'WYNIKI TESTU\n%', array_to_string(res, E'\n');
end;
$$;
