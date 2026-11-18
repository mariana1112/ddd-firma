import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { FULL_PERMISSIONS, getPermissionMap, permissionsFor, setMemberPermissions, SYNCED_META_KEYS } from './settings';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('uprawnienia techników', () => {
  it('domyślnie technik może wszystko; admin i aplikacja bez konta zawsze', async () => {
    expect(permissionsFor('technik', 't1', {})).toEqual(FULL_PERMISSIONS);
    expect(permissionsFor('owner', 'a1', { a1: { addOrders: false } })).toEqual(FULL_PERMISSIONS);
    expect(permissionsFor(null, null, {})).toEqual(FULL_PERMISSIONS);
  });

  it('admin odbiera wybrane uprawnienia; pełne uprawnienia usuwają wpis; ustawienie jest wspólne dla firmy', async () => {
    await setMemberPermissions('t1', { ...FULL_PERMISSIONS, addOrders: false, costs: false });
    const map = await getPermissionMap();
    expect(permissionsFor('technik', 't1', map)).toEqual({ ...FULL_PERMISSIONS, addOrders: false, costs: false });
    expect(permissionsFor('technik', 't2', map)).toEqual(FULL_PERMISSIONS);
    expect(SYNCED_META_KEYS).toContain('permissions');
    expect(await db.changes.where('[tbl+recordId]').equals(['meta', 'permissions']).count()).toBeGreaterThan(0);

    await setMemberPermissions('t1', FULL_PERMISSIONS);
    expect(await getPermissionMap()).toEqual({});
  });
});
