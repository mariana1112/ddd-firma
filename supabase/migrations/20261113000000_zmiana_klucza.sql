-- Zmiana hasła szyfrowania (klucza firmy) przez admina, np. gdy nikt nie pamięta starego hasła.
--
-- Urządzenie admina, które ma klucz i wszystkie dane, tworzy nowy klucz z nowego hasła, zapisuje go tutaj
-- i wysyła wszystkie rekordy oraz zdjęcia ponownie, zaszyfrowane nowym kluczem. Serwer dalej nie zna hasła
-- ani klucza. Niewykorzystane kody dołączenia znikają, bo niosą dowody i klucze liczone starym kluczem.
-- Inne urządzenia odblokowuje się potem nowym hasłem.

create function public.replace_org_key(p_org uuid, p_data_key jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  if jsonb_typeof(p_data_key) <> 'object' or p_data_key ->> 'wrapped' is null then
    raise exception 'BAD_KEY';
  end if;
  update public.orgs set data_key = p_data_key where id = p_org;
  delete from public.invites where org_id = p_org and used_by is null;
end;
$$;

revoke all on function public.replace_org_key(uuid, jsonb) from public, anon;
grant execute on function public.replace_org_key(uuid, jsonb) to authenticated;
