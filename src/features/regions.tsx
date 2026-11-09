import { useEffect, useState } from 'react';
import { getDataKey, getSyncState, setSyncState } from '../data/settings';
import { syncInBackground } from '../data/sync/runner';
import type { SyncState } from '../data/types';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Field, Group, Row } from '../ui/kit';

const supabaseApi = () => import('../data/sync/supabase');

/**
 * Przejście do innego regionu na tym urządzeniu. Serwer zmienia aktywny region konta, a urządzenie pobiera dane
 * od nowa: rekordy innego regionu nie były tu wcześniej widoczne.
 */
export async function enterRegion(state: SyncState, branch: { id: string; name: string }): Promise<void> {
  await (await supabaseApi()).switchBranch(state.orgId, branch.id);
  const latest = (await getSyncState()) ?? state;
  await setSyncState({ ...latest, branchId: branch.id, branchName: branch.name, regionsTagged: false });
  void syncInBackground().catch(() => undefined);
}

/** Regiony konta: aktywny, przejście do innego i dołączenie do kolejnego regionu samym kodem. */
export function RegionSwitcher({ state }: { state: SyncState }) {
  const { run, toast } = useFeedback();
  const [branches, setBranches] = useState<Array<{ id: string; name: string }> | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const owner = state.role === 'owner';

  const load = async () => {
    // RLS: admin widzi wszystkie regiony firmy, technik tylko swoje.
    setBranches(await (await supabaseApi()).listBranches(state.orgId));
  };

  useEffect(() => {
    void load().catch(() => setBranches(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.orgId]);

  const join = () =>
    run(async () => {
      const key = await getDataKey();
      if (!key) throw new Error('Brak klucza firmy na tym urządzeniu.');
      setBusy(true);
      try {
        const ok = await (await supabaseApi()).joinAnotherRegion(code, key);
        if (!ok) {
          toast('Kod nie pasuje do hasła firmy na tym urządzeniu.', { tone: 'error' });
          return;
        }
        setCode('');
        await load();
        toast('Dołączono do regionu. Przejdź do niego poniżej.');
      } finally {
        setBusy(false);
      }
    });

  return (
    <Group title="Regiony tego konta">
      {branches === null && <p className="field-hint group-pad">Lista regionów wymaga internetu.</p>}
      {branches?.length === 0 && <p className="field-hint group-pad">Brak regionów. {owner ? 'Utwórz region w panelu admina.' : 'Poproś admina o kod do regionu.'}</p>}
      {branches?.map((b) => (
        <Row
          key={b.id}
          icon="building"
          title={b.name}
          sub={b.id === state.branchId ? 'Aktywny na tym urządzeniu' : owner ? 'Admin może wejść do każdego regionu' : 'Masz dostęp'}
          onClick={
            b.id === state.branchId
              ? undefined
              : () =>
                  void run(async () => {
                    await enterRegion(state, b);
                    toast(`Jesteś w regionie ${b.name}`);
                  })
          }
          trailing={b.id === state.branchId ? <Badge tone="ok">Aktywny</Badge> : <Badge tone="primary">Przejdź</Badge>}
        />
      ))}
      <form
        className="form group-pad"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) void join();
        }}
      >
        <Field label="Dołącz do kolejnego regionu" hint="Kod weryfikacyjny od admina. Ten sam e-mail może należeć do kilku regionów.">
          <input value={code} autoCapitalize="characters" autoComplete="off" placeholder="Kod, np. ABCD2345EF" onChange={(e) => setCode(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-block" disabled={busy || code.trim().length < 10}>
          <Icon name="plus" /> {busy ? 'Dołączam…' : 'Dołącz kodem'}
        </button>
      </form>
    </Group>
  );
}
