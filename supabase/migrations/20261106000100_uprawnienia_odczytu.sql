-- Nowe projekty Supabase nie nadają rolom API uprawnień do nowych tabel automatycznie.
-- Zalogowani dostają prawo odczytu, a które wiersze widzą, nadal rozstrzygają polityki RLS.
-- Rola anon (gość z kluczem publicznym) nie dostaje niczego. Zapis idzie wyłącznie przez funkcje.
grant usage on schema public to authenticated;
grant select on public.orgs, public.memberships, public.records, public.changes, public.app_config to authenticated;
revoke all on public.orgs, public.memberships, public.records, public.changes, public.number_counters, public.app_config from anon;
