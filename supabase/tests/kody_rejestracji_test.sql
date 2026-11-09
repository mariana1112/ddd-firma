-- Test kodów weryfikacyjnych (migracja 20261114000000_kody_rejestracji.sql). Wszystko jest cofane: blok kończy się
-- wyjątkiem z wynikami, więc w bazie nie zostaje żaden ślad. Uruchamiać w edytorze SQL Supabase.
do $$
declare
  o uuid := gen_random_uuid();   -- admin
  t uuid := gen_random_uuid();   -- technik firmy
  n uuid := gen_random_uuid();   -- nowe konto założone z kodem
  x uuid := gen_random_uuid();   -- obce konto
  y uuid := gen_random_uuid();   -- konto z kodem admina
  org uuid;
  b1 uuid;
  b2 uuid;
  res text[] := '{}';
  r uuid;
  m public.memberships;
  h text := encode(sha256(convert_to('dowod-1', 'UTF8')), 'hex');
  k jsonb := '{"wrapped":"x","salt":"y","iv":"z"}';
  as_user text := 'select set_config(''request.jwt.claims'', json_build_object(''sub'', %L, ''role'', ''authenticated'')::text, true), set_config(''role'', ''authenticated'', true)';
begin
  insert into auth.users (id, email, aud, role) values
    (o, 'o@test.invalid', 'authenticated', 'authenticated'),
    (t, 't@test.invalid', 'authenticated', 'authenticated'),
    (n, 'n@test.invalid', 'authenticated', 'authenticated'),
    (x, 'x@test.invalid', 'authenticated', 'authenticated'),
    (y, 'y@test.invalid', 'authenticated', 'authenticated');
  insert into public.orgs (name) values ('Test kodów') returning id into org;
  insert into public.branches (org_id, name) values (org, 'R1') returning id into b1;
  insert into public.branches (org_id, name) values (org, 'R2') returning id into b2;
  insert into public.memberships (org_id, user_id, role, branch_id, approved) values (org, o, 'owner', b1, true), (org, t, 'technik', b1, true);
  insert into public.member_branches (org_id, user_id, branch_id) values (org, t, b1);

  -- Technik nie generuje kodów.
  execute format(as_user, t);
  begin
    perform public.create_signup_code(org, b2, 'technik', 'AAAAAAAA', h, k, null);
    res := array_append(res, ('BŁĄD: technik wygenerował kod')::text);
  exception when others then
    res := array_append(res, (('technik bez kodu: ' || sqlerrm))::text);
  end;

  -- Admin: kod do regionu, kod drugiego admina; złe dane odrzucone.
  execute format(as_user, o);
  perform public.create_signup_code(org, b2, 'technik', 'ABCDEFGH', h, k, null);
  perform public.create_signup_code(org, b2, 'technik', 'BCDEFGHJ', h, k, null);
  perform public.create_signup_code(org, null, 'owner', 'CDEFGHJK', h, k, null);
  res := array_append(res, ('admin wygenerował 3 kody')::text);
  begin
    perform public.create_signup_code(org, null, 'technik', 'DEFGHJKM', h, k, null);
    res := array_append(res, ('BŁĄD: kod technika bez regionu')::text);
  exception when others then
    res := array_append(res, (('kod technika bez regionu: ' || sqlerrm))::text);
  end;
  begin
    perform public.create_signup_code(org, b2, 'technik', 'ABCDEFGHJK', h, k, null);
    res := array_append(res, ('BŁĄD: 10-znakowy identyfikator')::text);
  exception when others then
    res := array_append(res, (('zły identyfikator: ' || sqlerrm))::text);
  end;
  begin
    perform public.create_signup_code(org, b2, 'technik', 'EFGHJKMN', h, '{}', null);
    res := array_append(res, ('BŁĄD: kod bez klucza')::text);
  exception when others then
    res := array_append(res, (('kod bez klucza: ' || sqlerrm))::text);
  end;

  -- Rejestracja (funkcja „konta”) przypisuje kod do nowego konta.
  perform set_config('role', 'postgres', true);
  update public.invites set for_user = n where code = 'ABCDEFGH';

  -- Obce konto nie widzi kodu przypisanego do innego konta.
  execute format(as_user, x);
  begin
    perform public.invite_preview('ABCDEFGH');
    res := array_append(res, ('BŁĄD: obce konto widzi kod')::text);
  exception when others then
    res := array_append(res, (('obce konto: ' || sqlerrm))::text);
  end;

  -- Nowe konto: zły dowód liczy próbę, dobry dołącza od razu do regionu z kodu.
  execute format(as_user, n);
  r := public.join_with_invite('ABCDEFGH', 'Nowy', 'zly-dowod');
  res := array_append(res, (('zły dowód: ' || coalesce(r::text, 'null')))::text);
  r := public.join_with_invite('ABCDEFGH', 'Nowy', 'dowod-1');
  perform set_config('role', 'postgres', true);
  select * into m from public.memberships where user_id = n;
  res := array_append(res, (format('nowe konto: firma %s, rola %s, zatwierdzone %s, region R2 %s, regiony %s, próby %s',
    r = org, m.role, m.approved, m.branch_id = b2,
    (select count(*) from public.member_branches where user_id = n and branch_id = b2),
    (select attempts from public.invites where code = 'ABCDEFGH')))::text);

  -- Ten sam kod drugi raz nie działa.
  execute format(as_user, n);
  begin
    perform public.join_with_invite('ABCDEFGH', 'Nowy', 'dowod-1');
    res := array_append(res, ('BŁĄD: kod użyty dwa razy')::text);
  exception when others then
    res := array_append(res, (('kod drugi raz: ' || sqlerrm))::text);
  end;

  -- Istniejący technik: kod regionu dodaje region (nowy telefon / kolejny region), bez zmiany roli.
  execute format(as_user, t);
  r := public.join_with_invite('BCDEFGHJ', '', 'dowod-1');
  perform set_config('role', 'postgres', true);
  select * into m from public.memberships where user_id = t;
  res := array_append(res, (format('technik: rola %s, zatwierdzony %s, regiony %s',
    m.role, m.approved, (select count(*) from public.member_branches where user_id = t)))::text);

  -- Kod admina: nowe konto zostaje adminem bez regionu.
  execute format(as_user, y);
  r := public.join_with_invite('CDEFGHJK', 'Drugi admin', 'dowod-1');
  perform set_config('role', 'postgres', true);
  select * into m from public.memberships where user_id = y;
  res := array_append(res, (format('kod admina: rola %s, zatwierdzony %s, bez regionu %s', m.role, m.approved, m.branch_id is null))::text);

  raise exception E'WYNIKI TESTU\n%', array_to_string(res, E'\n');
end;
$$;
