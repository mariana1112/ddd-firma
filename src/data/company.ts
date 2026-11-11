import { buildReport, formatPln, type Period, type Report } from './reports';
import { regionOf } from './scope';
import type { Expense, Order, Trip, Visit } from './types';

/** Region (oddział) w podsumowaniu firmy. */
export interface RegionRef {
  id: string;
  name: string;
  prefix: string;
}

export interface RegionRow extends RegionRef {
  report: Report;
  /** Liczba wykonanych zabiegów w okresie. */
  visits: number;
}

export interface CompanyData {
  visits: Visit[];
  orders: Order[];
  expenses: Expense[];
  trips: Trip[];
}

/** Rekordy jednego regionu. Rekord bez znacznika (niewysłany) należy do regionu tego urządzenia. */
export function regionData(data: CompanyData, regionId: string, ownBranch: string | null): CompanyData {
  const mine = <T extends { branchId?: string | null }>(rows: T[]) => rows.filter((r) => regionOf(r, ownBranch) === regionId);
  return { visits: mine(data.visits), orders: mine(data.orders), expenses: mine(data.expenses), trips: mine(data.trips) };
}

/**
 * Raport każdego regionu za okres, posortowany jak ranking: obrót malejąco, przy równym obrocie wynik gotówki.
 * Rekordy z regionu spoza listy (np. usuniętego) trafiają do pozycji „Bez regionu”, jeśli coś w nich jest.
 */
export function regionRanking(period: Period, data: CompanyData, regions: RegionRef[], ownBranch: string | null): RegionRow[] {
  const known = new Set(regions.map((r) => r.id));
  const rows: RegionRow[] = regions.map((region) => {
    const report = buildReport(period, regionData(data, region.id, ownBranch));
    return { ...region, report, visits: report.visits.length };
  });
  const orphan = (r: { branchId?: string | null }) => {
    const id = regionOf(r, ownBranch);
    return id === null || !known.has(id);
  };
  const rest = { visits: data.visits.filter(orphan), orders: data.orders, expenses: data.expenses.filter(orphan), trips: data.trips.filter(orphan) };
  const restReport = buildReport(period, rest);
  if (restReport.visits.length || restReport.costs || restReport.km.sluzbowy || restReport.km.prywatny) {
    rows.push({ id: '', name: 'Bez regionu', prefix: '', report: restReport, visits: restReport.visits.length });
  }
  return rows.sort((a, b) => b.report.turnover - a.report.turnover || b.report.cashForBoss - a.report.cashForBoss);
}

const periodLabel = (p: Period) => {
  const d = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}r.`;
  return p.from === p.to ? d(p.from) : `${d(p.from)} - ${d(p.to)}`;
};

/** Podsumowanie całej firmy do wysłania: suma, koszty, kilometry i ranking regionów. */
export function companyText(total: Report, ranking: RegionRow[]): string {
  const lines = [
    `Podsumowanie firmy ${periodLabel(total.period)}`,
    `Obrót - ${formatPln(total.turnover)}`,
    `Gotówka - ${formatPln(total.byMethod.gotowka)}`,
    `Blik - ${formatPln(total.byMethod.blik)}`,
    `Przelew - ${formatPln(total.byMethod.przelew)}`,
    `Koszty z premiami - ${formatPln(total.costs + total.bonus)} (koszty ${formatPln(total.costs)}, premie ${formatPln(total.bonus)})`,
    `Kilometry - ${total.km.sluzbowy} km służbowo (VAT), w tym ${total.km.prywatny} km prywatnie`,
    `Wynik gotówka - ${formatPln(total.cashForBoss)}`,
    '',
    'Ranking regionów (obrót):',
    ...ranking.map(
      (r, i) =>
        `${i + 1}. ${r.name}${r.prefix ? ` (${r.prefix})` : ''} - ${formatPln(r.report.turnover)}, zabiegi: ${r.visits}, koszty: ${formatPln(r.report.costs + r.report.bonus)}, km: ${r.report.km.sluzbowy}, wynik gotówka: ${formatPln(r.report.cashForBoss)}`,
    ),
  ];
  return lines.join('\n');
}
