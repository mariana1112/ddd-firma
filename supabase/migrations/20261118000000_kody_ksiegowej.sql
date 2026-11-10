-- Kody weryfikacyjne dla księgowej: tabela kodów dopuszczała dotąd tylko role admina i technika.
alter table public.invites drop constraint invites_role_check;
alter table public.invites add constraint invites_role_check check (role in ('owner', 'technik', 'ksiegowosc'));
