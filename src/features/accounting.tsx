import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { accountingState, accountingTasks, doneVisits, invoiceAmount, readyToClose, TASK_LABEL, taskDone } from '../data/accounting';
import { orderCode, visitCode } from '../data/codes';
import { deleteExpense } from '../data/domain';
import { orderMatches } from '../data/order-search';
import { costName, formatPln, periodOf, shiftPeriod, type Period, type PeriodKind } from '../data/reports';
import { expenses, orders, trips, visits } from '../data/repo';
import { INVOICES, orderAddress, PAY_NAMES, workSummary } from '../data/texts';
import type { Order, PayMethod, Visit } from '../data/types';
import { formatDate, todayWarsaw } from '../lib/dates';
import { moneyToInput, parseMoney } from '../lib/money';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Chips, Empty, Field, Group, Info, Loading, NotFound, Page, Row, Search } from '../ui/kit';
import { PayBadge } from './common';

type Tab = 'czeka' | 'zamkniete';

/**
 * Panel księgowej: zlecenia, w których klient chce fakturę albo protokół. „Do zrobienia” to zlecenia niezamknięte,
 * „Zrobione” to zamknięte przez księgową. Zlecenie trafia tu, gdy technik zaznaczy fakturę albo protokół.
 */
export function AccountingPage() {
  const data = useLiveQuery(async () => ({ orders: await orders.all(), visits: await visits.all() }));
  const [tab, setTab] = useState<Tab>('czeka');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    if (!data) return [];
    const byOrder = new Map<string, Visit[]>();
    for (const v of data.visits) byOrder.set(v.orderId, [...(byOrder.get(v.orderId) ?? []), v]);
    return data.orders
      .map((order) => ({ order, list: byOrder.get(order.id) ?? [], state: accountingState(order) }))
      .filter((r) => r.state !== 'brak' && orderMatches(r.order, query));
  }, [data, query]);

  if (!data) return <Loading />;
  const waiting = rows
    .filter((r) => r.state === 'czeka')
    // Najpierw zlecenia z wykonanym zabiegiem (jest kwota do faktury), od najstarszych.
    .sort((a, b) => Number(doneVisits(b.list).length > 0) - Number(doneVisits(a.list).length > 0) || a.order.number - b.order.number);
  const closed = rows
    .filter((r) => r.state === 'zamkniete')
    .sort((a, b) => (b.order.accountingClosedAt ?? '').localeCompare(a.order.accountingClosedAt ?? ''));
  const shown = tab === 'czeka' ? waiting : closed;

  return (
    <Page title="Księgowość">
      <Search value={query} onChange={setQuery} placeholder="Szukaj: nazwisko, adres, kod, fv23, fv, prot" />
      <Chips
        value={tab}
        onChange={setTab}
        options={[
          { value: 'czeka', label: 'Do zrobienia', count: waiting.length },
          { value: 'zamkniete', label: 'Zrobione' },
        ]}
      />
      <Group>
        {shown.length === 0 && <Empty title={tab === 'czeka' ? 'Nic nie czeka na księgową' : 'Brak zamkniętych zleceń'} />}
        {shown.map(({ order, list }) => {
          const done = doneVisits(list);
          return (
            <Row
              key={order.id}
              to={`/ksiegowosc/${order.id}`}
              title={
                <>
                  <span className="order-number">{orderCode(order)}</span> {order.clientName}
                </>
              }
              sub={orderAddress(order)}
              meta={
                <>
                  {done.length ? `Wykonane zabiegi: ${done.length}, razem ${formatPln(invoiceAmount(list))}` : 'Zabieg jeszcze niewykonany'}
                  <span className="row-tags">
                    {accountingTasks(order).map((t) => (
                      <Badge key={t} tone={taskDone(order, t) ? 'ok' : 'warn'}>
                        {t === 'faktura' ? INVOICES[order.invoice] : TASK_LABEL[t]}
                        {taskDone(order, t) ? ' ✓' : ''}
                      </Badge>
                    ))}
                  </span>
                </>
              }
            />
          );
        })}
      </Group>
      <Group title="Raporty">
        <Row to="/ksiegowosc/poprawki" icon="edit" title="Poprawki raportów" sub="Kwoty zabiegów, koszty i kilometry techników" />
        <Row to="/raporty" icon="chart" title="Raporty" sub="Dzień, tydzień, miesiąc wszystkich techników, PDF" />
      </Group>
    </Page>
  );
}

