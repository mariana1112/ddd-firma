import { formatDateLong } from '../lib/dates';
import type { Order, Visit } from './types';

/** Wykonany zabieg bez formy płatności albo kwoty: trafia do „Pilnych”, dopóki ktoś nie uzupełni płatności. */
export function paymentMissing(visit: Pick<Visit, 'status' | 'payMethod' | 'amount'>): boolean {
  return visit.status === 'wykonany' && (!visit.payMethod || !visit.amount);
}

/** Dlaczego zlecenie jest pilne: zabieg rozpoczęty i niezakończony, brak płatności albo zaległy termin. */
export type UrgentReason = 'w_trakcie' | 'platnosc' | 'zalegly';

export const URGENT_LABEL: Record<UrgentReason, string> = {
  w_trakcie: 'Niedokończony',
  platnosc: 'Brak płatności',
  zalegly: 'Zaległy termin',
};

/** Pierwszy powód pilności zlecenia albo null. Zlecenia w archiwum nie są pilne. */
export function urgentReason(order: Pick<Order, 'archived'>, list: Visit[], today: string): UrgentReason | null {
  if (isArchived(order, list)) return null;
  if (list.some((v) => v.status === 'w_trakcie')) return 'w_trakcie';
  if (list.some(paymentMissing)) return 'platnosc';
  if (list.some((v) => v.status === 'zaplanowany' && v.start && v.start.slice(0, 10) < today)) return 'zalegly';
  return null;
}

/** Zlecenie w archiwum: przeniesione ręcznie albo ze wszystkimi zabiegami odwołanymi. */
/**
 * Zlecenie w archiwum: oznaczone przy odwołaniu albo bez niczego do zrobienia po odwołaniu (same odwołane zabiegi
 * i ewentualnie pusty, nieumówiony zabieg, np. II, który został po odwołaniu zabiegu I).
 */
export function isArchived(order: Pick<Order, 'archived'>, list: Visit[]): boolean {
  if (order.archived) return true;
  return (
    list.some((v) => v.status === 'odwolany') && list.every((v) => v.status === 'odwolany' || (v.status === 'zaplanowany' && !v.start))
  );
}

/** Kolejność listy zleceń. */
export type OrderSort = 'od_dzis' | 'najwczesniej' | 'najpozniej' | 'numer';

export interface OrderListRow {
  order: Order;
  visits: Visit[];
}

export interface OrderTerm {
  /** RRRR-MM-DD albo null, gdy termin nie jest umówiony. */
  date: string | null;
  /** GG:MM albo null. */
  time: string | null;
}

/** Następny zabieg do zrobienia albo ostatni wykonany (odwołane pomijamy), do wyświetlenia na liście. */
export function currentVisit(list: Visit[]): Visit | undefined {
  const open = list.filter((v) => v.status === 'zaplanowany' || v.status === 'w_trakcie');
  const kept = list.filter((v) => v.status !== 'odwolany');
  return [...open].sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999'))[0] ?? kept[kept.length - 1] ?? list[list.length - 1];
}

/** Filtr listy zleceń. */
export type ListFilter = 'wszystkie' | 'aktywne' | 'wykonane' | 'pilne' | 'archiwum';

/** Dlaczego jeden zabieg jest pilny: niedokończony, bez płatności albo z zaległym terminem. */
export function visitUrgent(order: Pick<Order, 'archived'>, visit: Visit, today: string): UrgentReason | null {
  if (order.archived || visit.status === 'odwolany') return null;
  if (visit.status === 'w_trakcie') return 'w_trakcie';
  if (paymentMissing(visit)) return 'platnosc';
  if (visit.status === 'zaplanowany' && visit.start && visit.start.slice(0, 10) < today) return 'zalegly';
  return null;
}

/**
 * Czy zabieg pasuje do filtra listy (widok „każdy zabieg osobno”). Odwołane zabiegi i zlecenia z archiwum są tylko
 * w „Archiwum”, więc nie mieszają się z pracą do zrobienia.
 */
export function visitInFilter(order: Pick<Order, 'archived'>, visit: Visit, filter: ListFilter, today: string): boolean {
  const archived = Boolean(order.archived) || visit.status === 'odwolany';
  if (filter === 'archiwum') return archived;
  if (archived) return false;
  if (filter === 'aktywne') return visit.status === 'zaplanowany' || visit.status === 'w_trakcie';
  if (filter === 'wykonane') return visit.status === 'wykonany';
  if (filter === 'pilne') return visitUrgent(order, visit, today) !== null;
  return true;
}

/** Termin zlecenia na liście: zabieg do zrobienia, a gdy wszystko zrobione, dzień ostatniego zabiegu. */
export function orderTerm(list: Visit[]): OrderTerm {
  const visit = currentVisit(list);
  if (!visit) return { date: null, time: null };
  const date = visit.status === 'wykonany' ? (visit.doneOn ?? visit.start?.slice(0, 10) ?? null) : (visit.start?.slice(0, 10) ?? null);
  const time = visit.start && date === visit.start.slice(0, 10) ? visit.start.slice(11, 16) : null;
  return { date, time };
}

