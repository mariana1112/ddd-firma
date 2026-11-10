-- Test nadawania admina (migracja 20261116000000_nadawanie_admina.sql). Wszystko jest cofane wyjątkiem na końcu.
do $$
declare
  o uuid := gen_random_uuid();   -- admin
  t uuid := gen_random_uuid();   -- technik
  org uuid;
  b1 uuid;
  res text[] := '{}';
  m public.memberships;
  as_user text := 'select set_config(''request.jwt.claims'', json_build_object(''sub'', %L, ''role'', ''authenticated'')::text, true), set_config(''role'', ''authenticated'', true)';
begin
  insert into auth.users (id, email, aud, role) values
    (o, 'o@test.invalid', 'authenticated', 'authenticated'),
    (t, 't@test.invalid', 'authenticated', 'authenticated');
  insert into public.orgs (name) values ('Test ról') returning id into org;
  insert into public.branches (org_id, name) values (org, 'R1') returning id into b1;
  insert into public.memberships (org_id, user_id, role, branch_id, approved) values (org, o, 'owner', b1, true), (org, t, 'technik', b1, true);
  insert into public.member_branches (org_id, user_id, branch_id) values (org, t, b1);

  -- Technik nie nadaje sobie admina.
  execute format(as_user, t);
  begin
    perform public.set_member_role(org, t, 'owner');
    res := array_append(res, 'BŁĄD: technik dał sobie admina');
  exception when others then
    res := array_append(res, 'technik sam sobie: ' || sqlerrm);
  end;

  -- Admin nadaje i odbiera; siebie zmienić nie może.
  execute format(as_user, o);
  perform public.set_member_role(org, t, 'owner');
  perform set_config('role', 'postgres', true);
  select * into m from public.memberships where user_id = t;
  res := array_append(res, 'po nadaniu: ' || m.role);
  execute format(as_user, o);
  perform public.set_member_role(org, t, 'technik');
  perform set_config('role', 'postgres', true);
  select * into m from public.memberships where user_id = t;
  res := array_append(res, format('po odebraniu: %s, region %s', m.role, m.branch_id = b1));
  execute format(as_user, o);
  begin
    perform public.set_member_role(org, o, 'technik');
    res := array_append(res, 'BŁĄD: admin odebrał admina sobie');
  exception when others then
    res := array_append(res, 'admin sam sobie: ' || sqlerrm);
  end;
  begin
    perform public.set_member_role(org, t, 'ksiegowosc');
    res := array_append(res, 'BŁĄD: nieznana rola');
  exception when others then
    res := array_append(res, 'zła rola: ' || sqlerrm);
  end;

  raise exception E'WYNIKI TESTU\n%', array_to_string(res, E'\n');
end;
$$;
