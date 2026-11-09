-- Odzyskiwanie konta admina: link z e-maila (Supabase Auth) i pytania pomocnicze jako drugi krok.
--
-- Odpowiedzi leżą tylko jako skróty bcrypt, bez rozróżniania wielkości liter i nadmiarowych spacji. Tabela jest
-- w schemacie private: nikt nie czyta jej bezpośrednio, tylko przez funkcje poniżej.
--
-- Pytania są egzekwowane na serwerze, nie tylko w aplikacji: po każdej prośbie o reset hasła
-- (auth.users.recovery_sent_at) konto traci uprawnienia admina (private.has_role z rolą owner), dopóki ktoś
-- nie odpowie poprawnie na pytania. Kto przejmie samą skrzynkę e-mail i ustawi nowe hasło, widzi najwyżej
-- region admina, a nie całą firmę. Po 5 błędnych odpowiedziach pytania blokują się na godzinę.

create extension if not exists pgcrypto with schema extensions;

create table private.recovery_answers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Skróty bcrypt trzech odpowiedzi, w kolejności pytań.
  answers text[] not null,
  verified_at timestamptz not null default now(),
  failed integer not null default 0,
  locked_until timestamptz
);

alter table private.recovery_answers enable row level security;
revoke all on private.recovery_answers from public, anon, authenticated;

create function private.norm_answer(p_answer text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(trim(coalesce(p_answer, '')), '\s+', ' ', 'g'));
$$;

-- Prośba o reset hasła po ostatnim poprawnym potwierdzeniu pytaniami. Bez ustawionych pytań nic nie blokuje.
create function private.recovery_pending(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.recovery_answers r
    join auth.users u on u.id = r.user_id
    where r.user_id = p_user and u.recovery_sent_at is not null and u.recovery_sent_at > r.verified_at
  );
$$;

revoke all on function private.norm_answer(text), private.recovery_pending(uuid) from public, anon;
grant execute on function private.norm_answer(text), private.recovery_pending(uuid) to authenticated;

-- Rola admina (owner) działa dopiero po potwierdzeniu pytaniami, jeśli od tego czasu ktoś prosił o reset hasła.
create or replace function private.has_role(p_org uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.approved and m.role = any (p_roles)
      and (m.role <> 'owner' or not private.recovery_pending((select auth.uid())))
  );
$$;

-- Stan pytań dla zalogowanego konta: czy są ustawione, czy czekają na potwierdzenie i do kiedy blokada.
create function public.recovery_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'configured', r.user_id is not null,
    'pending', coalesce(private.recovery_pending(x.uid), false),
    'locked_until', r.locked_until
  )
  from (select (select auth.uid()) as uid) x
  left join private.recovery_answers r on r.user_id = x.uid;
$$;

-- Ustawia albo zmienia odpowiedzi. Nie działa, gdy konto czeka na potwierdzenie po resecie hasła,
-- bo wtedy przejęcie skrzynki pozwoliłoby podmienić pytania.
create function public.set_recovery_answers(p_answers text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if coalesce(array_length(p_answers, 1), 0) <> 3
     or exists (select 1 from unnest(p_answers) a where length(private.norm_answer(a)) < 2) then
    raise exception 'BAD_ANSWERS';
  end if;
  if private.recovery_pending(v_user) then
    raise exception 'RECOVERY_PENDING';
  end if;
  insert into private.recovery_answers (user_id, answers, verified_at, failed, locked_until)
  values (
    v_user,
    array(
      select extensions.crypt(private.norm_answer(t.a), extensions.gen_salt('bf', 10))
      from unnest(p_answers) with ordinality t(a, i)
      order by t.i
    ),
    clock_timestamp(), 0, null
  )
  on conflict (user_id) do update
    set answers = excluded.answers, verified_at = clock_timestamp(), failed = 0, locked_until = null;
end;
$$;

-- Sprawdza odpowiedzi. Zwraca 'ok', 'zle', 'blokada' albo 'brak' (pytania nieustawione). Nie rzuca wyjątku
-- przy złej odpowiedzi, żeby licznik prób się zapisał.
create function public.verify_recovery_answers(p_answers text[])
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  r private.recovery_answers%rowtype;
  v_ok boolean;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select * into r from private.recovery_answers where user_id = v_user for update;
  if not found then
    return 'brak';
  end if;
  if r.locked_until is not null and r.locked_until > now() then
    return 'blokada';
  end if;
  v_ok := coalesce(array_length(p_answers, 1), 0) = 3
    and extensions.crypt(private.norm_answer(p_answers[1]), r.answers[1]) = r.answers[1]
    and extensions.crypt(private.norm_answer(p_answers[2]), r.answers[2]) = r.answers[2]
    and extensions.crypt(private.norm_answer(p_answers[3]), r.answers[3]) = r.answers[3];
  if v_ok then
    update private.recovery_answers set verified_at = clock_timestamp(), failed = 0, locked_until = null where user_id = v_user;
    return 'ok';
  end if;
  update private.recovery_answers
    set failed = case when r.failed + 1 >= 5 then 0 else r.failed + 1 end,
        locked_until = case when r.failed + 1 >= 5 then now() + interval '1 hour' else null end
  where user_id = v_user;
  return case when r.failed + 1 >= 5 then 'blokada' else 'zle' end;
end;
$$;

revoke all on function public.recovery_status(), public.set_recovery_answers(text[]), public.verify_recovery_answers(text[]) from public, anon;
grant execute on function public.recovery_status(), public.set_recovery_answers(text[]), public.verify_recovery_answers(text[]) to authenticated;
