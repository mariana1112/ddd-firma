import { useEffect, useState } from 'react';
import { assignmentText, assignVisit, smsTextUrl, whatsappUrl, type Person } from '../data/assign';
import { visitCode } from '../data/codes';
import { getRegions, getSyncState } from '../data/settings';
import type { Order, SyncState, Visit } from '../data/types';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Sheet } from '../ui/kit';
import { copyText } from './common';

const supabaseApi = () => import('../data/sync/supabase');

type Member = { userId: string; displayName: string; email: string; role: string; branchId: string | null; approved: boolean; suspended?: boolean };

/**
 * Przydział technika do jednego zlecenia (zabiegu): najpierw technicy regionu zlecenia, a admin widzi też techników
 * z innych regionów. Ich region się nie zmienia: przydział dotyczy tylko tego zlecenia. Zastępstwo w całym regionie
 * ustawia się w panelu admina (Zastępstwa). Po przydziale: gotowa wiadomość na WhatsApp albo SMS.
 */
export function AssignSheet(props: { order: Order; visit: Visit; open: boolean; onClose: () => void }) {
  const { run, toast } = useFeedback();
  const [state, setState] = useState<SyncState | null | undefined>(undefined);
  const [members, setMembers] = useState<Member[] | null | 'offline'>(null);
  const [access, setAccess] = useState<Array<{ userId: string; branchId: string }>>([]);
  const [regionNames, setRegionNames] = useState<Record<string, string>>({});
  const [notify, setNotify] = useState<(Person & { outside?: boolean }) | null>(null);

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

  const assign = (person: Person, outside = false) =>
    run(async () => {
      await assignVisit(props.visit.id, person);
      toast(`Przydzielono: ${person.name}`);
      setNotify({ ...person, outside });
    });

  const text = notify ? assignmentText(props.order, props.visit, notify.name, notify.outside) : '';

  return (
    <Sheet open={props.open} title={notify ? `Powiadom: ${notify.name}` : `Przydziel technika · ${visitCode(props.order, props.visit.seq)}`} onClose={props.onClose}>
      {notify ? (
        <div className="form">
          {notify.outside ? (
            <p className="notice notice-warn">
              <Icon name="alert" />
              <span>{notify.name} jest w innym regionie i nie zobaczy tego zlecenia w swojej aplikacji. Wyślij mu wiadomość ze wszystkimi danymi:</span>
            </p>
          ) : (
            <p className="notice notice-info">
              <Icon name="bell" />
              <span>{notify.name} dostanie powiadomienie w aplikacji (dzwoneczek), gdy jego telefon się zsynchronizuje. Możesz też od razu wysłać wiadomość:</span>
            </p>
          )}
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
              <span className="field-label">Z innego regionu (tylko to zlecenie)</span>
              {others.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  className={props.visit.assignedId === m.userId ? 'assign-person assign-other active' : 'assign-person assign-other'}
                  onClick={() => void assign({ id: m.userId, name: name(m) }, true)}
                >
                  <span className="assign-avatar">{name(m).slice(0, 1).toUpperCase()}</span>
                  <span>
                    <strong>{name(m)}</strong>
                    <small>region {m.branchId ? (regionNames[m.branchId] ?? '—') : 'brak'}</small>
                  </span>
                </button>
              ))}
              <p className="field-hint">Region technika się nie zmienia. Zastępstwo w całym regionie ustawisz w panelu admina (Zastępstwa).</p>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
