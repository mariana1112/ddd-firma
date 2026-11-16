import { db } from './db';
import { formatPln } from './reports';
import type { Visit } from './types';
import { addDays, formatDate } from '../lib/dates';

/**
 * Raporty do odhaczenia: gdy dzień albo tydzień z wykonanymi zabiegami się skończył, raport jest gotowy, a na Pulpicie
 * i pod dzwoneczkiem wisi przypomnienie, dopóki technik go nie odhaczy (np. po wysłaniu szefowi i rozliczeniu).
 */
export interface ReportCheck {
  id: string;
  kind: 'dzien' | 'tydzien';
  from: string;
  to: string;
  title: string;
  text: string;
  link: string;
}

/** Odhaczone raporty: na tym telefonie (klucz w pamięci urządzenia). */
export const REPORT_CHECKS_KEY = 'reportChecks';
/** Ile dni i tygodni wstecz przypominamy. */
const DAYS_BACK = 7;
const WEEKS_BACK = 3;

export async function getReportChecks(): Promise<string[]> {
  return ((await db.meta.get(REPORT_CHECKS_KEY))?.value as string[] | undefined) ?? [];
}

export async function setReportChecked(id: string, checked: boolean): Promise<void> {
  const list = await getReportChecks();
  const next = checked ? [...new Set([...list, id])].slice(-200) : list.filter((x) => x !== id);
  await db.meta.put({ key: REPORT_CHECKS_KEY, value: next, updatedAt: new Date().toISOString() });
}

const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const plural = (n: number) => (n === 1 ? 'zabieg' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'zabiegi' : 'zabiegów');

/**
 * Raporty gotowe do odhaczenia. Dzień: minione dni (do tygodnia wstecz) z wykonanymi zabiegami, a dziś dopiero, gdy
 * wszystkie dzisiejsze zabiegi są zakończone. Tydzień: zakończone tygodnie (pon–niedz) z wykonanymi zabiegami.
 * `mine` wybiera zabiegi tej osoby.
 */
export function pendingReportChecks(input: { visits: Visit[]; mine: (v: Visit) => boolean; today: string; checked: string[] }): ReportCheck[] {
  const { today } = input;
  const own = input.visits.filter((v) => !v.deletedAt && input.mine(v));
  const done = own.filter((v) => v.status === 'wykonany' && v.doneOn);
  const sum = (from: string, to: string) => {
    const list = done.filter((v) => v.doneOn! >= from && v.doneOn! <= to);
    return { count: list.length, turnover: list.reduce((n, v) => n + (v.amount ?? 0), 0) };
  };
  const out: ReportCheck[] = [];
  const openToday = own.some((v) => (v.status === 'zaplanowany' || v.status === 'w_trakcie') && v.start?.slice(0, 10) === today);
  for (let back = 0; back <= DAYS_BACK; back++) {
    const date = addDays(today, -back);
    if (back === 0 && openToday) continue;
    const { count, turnover } = sum(date, date);
    const id = `dzien:${date}`;
    if (!count || input.checked.includes(id)) continue;
    out.push({
      id,
      kind: 'dzien',
      from: date,
      to: date,
      title: `Raport dzienny ${back === 0 ? 'z dziś' : formatDate(date)} gotowy`,
      text: `${count} ${plural(count)}, ${formatPln(turnover)}. Sprawdź i odhacz.`,
      link: `/raporty?okres=dzien&data=${date}`,
    });
  }
  const monday = addDays(today, -weekday(today));
  for (let k = 1; k <= WEEKS_BACK; k++) {
    const from = addDays(monday, -7 * k);
    const to = addDays(from, 6);
    const { count, turnover } = sum(from, to);
    const id = `tydzien:${from}`;
    if (!count || input.checked.includes(id)) continue;
    out.push({
      id,
      kind: 'tydzien',
      from,
      to,
      title: `Raport tygodniowy ${formatDate(from).slice(0, 5)}–${formatDate(to)} gotowy`,
      text: `${count} ${plural(count)}, ${formatPln(turnover)}. Sprawdź i odhacz.`,
      link: `/raporty?okres=tydzien&data=${from}`,
    });
  }
  return out.sort((a, b) => b.to.localeCompare(a.to) || (a.kind === 'tydzien' ? -1 : 1));
}
