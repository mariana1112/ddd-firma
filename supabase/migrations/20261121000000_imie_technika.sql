-- Admin zmienia imię i nazwisko konta w firmie (np. literówka albo pełne nazwisko). Zmiana dotyczy tylko nazwy
-- widocznej w aplikacji; e-mail i hasło zostają. Telefon technika przejmuje nowe imię przy najbliższej synchronizacji.

create function public.set_member_name(p_org uuid, p_user uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not private.has_role(p_org, array['owner']) then
    raise exception 'FORBIDDEN';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'BAD_NAME';
  end if;
  update public.memberships set display_name = v_name where org_id = p_org and user_id = p_user;
  if not found then
    raise exception 'FORBIDDEN';
  end if;
end;
$$;

revoke all on function public.set_member_name(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_name(uuid, uuid, text) to authenticated;
