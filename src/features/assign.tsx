import { useEffect, useState } from 'react';
import { assignmentText, assignVisit, smsTextUrl, whatsappUrl, type Person } from '../data/assign';
import { visitCode } from '../data/codes';
import { getRegions, getSyncState, saveSubstitution } from '../data/settings';
import type { Order, SyncState, Visit } from '../data/types';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Sheet } from '../ui/kit';
import { copyText } from './common';

const supabaseApi = () => import('../data/sync/supabase');

type Member = { userId: string; displayName: string; email: string; role: string; branchId: string | null; approved: boolean; suspended?: boolean };

/**
 * Przydział technika do zabiegu: najpierw technicy regionu zlecenia, a admin widzi też techników z innych regionów
 * (wybór takiej osoby to zastępstwo: technik przechodzi do regionu zlecenia, a po zakończeniu wraca do swojego).
 * Po przydziale: powiadomienie w aplikacji (dzwoneczek) i gotowa wiadomość na WhatsApp albo SMS.
 */
export function AssignSheet(props: { order: Order; visit: Visit; open: boolean; onClose: () => void }) {
  const { confirm, run, toast } = useFeedback();
  const [state, setState] = useState<SyncState | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[] | null | 'offline'>(null);
  const [access, setAccess] = useState<Array<{ userId: string; branchId: string }>>([]);
  const [regionNames, setRegionNames] = useState<Record<string, string>>({});
  const [notify, setNotify] = useState<Person | null>(null);

  useEffect(() => {
    if (!props.open) return;
    setNotify(null);
    void (async () => {
      const s = await getSyncState();
      setState(s);
      setRegionNames(Object.fromEntries(Object.entries(await getRegions()).map(([id, info]) => [id, info.name])));
      if (!s) return;
      try {
        const api = await supabaseApi();
        const [list, pairs] = await Promise.all([api.listMembers(s.orgId), api.listMemberBranches(s.orgId).catch(() => [])]);
        setMembers(list as Member[]);
        setAccess(pairs);
      } catch {
        setMembers('offline');
      }
    })();
  }, [props.open]);

  const region = props.order.branchId ?? state?.branchId ?? null;
  const owner = state?.role === 'owner';
  const people = Array.isArray(members) ? members.filter((m) => m.approved && !m.suspended && m.role !== 'ksiegowosc') : [];
  const inRegion = (m: Member) => !region || m.branchId === region || access.some((a) => a.userId === m.userId && a.branchId === region);
  const local = people.filter(inRegion);
  const others = owner ? people.filter((m) => !inRegion(m)) : [];
  const name = (m: Member) => m.displayName || m.email || 'Technik';

  const assign = (person: Person) =>
    run(async () => {
      await assignVisit(props.visit.id, person);
      toast(`Przydzielono: ${person.name}`);
      setNotify(person);
    });

  /** Zastępstwo: technik z innego regionu przechodzi do regionu zlecenia (admin), potem przydział. */
  const substitute = async (m: Member) => {
    if (!state || !region) return;
    const toName = regionNames[region] ?? 'tego regionu';
    const ok = await confirm({
      title: `Zastępstwo: ${name(m)}`,
      message: `${name(m)} przejdzie z regionu ${m.branchId ? (regionNames[m.branchId] ?? 'swojego') : 'bez regionu'} do regionu ${toName}. W tym czasie zobaczy zlecenia regionu ${toName}, a jego zabiegi wpadną do raportu tego regionu. Zastępstwo zakończysz w panelu admina (Zastępstwa) i wtedy wróci do swojego regionu.`,
      confirmLabel: 'Przenieś na zastępstwo',
    });
    if (!ok) return;
    await run(async () => {
      await (await supabaseApi()).setMemberBranch(state.orgId, m.userId, region);
      await saveSubstitution({
        userId: m.userId,
        name: name(m),
        home: m.branchId,
        homeName: m.branchId ? (regionNames[m.branchId] ?? '') : '',
        to: region,
        toName,
        since: new Date().toISOString(),
      });
      await assignVisit(props.visit.id, { id: m.userId, name: name(m) });
      toast(`${name(m)} na zastępstwie w regionie ${toName}`);
      setNotify({ id: m.userId, name: name(m) });
    });
  };

  const text = notify ? assignmentText(props.order, props.visit, notify.name) : '';

  return (
    <Sheet open={props.open} title={notify ? `Powiadom: ${notify.name}` : `Przydziel technika · ${visitCode(props.order, props.visit.seq)}`} onClose={props.onClose}>
      {notify ? (
        <div className="form">
          <p className="notice notice-info">
            <Icon name="bell" />
            <span>{notify.name} dostanie powiadomienie w aplikacji (dzwoneczek), gdy jego telefon się zsynchronizuje. Możesz też od razu wysłać wiadomość:</span>
          </p>
          <pre className="assign-text">{text}</pre>
          <a className="btn btn-primary btn-block btn-whatsapp" href={whatsappUrl(text)} target="_blank" rel="noreferrer">
            <Icon name="message" /> Wyślij na WhatsApp
          </a>
          <a className="btn btn-block" href={smsTextUrl(text)}>
            <Icon name="message" /> Wyślij SMS
          </a>
          <button type="button" className="btn btn-block" onClick={() => void copyText(text).then((ok) => toast(ok ? 'Skopiowano wiadomość' : 'Nie udało się skopiować'))}>
            <Icon name="copy" /> Kopiuj wiadomość
          </button>
          <button type="button" className="btn btn-block" onClick={props.onClose}>
            Gotowe
          </button>
        </div>
      ) : (
        <div className="form">
          {state === null && <p className="field-hint">Przydział techników działa na koncie firmy.</p>}
          {members === 'offline' && <p className="field-hint">Lista techników wymaga internetu. Spróbuj ponownie po połączeniu.</p>}
          {state && members === null && <div className="loading" role="status" aria-label="Wczytuję techników" />}
          {props.visit.assignedName && (
            <div className="assign-current">
              <span>
                Teraz: <strong>{props.visit.assignedName}</strong>
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void run(async () => {
                    await assignVisit(props.visit.id, null);
                    toast('Zdjęto przydział');
                    props.onClose();
                  })
                }
              >
                Bez przydziału
              </button>
            </div>
          )}
          {local.length > 0 && <span className="field-label">Technicy regionu {region ? (regionNames[region] ?? '') : ''}</span>}
          {local.map((m) => (
            <button key={m.userId} type="button" className={props.visit.assignedId === m.userId ? 'assign-person active' : 'assign-person'} onClick={() => void assign({ id: m.userId, name: name(m) })}>
              <span className="assign-avatar">{name(m).slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{name(m)}</strong>
                <small>{m.role === 'owner' ? 'admin' : 'technik'}</small>
              </span>
            </button>
          ))}
          {others.length > 0 && (
            <>
              <span className="field-label">Z innego regionu (zastępstwo)</span>
              {others.map((m) => (
                <button key={m.userId} type="button" className="assign-person assign-other" onClick={() => void substitute(m)}>
                  <span className="assign-avatar">{name(m).slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>{name(m)}</strong>
                    <small>region {m.branchId ? (regionNames[m.branchId] ?? '—') : 'brak'}</small>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
