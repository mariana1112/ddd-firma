import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { matchesCode, orderCode, roman, visitCode } from '../data/codes';
import { restoreRecord } from '../data/domain';
import { currentVisit, dateTile, dayHeading, groupByDay, nextVisitState, orderTerm, sortOrderRows, type OrderSort } from '../data/order-list';
import { deleteOrder, orderVisits, scheduleNextVisit } from '../data/orders';
import { orders, visits } from '../data/repo';
import { getAppSettings } from '../data/settings';
import { accessDetails, BUILDINGS, INVOICES, mapsUrl, orderAddress, pestName, priceRange, reminderSms } from '../data/texts';
import type { Order, PayMethod, Phone, Visit } from '../data/types';
import { formatDate, formatTerm, todayWarsaw } from '../lib/dates';
import { normalizeForSearch } from '../lib/validators';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { AddLink, Badge, Chips, Empty, Field, Group, Info, Loading, NotFound, Page, Row, Search, Sheet } from '../ui/kit';
import { TermsFields, termsDraft, termsFromDraft, termsText } from './terms';
import { proposeTerms, visitPrice, type VisitTerms } from '../data/visit-terms';
import type { InvoiceType } from '../data/types';
import { ContactBar, NextVisitPill, PayBadge, PinkBadge, useContactActions, VisitBadge, visitWhen } from './common';

type StatusFilter = 'aktywne' | 'wykonane' | 'wszystkie';
type PayFilter = 'wszystkie' | PayMethod;

/** Domyślna kolejność: do zrobienia od najbliższego terminu, zakończone od ostatniego. */
const defaultSort = (status: StatusFilter): OrderSort => (status === 'aktywne' ? 'najwczesniej' : 'najpozniej');

