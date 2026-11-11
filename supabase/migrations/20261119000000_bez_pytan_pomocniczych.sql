-- Bez pytań pomocniczych: reset hasła linkiem z e-maila wystarcza. Konto admina nie jest już blokowane po prośbie
-- o reset hasła (private.has_role i recovery_status korzystają z private.recovery_pending, które zawsze zwraca false),
-- a zapisane skróty odpowiedzi są usuwane.

create or replace function private.recovery_pending(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;

delete from private.recovery_answers;
