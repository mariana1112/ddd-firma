import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { accountingState, accountingTasks, bankPayments, doneVisits, invoiceAmount, paymentUnchecked, pendingInvoices, readyToClose, TASK_LABEL, taskDone, visitInvoiced } from '../data/accounting';
import { getProfile } from '../data/settings';
import { PayBadge } from './common';
import { orderCode, roman, visitCode } from '../data/codes';
import { deleteExpense } from '../data/domain';
import { orderMatches } from '../data/order-search';
import { costName, formatPln, periodOf, shiftPeriod, type Period, type PeriodKind } from '../data/reports';
import { expenses, orders, trips, visits } from '../data/repo';
import { getRegions } from '../data/settings';
import { INVOICES, orderAddress, PAY_NAMES, workSummary } from '../data/texts';
import type { Order, PayMethod, Visit } from '../data/types';
import { formatDate, todayWarsaw } from '../lib/dates';
import { moneyToInput, parseMoney } from '../lib/money';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Chips, Empty, Field, Group, Info, Loading, NotFound, Page, Row, Search, Sheet } from '../ui/kit';

type Tab = 'czeka' | 'zamkniete';

/**
 * Panel księgowej: zlecenia, w których klient chce fakturę albo protokół. „Do zrobienia” to zlecenia niezamknięte,
 * „Zrobione” to zamknięte przez księgową. Zlecenie trafia tu, gdy technik zaznaczy fakturę albo protokół.
 */
