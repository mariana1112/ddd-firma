import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { getPermissionMap, getUiSyncState, PERMISSIONS, permissionsFor, type Permission, type PermissionSet } from '../data/settings';
import { Empty, Loading, Page } from '../ui/kit';

/** Uprawnienia zalogowanej osoby (undefined: jeszcze się wczytują). */
export function usePermissions(): PermissionSet | undefined {
  return useLiveQuery(async () => {
    const state = await getUiSyncState();
    return permissionsFor(state?.role ?? null, state?.userId ?? null, await getPermissionMap());
  });
}

/** Ekran tylko z uprawnieniem; bez niego informacja, że trzeba poprosić admina. */
export function Allowed(props: { perm: Permission; title: string; back: string; children: ReactNode }) {
  const perms = usePermissions();
  if (!perms) return <Loading />;
  if (perms[props.perm]) return <>{props.children}</>;
  const label = PERMISSIONS.find((p) => p.key === props.perm)?.label ?? '';
  return (
    <Page title={props.title} back={props.back}>
      <Empty icon="users" title="Nie masz tego uprawnienia">
        <p className="field-hint">„{label}” wyłączył admin. Poproś admina, jeśli potrzebujesz.</p>
      </Empty>
    </Page>
  );
}