/** Pole tekstowe zapisywane po wyjściu z pola. */
function SavedText(props: { label: string; value: string; placeholder?: string; multiline?: boolean; onSave: (value: string) => Promise<unknown> }) {
  const [value, setValue] = useState(props.value);
  useEffect(() => setValue(props.value), [props.value]);
  const save = () => {
    if (value.trim() !== props.value) void props.onSave(value.trim());
  };
  return (
    <Field label={props.label}>
      {props.multiline ? (
        <textarea rows={3} value={value} placeholder={props.placeholder} onChange={(e) => setValue(e.target.value)} onBlur={save} />
      ) : (
        <input value={value} placeholder={props.placeholder} onChange={(e) => setValue(e.target.value)} onBlur={save} />
      )}
    </Field>
  );
}

/** Zlecenie oczami księgowej: dane do faktury, wykonane zabiegi, dokumenty i zamknięcie. */
export function AccountingOrderPage() {
  const { id = '' } = useParams();
  const { run, toast } = useFeedback();
  const data = useLiveQuery(async () => {
    const order = await orders.get(id);
    if (!order || order.deletedAt) return null;
    return { order, list: await visits.where('orderId', id) };
  }, [id]);

  if (data === undefined) return <Loading />;
  if (data === null) return <NotFound back="/ksiegowosc" />;
  const { order, list } = data;
  const done = doneVisits(list);
  const update = (patch: Partial<Order>, message?: string) =>
    run(async () => {
      await orders.update(order.id, patch);
      if (message) toast(message);
    });

  return (
    <Page title={orderCode(order)} back="/ksiegowosc">
      {order.accountingClosedAt ? (
        <div className="notice notice-info">
          <Icon name="check" />
          <span>Zamknięte przez księgową {formatDate(order.accountingClosedAt)}.</span>
        </div>
      ) : null}

      {order.invoice === 'vat' && !order.nip.trim() && (
        <div className="notice notice-warn">
          <Icon name="alert" />
          <span>Faktura VAT bez NIP. Uzupełnij NIP w pełnym zleceniu (Edytuj) albo zapytaj technika.</span>
        </div>
      )}
      <Group title="Klient i dane do faktury">
        <Info label="Klient">{order.clientName || '—'}</Info>
        <Info label="Faktura">{INVOICES[order.invoice]}</Info>
        {order.nip && <Info label="NIP">{order.nip}</Info>}
        <Info label="Adres do faktury">{order.invoiceAddress || `${orderAddress(order)}${order.postalCode ? `, ${order.postalCode}` : ''}`}</Info>
        {order.email && <Info label="E-mail">{order.email}</Info>}
        {order.phones.map((p, i) => (
          <Info key={i} label={i === 0 ? 'Telefon' : p.label || 'Telefon'}>
            {p.number}
          </Info>
        ))}
      </Group>

      <Group title={`Wykonane zabiegi (${done.length})`}>
        {done.length === 0 && <Empty title="Zabieg jeszcze niewykonany" />}
        {done.map((v) => (
          <Row
            key={v.id}
            to={`/zabieg/${v.id}`}
            title={`${visitCode(order, v.seq)} · ${formatDate(v.doneOn)}`}
            sub={[workSummary(v), v.technicianName && `technik: ${v.technicianName}`].filter(Boolean).join(' · ')}
            trailing={
              <span className="row-end">
                <strong className="num">{v.amount ? formatPln(v.amount) : '—'}</strong>
                {v.payMethod && <PayBadge method={v.payMethod} />}
              </span>
            }
          />
        ))}
        {done.length > 1 && <Info label="Razem">{formatPln(invoiceAmount(list))}</Info>}
      </Group>

      {accountingTasks(order).includes('faktura') && (
        <Group title={INVOICES[order.invoice]} plain>
          <label className="check">
            <input type="checkbox" checked={Boolean(order.invoiceDone)} onChange={(e) => void update({ invoiceDone: e.target.checked })} />
            Faktura wystawiona
          </label>
          <SavedText label="Numer faktury" value={order.invoiceNumber ?? ''} placeholder="Np. FV 12/11/2026" onSave={(invoiceNumber) => update({ invoiceNumber })} />
        </Group>
      )}
      {accountingTasks(order).includes('protokol') && (
        <Group title="Protokół" plain>
          <label className="check">
            <input type="checkbox" checked={Boolean(order.protocolDone)} onChange={(e) => void update({ protocolDone: e.target.checked })} />
            Protokół przygotowany
          </label>
        </Group>
      )}
      <SavedText label="Uwagi księgowej" value={order.accountingNote ?? ''} multiline onSave={(accountingNote) => update({ accountingNote })} />

      {order.accountingClosedAt ? (
        <button type="button" className="btn btn-block" onClick={() => void update({ accountingClosedAt: null }, 'Zlecenie wróciło do „Do zrobienia”')}>
          Otwórz ponownie
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={!readyToClose(order)}
            onClick={() => void update({ accountingClosedAt: new Date().toISOString() }, 'Zlecenie zamknięte')}
          >
            <Icon name="check" /> Zamknij: wszystko zrobione
          </button>
          {!readyToClose(order) && <p className="field-hint">Zaznacz najpierw wszystkie dokumenty powyżej.</p>}
        </>
      )}
      <Link className="btn btn-block" to={`/zlecenia/${order.id}`}>
        Pełne zlecenie
      </Link>
    </Page>
  );
}

