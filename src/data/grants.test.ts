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
