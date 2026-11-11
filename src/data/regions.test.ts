import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { getRegions, matchRegionsToServer, saveRegions } from './settings';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('lista regionów firmy', () => {
  it('usunięte na serwerze regiony znikają całkowicie, prefiksy zostają, nowe nazwy dochodzą', async () => {
    await saveRegions({
      a: { name: 'Pomorskie', prefix: 'GD' },
      b: { name: 'Testowy', prefix: 'TS' },
      c: { name: 'Stary', prefix: '' },
    });
    expect(await matchRegionsToServer([{ id: 'a', name: 'Pomorskie' }, { id: 'd', name: 'Mazowieckie' }])).toBe(true);
    expect(await getRegions()).toEqual({ a: { name: 'Pomorskie', prefix: 'GD' }, d: { name: 'Mazowieckie', prefix: '' } });
    // Zmiana idzie do synchronizacji, więc inne telefony też tracą usunięte regiony.
    expect(await db.changes.where('tbl').equals('meta').count()).toBeGreaterThan(0);
    // Bez różnic nic się nie zapisuje.
    expect(await matchRegionsToServer([{ id: 'a', name: 'Pomorskie' }, { id: 'd', name: 'Mazowieckie' }])).toBe(false);
  });
});
