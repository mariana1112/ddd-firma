import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { localOrderCounter, nextOrderNumber, orderNumbersKey, orderSeries } from './settings';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const setRegion = (branchId: string) =>
  db.meta.put({ key: 'sync', value: { orgId: 'org', branchId, role: 'technik' }, updatedAt: new Date().toISOString() });

describe('numeracja zleceń osobno dla każdego regionu', () => {
  it('region ma własną serię i pulę numerów', () => {
    expect(orderSeries('gda')).toBe('order:gda');
    expect(orderSeries(null)).toBe('order');
    expect(orderNumbersKey('gda')).toBe('numbers:order:gda');
  });

  it('numer w jednym regionie nie przesuwa numeracji w drugim; region ciągnie od swojego najwyższego numeru', async () => {
    await db.orders.bulkPut([
      { id: 'a', number: 141, branchId: 'gda' },
      { id: 'b', number: 150, branchId: 'ldz' },
    ] as never);
    await setRegion('gda');
    expect(await localOrderCounter()).toBe(141);
    expect(await nextOrderNumber()).toBe(142);
    await setRegion('ldz');
    expect(await nextOrderNumber()).toBe(151);
    expect(await nextOrderNumber()).toBe(152);
    await setRegion('gda');
    expect(await nextOrderNumber()).toBe(143);
  });

  it('pula regionu z serwera jest używana, a numery poniżej najwyższego w regionie są pomijane', async () => {
    await setRegion('gda');
    await db.orders.put({ id: 'a', number: 141, branchId: 'gda' } as never);
    await db.meta.put({ key: orderNumbersKey('gda'), value: [{ next: 100, end: 119 }, { next: 142, end: 161 }], updatedAt: '' });
    expect(await nextOrderNumber()).toBe(142);
    expect(await nextOrderNumber()).toBe(143);
  });
});
