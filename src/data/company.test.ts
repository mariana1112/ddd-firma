import { beforeEach, describe, expect, it } from 'vitest';
import { companyText, regionRanking } from './company';
import { db } from './db';
import { periodOf } from './reports';
import { orders } from './repo';
import { currentViewScope, scopeFilter, setOwnBranch, setViewScope } from './scope';
import type { Expense, Order, Trip, Visit } from './types';

const visit = (id: string, branchId: string | null, amount: number, doneOn = '2026-11-03'): Visit =>
  ({ id, orderId: `o-${id}`, seq: 1, status: 'wykonany', doneOn, payMethod: 'gotowka', amount, bonus: 0, finishedAt: `${doneOn}T10:00:00Z`, branchId, deletedAt: null }) as unknown as Visit;
const order = (id: string, branchId: string | null): Order => ({ id: `o-${id}`, branchId, deletedAt: null }) as unknown as Order;
const cost = (id: string, branchId: string | null, amount: number): Expense =>
  ({ id, date: '2026-11-04', category: 'Paliwo', description: '', amount, branchId, deletedAt: null }) as unknown as Expense;
const trip = (id: string, branchId: string | null, km: number): Trip =>
  ({ id, date: '2026-11-04', kind: 'sluzbowy', odometerStart: 1000, odometerEnd: 1000 + km, branchId, deletedAt: null }) as unknown as Trip;

describe('regiony', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    setViewScope(null);
    setOwnBranch(null);
  });

  it('listy pokazują własny region, a panel admina wybrany albo całą firmę', async () => {
    await db.orders.bulkPut([order('a', 'gda'), order('b', 'ldz'), order('c', null)].map((o) => ({ ...o, createdAt: '', updatedAt: '' })) as Order[]);
    // Bez konta firmowego nic nie jest filtrowane.
    expect((await orders.all()).length).toBe(3);
    setOwnBranch({ branchId: 'ldz' });
    // Rekord bez znacznika (jeszcze niewysłany) należy do regionu urządzenia.
    expect((await orders.all()).map((o) => o.id).sort()).toEqual(['o-b', 'o-c']);
    setViewScope('gda');
    expect(currentViewScope()).toBe('gda');
    expect((await orders.all()).map((o) => o.id)).toEqual(['o-a']);
    setViewScope('all');
    expect(scopeFilter()).toBeNull();
    expect((await orders.allRegions()).length).toBe(3);
    setViewScope(null);
    expect((await orders.all()).length).toBe(2);
  });

  it('ranking regionów i podsumowanie firmy', async () => {
    const regions = [
      { id: 'gda', name: 'Pomorskie', prefix: 'GDA' },
      { id: 'ldz', name: 'Łódzkie', prefix: 'LDZ' },
    ];
    const data = {
      visits: [visit('1', 'gda', 40000), visit('2', 'gda', 30000), visit('3', 'ldz', 90000), visit('4', null, 10000)],
      orders: [order('1', 'gda'), order('2', 'gda'), order('3', 'ldz'), order('4', null)],
      expenses: [cost('k1', 'gda', 5000), cost('k2', 'ldz', 12000)],
      trips: [trip('t1', 'gda', 120), trip('t2', 'ldz', 80)],
    };
    const period = periodOf('tydzien', '2026-11-04');
    // Urządzenie admina jest w regionie łódzkim: niewysłany zabieg liczy się do Łódzkiego.
    const ranking = regionRanking(period, data, regions, 'ldz');
    expect(ranking.map((r) => [r.name, r.report.turnover, r.visits, r.report.costs, r.report.km.sluzbowy])).toEqual([
      ['Łódzkie', 100000, 2, 12000, 80],
      ['Pomorskie', 70000, 2, 5000, 120],
    ]);
    const { buildReport } = await import('./reports');
    const text = companyText(buildReport(period, data), ranking).split('\n');
    expect(text[0]).toBe('Podsumowanie firmy 02.11.26r. - 08.11.26r.');
    expect(text).toContain('Obrót - 1 700 zł');
    expect(text).toContain('Kilometry - 200 km służbowo, 0 km prywatnie');
    expect(text).toContain('1. Łódzkie (LDZ) - 1 000 zł, zabiegi: 2, koszty: 120 zł, km: 80, wynik gotówka: 880 zł');
    expect(text).toContain('2. Pomorskie (GDA) - 700 zł, zabiegi: 2, koszty: 50 zł, km: 120, wynik gotówka: 650 zł');
  });

  it('rekordy spoza listy regionów trafiają do „Bez regionu”', () => {
    const data = { visits: [visit('1', 'stary', 20000)], orders: [order('1', 'stary')], expenses: [] as Expense[], trips: [] as Trip[] };
    const ranking = regionRanking(periodOf('tydzien', '2026-11-04'), data, [{ id: 'gda', name: 'Pomorskie', prefix: 'GDA' }], 'gda');
    expect(ranking.map((r) => [r.name, r.report.turnover])).toEqual([
      ['Bez regionu', 20000],
      ['Pomorskie', 0],
    ]);
  });
});
