-- Funkcja serwera „konta” działa kluczem serwisowym (rola service_role, tylko w środowisku Supabase). W tym projekcie
-- nowe tabele nie dostają uprawnień dla service_role automatycznie, więc funkcja nie widziała kodów: każda rejestracja
-- kończyła się BAD_INVITE, a usuwanie kont FORBIDDEN. Tylko niezbędne uprawnienia, wyłącznie dla service_role.

grant select, update on public.invites to service_role;
grant select, update, delete on public.memberships to service_role;
grant select, delete on public.member_branches to service_role;
