// Czyste obliczenia bez dostępu do bazy, więc łatwe do testowania.
import { addDays, monthOf } from '../lib/dates';
import { lineNet, vatAmount } from '../lib/money';
import type { Expense, Job, JobLine, Payment, Preparation, StockMovement, VatRate } from './types';

export interface Totals {
  net: number;
  vat: number;
  gross: number;
  byRate: Array<{ rate: VatRate; net: number; vat: number }>;
}

/** VAT liczony od sumy netto w każdej stawce, jak na fakturze. */
export function jobTotals(lines: JobLine[]): Totals {
  const groups = new Map<VatRate, number>();
  for (const line of lines) {
    const net = lineNet(line.qtyMilli, line.unitPriceNet);
    groups.set(line.vatRate, (groups.get(line.vatRate) ?? 0) + net);
  }
  const byRate = [...groups.entries()].map(([rate, net]) => ({ rate, net, vat: vatAmount(net, rate) }));
  const net = byRate.reduce((sum, g) => sum + g.net, 0);
  const vat = byRate.reduce((sum, g) => sum + g.vat, 0);
  return { net, vat, gross: net + vat, byRate };
}

export function paidForJob(jobId: string, payments: Payment[]): number {
  return payments.filter((p) => p.jobId === jobId).reduce((sum, p) => sum + p.amount, 0);
}

export function jobBalance(job: Job, payments: Payment[]): number {
  return jobTotals(job.lines).gross - paidForJob(job.id, payments);
}

/** Wykonane zlecenia z nieuregulowaną kwotą. Anulowane i wyceny nie są należnościami. */
export function outstandingJobs(jobs: Job[], payments: Payment[]): Array<{ job: Job; balance: number }> {
  return jobs
    .filter((j) => j.status === 'wykonane')
    .map((job) => ({ job, balance: jobBalance(job, payments) }))
    .filter((x) => x.balance > 0);
}

export interface MonthSummary {
  income: number;
  costs: number;
  result: number;
}

export function monthSummary(month: string, payments: Payment[], expenses: Expense[]): MonthSummary {
  const income = payments.filter((p) => monthOf(p.date) === month).reduce((s, p) => s + p.amount, 0);
  const costs = expenses.filter((e) => monthOf(e.date) === month).reduce((s, e) => s + e.amount, 0);
  return { income, costs, result: income - costs };
}

/** Zużycie liczymy tylko ze zleceń wykonanych; zaplanowane materiały nie zdejmują stanu. */
export function usedMaterials(jobs: Job[], preparationId?: string) {
  return jobs
    .filter((j) => j.status === 'wykonane')
    .flatMap((job) =>
      job.materials
        .filter((m) => !preparationId || m.preparationId === preparationId)
        .map((material) => ({ job, material })),
    );
}

export function stockOf(preparationId: string, movements: StockMovement[], jobs: Job[]): number {
  const moved = movements
    .filter((m) => m.preparationId === preparationId)
    .reduce((sum, m) => sum + m.qtyMilli, 0);
  const used = usedMaterials(jobs, preparationId).reduce((sum, u) => sum + u.material.qtyMilli, 0);
  return moved - used;
}

export interface BatchBalance {
  batchNo: string;
  expiryDate: string | null;
  qtyMilli: number;
}

export function batchBalances(preparationId: string, movements: StockMovement[], jobs: Job[]): BatchBalance[] {
  const batches = new Map<string, BatchBalance>();
  const entry = (batchNo: string) => {
    let batch = batches.get(batchNo);
    if (!batch) {
      batch = { batchNo, expiryDate: null, qtyMilli: 0 };
      batches.set(batchNo, batch);
    }
    return batch;
  };
  for (const m of movements) {
    if (m.preparationId !== preparationId) continue;
    const batch = entry(m.batchNo);
    batch.qtyMilli += m.qtyMilli;
    if (m.expiryDate) batch.expiryDate = m.expiryDate;
  }
  for (const { material } of usedMaterials(jobs, preparationId)) {
    entry(material.batchNo).qtyMilli -= material.qtyMilli;
  }
  return [...batches.values()].sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'));
}

export interface StockAlert {
  preparation: Preparation;
  kind: 'niski-stan' | 'termin' | 'przeterminowane';
  message: string;
  stockMilli: number;
  batchNo?: string;
  expiryDate?: string;
}

export function stockAlerts(
  preparations: Preparation[],
  movements: StockMovement[],
  jobs: Job[],
  today: string,
  warnDays = 60,
): StockAlert[] {
  const alerts: StockAlert[] = [];
  for (const preparation of preparations) {
    const stockMilli = stockOf(preparation.id, movements, jobs);
    if (preparation.minStockMilli > 0 && stockMilli < preparation.minStockMilli) {
      alerts.push({ preparation, kind: 'niski-stan', message: 'Niski stan', stockMilli });
    }
    for (const batch of batchBalances(preparation.id, movements, jobs)) {
      if (batch.qtyMilli <= 0 || !batch.expiryDate) continue;
      if (batch.expiryDate < today) {
        alerts.push({
          preparation,
          kind: 'przeterminowane',
          message: 'Przeterminowana partia',
          stockMilli: batch.qtyMilli,
          batchNo: batch.batchNo,
          expiryDate: batch.expiryDate,
        });
      } else if (batch.expiryDate <= addDays(today, warnDays)) {
        alerts.push({
          preparation,
          kind: 'termin',
          message: 'Kończy się termin',
          stockMilli: batch.qtyMilli,
          batchNo: batch.batchNo,
          expiryDate: batch.expiryDate,
        });
      }
    }
  }
  return alerts;
}

/** Wizyty cykliczne do umówienia w ciągu najbliższych dni, także te zaległe. */
export function followUpsDue(jobs: Job[], today: string, withinDays = 30): Job[] {
  const limit = addDays(today, withinDays);
  return jobs
    .filter((j) => j.status === 'wykonane' && j.followUpDate && !j.followUpDone && j.followUpDate <= limit)
    .sort((a, b) => a.followUpDate!.localeCompare(b.followUpDate!));
}

/** Zlecenia zaplanowane na dzień wcześniejszy niż dziś, a niezamknięte. */
export function overdueJobs(jobs: Job[], today: string): Job[] {
  return jobs.filter((j) => j.status === 'zaplanowane' && j.start && j.start.slice(0, 10) < today);
}