/** Sortuje wiersze; zlecenia bez terminu zawsze na końcu, przy równym terminie nowsze numery wyżej. */
export function sortOrderRows<T extends OrderListRow>(rows: T[], sort: OrderSort, today = ''): T[] {
  if (sort === 'numer') return [...rows].sort((a, b) => b.order.number - a.order.number);
  const key = (row: T) => {
    const term = orderTerm(row.visits);
    return term.date ? `${term.date}T${term.time ?? '00:00'}` : null;
  };
  const keyed = rows.map((row) => ({ row, key: key(row) }));
  if (sort === 'od_dzis') {
    // Od dziś po kolei jak w kalendarzu (dziś, jutro, 15, 16, 17…), potem do umówienia, na końcu minione od najnowszych.
    const group = (k: string | null) => (k === null ? 1 : k.slice(0, 10) >= today ? 0 : 2);
    return keyed
      .sort((a, b) => {
        const g = group(a.key) - group(b.key);
        if (g) return g;
        if (a.key === null || b.key === null) return b.row.order.number - a.row.order.number;
        const byDate = group(a.key) === 0 ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key);
        return byDate || b.row.order.number - a.row.order.number;
      })
      .map(({ row }) => row);
  }
  return keyed
    .sort((a, b) => {
      if (a.key === null || b.key === null) return a.key === b.key ? b.row.order.number - a.row.order.number : a.key === null ? 1 : -1;
      const byDate = sort === 'najwczesniej' ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key);
      return byDate || b.row.order.number - a.row.order.number;
    })
    .map(({ row }) => row);
}

/** Dzieli posortowane wiersze na dni (kolejne wiersze z tą samą datą). */
export function groupByDay<T extends OrderListRow>(rows: T[]): Array<{ date: string | null; rows: T[] }> {
  const groups: Array<{ date: string | null; rows: T[] }> = [];
  for (const row of rows) {
    const date = orderTerm(row.visits).date;
    const last = groups.at(-1);
    if (last && last.date === date) last.rows.push(row);
    else groups.push({ date, rows: [row] });
  }
  return groups;
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** „Dziś · niedziela, 8 listopada”, rok tylko gdy inny niż bieżący. */
export function dayHeading(date: string | null, today: string): string {
  if (!date) return 'Termin do umówienia';
  const near = date === today ? 'Dziś' : date === shift(today, 1) ? 'Jutro' : date === shift(today, -1) ? 'Wczoraj' : '';
  const long = formatDateLong(date) + (date.slice(0, 4) !== today.slice(0, 4) ? ` ${date.slice(0, 4)}` : '');
  return near ? `${near} · ${long}` : long;
}

const WEEKDAYS = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb'];
const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

/** Kafelek z datą: dzień tygodnia, dzień miesiąca, miesiąc. */
export function dateTile(date: string): { weekday: string; day: string; month: string } {
  const [y, m, d] = date.split('-').map(Number);
  return { weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], day: String(d), month: MONTHS[m - 1] };
}

/**
 * Kolejny zabieg zlecenia, liczony od bieżącego: zabiegu w trakcie, ostatniego wykonanego albo, gdy nic nie
 * jest jeszcze zrobione, pierwszego zaplanowanego.
 * - umowiony: kolejny zabieg ma termin,
 * - do_umowienia: kolejny zabieg jest założony, ale bez terminu,
 * - nieumowiony: kolejnego zabiegu jeszcze nie ma; termin ustala się przy zakończeniu bieżącego,
 * - brak: wszystko zrobione i nic więcej nie jest zaplanowane.
 */
export type NextVisitState =
  | { kind: 'umowiony'; seq: number; start: string }
  | { kind: 'do_umowienia'; seq: number }
  | { kind: 'nieumowiony'; seq: number; afterSeq: number }
  | { kind: 'brak' };

export function nextVisitState(list: Visit[]): NextVisitState {
  const active = list.filter((v) => v.status !== 'odwolany').sort((a, b) => a.seq - b.seq);
  const isOpen = (v: Visit) => v.status === 'zaplanowany' || v.status === 'w_trakcie';
  const done = active.filter((v) => v.status === 'wykonany');
  const present = active.find((v) => v.status === 'w_trakcie') ?? (done.length ? done[done.length - 1] : active.find(isOpen));
  if (!present) return { kind: 'brak' };
  const future = active.find((v) => v.seq > present.seq && isOpen(v));
  if (future) return future.start ? { kind: 'umowiony', seq: future.seq, start: future.start } : { kind: 'do_umowienia', seq: future.seq };
  if (isOpen(present)) return { kind: 'nieumowiony', seq: present.seq + 1, afterSeq: present.seq };
  return { kind: 'brak' };
}
