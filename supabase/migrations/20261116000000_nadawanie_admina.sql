-- Admin nadaje innemu kontu uprawnienia admina albo je odbiera. Siebie zmienić nie może, więc w firmie zawsze
-- zostaje co najmniej jeden admin. Technik musi mieć region: konto admina bez regionu dostaje przy odebraniu
-- uprawnień pierwszy region, do którego ma dostęp (bez regionu odebranie jest odrzucane).

create function public.set_member_role(p_org uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.memberships;
  v_branch uuid;
begin
  if not private.has_role(p_org, array['owner']) or p_user = auth.uid() then
    raise exception 'FORBIDDEN';
  end if;
  if p_role not in ('owner', 'technik') then
    raise exception 'BAD_ROLE';
  end if;
  select * into v_member from public.memberships where org_id = p_org and user_id = p_user;
  if v_member.user_id is null or not v_member.approved then
    raise exception 'FORBIDDEN';
  end if;
  v_branch := v_member.branch_id;
  if p_role = 'technik' and v_branch is null then
    select branch_id into v_branch from public.member_branches where org_id = p_org and user_id = p_user limit 1;
    if v_branch is null then
      raise exception 'BAD_BRANCH';
    end if;
  end if;
  update public.memberships set role = p_role, branch_id = v_branch where org_id = p_org and user_id = p_user;
end;
$$;

revoke all on function public.set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
