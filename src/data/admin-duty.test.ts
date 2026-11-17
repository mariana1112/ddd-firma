import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { getAdminOff, getSyncState, getUiSyncState, isDeviceMetaKey, setAdminOff } from './settings';
import type { SyncState } from './types';

const account = (role: SyncState['role']) =>
  ({ userId: 'u1', email: 'a@b.pl', orgId: 'o1', role, cursor: 0, lastSyncAt: null, lastError: null }) as unknown as SyncState;

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('tryb admina (po służbie)', () => {
  it('admin z wyłączonym trybem widzi aplikację jak technik, a prawdziwa rola zostaje', async () => {
    await db.meta.put({ key: 'sync', value: account('owner'), updatedAt: '' });
    expect((await getUiSyncState())?.role).toBe('owner');
    await setAdminOff(true);
    expect(await getAdminOff()).toBe(true);
    expect((await getUiSyncState())?.role).toBe('technik');
    expect((await getUiSyncState())?.userId).toBe('u1');
    // Synchronizacja i klucze dalej widzą admina.
    expect((await getSyncState())?.role).toBe('owner');
    await setAdminOff(false);
    expect((await getUiSyncState())?.role).toBe('owner');
  });

  it('nie zmienia innych ról i nie trafia na serwer ani do kopii', async () => {
    await db.meta.put({ key: 'sync', value: account('ksiegowosc'), updatedAt: '' });
    await setAdminOff(true);
    expect((await getUiSyncState())?.role).toBe('ksiegowosc');
    expect(isDeviceMetaKey('adminOff')).toBe(true);
    expect(await db.changes.count()).toBe(0);
  });
});
