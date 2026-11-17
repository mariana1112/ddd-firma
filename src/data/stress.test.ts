import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { cancelVisit, createOrder, duplicateOrder, finishVisit, orderVisits, revertStartedVisit, startVisit, type NextVisit, type OrderDraft } from './orders';
import { accountingState, pendingInvoices } from './accounting';
import { invoiceMissing } from './invoice';
import { isArchived, sortOrderRows, urgentReason, visitUrgent } from './order-list';
import { buildReport, periodOf, reportText } from './reports';
import { orders, visits } from './repo';
import { getAppSettings, saveProfile } from './settings';
import { centralExport, finishSms, orderText, reminderSms } from './texts';
import { nextVisitDays } from './geo';
import type { InvoiceType, PayMethod, PestCategory, TreatmentMethod } from './types';

/**
 * Przegląd całej ścieżki zlecenia na 10 różnych ustawieniach (faktura, protokół, szkodnik, metody, płatność od razu
 * albo później, „opiszę później”, kolejny zabieg). Każdy przebieg sprawdza, czy dane, raport, pilne i księgowość
 * się zgadzają.
 */

// Powtarzalny „losowy” wybór: ten sam zestaw przypadków przy każdym uruchomieniu.
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}
const pick = <T,>(r: () => number, list: T[]): T => list[Math.floor(r() * list.length)];

const INVOICES: InvoiceType[] = ['brak', 'imienna', 'vat'];
const PESTS: PestCategory[] = ['pluskwy', 'karaluchy', 'chrzaszczowate', 'gryzonie', 'inne'];
const METHODS: TreatmentMethod[] = ['oprysk', 'ulv', 'zamglawianie', 'zelowanie', 'odplywy', 'parowanie', 'inne'];
const PAY: PayMethod[] = ['gotowka', 'blik', 'przelew'];

function draftFor(r: () => number, i: number): OrderDraft {
  const invoice = pick(r, INVOICES);
  const fixed = r() < 0.5;
  const min = 20000 + Math.floor(r() * 40) * 1000;
  const methods = [pick(r, METHODS)];
  return {
    building: r() < 0.5 ? 'blok' : 'dom',
    street: `ul. Testowa ${i}`,
    houseNo: String(i + 1),
    flatNo: r() < 0.5 ? String(i + 10) : '',
    floor: '',
    staircase: '',
    postalCode: '80-001',
    city: pick(r, ['Gdańsk', 'Gdynia', 'Sopot']),
    access: '',
    pest: pick(r, PESTS),
    pestOther: 'osy',
    description: r() < 0.7 ? `Opis ${i}` : '',
    areaM2: null,
    priceMin: min,
    priceMax: fixed ? min : min + 10000,
    invoice,
    clientName: invoice === 'brak' && r() < 0.5 ? '' : `Klient ${i}`,
    email: invoice === 'brak' ? '' : `k${i}@example.com`,
    nip: invoice === 'vat' ? '5260250274' : '',
    invoiceName: invoice === 'vat' ? `Firma ${i}` : '',
    invoiceAddress: '',
    phones: r() < 0.5 ? [{ number: `600 000 ${String(100 + i)}`, label: '' }] : [{ number: `600 000 ${String(100 + i)}`, label: 'pani' }, { number: `601 000 ${String(100 + i)}`, label: 'syn' }],
    pink: r() < 0.3,
    pinkNote: 'Uwaga',
    mapsLink: '',
    methods,
    methodOther: methods.includes('inne' as TreatmentMethod) ? 'Odymianie' : '',
    protocol: r() < 0.4,
  } as unknown as OrderDraft;
}

beforeEach(async () => {
  await db.delete();
  await db.open();
  await saveProfile({ name: 'Maurycy Test', userId: null });
});

