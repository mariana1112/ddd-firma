import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createComplaint, createOrder, finishVisit, nextVisitSeq, orderVisits, renumberVisit, scheduleNextVisit, type OrderDraft } from './orders';
import { visits } from './repo';
import { buildReport, byTechnician } from './reports';
import { paymentMissing } from './order-list';
import { doneVisits } from './accounting';
import { visitLabel } from './codes';

const draft = (): OrderDraft => ({
  building: 'dom', street: 'Polna', houseNo: '1', flatNo: '', floor: '', staircase: '', postalCode: '80-001', city: 'Gdańsk', access: '',
  pest: 'karaluchy', pestOther: '', description: '', areaM2: null, priceMin: 30000, priceMax: 35000, invoice: 'brak', clientName: 'Jan',
  email: '', nip: '', invoiceAddress: '', phones: [{ number: '600700800', label: '' }], pink: false, pinkNote: '',
});

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function doneFirst() {
  const { order, visits: [first] } = await createOrder(draft(), { start: '2026-11-10T10:00', durationMin: 60 }, null);
  await visits.update(first.id, { status: 'wykonany', doneOn: '2026-11-10', payMethod: 'gotowka', amount: 35000 });
  return { order, first: (await visits.get(first.id))! };
}

describe('reklamacja', () => {
  it('zabieg gratis: ten sam numer co reklamowany, dopisek, cena 0, bez płatności i bez faktury', async () => {
    const { order, first } = await doneFirst();
    const g = await createComplaint(first.id, { kind: 'gratis', note: 'karaluchy wróciły', start: '2026-11-20T09:00' });
    expect(g).toMatchObject({ seq: 1, complaintOf: first.id, complaintKind: 'gratis', priceMin: 0, priceMax: 0, start: '2026-11-20T09:00', status: 'zaplanowany' });
    expect(visitLabel(order, g)).toBe(`${visitLabel(order, first)} reklamacja`);
    expect(paymentMissing({ ...g, status: 'wykonany', payMethod: null, amount: null })).toBe(false);
    expect(doneVisits([{ ...g, status: 'wykonany' } as never])).toEqual([]);
    // Reklamacja nie zmienia numeracji: kolejny zabieg to dalej II.
    expect(nextVisitSeq(await orderVisits(order.id))).toBe(2);
    const second = await scheduleNextVisit(order.id, { start: '2026-11-25T10:00', durationMin: 60 });
    expect(second.seq).toBe(2);
  });

  it('zwrot pieniędzy odejmuje się od utargu (i gotówki do oddania), ale nie jest zabiegiem technika', async () => {
    const { first } = await doneFirst();
    await createComplaint(first.id, { kind: 'zwrot', note: '', refund: { amount: 20000, method: 'gotowka', date: '2026-11-12' } });
    const all = await visits.all();
    const report = buildReport({ kind: 'month', from: '2026-11-01', to: '2026-11-30' } as never, { visits: all, orders: await db.orders.toArray(), expenses: [], trips: [] });
    expect(report.turnover).toBe(15000);
    expect(report.byMethod.gotowka).toBe(15000);
    expect(report.unpaid).toBe(0);
    expect(byTechnician(report).reduce((n, r) => n + r.visits, 0)).toBe(1);
  });

  it('rabat i inne: cena po rabacie, opis wymagany przy „inne”; kończenie reklamacji nie tworzy kolejnego zabiegu', async () => {
    const { order, first } = await doneFirst();
    const r = await createComplaint(first.id, { kind: 'rabat', note: '', price: 15000, start: '2026-11-21T10:00' });
    expect(r).toMatchObject({ priceMin: 15000, priceMax: 15000, seq: 1 });
    await expect(createComplaint(first.id, { kind: 'inne', note: '  ' })).rejects.toThrow('Opisz');
    await visits.update(r.id, { status: 'w_trakcie' });
    await finishVisit(r.id, { payMethod: 'blik', amount: 15000, treatments: [], places: [], findings: '', problems: '', recommendations: [], next: { mode: 'brak' } });
    expect((await orderVisits(order.id)).filter((v) => v.seq === 2)).toEqual([]);
  });
});

describe('zmiana numeru zabiegu', () => {
  it('zamiana z zabiegiem o tym numerze; reklamacje idą za swoim zabiegiem', async () => {
    const { order, first } = await doneFirst();
    const second = await scheduleNextVisit(order.id, { start: '2026-11-25T10:00', durationMin: 60 });
    const c = await createComplaint(first.id, { kind: 'gratis', note: '', start: '2026-11-20T09:00' });
    await renumberVisit(first.id, 2);
    expect((await visits.get(first.id))?.seq).toBe(2);
    expect((await visits.get(second.id))?.seq).toBe(1);
    expect((await visits.get(c.id))?.seq).toBe(2);
    await expect(renumberVisit(c.id, 3)).rejects.toThrow('reklamacyjny');
    await renumberVisit(second.id, 3);
    expect((await visits.get(second.id))?.seq).toBe(3);
  });
});
