-- Zarządzanie kontami w panelu admina: zawieszenie (tymczasowa blokada), przywrócenie, usunięcie także drugiego admina.
--
-- Zawieszone konto zostaje w firmie, ale nie czyta ani nie zapisuje żadnych danych (private.is_member i has_role
-- zwracają false), dopóki admin go nie przywróci. Admin nie zawiesi ani nie usunie samego siebie.

alter table public.memberships add column suspended boolean not null default false;

create or replace function private.is_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.approved and not m.suspended
  );
$$;

create or replace function private.has_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.approved and not m.suspended
      and m.role = any (p_roles)
      and (m.role <> 'owner' or not private.recovery_pending((select auth.uid())))
  );
$$;

-- Zawieszenie albo przywrócenie konta przez admina.
create function public.suspend_member(p_org uuid, p_user uuid, p_suspended boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org, array['owner']) or p_user = auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  update public.memberships set suspended = coalesce(p_suspended, false) where org_id = p_org and user_id = p_user;
  if not found then
    raise exception 'FORBIDDEN';
  end if;
end;
$$;

-- Odrzucenie prośby albo usunięcie konta z firmy, także drugiego admina. Siebie usunąć nie można.
create or replace function public.remove_member(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(p_org, array['owner']) or p_user = auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  delete from public.member_branches where org_id = p_org and user_id = p_user;
  delete from public.memberships where org_id = p_org and user_id = p_user;
  if not found then
    raise exception 'FORBIDDEN';
  end if;
end;
$$;

revoke all on function public.suspend_member(uuid, uuid, boolean) from public, anon;
grant execute on function public.suspend_member(uuid, uuid, boolean) to authenticated;
