import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { initViewScope, scopeFilter, setGrantedRecords, setOwnBranch, setViewScope } from './scope';

describe('zlecenie udostępnione technikowi z innego regionu', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    setOwnBranch({ branchId: 'ldz' });
    setViewScope(null);
  });
  afterEach(async () => {
    await setGrantedRecords([]);
    setOwnBranch(null);
  });

  it('jest na listach obok rekordów własnego regionu; inne zlecenia tamtego regionu nie', async () => {
    await setGrantedRecords(['z1', 'w1']);
    const inScope = scopeFilter()!;
    expect(inScope({ id: 'x', branchId: 'ldz' })).toBe(true);
    expect(inScope({ id: 'z1', branchId: 'gda' })).toBe(true);
    expect(inScope({ id: 'w1', branchId: 'gda' })).toBe(true);
    expect(inScope({ id: 'z2', branchId: 'gda' })).toBe(false);
  });

  it('po odebraniu udostępnienia znika z list', async () => {
    await setGrantedRecords(['z1']);
    await setGrantedRecords([]);
    expect(scopeFilter()!({ id: 'z1', branchId: 'gda' })).toBe(false);
  });

  it('lista udostępnień przetrwa ponowne uruchomienie aplikacji', async () => {
    await setGrantedRecords(['z1']);
    await initViewScope();
    setOwnBranch({ branchId: 'ldz' });
    expect(scopeFilter()!({ id: 'z1', branchId: 'gda' })).toBe(true);
  });

  it('w panelu admina (wybrany region) udostępnienia niczego nie dokładają', async () => {
    await setGrantedRecords(['z1']);
    setViewScope('ldz');
    expect(scopeFilter()!({ id: 'z1', branchId: 'gda' })).toBe(false);
    setViewScope(null);
  });
});

describe('zabieg z innym regionem niż jego zlecenie', () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    setOwnBranch({ branchId: 'gda' });
    setViewScope(null);
  });
  afterEach(() => setOwnBranch(null));

  it('jest w kalendarzu i na listach regionu zlecenia (zabieg umówiony przez kogoś z innego regionu)', async () => {
    const { visits } = await import('./repo');
    const base = { createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', deletedAt: null };
    await db.orders.put({ ...base, id: 'z1', branchId: 'gda' } as never);
    await db.orders.put({ ...base, id: 'z2', branchId: 'ldz' } as never);
    // Zabieg II zlecenia z Gdańska zapisany przez kogoś z Łodzi: serwer dał mu region Łodzi.
    await db.visits.put({ ...base, id: 'w2', orderId: 'z1', seq: 2, branchId: 'ldz', start: '2026-12-02T10:00', status: 'zaplanowany' } as never);
    // Zabieg zlecenia z Łodzi w regionie Łodzi: dalej niewidoczny w Gdańsku.
    await db.visits.put({ ...base, id: 'w3', orderId: 'z2', seq: 1, branchId: 'ldz', start: '2026-12-02T12:00', status: 'zaplanowany' } as never);
    expect((await visits.all()).map((v) => v.id)).toEqual(['w2']);
  });
});