describe('przegląd: 10 przebiegów zlecenia na różnych ustawieniach', () => {
  for (let i = 0; i < 10; i++) {
    it(`przebieg ${i + 1}`, async () => {
      const r = rng(1000 + i * 7919);
      const settings = await getAppSettings();
      const day = `2026-11-${String(10 + i).padStart(2, '0')}`;
      const draft = draftFor(r, i);
      const { order, visits: [first] } = await createOrder(draft, { start: `${day}T${pick(r, ['08:00', '10:30', '13:00'])}`, durationMin: pick(r, [45, 60, 90]) }, null);
      expect(order.number).toBeGreaterThan(0);
      expect(reminderSms(order, first, settings)).toContain(first.start!.slice(11, 16));

      // Rozpoczęcie: metody zlecenia trafiają do „wykonanych”.
      await startVisit(first.id);
      const started = (await visits.get(first.id))!;
      expect(started.status).toBe('w_trakcie');
      expect(started.treatments.length).toBeGreaterThan(0);
      expect(visitUrgent(order, started, day)).toBe('w_trakcie');

      // Czasem wycofanie rozpoczęcia i ponowny start.
      if (r() < 0.2) {
        await revertStartedVisit(first.id);
        const reverted = (await visits.get(first.id))!;
        expect(reverted.status).toBe('zaplanowany');
        expect(reverted.start).toBe(first.start);
        await startVisit(first.id);
      }

      // Płatność od razu (karta „Klient płaci od razu?”) albo brak płatności.
      const paysNow = r() < 0.75;
      const method = pick(r, PAY);
      const amount = order.priceMin!;
      if (paysNow) await visits.update(first.id, { payMethod: method, amount });

      const later = r() < 0.4;
      const nextMode = pick(r, ['brak', 'technik', 'umowiony'] as const);
      const proposed = nextVisitDays(day)[0];
      const next: NextVisit = nextMode === 'umowiony' ? { mode: 'umowiony', start: `${proposed}T10:00`, durationMin: 60 } : { mode: nextMode };
      const fresh = (await visits.get(first.id))!;
      const { next: second } = await finishVisit(first.id, {
        doneOn: day,
        payMethod: fresh.payMethod,
        amount: fresh.amount,
        treatments: fresh.treatments,
        places: ['listwy'],
        findings: '',
        problems: '',
        recommendations: ['Wietrzyć'],
        next,
        detailsLater: later,
      });
      const done = (await visits.get(first.id))!;
      expect(done.status).toBe('wykonany');
      expect(done.doneOn).toBe(day);
      expect(done.detailsLater).toBe(later);

      // Pilne: brak płatności ma pierwszeństwo, potem „do opisania”.
      const urgent = visitUrgent(order, done, day);
      if (!paysNow) expect(urgent).toBe('platnosc');
      else if (later) expect(urgent).toBe('opis');
      else expect(urgent).toBeNull();

      // Kolejny zabieg 8–12 dni po pierwszym, bez niedziel.
      if (nextMode === 'umowiony') {
        expect(second?.seq).toBe(2);
        const gap = (Date.parse(proposed) - Date.parse(day)) / 86400000;
        expect(gap).toBeGreaterThanOrEqual(8);
        expect(gap).toBeLessThanOrEqual(12);
        expect(new Date(`${proposed}T12:00:00Z`).getUTCDay()).not.toBe(0);
      } else if (nextMode === 'technik') {
        expect(second?.seq).toBe(2);
        expect(second?.start).toBeNull();
      } else {
        expect(second).toBeNull();
      }

      // Raport dnia: obrót = zapłacone, nieopłacone liczone osobno.
      const all = await orderVisits(order.id);
      const report = buildReport(periodOf('dzien', day), { visits: all, orders: [order], expenses: [], trips: [] });
      expect(report.turnover).toBe(paysNow ? amount : 0);
      expect(report.unpaid).toBe(paysNow ? 0 : 1);
      if (paysNow) expect(report.byMethod[method]).toBe(amount);
      expect(report.cashForBoss).toBe(paysNow && method === 'gotowka' ? amount : 0);
      expect(reportText(report, { technician: 'Maurycy', bossGenitive: 'Piotrka' }).length).toBeGreaterThan(10);

      // Księgowość: faktura czeka za wykonany zabieg; kompletne dane do faktury.
      const current = (await orders.get(order.id))!;
      if (current.invoice !== 'brak') {
        expect(pendingInvoices(current, all).map((v) => v.id)).toContain(first.id);
        expect(accountingState(current, all)).toBe('czeka');
        expect(invoiceMissing(current)).toEqual([]);
      } else if (!current.protocol) {
        expect(accountingState(current, all)).toBe('brak');
      }

      // Teksty: dane do skopiowania, podsumowanie, SMS po zabiegu.
      expect(centralExport(current, done, all)).toContain(String(current.number).padStart(4, '0'));
      expect(orderText(current, all, settings.vatRate).length).toBeGreaterThan(10);
      expect(finishSms(done, second, settings, 'Maurycy').length).toBeGreaterThan(10);

      // Odwołanie kolejnego (umówionego) zabiegu: wykonany zabieg I zostaje, zlecenie nie trafia do archiwum.
      if (second && second.start) {
        const { archived } = await cancelVisit(second.id);
        expect(archived).toBe(false);
        const after = await orderVisits(order.id);
        expect(isArchived((await orders.get(order.id))!, after)).toBe(false);
        expect(after.find((v) => v.id === first.id)?.status).toBe('wykonany');
        expect(after.find((v) => v.id === second.id)?.status).toBe('odwolany');
        const reason = urgentReason((await orders.get(order.id))!, after, day);
        expect(reason === null || reason === 'platnosc' || reason === 'opis').toBe(true);
      }

      // Powielenie: nowy numer, te same dane, inny lokal, zabieg I umówiony.
      if (r() < 0.5) {
        const copy = await duplicateOrder(order.id, { start: `${day}T16:00`, durationMin: 60, flatNo: '99' });
        expect(copy.number).toBeGreaterThan(order.number);
        expect(copy.flatNo).toBe('99');
        expect(copy.street).toBe(order.street);
        expect(copy.invoice).toBe(order.invoice);
        expect(copy.phones.map((p) => p.number)).toEqual(order.phones.map((p) => p.number));
        const copyVisits = await orderVisits(copy.id);
        expect(copyVisits).toHaveLength(1);
        expect(copyVisits[0].start).toBe(`${day}T16:00`);
      }
    });
  }

  it('lista „od dziś”: dziś i przyszłe rosnąco, potem bez terminu, potem minione od najnowszych', () => {
    const r = rng(42);
    const today = '2026-11-17';
    const rows = Array.from({ length: 40 }, (_, k) => {
      const kind = r();
      const start = kind < 0.15 ? null : `2026-11-${String(5 + Math.floor(r() * 25)).padStart(2, '0')}T${pick(r, ['08:00', '12:00', '16:00'])}`;
      return { order: { number: k } as never, visits: [{ seq: 1, status: 'zaplanowany', start, doneOn: null } as never] };
    });
    const sorted = sortOrderRows(rows, 'od_dzis', today);
    const keys = sorted.map((x) => (x.visits[0] as { start: string | null }).start);
    const firstNull = keys.indexOf(null);
    const future = keys.slice(0, firstNull === -1 ? keys.length : firstNull).filter((k) => k && k.slice(0, 10) >= today) as string[];
    expect(future).toEqual([...future].sort());
    const past = keys.filter((k) => k && k.slice(0, 10) < today) as string[];
    expect(past).toEqual([...past].sort().reverse());
  });
});
