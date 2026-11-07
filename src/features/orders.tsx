import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { restoreRecord } from '../data/domain';
import { deleteOrder, orderVisits } from '../data/orders';
import { orders, visits } from '../data/repo';
import { getAppSettings } from '../data/settings';
import { accessDetails, BUILDINGS, INVOICES, mapsUrl, orderAddress, pestName, priceRange, reminderSms } from '../data/texts';
import type { Order, PayMethod, Phone, Visit } from '../data/types';
import { formatDate } from '../lib/dates';
import { normalizeForSearch } from '../lib/validators';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { AddLink, Badge, Chips, Empty, Group, Info, Loading, NotFound, Page, Row, Search } from '../ui/kit';
import { ContactBar, PayBadge, PinkBadge, useContactActions, VisitBadge, visitWhen } from './common';

type StatusFilter = 'aktywne' | 'wykonane' | 'wszystkie';
type PayFilter = 'wszystkie' | PayMethod;

/** Następny zabieg do zrobienia albo ostatni wykonany, do wyświetlenia na liście. */
function currentVisit(list: Visit[]): Visit | undefined {
  const open = list.filter((v) => v.status === 'zaplanowany' || v.status === 'w_trakcie');
  return open.sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999'))[0] ?? list[list.length - 1];
}

