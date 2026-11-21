import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { createOrder, type OrderDraft } from './orders';
import { findDuplicates, keepOrder, markNotDuplicate } from './duplicates';
import { addressMissing, nextVisitOfDay, urgentReason, visitUrgent } from './order-list';
import { orders, visits } from './repo';
import { saveProfile } from './settings';
import type { Visit } from './types';

const v = (id: string, start: string, status: Visit['status'] = 'zaplanowany', durationMin = 60) => ({ id, start, status, durationMin, deletedAt: null }) as Visit;

describe('następny zabieg w kolejce dnia', () => {
  const day = [v('a', '2026-11-20T08:00'), v('b', '2026-11-20T09:00'), v('c', '2026-11-20T10:00'), v('x', '2026-11-21T08:00')];
  it('gdy zabieg trwa, następny jest po nim', () => {
    expect(nextVisitOfDay([{ ...day[0], status: 'w_trakcie' }, day[1], day[2]], '2026-11-20T08:20')).toBe('b');
  });
  it('bez trwającego: najbliższy, którego czas jeszcze nie minął', () => {
    expect(nextVisitOfDay(day, '2026-11-20T07:30')).toBe('a');
    expect(nextVisitOfDay(day, '2026-11-20T09:30')).toBe('b');
    expect(nextVisitOfDay(day, '2026-11-20T11:30')).toBeNull();
  });
});

describe('adres podany później', () => {
  it('umówiony zabieg bez adresu jest pilny („Brak adresu”)', () => {
    const order = { archived: false, street: '', city: '' };
    expect(addressMissing(order)).toBe(true);
    expect(visitUrgent(order, v('a', '2026-11-25T10:00'), '2026-11-20')).toBe('adres');
    expect(urgentReason(order, [v('a', '2026-11-25T10:00')], '2026-11-20')).toBe('adres');
    expect(addressMissing({ street: 'Długa', city: 'Gdańsk' })).toBe(false);
  });
});

const draft = (phone: string): OrderDraft =>
  ({
    building: 'dom', street: 'Długa', houseNo: '1', flatNo: '', floor: '', staircase: '', postalCode: '80-001', city: 'Gdańsk', access: '',
    pest: 'pluskwy', pestOther: '', description: '', areaM2: null, priceMin: 30000, priceMax: 30000, invoice: 'brak', clientName: '', email: '',
    nip: '', invoiceAddress: '', phones: [{ number: phone, label: '' }], pink: false, pinkNote: '',
  }) as OrderDraft;

describe('to samo zlecenie zapisane dwa razy', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await saveProfile({ name: 'Maurycy', userId: null });
  });

  it('wykrywa parę z tym samym telefonem; wybór zostawia jedno, drugie w archiwum z dopiskiem', async () => {
    const a = (await createOrder(draft('600 100 200'), { start: '2026-11-25T10:00', durationMin: 60 }, null)).order;
    const b = (await createOrder(draft('+48 600 100 200'), { start: '2026-11-25T10:00', durationMin: 60 }, null)).order;
    await createOrder(draft('600 999 999'), { start: '2026-11-25T12:00', durationMin: 60 }, null);
    const pairs = findDuplicates(await orders.all(), await visits.all());
    expect(pairs).toHaveLength(1);
    await keepOrder(pairs[0].a, pairs[0].b);
    const dropped = (await orders.get(b.id))!;
    expect(dropped.archived).toBe(true);
    expect(dropped.archivedNote).toContain(String(a.number).padStart(4, '0'));
    expect(findDuplicates(await orders.all(), await visits.all())).toHaveLength(0);
  });

  it('„to dwa różne zlecenia” ukrywa parę', async () => {
    await createOrder(draft('600 100 200'), { start: '2026-11-25T10:00', durationMin: 60 }, null);
    await createOrder(draft('600 100 200'), { start: '2026-11-26T10:00', durationMin: 60 }, null);
    const [pair] = findDuplicates(await orders.all(), await visits.all());
    await markNotDuplicate(pair.a, pair.b);
    expect(findDuplicates(await orders.all(), await visits.all())).toHaveLength(0);
  });
});
