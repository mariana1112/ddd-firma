import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createOrder, finishVisit, startVisit, type OrderDraft } from './orders';
import { urgentReason, URGENT_LABEL, visitUrgent } from './order-list';
import { visits } from './repo';
import { saveProfile } from './settings';

const draft: OrderDraft = {
  building: 'blok',
  street: 'ul. Świętojańska',
  houseNo: '12',
  flatNo: '5',
  floor: '3',
  staircase: 'B',
  postalCode: '81-368',
  city: 'Gdynia',
  access: '',
  pest: 'karaluchy',
  pestOther: '',
  description: '',
  areaM2: 48,
  priceMin: 30000,
  priceMax: 30000,
  invoice: 'brak',
  clientName: 'Jan Kowalski',
  email: '',
  nip: '',
  invoiceAddress: '',
  phones: [{ number: '600 700 800', label: '' }],
  pink: false,
  pinkNote: '',
} as OrderDraft;

beforeEach(async () => {
  await db.delete();
  await db.open();
  await saveProfile({ name: 'Maurycy', userId: null });
});

describe('zakończ teraz, opiszę później', () => {
  it('zabieg zakończony z płatnością czeka w „Pilnych” jako „Do opisania”, dopóki opis nie zostanie dopisany', async () => {
    const { order, visits: [first] } = await createOrder(draft, { start: '2026-11-17T10:00', durationMin: 60 }, null);
    await startVisit(first.id);
    // Klient płaci od razu: płatność zapisana jeszcze w trakcie zabiegu.
    await visits.update(first.id, { payMethod: 'gotowka', amount: 30000 });
    await finishVisit(first.id, {
      payMethod: 'gotowka',
      amount: 30000,
      treatments: [],
      places: [],
      findings: '',
      problems: '',
      recommendations: [],
      next: { mode: 'technik' },
      detailsLater: true,
    });
    const done = (await visits.get(first.id))!;
    expect(done.status).toBe('wykonany');
    expect(done.amount).toBe(30000);
    expect(visitUrgent(order, done, '2026-11-17')).toBe('opis');
    expect(URGENT_LABEL.opis).toBe('Do opisania');
    expect(urgentReason(order, [done], '2026-11-17')).toBe('opis');

    // Dopisany opis zdejmuje znacznik.
    await visits.update(first.id, { detailsLater: false });
    expect(visitUrgent(order, (await visits.get(first.id))!, '2026-11-17')).toBeNull();
  });

  it('zwykłe zakończenie nie oznacza zabiegu do opisania', async () => {
    const { order, visits: [first] } = await createOrder(draft, { start: '2026-11-17T10:00', durationMin: 60 }, null);
    await startVisit(first.id);
    await finishVisit(first.id, {
      payMethod: 'blik',
      amount: 30000,
      treatments: ['Żelowanie'],
      places: [],
      findings: '',
      problems: '',
      recommendations: [],
      next: { mode: 'brak' },
    });
    const done = (await visits.get(first.id))!;
    expect(done.detailsLater).toBe(false);
    expect(visitUrgent(order, done, '2026-11-17')).toBeNull();
  });
});