function matches(order: Order, query: string): boolean {
  const q = normalizeForSearch(query.trim().replace(/^#/, ''));
  if (!q) return true;
  if (matchesCode(order, query)) return true;
  const hay = normalizeForSearch(
    [orderCode(order), order.clientName, orderAddress(order), order.postalCode, pestName(order), ...order.phones.map((p) => p.number.replace(/\s/g, ''))].join(' '),
  );
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function OrdersPage() {
  const data = useLiveQuery(async () => ({ orders: await orders.all(), visits: await visits.all() }));
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('aktywne');
  const [pay, setPay] = useState<PayFilter>('wszystkie');
  const [invoicesOnly, setInvoicesOnly] = useState(false);
  const [sort, setSort] = useState<OrderSort>('najwczesniej');
  const today = todayWarsaw();
  const changeStatus = (next: StatusFilter) => {
    setStatus(next);
    setSort(defaultSort(next));
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const byOrder = new Map<string, Visit[]>();
    for (const v of data.visits) byOrder.set(v.orderId, [...(byOrder.get(v.orderId) ?? []), v].sort((a, b) => a.seq - b.seq));
    const filtered = data.orders
      .map((order) => ({ order, visits: byOrder.get(order.id) ?? [] }))
      .filter(({ order, visits: list }) => {
        if (!matches(order, query)) return false;
        if (invoicesOnly && order.invoice === 'brak') return false;
        if (pay !== 'wszystkie' && !list.some((v) => v.payMethod === pay)) return false;
        const active = list.some((v) => v.status === 'zaplanowany' || v.status === 'w_trakcie');
        if (status === 'aktywne') return active;
        if (status === 'wykonane') return !active;
        return true;
      });
    return sortOrderRows(filtered, sort);
  }, [data, query, status, pay, invoicesOnly, sort]);

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
          <Search value={query} onChange={setQuery} placeholder="Szukaj: kod (np. 0210), nazwisko, adres, telefon" />
          <Chips
            value={status}
            onChange={changeStatus}
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
          <div className="chips sort-chips" role="group" aria-label="Sortowanie">
            <span className="chips-label">Sortuj:</span>
            {(
              [
                ['najwczesniej', 'Najwcześniejsze'],
                ['najpozniej', 'Najpóźniejsze'],
                ['numer', 'Numer'],
              ] as Array<[OrderSort, string]>
            ).map(([value, label]) => (
              <button key={value} type="button" className={sort === value ? 'chip active' : 'chip'} aria-pressed={sort === value} onClick={() => setSort(value)}>
                {label}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <Group>
              <Empty title="Brak zleceń w tym widoku" />
            </Group>
          ) : sort === 'numer' ? (
            <Group>
              {rows.map(({ order, visits: list }) => (
                <OrderRow key={order.id} order={order} visits={list} today={today} />
              ))}
            </Group>
          ) : (
            groupByDay(rows).map((day) => (
              <section key={day.date ?? 'bez-terminu'} className="group day-group">
                <h2 className={`day-head${day.date === today ? ' day-head-today' : ''}`}>
                  <span>{dayHeading(day.date, today)}</span>
                  <span className="day-head-count">{day.rows.length}</span>
                </h2>
                <div className="group-body">
                  {day.rows.map(({ order, visits: list }) => (
                    <OrderRow key={order.id} order={order} visits={list} today={today} />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </Page>
  );
}

export function OrderRow({ order, visits: list, today }: { order: Order; visits: Visit[]; today: string }) {
  const current = currentVisit(list);
  const term = orderTerm(list);
  const open = current?.status === 'zaplanowany' || current?.status === 'w_trakcie';
  const tile = term.date ? dateTile(term.date) : null;
  const tone = !term.date ? ' date-tile-none' : term.date === today ? ' date-tile-today' : open && term.date < today ? ' date-tile-late' : !open ? ' date-tile-done' : '';
  const paid = [...new Set(list.map((v) => v.payMethod).filter((m): m is PayMethod => m !== null))];
  return (
    <Row
      to={`/zlecenia/${order.id}`}
      lead={
        <span className={`date-tile${tone}`} aria-hidden="true">
          {tile ? (
            <>
              <span className="date-tile-weekday">{tile.weekday}</span>
              <span className="date-tile-day">{tile.day}</span>
              <span className="date-tile-month">{tile.month}</span>
            </>
          ) : (
            <span className="date-tile-weekday">bez<br />terminu</span>
          )}
        </span>
      }
      title={
        <>
          <span className="order-number">{orderCode(order)}</span> {order.clientName}
        </>
      }
      sub={`${orderAddress(order)} · ${pestName(order)}`}
      meta={
        current ? (
          <>
            {term.date ? <strong className="row-when">{formatDate(term.date)}{term.time ? `, godz. ${term.time}` : ''}</strong> : visitWhen(current)}
            {` · zabieg ${roman(current.seq)}`}
            <span className="row-next">
              <NextVisitPill state={nextVisitState(list)} />
            </span>
          </>
        ) : undefined
      }
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

/** Kolejny zabieg: termin, czas trwania, co pryskamy i cena (propozycja z poprzedniego zabiegu). */
function ScheduleNext(props: {
  durationMin: number;
  initial: VisitTerms;
  invoice: InvoiceType;
  onSave: (start: string, durationMin: number, terms: VisitTerms) => void;
}) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [duration, setDuration] = useState(String(props.durationMin));
  const [terms, setTerms] = useState(() => termsDraft(props.initial));
  const minutes = Number(duration);
  const parsed = termsFromDraft(terms);
  const valid = Boolean(date && time) && Number.isInteger(minutes) && minutes > 0 && parsed !== null;
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) props.onSave(`${date}T${time}`, minutes, parsed!);
      }}
    >
      <div className="form-row">
        <Field label="Data">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Godzina">
          <input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} required />
        </Field>
      </div>
      <Field label="Czas trwania (min)">
        <input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/D/g, ''))} />
      </Field>
      <TermsFields value={terms} onChange={setTerms} invoice={props.invoice} proposedFrom="Podpowiedź: zakres i cena z poprzedniego zabiegu. Zmień, jeśli klient chce inaczej." />
      <button type="submit" className="btn btn-primary btn-block" disabled={!valid}>
        Umów zabieg
      </button>
    </form>
  );
}

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const [scheduling, setScheduling] = useState(false);
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
  const next = nextVisitState(data.visits);
  // Aktualny: w trakcie albo najbliższy do zrobienia; gdy wszystko zrobione, ostatni wykonany.
  const current = currentVisit(data.visits.filter((v) => v.status !== 'odwolany'));
  const currentOpen = current?.status === 'zaplanowany' || current?.status === 'w_trakcie';
  const waiting = data.visits.find((v) => v.status === 'zaplanowany' && !v.start);
  const nextSeq = waiting?.seq ?? Math.max(0, ...data.visits.map((v) => v.seq)) + 1;

  const remove = async () => {
    const ok = await confirm({
      title: `Usunąć zlecenie ${orderCode(order)}?`,
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
      title={orderCode(order)}
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

      <Group title="Zabiegi" action={<NextVisitPill state={next} />}>
        {data.visits.map((v) => (
          <Row
            key={v.id}
            to={`/zabieg/${v.id}`}
            className={v.id === current?.id ? 'row-current' : undefined}
            title={
              <>
                {v.id === current?.id && <span className="current-label">{currentOpen ? 'Aktualny zabieg' : 'Ostatni zabieg'}</span>}
                {`Zabieg ${roman(v.seq)} · ${visitCode(order, v.seq)}`}
              </>
            }
            sub={`${v.status === 'wykonany' ? `Wykonany ${formatDate(v.doneOn ?? v.start)}` : visitWhen(v)} · ${termsText({ scope: v.scope ?? { kind: 'calosc', note: '' }, ...visitPrice(v, order) }, order.invoice, settings.vatRate)}`}
            meta={v.technicianName || undefined}
            trailing={
              <span className="row-end">
                <VisitBadge visit={v} />
                {v.payMethod && <PayBadge method={v.payMethod} />}
              </span>
            }
          />
        ))}
        {next.kind === 'nieumowiony' && (
          <Row
            title={`Zabieg ${roman(next.seq)} · ${visitCode(order, next.seq)}`}
            sub={`Jeszcze nie umówiony. Termin ustalisz przy zakończeniu zabiegu ${roman(next.afterSeq)}.`}
            trailing={<Badge tone="warn">Nieumówiony</Badge>}
          />
        )}
      </Group>
      <button type="button" className="btn btn-block" onClick={() => setScheduling(true)}>
        <Icon name="calendar" /> Umów kolejny zabieg
      </button>
      <Sheet open={scheduling} title={`Umów kolejny zabieg · ${visitCode(order, nextSeq)}`} onClose={() => setScheduling(false)}>
        {scheduling && (
          <ScheduleNext
            durationMin={current?.durationMin ?? 60}
            initial={proposeTerms(data.visits, order)}
            invoice={order.invoice}
            onSave={(start, durationMin, terms) =>
              run(async () => {
                await scheduleNextVisit(order.id, { start, durationMin, terms });
                setScheduling(false);
                toast(`Zabieg ${roman(nextSeq)} umówiony: ${formatTerm(start)}`);
              })
            }
          />
        )}
      </Sheet>

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
            <Row key={o.id} to={`/zlecenia/${o.id}`} title={`${orderCode(o)} ${o.clientName}`} sub={`${orderAddress(o)} · ${pestName(o)}`} />
          ))}
        </Group>
      )}

      <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => void remove()}>
        <Icon name="trash" /> Usuń zlecenie
      </button>
    </Page>
  );
}