export function AccountingPage() {
  const data = useLiveQuery(async () => ({ orders: await orders.all(), visits: await visits.all(), regions: await getRegions() }));
  const [tab, setTab] = useState<Tab>('czeka');
  const [query, setQuery] = useState('');
  // Szybki wybór regionu: księgowa i admin widzą wszystkie regiony.
  const [region, setRegion] = useState('');

  const rows = useMemo(() => {
    if (!data) return [];
    const byOrder = new Map<string, Visit[]>();
    for (const v of data.visits) byOrder.set(v.orderId, [...(byOrder.get(v.orderId) ?? []), v]);
    return data.orders
      .map((order) => ({ order, list: byOrder.get(order.id) ?? [], state: accountingState(order, byOrder.get(order.id) ?? []) }))
      .filter((r) => r.state !== 'brak' && orderMatches(r.order, query) && (!region || r.order.branchId === region));
  }, [data, query, region]);

  if (!data) return <Loading />;
  const waiting = rows
    .filter((r) => r.state === 'czeka')
    // Najpierw zlecenia z wykonanym zabiegiem (jest kwota do faktury), od najstarszych.
    .sort((a, b) => Number(doneVisits(b.list).length > 0) - Number(doneVisits(a.list).length > 0) || a.order.number - b.order.number);
  const closed = rows
    .filter((r) => r.state === 'zamkniete')
    .sort((a, b) => (b.order.accountingClosedAt ?? '').localeCompare(a.order.accountingClosedAt ?? ''));
  const shown = tab === 'czeka' ? waiting : closed;
  const newPayments = bankPayments(data.visits).filter(paymentUnchecked).length;

  return (
    <Page title="Księgowość">
      {Object.keys(data.regions).length > 1 && (
        <label className="region-line region-switch">
          <span>region</span>
          <select value={region} aria-label="Region" onChange={(e) => setRegion(e.target.value)}>
            <option value="">wszystkie</option>
            {Object.entries(data.regions)
              .sort((a, b) => a[1].name.localeCompare(b[1].name, 'pl'))
              .map(([id, info]) => (
                <option key={id} value={id}>
                  {info.name.toLowerCase()}
                </option>
              ))}
          </select>
        </label>
      )}
      <Group>
        <Row
          to="/ksiegowosc/platnosci"
          icon="wallet"
          title="BLIK i przelewy"
          sub="Nowe wpłaty od klientów do sprawdzenia na koncie"
          trailing={newPayments > 0 ? <Badge tone="warn">Nowe: {newPayments}</Badge> : <Badge tone="ok">Wszystko sprawdzone</Badge>}
        />
      </Group>
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
                      <Badge key={t} tone={taskDone(order, t, list) ? 'ok' : 'warn'}>
                        {t === 'faktura' ? INVOICES[order.invoice] : TASK_LABEL[t]}
                        {t === 'faktura' && done.length > 1 ? ` ${done.length - pendingInvoices(order, list).length}/${done.length}` : ''}
                        {taskDone(order, t, list) ? ' ✓' : ''}
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

/** Zlecenie oczami księgowej: dane do faktury, faktura osobno dla każdego zabiegu, protokół, zapis z podsumowaniem. */
export function AccountingOrderPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { run, toast } = useFeedback();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const data = useLiveQuery(async () => {
    const order = await orders.get(id);
    if (!order || order.deletedAt) return null;
    return { order, list: await visits.where('orderId', id) };
  }, [id]);

  if (data === undefined) return <Loading />;
  if (data === null) return <NotFound back="/ksiegowosc" />;
  const { order, list } = data;
  const done = doneVisits(list);
  const wantsInvoice = order.invoice !== 'brak';
  const pending = pendingInvoices(order, list);
  const ready = readyToClose(order, list);
  const update = (patch: Partial<Order>) => run(() => orders.update(order.id, patch));
  const updateVisit = (visitId: string, patch: Partial<Visit>) => run(() => visits.update(visitId, patch));

  /** Zapis: zamknięcie (gdy wszystko zrobione) albo powrót z niedokończonym zleceniem; zawsze wraca do listy. */
  const finish = (close: boolean) =>
    run(async () => {
      if (close) await orders.update(order.id, { accountingClosedAt: new Date().toISOString() });
      setSummaryOpen(false);
      toast(close ? `${orderCode(order)}: zamknięte, wszystko zrobione` : `${orderCode(order)}: zapisane, zostaje w „Do zrobienia”`);
      navigate('/ksiegowosc', { replace: true });
    });

  // Podsumowanie przed wyjściem: co zrobione, co jeszcze czeka.
  const summaryLines: Array<[string, boolean]> = [
    ...(wantsInvoice
      ? done.length
        ? done.map((v): [string, boolean] => [
            `Faktura za zabieg ${roman(v.seq)} (${v.amount ? formatPln(v.amount) : 'bez kwoty'})${v.invoiceNumber ? `, nr ${v.invoiceNumber}` : ''}`,
            visitInvoiced(order, v),
          ])
        : [['Faktura: zabieg jeszcze niewykonany', false] as [string, boolean]]
      : []),
    ...(order.protocol ? [['Protokół', Boolean(order.protocolDone)] as [string, boolean]] : []),
  ];

  return (
    <Page title={orderCode(order)} back="/ksiegowosc">
      {order.accountingClosedAt && accountingState(order, list) === 'zamkniete' ? (
        <div className="notice notice-info">
          <Icon name="check" />
          <span>Zamknięte przez księgową {formatDate(order.accountingClosedAt)}.</span>
        </div>
      ) : order.accountingClosedAt ? (
        <div className="notice notice-warn">
          <Icon name="alert" />
          <span>Zlecenie było zamknięte, ale doszedł zabieg bez faktury. Zaznacz go poniżej.</span>
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
        {order.invoice === 'vat' && <Info label="Firma">{order.invoiceName || '—'}</Info>}
        {order.nip && <Info label="NIP">{order.nip}</Info>}
        <Info label="Adres do faktury">{order.invoiceAddress || `${orderAddress(order)}${order.postalCode ? `, ${order.postalCode}` : ''}`}</Info>
        {order.email && <Info label="E-mail">{order.email}</Info>}
        {order.phones.map((p, i) => (
          <Info key={i} label={i === 0 ? 'Telefon' : p.label || 'Telefon'}>
            {p.number}
          </Info>
        ))}
      </Group>

      <Group title={wantsInvoice ? `Faktury za zabiegi (${done.length - pending.length} z ${done.length})` : `Wykonane zabiegi (${done.length})`} plain>
        {done.length === 0 && <Empty title="Zabieg jeszcze niewykonany" />}
        {done.map((v) => (
          <div key={v.id} className={`card form accounting-visit${wantsInvoice && visitInvoiced(order, v) ? ' accounting-visit-done' : ''}`}>
            <Link to={`/zabieg/${v.id}`} className="accounting-visit-head">
              <strong>
                {visitCode(order, v.seq)} · {formatDate(v.doneOn)}
              </strong>
              <span className="num">{v.amount ? formatPln(v.amount) : '—'}</span>
            </Link>
            <span className="row-sub">
              {[v.payMethod && PAY_NAMES[v.payMethod], workSummary(v), v.technicianName && `technik: ${v.technicianName}`].filter(Boolean).join(' · ')}
            </span>
            {wantsInvoice && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={visitInvoiced(order, v)}
                    onChange={(e) => void updateVisit(v.id, { invoicedAt: e.target.checked ? new Date().toISOString() : null })}
                  />
                  Faktura za zabieg {roman(v.seq)} wystawiona
                </label>
                <SavedText label="Numer faktury" value={v.invoiceNumber ?? ''} placeholder="Np. FV 12/11/2026" onSave={(invoiceNumber) => updateVisit(v.id, { invoiceNumber })} />
              </>
            )}
          </div>
        ))}
        {done.length > 1 && <Info label="Razem">{formatPln(invoiceAmount(list))}</Info>}
      </Group>

      {order.protocol && (
        <Group title="Protokół" plain>
          <label className="check">
            <input type="checkbox" checked={Boolean(order.protocolDone)} onChange={(e) => void update({ protocolDone: e.target.checked })} />
            Protokół przygotowany
          </label>
        </Group>
      )}
      <SavedText label="Uwagi księgowej" value={order.accountingNote ?? ''} multiline onSave={(accountingNote) => update({ accountingNote })} />

      {order.accountingClosedAt && accountingState(order, list) === 'zamkniete' ? (
        <button type="button" className="btn btn-block" onClick={() => void update({ accountingClosedAt: null })}>
          Otwórz ponownie
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-block" onClick={() => setSummaryOpen(true)}>
          <Icon name="check" /> Zapisz
        </button>
      )}
      <Link className="btn btn-block" to={`/zlecenia/${order.id}`}>
        Pełne zlecenie
      </Link>

      <Sheet open={summaryOpen} title={`Podsumowanie · ${orderCode(order)}`} onClose={() => setSummaryOpen(false)}>
        <div className="form">
          <p className="sheet-text">
            {order.clientName}
            {order.invoice === 'vat' && order.invoiceName ? ` · ${order.invoiceName}` : ''}
          </p>
          <ul className="accounting-summary">
            {summaryLines.map(([text, ok]) => (
              <li key={text} className={ok ? 'done' : 'todo'}>
                <Icon name={ok ? 'check' : 'alert'} size={16} /> {text}: {ok ? 'zrobione' : 'jeszcze nie'}
              </li>
            ))}
          </ul>
          {ready ? (
            <button type="button" className="btn btn-primary btn-block" onClick={() => void finish(true)}>
              <Icon name="check" /> Zamknij zlecenie i wróć do listy
            </button>
          ) : (
            <p className="field-hint">Nie wszystko jest zrobione, więc zlecenie zostanie w „Do zrobienia”.</p>
          )}
          <button type="button" className={ready ? 'btn btn-block' : 'btn btn-primary btn-block'} onClick={() => void finish(false)}>
            {ready ? 'Zapisz bez zamykania' : 'Zapisz i wróć do listy'}
          </button>
        </div>
      </Sheet>
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
          // Nierealna kwota (np. numer telefonu) nie zapisuje się.
          if (parsed !== null && parsed <= 3_000_000 && parsed !== props.value) void props.onSave(parsed);
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

type PaymentTab = 'nowe' | 'sprawdzone';
type MethodFilter = 'wszystkie' | 'blik' | 'przelew';

/**
 * BLIK i przelewy dla księgowej: każda wpłata z wykonanego zabiegu, od najnowszej. „Wpłynęło” oznacza, że kwota
 * jest na koncie; oznaczenie widzą wszyscy (synchronizacja), a „Cofnij” je zdejmuje.
 */
export function PaymentsPage() {
  const { run, toast } = useFeedback();
  const data = useLiveQuery(async () => ({ orders: await orders.all(), visits: await visits.all(), regions: await getRegions() }));
  const [tab, setTab] = useState<PaymentTab>('nowe');
  const [method, setMethod] = useState<MethodFilter>('wszystkie');
  const [region, setRegion] = useState('');
  if (!data) return <Loading />;
  const byId = new Map(data.orders.map((o) => [o.id, o]));
  const all = bankPayments(data.visits).filter((v) => byId.has(v.orderId) && (!region || byId.get(v.orderId)!.branchId === region));
  const fresh = all.filter(paymentUnchecked);
  const checked = all.filter((v) => !paymentUnchecked(v));
  const list = (tab === 'nowe' ? fresh : checked).filter((v) => method === 'wszystkie' || v.payMethod === method);
  const total = list.reduce((sum, v) => sum + (v.amount ?? 0), 0);

  const mark = (v: Visit, ok: boolean) =>
    run(async () => {
      const me = await getProfile();
      await visits.update(v.id, ok ? { paymentCheckedAt: new Date().toISOString(), paymentCheckedBy: me.name } : { paymentCheckedAt: null, paymentCheckedBy: '' });
      toast(ok ? 'Oznaczono: wpłynęło' : 'Cofnięto oznaczenie', ok ? { action: { label: 'Cofnij', onClick: () => void mark(v, false) } } : undefined);
    });

  return (
    <Page title="BLIK i przelewy" back="/ksiegowosc">
      {Object.keys(data.regions).length > 1 && (
        <label className="region-line region-switch">
          <span>region</span>
          <select value={region} aria-label="Region" onChange={(e) => setRegion(e.target.value)}>
            <option value="">wszystkie</option>
            {Object.entries(data.regions)
              .sort((a, b) => a[1].name.localeCompare(b[1].name, 'pl'))
              .map(([id, info]) => (
                <option key={id} value={id}>
                  {info.name.toLowerCase()}
                </option>
              ))}
          </select>
        </label>
      )}
      <Chips
        wrap
        value={tab}
        onChange={setTab}
        options={[
          { value: 'nowe', label: 'Nowe', count: fresh.length },
          { value: 'sprawdzone', label: 'Sprawdzone' },
        ]}
      />
      <Chips
        value={method}
        onChange={setMethod}
        options={[
          { value: 'wszystkie', label: 'BLIK i przelewy' },
          { value: 'blik', label: 'BLIK' },
          { value: 'przelew', label: 'Przelew' },
        ]}
      />
      {list.length > 0 && (
        <p className="total-line">
          <span>{tab === 'nowe' ? 'Do sprawdzenia' : 'Sprawdzone'}: {list.length}</span>
          <strong>{formatPln(total)}</strong>
        </p>
      )}
      <Group>
        {list.length === 0 && <Empty icon="wallet" title={tab === 'nowe' ? 'Brak nowych wpłat do sprawdzenia' : 'Nic jeszcze nie sprawdzono'} />}
        {list.map((v) => {
          const order = byId.get(v.orderId)!;
          return (
            <div key={v.id} className="payment-row">
              <Link to={`/zabieg/${v.id}`} className="payment-main">
                <span className="payment-head">
                  <strong>{formatPln(v.amount ?? 0)}</strong>
                  {v.payMethod && <PayBadge method={v.payMethod} />}
                </span>
                <span>
                  <span className="order-number">{visitCode(order, v.seq)}</span> {order.clientName || order.phones[0]?.number}
                </span>
                <span className="row-sub">
                  {formatDate(v.doneOn ?? v.start)} · {v.technicianName || 'technik'} · {orderAddress(order)}
                  {order.invoice !== 'brak' ? ` · ${INVOICES[order.invoice]}` : ''}
                </span>
                {v.paymentCheckedAt && (
                  <span className="row-sub">
                    Sprawdzone {formatDate(v.paymentCheckedAt)}
                    {v.paymentCheckedBy ? `, ${v.paymentCheckedBy}` : ''}
                  </span>
                )}
              </Link>
              {paymentUnchecked(v) ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => void mark(v, true)}>
                  <Icon name="check" /> Wpłynęło
                </button>
              ) : (
                <button type="button" className="btn btn-sm" onClick={() => void mark(v, false)}>
                  Cofnij
                </button>
              )}
            </div>
          );
        })}
      </Group>
    </Page>
  );
}
