import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { renamePersonInRecords } from './people';
import { messages, orders, trips, visits } from './repo';
import type { Message, Order, Trip, Visit } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('zmiana imienia konta przez admina', () => {
  it('poprawia imię w zabiegach, zleceniach, przejazdach i czacie tej osoby, cudzych nie rusza', async () => {
    const v = await visits.create({ orderId: 'o1', seq: 1, technicianId: 'u1', technicianName: 'Maciej', bookedById: 'u1', bookedByName: 'Maciej' } as unknown as Visit);
    const other = await visits.create({ orderId: 'o1', seq: 2, technicianId: 'u2', technicianName: 'Ania' } as unknown as Visit);
    const o = await orders.create({ ownerId: 'u1', ownerName: 'Maciej', deleteRequest: { byId: 'u1', byName: 'Maciej', status: 'czeka' } } as unknown as Order);
    const t = await trips.create({ ownerId: 'u1', driver: 'Maciej' } as unknown as Trip);
    const manual = await trips.create({ ownerId: 'u1', driver: 'Kierowca zastępczy' } as unknown as Trip);
    const m = await messages.create({ channel: 'firma', authorId: 'u1', authorName: 'Maciej', text: 'Hej' } as unknown as Message);

    expect(await renamePersonInRecords('u1', 'Maciej', 'Maciej Kowalski')).toBe(4);
    expect(await visits.get(v.id)).toMatchObject({ technicianName: 'Maciej Kowalski', bookedByName: 'Maciej Kowalski' });
    expect((await visits.get(other.id))?.technicianName).toBe('Ania');
    expect(await orders.get(o.id)).toMatchObject({ ownerName: 'Maciej Kowalski', deleteRequest: { byName: 'Maciej Kowalski' } });
    expect((await trips.get(t.id))?.driver).toBe('Maciej Kowalski');
    expect((await trips.get(manual.id))?.driver).toBe('Kierowca zastępczy');
    expect((await messages.get(m.id))?.authorName).toBe('Maciej Kowalski');
    // Drugi raz nic się nie zmienia.
    expect(await renamePersonInRecords('u1', 'Maciej Kowalski', 'Maciej Kowalski')).toBe(0);
  });
});
