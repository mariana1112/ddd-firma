-- Trwałe usunięcie rekordu (opróżnienie kosza) czyści też treść jego wpisów w historii zmian.
-- Zostaje sam fakt zmiany: kto, kiedy i jaka operacja, bez danych klienta.
create or replace function private.clear_purged_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.purged and (tg_op = 'INSERT' or not old.purged) then
    update public.changes
    set patch = '{}'::jsonb
    where org_id = new.org_id and tbl = new.tbl and record_id = new.id and patch <> '{}'::jsonb;
  end if;
  return new;
end;
$$;

create trigger records_clear_purged_history
after insert or update of purged on public.records
for each row execute function private.clear_purged_history();

-- Rekordy usunięte trwale przed tą migracją.
update public.changes c
set patch = '{}'::jsonb
from public.records r
where r.purged and c.org_id = r.org_id and c.tbl = r.tbl and c.record_id = r.id and c.patch <> '{}'::jsonb;
