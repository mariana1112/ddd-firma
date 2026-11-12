// Raporty dzienne, tygodniowe i miesięczne. Czyste funkcje: dostają rekordy, zwracają wynik.
import { addDays, addMonths, formatMonth, monthOf } from '../lib/dates';
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

/**
 * Koszty mają jedną kategorię, „inne koszty”, a nazwę wpisuje technik, np. „Paliwo” albo „Zaliczka”.
 * Podpowiedzi przy dodawaniu; każda inna nazwa też jest w porządku.
 */
export const COST_SUGGESTIONS = ['Paliwo', 'Parking', 'Autostrada', 'Zaliczka', 'Utrzymanie auta'];

/** Nazwa kosztu w raporcie. Dawne koszty kategorii „Inne” mają nazwę w opisie. */
export function costName(e: Pick<Expense, 'category' | 'description'>): string {
  const category = e.category.trim();
  if ((category === 'Inne' || !category) && e.description.trim()) return e.description.trim();
  return category || 'Inne';
}

export interface CostLine {
  name: string;
  amount: number;
}

/** Koszty zsumowane według nazwy, bez rozróżniania wielkości liter, w kolejności pierwszego wystąpienia. */
export function costLines(expenses: Array<Pick<Expense, 'category' | 'description' | 'amount'>>): CostLine[] {
  const lines = new Map<string, CostLine>();
  for (const e of expenses) {
    const name = costName(e);
    const key = name.toLowerCase();
    const line = lines.get(key) ?? { name, amount: 0 };
    line.amount += e.amount;
    lines.set(key, line);
  }
  return [...lines.values()];
}

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
  /** Koszty z okresu (bez premii), w groszach. */
  costs: number;
  costLines: CostLine[];
  bonus: number;
  /** Gotówka minus koszty i premie: tyle gotówki dostaje szef. */
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
    // Zlecenia z usuniętego regionu (dane testowe, stary region) nie liczą się do raportów.
    .filter((v) => v.status === 'wykonany' && inPeriod(v.doneOn, period) && !orderById.get(v.orderId)?.regionDeleted)
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
  const costs = expenses.reduce((s, e) => s + e.amount, 0);
  const bonus = done.reduce((s, v) => s + v.bonus, 0);
  const turnover = byMethod.gotowka + byMethod.blik + byMethod.przelew;

  const activeDates = [...dayMap.keys(), ...expenses.map((e) => e.date)].sort();
  const km = { sluzbowy: 0, prywatny: 0 };
  // Każdy przejazd liczy się do ewidencji VAT jako służbowy; prywatne są dodatkowo pokazane osobno (w tym prywatne).
  for (const t of trips) {
    const distance = Math.max(0, t.odometerEnd - t.odometerStart);
    km.sluzbowy += distance;
    if (t.kind === 'prywatny') km.prywatny += distance;
    else km.prywatny += Math.min(distance, t.privateKm ?? 0);
  }

  return {
    period,
    activeFrom: activeDates[0] ?? period.from,
    activeTo: activeDates[activeDates.length - 1] ?? period.to,
    turnover,
    byMethod,
    costs,
    costLines: costLines(expenses),
    bonus,
    cashForBoss: byMethod.gotowka - costs - bonus,
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

/** Kwota jak w rozliczeniach pisanych ręcznie: „953,5 zł”, „2 250 zł”. */
export function textPln(grosze: number): string {
  const zl = new Intl.NumberFormat('pl-PL', { useGrouping: 'always', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(grosze / 100);
  return `${zl.replace(/[  ]/g, ' ')} zł`;
}

/** Adres z kodem pocztowym: „Morska 176, 81-222 Gdynia”. */
export function reportAddress(order: Order): string {
  const flat = order.building === 'blok' && order.flatNo.trim() ? `/${order.flatNo.trim()}` : '';
  const street = `${order.street.trim()} ${order.houseNo.trim()}${flat}`.trim();
  const city = [order.postalCode.trim(), order.city.trim()].filter(Boolean).join(' ');
  return [street, city].filter(Boolean).join(', ');
}

export interface WeekPart {
  /** Dni w rozliczeniu: od pierwszego do ostatniego dnia z pracą, a bez pracy dni robocze tygodnia. */
  from: string;
  to: string;
  byMethod: Record<PayMethod, number>;
}

/**
 * Tygodnie miesiąca od poniedziałku, przycięte do miesiąca. Kawałek tygodnia z samym weekendem
 * na początku lub końcu miesiąca liczy się tylko wtedy, gdy była w nim praca.
 */
export function monthWeeks(r: Report): WeekPart[] {
  const weeks: WeekPart[] = [];
  let monday = addDays(r.period.from, -weekday(r.period.from));
  while (monday <= r.period.to) {
    const from = monday < r.period.from ? r.period.from : monday;
    const sunday = addDays(monday, 6);
    const to = sunday > r.period.to ? r.period.to : sunday;
    const days = r.days.filter((d) => d.date >= from && d.date <= to);
    const active = [...days.map((d) => d.date), ...r.expenses.filter((e) => e.date >= from && e.date <= to).map((e) => e.date)].sort();
    const friday = addDays(monday, 4);
    const workdaysTo = friday < to ? friday : to;
    if (active.length > 0 || from <= workdaysTo) {
      const byMethod: Record<PayMethod, number> = { gotowka: 0, blik: 0, przelew: 0 };
      for (const d of days) for (const m of PAY_METHODS) byMethod[m] += d[m];
      weeks.push({ from: active[0] ?? from, to: active.at(-1) ?? workdaysTo, byMethod });
    }
    monday = addDays(monday, 7);
  }
  return weeks;
}

/**
 * Wspólne nazwy we wszystkich rozliczeniach (dzień, tydzień, miesiąc), żeby nie było raz „Bliki”, raz „Blik”:
 * formy płatności „Gotówka”, „Blik”, „Przelew”, premia „Premia”, sekcje „Dane szczegółowe … w tym:”.
 */
const LABEL: Record<PayMethod, string> = { gotowka: 'Gotówka', blik: 'Blik', przelew: 'Przelew' };

/** „Gotówka - 1 100 zł”, „Blik - 800 zł”, „Przelew - 350 zł”. */
const methodLines = (r: Report): string[] => PAY_METHODS.map((m) => `${LABEL[m]} - ${textPln(r.byMethod[m])}`);

/** „Dane szczegółowe blik 800 zł w tym:”. */
const detailTitle = (r: Report, m: PayMethod) => `Dane szczegółowe ${METHOD_NAMES[m]} ${textPln(r.byMethod[m])} w tym:`;

/** Koszty razem z premią, każdy wiersz „Nazwa: kwota”. */
function costBlock(r: Report): string[] {
  const total = r.costs + r.bonus;
  if (total === 0) return ['Koszty: brak'];
  const lines = [`Koszty ${textPln(total)} w tym:`];
  if (r.bonus > 0) lines.push(`Premia: ${textPln(r.bonus)}`);
  for (const c of r.costLines) lines.push(`${c.name}: ${textPln(c.amount)}`);
  return lines;
}

const resultLine = (r: Report, bossGenitive: string) => `Wynik gotówka dla ${bossGenitive} - ${textPln(r.cashForBoss)}`;

function dailyText(r: Report, bossGenitive: string): string[] {
  const deductions = [
    ...(r.bonus > 0 ? [`-${textPln(r.bonus)} premia`] : []),
    ...r.costLines.map((c) => `-${textPln(c.amount)} ${c.name.toLowerCase()}`),
  ];
  const [cash, ...others] = methodLines(r);
  const lines = [
    `Obrót ${periodTitle(r)} - ${textPln(r.turnover)}`,
    `${cash}${deductions.length ? ` (${deductions.join(', ')}, czyli gotówki wychodzi ${textPln(r.cashForBoss)})` : ''}`,
    ...others,
    '',
    ...costBlock(r),
    '',
    resultLine(r, bossGenitive),
  ];
  for (const method of PAY_METHODS) {
    const paid = r.visits.filter(({ visit }) => visit.payMethod === method && visit.amount);
    lines.push('', detailTitle(r, method));
    if (paid.length === 0) lines.push('Brak');
    paid.forEach(({ visit, order }, i) => {
      const gross = order?.invoice === 'vat' ? ' brutto' : '';
      lines.push(`${i + 1}. ${textPln(visit.amount!)}${gross}${order ? `, ${reportAddress(order)}` : ''}`);
    });
  }
  return lines;
}

function weeklyText(r: Report, bossGenitive: string): string[] {
  const lines = [`Obrót ${periodTitle(r)} - ${textPln(r.turnover)}`, ...methodLines(r), '', ...costBlock(r), '', resultLine(r, bossGenitive)];
  for (const method of PAY_METHODS) {
    lines.push('', detailTitle(r, method));
    const days = r.days.filter((day) => day[method] > 0);
    if (days.length === 0) lines.push('Brak');
    for (const day of days) lines.push(`${WEEKDAYS[weekday(day.date)]} - ${textPln(day[method])}`);
  }
  return lines;
}

function monthlyText(r: Report, bossGenitive: string): string[] {
  const month = formatMonth(monthOf(r.period.from));
  const lines = [
    `Obrót miesiąca ${month.charAt(0).toUpperCase()}${month.slice(1)} - ${textPln(r.turnover)}`,
    ...methodLines(r),
    '',
    ...costBlock(r),
    '',
    resultLine(r, bossGenitive),
  ];
  const weeks = monthWeeks(r);
  for (const method of PAY_METHODS) {
    lines.push('', detailTitle(r, method));
    weeks.forEach((w, i) => lines.push(`Tydzień ${i + 1} (${shortDate(w.from)} - ${shortDate(w.to)}) - ${textPln(w.byMethod[method])}`));
  }
  return lines;
}

/**
 * Rozliczenie w formacie wysyłanym szefowi. Dzień: zabiegi z adresami według formy płatności.
 * Tydzień: kwoty według dni. Miesiąc: kwoty według tygodni. Koszty i premie zawsze pomniejszają
 * gotówkę dla szefa.
 */
export function reportText(r: Report, names: { technician: string; bossGenitive: string }): string {
  const lines =
    r.period.kind === 'dzien'
      ? dailyText(r, names.bossGenitive)
      : r.period.kind === 'tydzien'
        ? weeklyText(r, names.bossGenitive)
        : monthlyText(r, names.bossGenitive);
  return lines.join('\n');
}

/** Inicjały technika: „Maciej Kowalski” → „MK”, samo imię „Maurycy” → „MA”. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export interface TechnicianShare {
  key: string;
  initials: string;
  name: string;
  /** Imię do raportu („Maciej”); przy dwóch osobach o tym samym imieniu z literą nazwiska („Maciej K.”). */
  label: string;
  visits: number;
  turnover: number;
}

/** Podział raportu na techników (kto wykonał zabiegi): inicjały, liczba zabiegów i obrót, od największego obrotu. */
export function byTechnician(report: Pick<Report, 'visits'>): TechnicianShare[] {
  const map = new Map<string, TechnicianShare>();
  for (const { visit } of report.visits) {
    const key = visit.technicianId ?? `name:${visit.technicianName}`;
    const row = map.get(key) ?? { key, initials: initials(visit.technicianName), name: visit.technicianName || 'technik', label: '', visits: 0, turnover: 0 };
    row.visits += 1;
    row.turnover += visit.amount ?? 0;
    map.set(key, row);
  }
  const rows = [...map.values()];
  const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;
  for (const row of rows) {
    const words = row.name.trim().split(/\s+/);
    const twin = rows.some((o) => o !== row && first(o.name).toLowerCase() === first(row.name).toLowerCase());
    row.label = twin && words.length > 1 ? `${words[0]} ${words[words.length - 1][0]}.` : first(row.name);
  }
  return rows.sort((a, b) => b.turnover - a.turnover || a.label.localeCompare(b.label, 'pl'));
}

/** Podział na techników do tekstu raportu: „Maciej – 3 zabiegi, 1 200 zł”. */
export function technicianLines(shares: TechnicianShare[]): string[] {
  const word = (n: number) => (n === 1 ? 'zabieg' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'zabiegi' : 'zabiegów');
  return shares.map((s) => `${s.label} – ${s.visits} ${word(s.visits)}, ${formatPln(s.turnover)}`);
}
