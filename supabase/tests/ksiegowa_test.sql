-- Test roli księgowej (migracja 20261117000000_ksiegowa.sql). Wszystko jest cofane wyjątkiem na końcu.
do $$
declare
  o uuid := gen_random_uuid();   -- admin
  t uuid := gen_random_uuid();   -- technik regionu R1
  k uuid := gen_random_uuid();   -- księgowa (bez regionu)
  org uuid;
  b1 uuid;
  b2 uuid;
  res text[] := '{}';
  n integer;
  v text;
  as_user text := 'select set_config(''request.jwt.claims'', json_build_object(''sub'', %L, ''role'', ''authenticated'')::text, true), set_config(''role'', ''authenticated'', true)';
  change jsonb;
begin
  insert into auth.users (id, email, aud, role) values
    (o, 'o@test.invalid', 'authenticated', 'authenticated'),
    (t, 't@test.invalid', 'authenticated', 'authenticated'),
    (k, 'k@test.invalid', 'authenticated', 'authenticated');
  insert into public.orgs (name) values ('Test księgowej') returning id into org;
  insert into public.branches (org_id, name) values (org, 'R1') returning id into b1;
  insert into public.branches (org_id, name) values (org, 'R2') returning id into b2;
  insert into public.memberships (org_id, user_id, role, branch_id, approved) values
    (org, o, 'owner', b1, true), (org, t, 'technik', b1, true), (org, k, 'ksiegowosc', null, true);
  insert into public.member_branches (org_id, user_id, branch_id) values (org, t, b1);
  -- Rekord w regionie R2 i ustawienia firmy.
  insert into public.records (org_id, tbl, id, data, rev, branch_id) values
    (org, 'orders', 'z-r2', '{"clientName":"e1:stare"}', nextval('public.record_rev'), b2),
    (org, 'meta', 'company', '{"name":"e1:firma"}', nextval('public.record_rev'), null);

  -- Księgowa widzi rekordy wszystkich regionów i wszystkie regiony.
  execute format(as_user, k);
  select count(*) into n from public.records where org_id = org;
  res := array_append(res, 'księgowa widzi rekordów: ' || n);
  select count(*) into n from public.branches where org_id = org;
  res := array_append(res, 'księgowa widzi regionów: ' || n);

  -- Księgowa poprawia rekord regionu R2, ale nie ustawienia firmy.
  change := jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'orders', 'recordId', 'z-r2', 'op', 'update', 'patch', '{"clientName":"e1:poprawione"}'::jsonb, 'at', now()),
    jsonb_build_object('id', gen_random_uuid(), 'tbl', 'meta', 'recordId', 'company', 'op', 'put', 'patch', '{"name":"e1:zmiana"}'::jsonb, 'at', now()));
  perform public.sync_push(org, 'urz-k', 999, change);
  perform set_config('role', 'postgres', true);
  select data ->> 'clientName' into v from public.records where org_id = org and id = 'z-r2';
  res := array_append(res, 'rekord R2 po poprawce księgowej: ' || v);
  select data ->> 'name' into v from public.records where org_id = org and id = 'company';
  res := array_append(res, 'ustawienia firmy po próbie księgowej: ' || v);

  -- Technik z R1 nie zmieni rekordu R2 i go nie widzi.
  execute format(as_user, t);
  select count(*) into n from public.records where org_id = org and id = 'z-r2';
  res := array_append(res, 'technik R1 widzi rekord R2: ' || n);
  change := jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'tbl', 'orders', 'recordId', 'z-r2', 'op', 'update', 'patch', '{"clientName":"e1:technik"}'::jsonb, 'at', now()));
  perform public.sync_push(org, 'urz-t', 999, change);
  perform set_config('role', 'postgres', true);
  select data ->> 'clientName' into v from public.records where org_id = org and id = 'z-r2';
  res := array_append(res, 'rekord R2 po próbie technika: ' || v);

  -- Kod dla księgowej bez regionu; technik bez regionu dalej odrzucony; księgowa nie generuje kodów.
  execute format(as_user, o);
  perform public.create_signup_code(org, null, 'ksiegowosc', 'KSGWABCD', repeat('a', 64), '{"wrapped":"x"}', null);
  res := array_append(res, 'kod dla księgowej: utworzony');
  begin
    perform public.create_signup_code(org, null, 'technik', 'TECHABCD', repeat('a', 64), '{"wrapped":"x"}', null);
    res := array_append(res, 'BŁĄD: kod technika bez regionu');
  exception when others then
    res := array_append(res, 'kod technika bez regionu: ' || sqlerrm);
  end;
  execute format(as_user, k);
  begin
    perform public.create_signup_code(org, b1, 'technik', 'KSGWEFGH', repeat('a', 64), '{"wrapped":"x"}', null);
    res := array_append(res, 'BŁĄD: księgowa wygenerowała kod');
  exception when others then
    res := array_append(res, 'księgowa a kody: ' || sqlerrm);
  end;

  raise exception E'WYNIKI TESTU\n%', array_to_string(res, E'\n');
end;
$$;
