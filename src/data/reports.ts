// Raporty dzienne, tygodniowe i miesięczne. Czyste funkcje: dostają rekordy, zwracają wynik.
import { addDays, addMonths, formatMonth, monthOf } from '../lib/dates';
import { orderAddress } from './texts';
import type { Expense, Order, PayMethod, Trip, Visit } from './types';

export type PeriodKind = 'dzien' | 'tydzien' | 'miesiac';

export interface Period {
  kind: PeriodKind;
  from: string;
  to: string;
}

function weekday(date: string): number {
  // 0 = poniedziałek, 6 = niedziela.
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function periodOf(kind: PeriodKind, date: string): Period {
  if (kind === 'dzien') return { kind, from: date, to: date };
  if (kind === 'tydzien') {
    const from = addDays(date, -weekday(date));
    return { kind, from, to: addDays(from, 6) };
  }
  const from = `${monthOf(date)}-01`;
  return { kind, from, to: addDays(addMonths(from, 1), -1) };
}

export function shiftPeriod(period: Period, by: number): Period {
  if (period.kind === 'dzien') return periodOf('dzien', addDays(period.from, by));
  if (period.kind === 'tydzien') return periodOf('tydzien', addDays(period.from, 7 * by));
  return periodOf('miesiac', addMonths(period.from, by));
}

const inPeriod = (date: string | null, p: Period) => date !== null && date >= p.from && date <= p.to;

/** Koszty zwracane technikowi osobno w rozliczeniu. Pozostałe kategorie to „inne koszty”. */
export const REFUND_CATEGORIES = ['Autostrada', 'Parking'];
export const COST_CATEGORIES = ['Autostrada', 'Parking', 'Paliwo', 'Inne'];

export const PAY_METHODS: PayMethod[] = ['gotowka', 'blik', 'przelew'];

export interface DayAmounts {
  date: string;
  gotowka: number;
  blik: number;
  przelew: number;
}

export interface Report {
  period: Period;
  /** Pierwszy i ostatni dzień z obrotem lub kosztem; zakres okresu, gdy nic się nie działo. */
  activeFrom: string;
  activeTo: string;
  turnover: number;
  byMethod: Record<PayMethod, number>;
  refunds: number;
  otherCosts: number;
  bonus: number;
  cashForBoss: number;
  days: DayAmounts[];
  visits: Array<{ visit: Visit; order: Order | undefined }>;
  expenses: Expense[];
  km: { sluzbowy: number; prywatny: number };
  unpaid: number;
}

export function buildReport(
  period: Period,
  data: { visits: Visit[]; orders: Order[]; expenses: Expense[]; trips: Trip[] },
): Report {
  const orderById = new Map(data.orders.map((o) => [o.id, o]));
  const done = data.visits
    .filter((v) => v.status === 'wykonany' && inPeriod(v.doneOn, period))
    .sort((a, b) => (a.finishedAt ?? '').localeCompare(b.finishedAt ?? ''));
  const expenses = data.expenses.filter((e) => inPeriod(e.date, period)).sort((a, b) => a.date.localeCompare(b.date));
  const trips = data.trips.filter((t) => inPeriod(t.date, period));

  const byMethod: Record<PayMethod, number> = { gotowka: 0, blik: 0, przelew: 0 };
  const dayMap = new Map<string, DayAmounts>();
  let unpaid = 0;
  for (const v of done) {
    if (!v.payMethod || !v.amount) {
      unpaid++;
      continue;
    }
    byMethod[v.payMethod] += v.amount;
    const day = dayMap.get(v.doneOn!) ?? { date: v.doneOn!, gotowka: 0, blik: 0, przelew: 0 };
    day[v.payMethod] += v.amount;
    dayMap.set(v.doneOn!, day);
  }
  const refunds = expenses.filter((e) => REFUND_CATEGORIES.includes(e.category)).reduce((s, e) => s + e.amount, 0);
  const otherCosts = expenses.filter((e) => !REFUND_CATEGORIES.includes(e.category)).reduce((s, e) => s + e.amount, 0);
  const bonus = done.reduce((s, v) => s + v.bonus, 0);
  const turnover = byMethod.gotowka + byMethod.blik + byMethod.przelew;

  const activeDates = [...dayMap.keys(), ...expenses.map((e) => e.date)].sort();
  const km = { sluzbowy: 0, prywatny: 0 };
  for (const t of trips) km[t.kind] += Math.max(0, t.odometerEnd - t.odometerStart);

  return {
    period,
    activeFrom: activeDates[0] ?? period.from,
    activeTo: activeDates[activeDates.length - 1] ?? period.to,
    turnover,
    byMethod,
    refunds,
    otherCosts,
    bonus,
    cashForBoss: byMethod.gotowka - refunds - bonus - otherCosts,
    days: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    visits: done.map((visit) => ({ visit, order: orderById.get(visit.orderId) })),
    expenses,
    km,
    unpaid,
  };
}

// ---------- Tekst rozliczenia ----------

const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const METHOD_NAMES: Record<PayMethod, string> = { gotowka: 'gotówka', blik: 'blik', przelew: 'przelew' };

/** 534800 -> "5 348 zł", 534850 -> "5 348,50 zł". */
export function formatPln(grosze: number): string {
  const zl = new Intl.NumberFormat('pl-PL', {
    useGrouping: 'always',
    minimumFractionDigits: grosze % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(grosze / 100);
  return `${zl.replace(/ /g, ' ')} zł`;
}

/** "2026-10-26" -> "26.10.26r." jak w dotychczasowych rozliczeniach. */
function shortDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y.slice(2)}r.`;
}

export function periodTitle(r: Report): string {
  if (r.period.kind === 'dzien') return `dnia ${shortDate(r.period.from)}`;
  if (r.period.kind === 'tydzien') return `tygodnia ${shortDate(r.activeFrom)} - ${shortDate(r.activeTo)}`;
  return `miesiąca ${formatMonth(monthOf(r.period.from))}`;
}

function dayLabel(r: Report, date: string): string {
  if (r.period.kind === 'tydzien') return WEEKDAYS[weekday(date)];
  const [, m, d] = date.split('-');
  return `${d}.${m}`;
}

/** Rozliczenie w formacie wysyłanym szefowi. */
export function reportText(r: Report, names: { technician: string; bossGenitive: string }): string {
  const lines = [
    `Obrót ${periodTitle(r)} - ${formatPln(r.turnover)}`,
    `Gotówka - ${formatPln(r.byMethod.gotowka)}`,
    `Blik - ${formatPln(r.byMethod.blik)}`,
    `Przelew - ${formatPln(r.byMethod.przelew)}`,
    `Parkingi oraz autostrady (zwrot ${names.technician}) - ${formatPln(r.refunds)}`,
    `Premia ${names.technician}: ${formatPln(r.bonus)}`,
    `Inne koszty: ${formatPln(r.otherCosts)}`,
    `Wynik gotówka dla ${names.bossGenitive} - ${formatPln(r.cashForBoss)}`,
  ];
  if (r.period.kind !== 'dzien') {
    for (const method of PAY_METHODS) {
      if (r.byMethod[method] === 0) continue;
      lines.push(`Dane szczegółowe ${METHOD_NAMES[method]} ${formatPln(r.byMethod[method])} w tym :`);
      for (const day of r.days) {
        if (day[method] > 0) lines.push(`${dayLabel(r, day.date)} - ${formatPln(day[method])}`);
      }
    }
  } else {
    for (const { visit, order } of r.visits) {
      if (!order) continue;
      const pay = visit.amount ? `${formatPln(visit.amount)} ${visit.payMethod ? METHOD_NAMES[visit.payMethod] : ''}` : 'bez płatności';
      lines.push(`#${order.number} ${orderAddress(order)} - ${pay}`.trim());
    }
  }
  return lines.join('\n');
}