function matches(order: Order, query: string): boolean {
  const q = normalizeForSearch(query.trim().replace(/^#/, ''));
  if (!q) return true;
  if (/^\d+$/.test(q) && String(order.number).startsWith(q)) return true;
  const hay = normalizeForSearch(
    [order.clientName, orderAddress(order), order.postalCode, pestName(order), ...order.phones.map((p) => p.number.replace(/\s/g, ''))].join(' '),
  );
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function OrdersPage() {
  const data = useLiveQuery(async () => ({ orders: await orders.all(), visits: await visits.all() }));
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('aktywne');
  const [pay, setPay] = useState<PayFilter>('wszystkie');
  const [invoicesOnly, setInvoicesOnly] = useState(false);

  const rows = useMemo(() => {
    if (!data) return [];
    const byOrder = new Map<string, Visit[]>();
    for (const v of data.visits) byOrder.set(v.orderId, [...(byOrder.get(v.orderId) ?? []), v].sort((a, b) => a.seq - b.seq));
    return data.orders
      .map((order) => ({ order, visits: byOrder.get(order.id) ?? [] }))
      .filter(({ order, visits: list }) => {
        if (!matches(order, query)) return false;
        if (invoicesOnly && order.invoice === 'brak') return false;
        if (pay !== 'wszystkie' && !list.some((v) => v.payMethod === pay)) return false;
        const active = list.some((v) => v.status === 'zaplanowany' || v.status === 'w_trakcie');
        if (status === 'aktywne') return active;
        if (status === 'wykonane') return !active;
        return true;
      })
      .sort((a, b) => b.order.number - a.order.number);
  }, [data, query, status, pay, invoicesOnly]);

  return (
    <Page title="Zlecenia" actions={<AddLink to="/zlecenia/nowe" label="Nowe zlecenie" />}>
      {!data ? (
        <Loading />
      ) : data.orders.length === 0 ? (
        <Empty icon="clipboard" title="Nie ma jeszcze zleceń">
          <Link className="btn btn-primary" to="/zlecenia/nowe">Nowe zlecenie</Link>
        </Empty>
      ) : (
        <>
          <Search value={query} onChange={setQuery} placeholder="Szukaj: #210, nazwisko, adres, telefon" />
          <Chips
            value={status}
            onChange={setStatus}
            options={[
              { value: 'aktywne', label: 'Do zrobienia' },
              { value: 'wykonane', label: 'Zakończone' },
              { value: 'wszystkie', label: 'Wszystkie' },
            ]}
          />
          <div className="chips" role="group" aria-label="Forma płatności">
            {(['wszystkie', 'gotowka', 'blik', 'przelew'] as PayFilter[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`chip${pay === m ? ' active' : ''}${m !== 'wszystkie' ? ` chip-${m}` : ''}`}
                aria-pressed={pay === m}
                onClick={() => setPay(m)}
              >
                {m === 'wszystkie' ? 'Każda płatność' : m === 'gotowka' ? 'Gotówka' : m === 'blik' ? 'BLIK' : 'Przelew'}
              </button>
            ))}
            <button type="button" className={invoicesOnly ? 'chip active' : 'chip'} aria-pressed={invoicesOnly} onClick={() => setInvoicesOnly(!invoicesOnly)}>
              Tylko faktury
            </button>
          </div>
          <Group>
            {rows.length === 0 && <Empty title="Brak zleceń w tym widoku" />}
            {rows.map(({ order, visits: list }) => (
              <OrderRow key={order.id} order={order} visits={list} />
            ))}
          </Group>
        </>
      )}
    </Page>
  );
}

export function OrderRow({ order, visits: list }: { order: Order; visits: Visit[] }) {
  const current = currentVisit(list);
  const paid = [...new Set(list.map((v) => v.payMethod).filter((m): m is PayMethod => m !== null))];
  return (
    <Row
      to={`/zlecenia/${order.id}`}
      title={
        <>
          <span className="order-number">#{order.number}</span> {order.clientName}
        </>
      }
      sub={`${orderAddress(order)} · ${pestName(order)}`}
      meta={current ? `Zabieg ${current.seq}: ${visitWhen(current)}` : undefined}
      trailing={
        <span className="row-end">
          {order.pink && <PinkBadge />}
          {current && <VisitBadge visit={current} />}
          {order.invoice !== 'brak' && <Badge tone="info">{order.invoice === 'vat' ? 'FV VAT' : 'FV'}</Badge>}
          {paid.map((m) => (
            <PayBadge key={m} method={m} />
          ))}
        </span>
      }
    />
  );
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { confirm, run, toast } = useFeedback();
  const { sms } = useContactActions();
  const data = useLiveQuery(async () => {
    const order = await orders.get(id);
    if (!order || order.deletedAt) return null;
    const list = await orderVisits(id);
    // Historia klienta: inne zlecenia z tym samym numerem telefonu lub adresem.
    const phones = new Set(order.phones.map((p) => p.number.replace(/\D/g, '')).filter(Boolean));
    const address = normalizeForSearch(orderAddress(order));
    const others = (await orders.all()).filter(
      (o) =>
        o.id !== id &&
        (o.phones.some((p) => phones.has(p.number.replace(/\D/g, ''))) || normalizeForSearch(orderAddress(o)) === address),
    );
    return { order, visits: list, others, settings: await getAppSettings() };
  }, [id]);

  if (data === undefined) return <Loading />;
  if (data === null) return <NotFound back="/zlecenia" />;
  const { order, settings } = data;
  const price = priceRange(order, settings.vatRate);
  const nextPlanned = data.visits.find((v) => v.status === 'zaplanowany' && v.start);

  const remove = async () => {
    const ok = await confirm({
      title: `Usunąć zlecenie #${order.number}?`,
      message: 'Zlecenie z zabiegami i zdjęciami trafi do kosza.',
      confirmLabel: 'Usuń',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await deleteOrder(id);
      navigate('/zlecenia', { replace: true });
      toast('Zlecenie jest w koszu', { action: { label: 'Cofnij', onClick: () => void run(() => restoreRecord('orders', id)) } });
    });
  };

  const onSms = (phone: Phone) =>
    void sms(phone, nextPlanned ? reminderSms(order, nextPlanned, settings) : '');

  return (
    <Page
      title={`#${order.number}`}
      back="/zlecenia"
      actions={
        <Link className="icon-btn" to={`/zlecenia/${id}/edycja`} aria-label="Edytuj zlecenie">
          <Icon name="edit" />
        </Link>
      }
    >
      <div className="job-hero">
        <div className="hero-badges">
          {order.pink && <PinkBadge />}
          {order.closed && <Badge tone="ok">Zakończone</Badge>}
        </div>
        <h2>{order.clientName}</h2>
        <p>{orderAddress(order)}</p>
      </div>

      <ContactBar order={order} mapsHref={mapsUrl(order)} onSms={onSms} />
      {nextPlanned && <p className="field-hint">SMS zawiera przypomnienie o zabiegu {formatDate(nextPlanned.start)} z prośbą o potwierdzenie.</p>}

      {order.pink && order.pinkNote && (
        <div className="notice notice-pink">
          <Icon name="alert" />
          <span>{order.pinkNote}</span>
        </div>
      )}

      <Group title="Zabiegi">
        {data.visits.map((v) => (
          <Row
            key={v.id}
            to={`/zabieg/${v.id}`}
            title={`Zabieg ${v.seq}`}
            sub={visitWhen(v)}
            meta={v.technicianName || undefined}
            trailing={
              <span className="row-end">
                <VisitBadge visit={v} />
                {v.payMethod && <PayBadge method={v.payMethod} />}
              </span>
            }
          />
        ))}
      </Group>

      <Group title="Adres">
        <Info label="Budynek">{BUILDINGS[order.building]}</Info>
        <Info label="Adres">{`${orderAddress(order)}${order.postalCode ? `, ${order.postalCode}` : ''}`}</Info>
        {accessDetails(order) && <Info label="W bloku">{accessDetails(order)}</Info>}
        {order.access && <Info label="Dojazd">{order.access}</Info>}
      </Group>

      <Group title="Problem">
        <Info label="Szkodnik">{pestName(order)}</Info>
        {order.description && <Info label="Opis">{order.description}</Info>}
        {order.areaM2 && <Info label="Metraż">{order.areaM2} m²</Info>}
        {price && (
          <Info label="Widełki">
            {price.net}
            {price.gross && (
              <>
                <br />
                {price.gross}
              </>
            )}
          </Info>
        )}
      </Group>

      <Group title="Klient">
        <Info label="Imię / firma">{order.clientName}</Info>
        {order.phones.map((p, i) => (
          <Info key={i} label={i === 0 ? 'Telefon' : `Telefon ${i + 1}`}>
            {p.number}
            {p.label ? ` (${p.label})` : ''}
          </Info>
        ))}
        {order.email && <Info label="E-mail">{order.email}</Info>}
        <Info label="Faktura">{INVOICES[order.invoice]}</Info>
        {order.nip && <Info label="NIP">{order.nip}</Info>}
        {order.invoiceAddress && <Info label="Adres do FV">{order.invoiceAddress}</Info>}
      </Group>

      {data.others.length > 0 && (
        <Group title="Wcześniejsze zlecenia tego klienta">
          {data.others.map((o) => (
            <Row key={o.id} to={`/zlecenia/${o.id}`} title={`#${o.number} ${o.clientName}`} sub={`${orderAddress(o)} · ${pestName(o)}`} />
          ))}
        </Group>
      )}

      <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => void remove()}>
        <Icon name="trash" /> Usuń zlecenie
      </button>
    </Page>
  );
}