/** Kwota w złotych zapisywana po wyjściu z pola. */
function MoneyField(props: { label: string; value: number | null; onSave: (grosze: number) => Promise<unknown> }) {
  const [text, setText] = useState(props.value != null ? moneyToInput(props.value) : '');
  useEffect(() => setText(props.value != null ? moneyToInput(props.value) : ''), [props.value]);
  return (
    <Field label={props.label}>
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = parseMoney(text);
          if (parsed !== null && parsed !== props.value) void props.onSave(parsed);
        }}
      />
    </Field>
  );
}

/** Liczba (np. stan licznika) zapisywana po wyjściu z pola. */
function NumberField(props: { label: string; value: number; onSave: (value: number) => Promise<unknown> }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  return (
    <Field label={props.label}>
      <input
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text.replace(/\s/g, ''));
          if (Number.isInteger(n) && n >= 0 && n !== props.value) void props.onSave(n);
        }}
      />
    </Field>
  );
}

/**
 * Poprawki raportów: księgowa wybiera technika i okres, poprawia kwoty i formy płatności zabiegów, koszty i stany
 * licznika przejazdów. Zmiany trafiają do raportów technika i firmy.
 */
export function CorrectionsPage() {
  const { confirm, run, toast } = useFeedback();
  const [kind, setKind] = useState<PeriodKind>('tydzien');
  const [period, setPeriod] = useState<Period>(() => periodOf('tydzien', todayWarsaw()));
  const [who, setWho] = useState('');
  const data = useLiveQuery(async () => ({
    orders: await orders.all(),
    visits: await visits.all(),
    expenses: await expenses.all(),
    trips: await trips.all(),
  }));

  if (!data) return <Loading />;
  // Technicy: z zabiegów (imię), kosztów i przejazdów (kierowca). Wpisy bez technika (np. sprzed kont) też da się poprawić.
  const NONE = 'brak';
  const key = (id: string | null | undefined) => id || NONE;
  const people = new Map<string, string>();
  for (const v of data.visits) if (v.status === 'wykonany') people.set(key(v.technicianId), v.technicianId ? v.technicianName || people.get(v.technicianId) || 'Technik' : 'Bez przypisanego technika');
  for (const t of data.trips) if (!people.has(key(t.ownerId))) people.set(key(t.ownerId), t.ownerId ? t.driver || 'Technik' : 'Bez przypisanego technika');
  for (const e of data.expenses) if (!people.has(key(e.ownerId))) people.set(key(e.ownerId), e.ownerId ? 'Technik' : 'Bez przypisanego technika');
  const inPeriod = (date: string | null | undefined) => Boolean(date && date >= period.from && date <= period.to);
  const orderById = new Map(data.orders.map((o) => [o.id, o]));
  const visitList = data.visits.filter((v) => v.status === 'wykonany' && key(v.technicianId) === who && inPeriod(v.doneOn)).sort((a, b) => (a.doneOn ?? '').localeCompare(b.doneOn ?? ''));
  const costList = data.expenses.filter((e) => key(e.ownerId) === who && inPeriod(e.date)).sort((a, b) => a.date.localeCompare(b.date));
  const tripList = data.trips.filter((t) => key(t.ownerId) === who && inPeriod(t.date)).sort((a, b) => a.date.localeCompare(b.date));
  const saved = () => toast('Zapisano poprawkę');

  return (
    <Page title="Poprawki raportów" back="/ksiegowosc">
      <Field label="Technik">
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Wybierz technika</option>
          {[...people].sort((a, b) => a[1].localeCompare(b[1], 'pl')).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Chips
        value={kind}
        onChange={(k: PeriodKind) => {
          setKind(k);
          setPeriod(periodOf(k, todayWarsaw()));
        }}
        options={[
          { value: 'dzien', label: 'Dzień' },
          { value: 'tydzien', label: 'Tydzień' },
          { value: 'miesiac', label: 'Miesiąc' },
        ]}
      />
      <div className="month-nav">
        <button type="button" className="icon-btn" aria-label="Poprzedni okres" onClick={() => setPeriod(shiftPeriod(period, -1))}>
          <Icon name="left" />
        </button>
        <strong>
          {formatDate(period.from)}
          {period.to !== period.from ? ` – ${formatDate(period.to)}` : ''}
        </strong>
        <button type="button" className="icon-btn" aria-label="Następny okres" onClick={() => setPeriod(shiftPeriod(period, 1))}>
          <Icon name="chevron" />
        </button>
      </div>

      {!who ? (
        <Empty icon="users" title="Wybierz technika, żeby poprawić jego raport" />
      ) : (
        <>
          <Group title={`Zabiegi (${visitList.length})`} plain>
            {visitList.length === 0 && <Empty title="Brak wykonanych zabiegów w tym okresie" />}
            {visitList.map((v) => {
              const order = orderById.get(v.orderId);
              return (
                <div key={v.id} className="card form">
                  <strong>
                    {order ? `${visitCode(order, v.seq)} ${order.clientName}` : 'Zabieg'} · {formatDate(v.doneOn)}
                  </strong>
                  <div className="form-row">
                    <MoneyField label="Kwota (zł)" value={v.amount} onSave={(amount) => run(async () => { await visits.update(v.id, { amount }); saved(); })} />
                    <Field label="Płatność">
                      <select
                        value={v.payMethod ?? ''}
                        onChange={(e) => void run(async () => { await visits.update(v.id, { payMethod: (e.target.value || null) as PayMethod | null }); saved(); })}
                      >
                        <option value="">Brak</option>
                        {(Object.entries(PAY_NAMES) as Array<[PayMethod, string]>).map(([m, label]) => (
                          <option key={m} value={m}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
              );
            })}
          </Group>

          <Group title={`Koszty (${costList.length})`} plain>
            {costList.length === 0 && <Empty title="Brak kosztów w tym okresie" />}
            {costList.map((e) => (
              <div key={e.id} className="card form">
                <strong>
                  {costName(e)} · {formatDate(e.date)}
                </strong>
                <MoneyField label="Kwota (zł)" value={e.amount} onSave={(amount) => run(async () => { await expenses.update(e.id, { amount }); saved(); })} />
                <button
                  type="button"
                  className="link link-danger"
                  onClick={() =>
                    void (async () => {
                      const ok = await confirm({ title: `Usunąć koszt ${costName(e)}?`, message: 'Koszt zniknie z raportu technika. Można go przywrócić z kosza.', confirmLabel: 'Usuń', danger: true });
                      if (ok) await run(async () => { await deleteExpense(e.id); toast('Usunięto koszt'); });
                    })()
                  }
                >
                  Usuń koszt
                </button>
              </div>
            ))}
          </Group>

          <Group title={`Przejazdy (${tripList.length})`} plain>
            {tripList.length === 0 && <Empty title="Brak przejazdów w tym okresie" />}
            {tripList.map((t) => (
              <div key={t.id} className="card form">
                <strong>
                  {formatDate(t.date)} · {t.from} → {t.to} ({t.kind === 'sluzbowy' ? 'służbowy' : 'prywatny'}, {Math.max(0, t.odometerEnd - t.odometerStart)} km)
                </strong>
                <div className="form-row">
                  <NumberField label="Licznik start" value={t.odometerStart} onSave={(odometerStart) => run(async () => { await trips.update(t.id, { odometerStart }); saved(); })} />
                  <NumberField label="Licznik koniec" value={t.odometerEnd} onSave={(odometerEnd) => run(async () => { await trips.update(t.id, { odometerEnd }); saved(); })} />
                </div>
              </div>
            ))}
          </Group>

          {who !== NONE && (
            <Row to={`/raporty?technik=${who}&imie=${encodeURIComponent(people.get(who) ?? 'technik')}`} icon="chart" title="Raport tego technika" sub="Po poprawkach, do wysłania albo PDF" />
          )}
        </>
      )}
    </Page>
  );
}
