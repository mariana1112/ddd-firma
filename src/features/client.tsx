import { useLiveQuery } from 'dexie-react-hooks';
import { useParams } from 'react-router-dom';
import { groupClients, type ClientGroup } from '../data/clients-view';
import { roman, visitCode } from '../data/codes';
import { normalizeInterview } from '../data/interview';
import { orders, visits } from '../data/repo';
import { orderAddress, PAY_NAMES, pestName, telUrl, workSummary } from '../data/texts';
import type { Order, Visit } from '../data/types';
import { formatDate, formatTerm } from '../lib/dates';
import { formatPln } from '../data/reports';
import { withCountryCode } from '../lib/validators';
import { Icon } from '../ui/icons';
import { Badge, Empty, Group, Info, Loading, NotFound, Page, Row } from '../ui/kit';

/** Karta klienta w wynikach wyszukiwania: imię, telefon, ile zabiegów umówionych i wykonanych. */
export function ClientRow({ client }: { client: ClientGroup }) {
  const sub = [client.phones[0] ? withCountryCode(client.phones[0].number) : '', client.addresses[0] ?? ''].filter(Boolean).join(' · ');
  return (
    <Row
      to={`/klient/${client.key}`}
      icon="users"
      title={client.name || (client.phones[0] ? withCountryCode(client.phones[0].number) : 'Klient')}
      sub={sub}
      trailing={
        <span className="row-end">
          {client.planned.length > 0 && <Badge tone="info">{client.planned.length} do zrobienia</Badge>}
          {client.done.length > 0 && <Badge tone="ok">{client.done.length} wykonane</Badge>}
        </span>
      }
    />
  );
}

function DoneVisit({ visit, order }: { visit: Visit; order: Order }) {
  const i = normalizeInterview(visit.interview);
  return (
    <details className="client-visit">
      <summary>
        <span>
          <strong>{visitCode(order, visit.seq)}</strong> · {formatDate(visit.doneOn ?? visit.start)} · {pestName(order)}
        </span>
        <span className="row-sub">
          {[workSummary(visit), visit.amount !== null ? `${formatPln(visit.amount)}${visit.payMethod ? `, ${PAY_NAMES[visit.payMethod]}` : ''}` : 'bez płatności', visit.technicianName].filter(Boolean).join(' · ')}
        </span>
      </summary>
      <div className="client-visit-body">
        {i.situation && <Info label="Opis">{i.situation}</Info>}
        {i.seenCount && <Info label="Skala populacji">{i.seenCount}</Info>}
        {i.sealed && <Info label="Uszczelnione">{i.sealed === 'tak' ? 'Tak' : 'Nie'}</Info>}
        {i.sealedNote && <Info label="Nie jest uszczelnione">{i.sealedNote}</Info>}
        {visit.recommendations.length > 0 && <Info label="Zalecenia">{visit.recommendations.map((r) => `• ${r}`).join('\n')}</Info>}
        <Row to={`/zabieg/${visit.id}`} icon="clipboard" title="Otwórz zabieg" />
      </div>
    </details>
  );
}

/**
 * Klient: dane kontaktowe i wszystkie jego zabiegi. Co jest umówione, co zostało wykonane (z opisem, wykonanymi pracami
 * i zaleceniami) i odnośniki do każdego zabiegu.
 */
export function ClientPage() {
  const { key = '' } = useParams();
  const data = useLiveQuery(async () => {
    const all = await orders.all();
    const list = await visits.all();
    const client = groupClients(all, list, orderAddress).find((g) => g.key === key) ?? null;
    return { client, byId: new Map(all.map((o) => [o.id, o])) };
  }, [key]);
  if (!data) return <Loading />;
  if (!data.client) return <NotFound back="/zlecenia" />;
  const { client, byId } = data;
  return (
    <Page title={client.name || 'Klient'} back="/zlecenia">
      <Group title="Klient">
        {client.phones.map((p, i) => (
          <Info key={i} label={i === 0 ? 'Telefon' : 'Drugi telefon'}>
            <a className="info-phone" href={telUrl(p.number)}>
              {withCountryCode(p.number)}
            </a>
            {p.label ? <span className="info-phone-label">{p.label}</span> : null}
          </Info>
        ))}
        {client.emails.length > 0 && <Info label="E-mail">{client.emails.join('\n')}</Info>}
        {client.addresses.length > 0 && <Info label={client.addresses.length > 1 ? 'Adresy' : 'Adres'}>{client.addresses.join('\n')}</Info>}
        <Info label="Zlecenia">{client.orders.length}</Info>
      </Group>

      <Group title={`Do zrobienia (${client.planned.length})`}>
        {client.planned.length === 0 && <Empty title="Nic nie jest umówione" />}
        {client.planned.map((v) => {
          const o = byId.get(v.orderId)!;
          return (
            <Row
              key={v.id}
              to={`/zabieg/${v.id}`}
              icon="calendar"
              title={`${visitCode(o, v.seq)} · ${v.start ? formatTerm(v.start) : 'termin do umówienia'}`}
              sub={`${orderAddress(o) || 'brak adresu'} · ${pestName(o)}, zabieg ${roman(v.seq)}`}
              trailing={v.status === 'w_trakcie' ? <Badge tone="warn">W trakcie</Badge> : undefined}
            />
          );
        })}
      </Group>

      <Group title={`Wykonane (${client.done.length})`}>
        {client.done.length === 0 && <Empty title="Jeszcze nic nie wykonano" />}
        {client.done.map((v) => (
          <DoneVisit key={v.id} visit={v} order={byId.get(v.orderId)!} />
        ))}
      </Group>
      <p className="field-hint center">
        <Icon name="users" size={14} /> Zabiegi łączone po numerze telefonu klienta.
      </p>
    </Page>
  );
}
