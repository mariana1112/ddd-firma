import { orderCode, roman, visitCode } from '../data/codes';
import { withCountryCode } from '../lib/validators';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { cancelVisit, defaultDoneOn, finishVisit, normalizeInterview, orderVisits, restoreOrder, revertStartedVisit, scheduleNextVisit, startVisit, type NextVisit } from '../data/orders';
import { googleCalendarUrl } from '../data/calendar';
import { ScheduleNext } from './orders';
import { paymentMissing } from '../data/order-list';
import { orders, visits } from '../data/repo';
import { getAppSettings, getCompany, type AppSettings, getProfile } from '../data/settings';
import { formatAccount } from '../data/card';
import { CopyRow } from './card';
import {
  INVOICES,
  PAY_NAMES,
  PINK_PLACEHOLDER,
  pestName,
  priceRange,
  workSummary,
  bookedBy, firstName, orderText, centralExport } from '../data/texts';
import type { Interview, InvoiceType, Order, PayMethod, Visit, YesNo } from '../data/types';
import { formatDate, formatTerm, todayWarsaw } from '../lib/dates';
import { TomorrowReminders } from './reminders';
import { moneyToInput, parseMoney } from '../lib/money';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Field, Group, Info, Loading, NotFound, Page, Sheet, TimeSelect, goBack } from '../ui/kit';
import { ContactBar, PinkBadge, SmsSheet, VisitBadge, visitWhen, AddressBlock, ClientHeading, copyText } from './common';
import { doneMethods, EXTRA_TREATMENTS, METHOD_LABEL, methodOf, recommendationsFor, SEALING_OPTIONS, methodNames } from '../data/methods';
import { Photos } from './photos';
import { INVOICE_FIELD_LABEL, invoiceMissing, type InvoiceField } from '../data/invoice';
import { isValidNip } from '../lib/validators';
import { VisitSummary } from './visit-summary';
import { TermsFields, termsDraft, termsFromDraft, termsText } from './terms';
import { proposeTerms, visitPrice, type VisitTerms } from '../data/visit-terms';

/** Kolejka zapisów wywiadu, wspólna dla ekranu zabiegu. */
let interviewQueue: Promise<unknown> = Promise.resolve();

/** Pytanie tak/nie. Ponowne dotknięcie zaznaczonej odpowiedzi ją czyści. */
function YesNoField(props: { label: string; value: YesNo; onChange: (value: YesNo) => void }) {
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      <div className="segmented yes-no" role="group" aria-label={props.label}>
        {(['tak', 'nie'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={props.value === v ? 'active' : ''}
            aria-pressed={props.value === v}
            onClick={() => props.onChange(props.value === v ? '' : v)}
          >
            {v === 'tak' ? 'Tak' : 'Nie'}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Pole zapisywane na bieżąco: każda zmiana trafia do bazy po chwili bezczynności i przy opuszczeniu pola. */
function AutoText(props: {
  label: string;
  value: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(props.value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(value);
  const pending = useRef(false);
  const onSave = useRef(props.onSave);
  onSave.current = props.onSave;

  const flush = () => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    pending.current = false;
    onSave.current(latest.current);
  };

  // Zapis także przy wyjściu z ekranu i przy przełączeniu aplikacji lub zablokowaniu telefonu.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Field label={props.label}>
      <textarea
        rows={props.rows ?? 2}
        value={value}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        onChange={(e) => {
          setValue(e.target.value);
          latest.current = e.target.value;
          pending.current = true;
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, 400);
        }}
        onBlur={flush}
      />
    </Field>
  );
}

/**
 * Czy klient dostał SMS z podsumowaniem i zaleceniami. Brak: wyraźna uwaga i „Wyślij teraz”; wysłane: data i godzina.
 * „Wysłane” znaczy, że technik otworzył Wiadomości z gotową treścią (aplikacja nie widzi, czy SMS faktycznie poszedł).
 */
function SummarySentBox({ visit, order }: { visit: Visit; order: Order }) {
  const [open, setOpen] = useState(false);
  const phone = order.phones.some((p) => p.number.trim());
  if (!phone) return null;
  return (
    <>
      {visit.summarySentAt ? (
        <div className="notice notice-info">
          <Icon name="check" />
          <span>
            Zalecenia wysłane klientowi {formatDate(visit.summarySentAt)}, godz. {visit.summarySentAt ? new Date(visit.summarySentAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }) : ''}.
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
            Wyślij ponownie
          </button>
        </div>
      ) : (
        <div className="notice notice-warn">
          <Icon name="alert" />
          <span>
            <strong>Zalecenia nie zostały wysłane klientowi.</strong>
          </span>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen(true)}>
            Wyślij teraz
          </button>
        </div>
      )}
      {open && <SmsSheet order={order} visit={visit} open={open} initial="zalecenia" only onClose={() => setOpen(false)} />}
    </>
  );
}

/** Pole zlecenia (dane do faktury) zapisywane po wyjściu z pola; brak podświetla się na czerwono. */
function OrderField(props: { label: string; value: string; missing: boolean; error?: string; inputMode?: 'email' | 'numeric' | 'text'; placeholder?: string; onSave: (value: string) => void }) {
  const [value, setValue] = useState(props.value);
  useEffect(() => setValue(props.value), [props.value]);
  return (
    <Field label={props.label} error={props.error ?? (props.missing ? `Uzupełnij: ${props.label}` : undefined)}>
      <input
        value={value}
        inputMode={props.inputMode}
        autoCapitalize={props.inputMode === 'email' ? 'none' : undefined}
        placeholder={props.placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim() !== props.value) props.onSave(value.trim());
        }}
      />
    </Field>
  );
}

/**
 * Dane do faktury przy zabiegu: po wybraniu faktury (także gdy klient zmieni zdanie w trakcie) trzeba uzupełnić
 * przy VAT nazwę firmy, NIP i e-mail, przy imiennej imię i nazwisko oraz e-mail.
 */
function InvoiceData({ order, alert, onSave }: { order: Order; alert: boolean; onSave: (patch: Partial<Order>) => void }) {
  if (order.invoice === 'brak') return null;
  const missing = invoiceMissing(order);
  const flag = (f: InvoiceField) => alert && missing.includes(f);
  return (
    <div className="invoice-data">
      {order.invoice === 'vat' ? (
        <>
          <OrderField label="Nazwa firmy" value={order.invoiceName ?? ''} missing={flag('invoiceName')} placeholder="Np. Apt Production sp. z o.o." onSave={(invoiceName) => onSave({ invoiceName })} />
          <OrderField
            label="NIP"
            value={order.nip}
            inputMode="numeric"
            missing={flag('nip')}
            error={order.nip.trim() && !isValidNip(order.nip) ? 'NIP jest niepoprawny' : undefined}
            onSave={(nip) => onSave({ nip })}
          />
        </>
      ) : (
        <OrderField label="Imię i nazwisko" value={order.clientName} missing={flag('clientName')} onSave={(clientName) => onSave({ clientName })} />
      )}
      <OrderField label="E-mail" value={order.email} inputMode="email" missing={flag('email')} onSave={(email) => onSave({ email })} />
      <OrderField label="Adres do faktury (puste: adres zlecenia)" value={order.invoiceAddress} missing={false} onSave={(invoiceAddress) => onSave({ invoiceAddress })} />
    </div>
  );
}

function ToggleChips(props: { options: string[]; selected: string[]; onChange: (selected: string[]) => void; addLabel: string }) {
  const [custom, setCustom] = useState('');
  const all = [...props.options, ...props.selected.filter((s) => !props.options.includes(s))];
  const toggle = (item: string) =>
    props.onChange(props.selected.includes(item) ? props.selected.filter((s) => s !== item) : [...props.selected, item]);
  return (
    <>
      <div className="chips chips-wrap">
        {all.map((item) => (
          <button key={item} type="button" className={props.selected.includes(item) ? 'chip active' : 'chip'} aria-pressed={props.selected.includes(item)} onClick={() => toggle(item)}>
            {item}
          </button>
        ))}
      </div>
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom.trim() && !props.selected.includes(custom.trim())) props.onChange([...props.selected, custom.trim()]);
          setCustom('');
        }}
      >
        <input value={custom} placeholder={props.addLabel} onChange={(e) => setCustom(e.target.value)} />
        <button type="submit" className="btn btn-sm" disabled={!custom.trim()}>
          Dodaj
        </button>
      </form>
    </>
  );
}

function History({ list, current, order, vatRate }: { list: Visit[]; current: Visit; order: Order; vatRate: number }) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Visit | null>(null);
  const earlier = list.filter((v) => v.seq < current.seq && v.status === 'wykonany');
  if (earlier.length === 0) return null;
  return (
    <>
    <Group title="Poprzednie zabiegi">
      {earlier.map((v) => (
        <div key={v.id} className="history">
          <strong>
            Zabieg {roman(v.seq)}, {formatDate(v.doneOn)}
            {v.technicianName ? `, ${v.technicianName}` : ''}
          </strong>
          {workSummary(v) && <span>Wykonano: {workSummary(v)}</span>}
          {v.findings && <span>Zastano: {v.findings}</span>}
          {v.problems && <span>Problemy: {v.problems}</span>}
          {normalizeInterview(v.interview).situation && <span>Sytuacja: {normalizeInterview(v.interview).situation}</span>}
          {v.amount !== null && v.payMethod && (
            <span>
              Płatność: {moneyToInput(v.amount)} zł, {PAY_NAMES[v.payMethod]}
            </span>
          )}
          <button type="button" className="link" onClick={() => setPreview(v)}>
            Szczegóły
          </button>
        </div>
      ))}
    </Group>
    <Sheet open={Boolean(preview)} title={preview ? `Zabieg ${roman(preview.seq)} · ${visitCode(order, preview.seq)}` : ''} onClose={() => setPreview(null)}>
      {preview && (
        <div className="form">
          <VisitSummary order={order} visit={preview} vatRate={vatRate} short />
          <button type="button" className="btn btn-block" onClick={() => navigate(`/zabieg/${preview.id}?edycja=1`)}>
            <Icon name="edit" /> Edytuj poprzedni zabieg
          </button>
        </div>
      )}
    </Sheet>
    </>
  );
}

/**
 * Wszystko, co wpisano przy przyjęciu zlecenia, do spokojnego przeczytania na karcie zabiegu: opis (co napisał
 * przyjmujący, np. szef), co robimy, szkodnik, cena, faktura, protokół, klient i telefony. Pod spodem opcje zlecenia.
 */
function OrderInfo(props: { order: Order; visits: Visit[]; vatRate: number }) {
  const { order } = props;
  const { deliverFile, run, toast } = useFeedback();
  const price = priceRange({ priceMin: order.priceMin, priceMax: order.priceMax, invoice: order.invoice }, props.vatRate);
  const methods = methodNames(order);
  const invoiceData = order.invoice === 'vat' ? [order.invoiceName, order.nip && `NIP ${order.nip}`, order.invoiceAddress].filter(Boolean).join(', ') : order.invoice === 'imienna' ? order.invoiceAddress : '';
  return (
    <Group
      title={`Zlecenie ${orderCode(order)}`}
      action={
        <button
          type="button"
          className="link"
          onClick={() => void copyText(orderText(order, props.visits, props.vatRate)).then((ok) => toast(ok ? 'Skopiowano dane zlecenia' : 'Nie udało się skopiować', ok ? undefined : { tone: 'error' }))}
        >
          <Icon name="copy" /> Kopiuj dane
        </button>
      }
    >
      {order.description.trim() && (
        <div className="order-note">
          <span className="order-note-label">Opis{order.ownerName ? ` od ${firstName(order.ownerName)}` : ''}</span>
          <p>{order.description.trim()}</p>
        </div>
      )}
      {methods.length > 0 && <Info label="Co robimy">{methods.join(', ')}</Info>}
      <Info label="Szkodnik">{pestName(order)}</Info>
      {order.areaM2 && <Info label="Metraż">{order.areaM2} m²</Info>}
      {price && <Info label="Cena">{price.gross ? `${price.net}\n${price.gross}` : price.net}</Info>}
      <Info label="Faktura">{INVOICES[order.invoice]}</Info>
      {invoiceData && <Info label="Dane do faktury">{invoiceData}</Info>}
      {order.protocol && <Info label="Protokół">Tak</Info>}
      {order.clientName.trim() && <Info label="Klient">{order.clientName}</Info>}
      {order.phones.map((p, i) => (
        <Info key={i} label={i === 0 ? 'Telefon' : 'Drugi telefon'}>
          {withCountryCode(p.number)}
          {p.label ? ` (${p.label})` : ''}
        </Info>
      ))}
      {order.email && <Info label="E-mail">{order.email}</Info>}
      {order.pink && <Info label="Kod pink">{order.pinkNote || 'Tak'}</Info>}
      {order.ownerName && <Info label="Przyjął">{`${order.ownerName}, ${formatDate(order.createdAt)}`}</Info>}
      <div className="order-actions">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            void run(async () => {
              const [{ orderDocument }, { renderPdf }] = await Promise.all([import('../pdf/documents'), import('../pdf/render')]);
              deliverFile(await renderPdf(orderDocument(order, props.visits, { vatRate: props.vatRate })), `zlecenie-${orderCode(order).replace(/[^\w-]+/g, '-')}.pdf`);
            })
          }
        >
          <Icon name="file" /> PDF zlecenia
        </button>
        <Link className="btn btn-sm" to={`/zlecenia/${order.id}/edycja`}>
          <Icon name="edit" /> Edytuj zlecenie
        </Link>
        <Link className="btn btn-sm" to={`/zlecenia/${order.id}?pelna=1`}>
          Wszystkie zabiegi i archiwum
        </Link>
      </div>
    </Group>
  );
}

function FinishSheet(props: {
  open: boolean;
  onClose: () => void;
  visit: Visit;
  later: Visit | undefined;
  settings: AppSettings;
  /** Zakres i cena kolejnego zabiegu: przechodzą z tego zabiegu, zmienia się je potem przy kolejnym zabiegu („Zmień”). */
  initialTerms: VisitTerms;
  invoice: Order['invoice'];
  order: Order;
  onFinish: (input: { recommendations: string[]; next: NextVisit; doneOn: string }) => Promise<void>;
}) {
  const { visit, later, settings } = props;
  // Dzień wykonania decyduje o raporcie: zabieg z wcześniejszego dnia zamykany później liczy się do tamtego dnia.
  const [doneOn, setDoneOn] = useState(() => defaultDoneOn(visit, todayWarsaw()));
  // Zalecenia: pakiet wykonanych metod zaznacza się sam (można odznaczyć), pod nim pozostałe i własne do dopisania.
  const methods = doneMethods(visit.treatments, props.order);
  const forMethods = recommendationsFor(methods, props.order.pest, settings.methodPackages);
  const [recommendations, setRecommendations] = useState<string[]>(() => (visit.recommendations.length ? visit.recommendations : forMethods.list));
  const [ownText, setOwnText] = useState('');
  const others = [...new Set([...settings.recommendations, ...recommendations])].filter((r) => !forMethods.list.includes(r));
  const addOwn = () => {
    const text = ownText.trim();
    if (!text) return;
    if (!recommendations.includes(text)) setRecommendations([...recommendations, text]);
    setOwnText('');
  };
  const recommendationRow = (r: string) => (
    <label key={r} className="check">
      <input
        type="checkbox"
        checked={recommendations.includes(r)}
        onChange={(e) => setRecommendations(e.target.checked ? [...recommendations, r] : recommendations.filter((x) => x !== r))}
      />
      {r}
    </label>
  );
  const [mode, setMode] = useState<NextVisit['mode']>(later ? (later.start ? 'umowiony' : 'technik') : visit.seq === 1 ? 'technik' : 'brak');
  const [date, setDate] = useState(later?.start?.slice(0, 10) ?? '');
  const [time, setTime] = useState(later?.start?.slice(11, 16) ?? visit.start?.slice(11, 16) ?? '10:00');
  const [busy, setBusy] = useState(false);
  const nextSeq = visit.seq + 1;
  const ready = mode !== 'umowiony' || Boolean(date && time);

  return (
    <Sheet open={props.open} title={`Zakończenie zabiegu ${roman(visit.seq)}`} onClose={props.onClose}>
      <div className="form">
        <Field label="Data wykonania" hint={doneOn === todayWarsaw() ? 'Dzisiaj: zabieg trafi do dzisiejszego raportu.' : `Zabieg trafi do raportu z ${formatDate(doneOn)}.`}>
          <input type="date" value={doneOn} max={todayWarsaw()} onChange={(e) => setDoneOn(e.target.value || todayWarsaw())} />
        </Field>
        {forMethods.list.length > 0 && (
          <div className="field">
            <span className="field-label">Pakiet zaleceń ({methodNames({ methods, methodOther: props.order.methodOther }).join(', ')}): odznacz, czego nie trzeba</span>
            <div className="check-list">{forMethods.list.map(recommendationRow)}</div>
          </div>
        )}
        <div className="field">
          <span className="field-label">{forMethods.list.length ? 'Inne zalecenia' : 'Zalecenia: zaznacz wybrane'}</span>
          {others.length > 0 && <div className="check-list">{others.map(recommendationRow)}</div>}
          <div className="add-own">
            <input
              value={ownText}
              placeholder="Dopisz własne zalecenie"
              onChange={(e) => setOwnText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOwn();
                }
              }}
            />
            <button type="button" className="btn btn-sm" disabled={!ownText.trim()} onClick={addOwn}>
              <Icon name="plus" /> Dodaj
            </button>
          </div>
        </div>
        <div className="field">
          <span className="field-label">Zabieg {roman(nextSeq)}</span>
          <div className="choice">
            {(
              [
                ['brak', `Bez zabiegu ${roman(nextSeq)}`],
                ['technik', 'Klient umówi się później'],
                ['umowiony', nextSeq === 3 ? `Umawiam teraz (+${moneyToInput(settings.thirdVisitBonus)} zł premii)` : 'Umawiam teraz'],
              ] as Array<[NextVisit['mode'], string]>
            ).map(([value, label]) => (
              <button key={value} type="button" className={mode === value ? 'choice-item active' : 'choice-item'} onClick={() => setMode(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {mode === 'umowiony' && (
          <div className="form-row">
            <Field label="Data">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Godzina">
              <TimeSelect value={time} onChange={setTime} />
            </Field>
          </div>
        )}
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={!ready || busy}
          onClick={async () => {
            setBusy(true);
            const t = props.initialTerms;
            const next: NextVisit =
              mode === 'umowiony' ? { mode, start: `${date}T${time}`, durationMin: visit.durationMin, terms: t } : mode === 'technik' ? { mode, terms: t } : { mode };
            await props.onFinish({ recommendations, next, doneOn });
            setBusy(false);
          }}
        >
          <Icon name="check" /> {busy ? 'Zapisuję…' : 'Zakończ zabieg'}
        </button>
      </div>
    </Sheet>
  );
}

export function VisitPage() {
  const { id = '' } = useParams();
  const { confirm, run, toast } = useFeedback();
  const navigate = useNavigate();
  const [finishing, setFinishing] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [editingPlanned, setEditingPlanned] = useState(false);
  const [leavingStarted, setLeavingStarted] = useState(false);
  const [planningNext, setPlanningNext] = useState(false);
  const [editingTerms, setEditingTerms] = useState(false);
  // Próba zakończenia bez płatności: sekcja płatności świeci na czerwono, ekran przewija się do niej.
  const [payAlert, setPayAlert] = useState(false);
  // Faktura bez potrzebnych danych (NIP, firma, imię i nazwisko, e-mail): pola świecą na czerwono.
  const [invoiceAlert, setInvoiceAlert] = useState(false);
  const payRef = useRef<HTMLDivElement>(null);
  // Pole opisu kodu pink dostaje kursor tylko zaraz po zaznaczeniu, a nie przy każdym wejściu na ekran.
  const [pinkJustOn, setPinkJustOn] = useState(false);
  // Wykonany zabieg pokazuje podsumowanie; formularz otwiera „Edytuj zabieg” albo link z ?edycja=1.
  const [params, setParams] = useSearchParams();
  const [editingId, setEditingId] = useState<string | null>(params.has('edycja') ? id : null);
  useEffect(() => setEditingId(params.has('edycja') ? id : null), [id, params]);
  const editing = editingId === id;

  const data = useLiveQuery(async () => {
    const visit = await visits.get(id);
    if (!visit || visit.deletedAt) return null;
    const order = await orders.get(visit.orderId);
    if (!order) return null;
    return { visit, order, list: await orderVisits(order.id), settings: await getAppSettings(), company: await getCompany() };
  }, [id]);

  if (data === undefined) return <Loading />;
  if (data === null) return <NotFound back="/zlecenia" />;
  const { visit, order, list, settings, company } = data;
  const later = list.find((v) => v.seq === visit.seq + 1 && v.status !== 'odwolany');
  const phone = order.phones[0];
  // Cena i zakres tego zabiegu; zabiegi sprzed tej opcji mają widełki zlecenia i całe mieszkanie.
  const terms: VisitTerms = { scope: visit.scope ?? { kind: 'calosc', note: '' }, ...visitPrice(visit, order) };
  const price = priceRange({ ...terms, invoice: order.invoice }, settings.vatRate);
  const save = (patch: Partial<Visit>) => void run(() => visits.update(visit.id, patch));
  // Świeży odczyt z bazy: dwa pola zapisane tuż po sobie nie mogą nadpisać się nawzajem.
  // Zapisy wywiadu idą po kolei: tekst zapisany przy wyjściu z pola i dotknięte zaraz potem Tak/Nie
  // czytałyby ten sam stary wywiad i drugi zapis nadpisałby pierwszy. Zapis zawsze w obecnej postaci.
  const saveInterview = <K extends keyof Interview>(key: K, value: Interview[K]) => {
    interviewQueue = interviewQueue.then(() =>
      run(async () => {
        const current = await visits.get(visit.id);
        if (current) await visits.update(visit.id, { interview: { ...normalizeInterview(current.interview), [key]: value } });
      }),
    );
  };
  const interview = normalizeInterview(visit.interview);
  const summary = visit.status === 'wykonany' && !editing;
  const active = visit.status === 'w_trakcie' || (visit.status === 'wykonany' && editing);

  const scrollToPay = () => setTimeout(() => payRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);

  /**
   * „Zakończ zabieg”: forma płatności i kwota są wymagane. Gdy ich brakuje, płatność świeci na czerwono i ekran
   * przewija się do niej; można też zakończyć teraz i uzupełnić później (zabieg trafia do „Pilnych”).
   */
  const requestFinish = async () => {
    // Kwota zapisuje się przy wyjściu z pola, więc czytamy świeży stan po chwili.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const fresh = (await visits.get(visit.id)) ?? visit;
    // Faktura wymaga danych klienta: bez nich zabiegu nie da się zakończyć.
    const freshOrder = (await orders.get(order.id)) ?? order;
    const lacking = invoiceMissing(freshOrder);
    if (lacking.length) {
      setInvoiceAlert(true);
      toast(`Do faktury brakuje: ${lacking.map((f) => INVOICE_FIELD_LABEL[f]).join(', ')}`, { tone: 'error' });
      scrollToPay();
      return;
    }
    const missing = [!fresh.payMethod && 'formy płatności', !fresh.amount && 'kwoty'].filter(Boolean) as string[];
    if (missing.length) {
      setPayAlert(true);
      const later = await confirm({
        title: 'Brak płatności',
        message: `Nie wybrano ${missing.join(' ani ')}. Uzupełnij płatność albo zakończ teraz i uzupełnij później: zabieg trafi do „Pilnych”.`,
        confirmLabel: 'Później (do Pilnych)',
        cancelLabel: 'Uzupełnię teraz',
      });
      if (!later) {
        scrollToPay();
        return;
      }
    }
    setFinishing(true);
  };

  const cancel = async () => {
    const ok = await confirm({
      title: `Odwołać zabieg ${roman(visit.seq)}?`,
      message: 'Zabieg zniknie z kalendarza. Gdy w zleceniu nie zostanie nic do zrobienia ani wykonane, zlecenie trafi do archiwum.',
      confirmLabel: 'Odwołaj zabieg',
      danger: true,
    });
    if (!ok) return;
    const previous = visit.status;
    await run(async () => {
      const { archived } = await cancelVisit(visit.id);
      toast(archived ? 'Zabieg odwołany, zlecenie w archiwum' : 'Zabieg odwołany', {
        action: {
          label: 'Cofnij',
          onClick: () =>
            void run(async () => {
              await visits.update(visit.id, { status: previous });
              if (archived) await restoreOrder(order.id);
            }),
        },
      });
    });
  };

  const finish = async (input: { recommendations: string[]; next: NextVisit; doneOn: string }) => {
    await run(async () => {
      await finishVisit(visit.id, {
        doneOn: input.doneOn,
        payMethod: visit.payMethod,
        amount: visit.amount,
        treatments: visit.treatments,
        places: visit.places,
        findings: visit.findings,
        problems: visit.problems,
        recommendations: input.recommendations,
        next: input.next,
      });
      setFinishing(false);
      setEditingId(null);
      // SMS z zaleceniami wysyła się przyciskiem w podsumowaniu, bez wyskakującego okna.
      toast(phone ? 'Zabieg zakończony. Zalecenia wyślesz przyciskiem „SMS” na górze.' : 'Zabieg zakończony');
    });
  };

  return (
    // Klucz: przejście do innego zabiegu tworzy pola od nowa, żeby nie zostały w nich wartości poprzedniego.
    <Page
      key={visit.id}
      title={visitCode(order, visit.seq)}
      back="/zlecenia"
      onBack={visit.status === 'w_trakcie' ? () => setLeavingStarted(true) : undefined}
    >
      {/* Wyjście z rozpoczętego zabiegu: dokończyć później (czeka w Pilnych) albo wycofać wszystko, co wpisano. */}
      <Sheet open={leavingStarted} title={`Zabieg ${visitCode(order, visit.seq)} jest rozpoczęty`} onClose={() => setLeavingStarted(false)}>
        <div className="form">
          <p className="sheet-text">Wpisane dane są zapisane. Możesz wrócić do zabiegu później: czeka na Pulpicie w „Pilnych”.</p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              setLeavingStarted(false);
              toast('Zabieg czeka w „Pilnych” na Pulpicie');
              goBack(navigate, `/zlecenia/${order.id}`);
            }}
          >
            <Icon name="alert" /> Dokończ później (do Pilnych)
          </button>
          <button
            type="button"
            className="btn btn-danger-quiet btn-block"
            onClick={async () => {
              const ok = await confirm({
                title: 'Usunąć wszystko, co wpisano?',
                message: 'Zabieg wróci do „umówiony” z tym samym terminem. Wykonane prace, wywiad, zalecenia, płatność i zdjęcia (do kosza) znikną.',
                confirmLabel: 'Usuń wpisane dane',
                danger: true,
              });
              if (!ok) return;
              await run(async () => {
                await revertStartedVisit(visit.id);
                setLeavingStarted(false);
                toast('Wycofano rozpoczęcie zabiegu');
                goBack(navigate, `/zlecenia/${order.id}`);
              });
            }}
          >
            <Icon name="trash" /> Usuń wszystko, co wpisano
          </button>
          <button type="button" className="btn btn-block" onClick={() => setLeavingStarted(false)}>
            Zostań w zabiegu
          </button>
        </div>
      </Sheet>
      <div className="job-hero">
        <div className="hero-badges">
          <VisitBadge visit={visit} />
          {order.pink && <PinkBadge />}
        </div>
        <ClientHeading order={order} />
        <AddressBlock order={order} />
        <p>
          {pestName(order)} · {visitWhen(visit)}
        </p>
        {bookedBy(visit, order) && <p className="visit-booked">Umówione przez: {firstName(bookedBy(visit, order))}</p>}
      </div>

      <ContactBar
        order={order}
        visit={visit}
      />
      {params.has('nowe') && visit.start && (
        <div className="notice notice-info calendar-offer">
          <Icon name="calendar" />
          <span>
            <strong>Zlecenie zapisane.</strong> Dodać termin {formatTerm(visit.start)} do Kalendarza Google?
          </span>
          <span className="notice-actions">
            <a className="btn btn-sm btn-primary" href={googleCalendarUrl(order, visit)!} target="_blank" rel="noreferrer" onClick={() => setParams({}, { replace: true })}>
              Dodaj do kalendarza
            </a>
            <button type="button" className="btn btn-sm" onClick={() => setParams({}, { replace: true })}>
              Nie teraz
            </button>
          </span>
        </div>
      )}
      <OrderInfo order={order} visits={list} vatRate={settings.vatRate} />

      {order.access && (
        <div className="notice notice-info">
          <Icon name="pin" />
          <span>{order.access}</span>
        </div>
      )}
      {order.pink && (
        <div className="notice notice-pink">
          <Icon name="alert" />
          <span>Kod pink{order.pinkNote ? `: ${order.pinkNote}` : ''}</span>
        </div>
      )}

      {!summary && (
        <div className="terms-bar">
          <span>
            <span className="terms-label">Co pryskamy i cena</span>
            {termsText(terms, order.invoice, settings.vatRate)}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setEditingTerms(true)}>
            <Icon name="edit" /> Zmień
          </button>
        </div>
      )}

      {visit.status === 'zaplanowany' && (
        <>
          {/* Kolejny zabieg (II, III…) można zacząć dopiero po umówieniu terminu z klientem. */}
          {visit.seq > 1 && !visit.start && (
            <p className="notice notice-warn">
              <Icon name="alert" />
              <span>Zabieg {roman(visit.seq)} nie jest umówiony. Najpierw umów termin z klientem, potem go rozpoczniesz.</span>
            </p>
          )}
          <button
            type="button"
            className="btn btn-primary btn-block btn-big"
            disabled={visit.seq > 1 && !visit.start}
            onClick={() => void run(() => startVisit(visit.id))}
          >
            <Icon name="play" /> Rozpocznij zabieg
          </button>
          <div className="btn-stack">
            {/* Jedno miejsce na zmiany umówionego zabiegu: termin, czas, zakres i cena; dane klienta w edycji zlecenia. */}
            <button type="button" className="btn" onClick={() => setEditingPlanned(true)}>
              <Icon name="edit" /> {visit.start ? 'Edytuj zabieg (termin, czas, zakres, cena)' : 'Umów termin i edytuj zabieg'}
            </button>
            {visit.start && (
              <a className="btn" href={googleCalendarUrl(order, visit)!} target="_blank" rel="noreferrer">
                <Icon name="calendar" /> Dodaj do Kalendarza Google
              </a>
            )}
            {later?.start ? (
              <button type="button" className="btn" onClick={() => navigate(`/zabieg/${later.id}`)}>
                <Icon name="calendar" /> Kolejny zabieg {roman(later.seq)}: {formatTerm(later.start)}
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => setPlanningNext(true)}>
                <Icon name="calendar" /> Umów kolejny zabieg
              </button>
            )}
            <button type="button" className="btn btn-danger-quiet" onClick={() => void cancel()}>
              <Icon name="close" /> Odwołaj zabieg
            </button>
          </div>
        </>
      )}

      {summary && paymentMissing(visit) && (
        <div className="notice notice-danger">
          <Icon name="alert" />
          <span>
            <strong>Brak płatności.</strong> Zabieg jest w „Pilnych”, dopóki nie uzupełnisz formy płatności i kwoty.
          </span>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => {
              setEditingId(visit.id);
              setPayAlert(true);
              scrollToPay();
            }}
          >
            Uzupełnij
          </button>
        </div>
      )}

      {summary && (
        <>
          <SummarySentBox visit={visit} order={order} />
          {visit.doneOn === todayWarsaw() && <TomorrowReminders afterLastToday />}
          <VisitSummary order={order} visit={visit} vatRate={settings.vatRate} later={later} photos={<Photos visitId={visit.id} readOnly />} />
          <div className="btn-stack">
            {/* Po zabiegu: opis i wszystkie dane do skopiowania (np. dla centrali albo do faktury). */}
            {interview.situation.trim() && (
              <button
                type="button"
                className="btn"
                onClick={() => void copyText(interview.situation.trim()).then((ok) => toast(ok ? 'Skopiowano opis' : 'Nie udało się skopiować', ok ? undefined : { tone: 'error' }))}
              >
                <Icon name="copy" /> Kopiuj opis
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => void copyText(centralExport(order, visit, list)).then((ok) => toast(ok ? 'Skopiowano wszystkie dane zabiegu' : 'Nie udało się skopiować', ok ? undefined : { tone: 'error' }))}
            >
              <Icon name="copy" /> Kopiuj wszystkie dane
            </button>
            <button type="button" className="btn" onClick={() => setEditingId(visit.id)}>
              <Icon name="edit" /> Edytuj zabieg
            </button>
            {!later?.start && (
              <button type="button" className="btn" onClick={() => setPlanningNext(true)}>
                <Icon name="calendar" /> Umów kolejny zabieg
              </button>
            )}
          </div>
        </>
      )}

      <Sheet open={planningNext} title={`Umów kolejny zabieg · ${visitCode(order, later?.seq ?? Math.max(...list.map((v) => v.seq)) + 1)}`} onClose={() => setPlanningNext(false)}>
        {planningNext && (
          <ScheduleNext
            durationMin={visit.durationMin || 60}
            initial={proposeTerms(list, order)}
            invoice={order.invoice}
            onSave={(start, durationMin, nextTerms) =>
              void run(async () => {
                const next = await scheduleNextVisit(order.id, { start, durationMin, terms: nextTerms });
                setPlanningNext(false);
                toast(`Zabieg ${roman(next.seq)} umówiony: ${formatTerm(start)}`);
              })
            }
          />
        )}
      </Sheet>


      {active && (
        <>
          <Group title="Wywiad" plain>
            <AutoText
              label="Opis"
              placeholder="Co się dzieje, gdzie, od kiedy"
              rows={4}
              value={interview.situation}
              onSave={(v) => saveInterview('situation', v)}
            />
            {order.pest !== 'karaluchy' && <YesNoField label="Czy są ugryzienia?" value={interview.bites} onChange={(v) => saveInterview('bites', v)} />}
            <YesNoField label="Czy widziano owady?" value={interview.seen} onChange={(v) => saveInterview('seen', v)} />
            {interview.seen === 'tak' && (
              <AutoText label="Ile owadów?" placeholder="Np. kilka, ok. 20" rows={1} value={interview.seenCount} onSave={(v) => saveInterview('seenCount', v)} />
            )}
            <YesNoField label="Czy klient używał środków na własną rękę?" value={interview.selfTreatment} onChange={(v) => saveInterview('selfTreatment', v)} />
          </Group>

          <Group title="Wykonane" plain>
            <ToggleChips
              options={[...new Set([...Object.values(METHOD_LABEL).filter((l) => l !== METHOD_LABEL.inne), ...methodNames(order), ...EXTRA_TREATMENTS, ...settings.treatments.filter((t) => !methodOf(t))])]}
              selected={visit.treatments}
              addLabel="Inny zabieg"
              onChange={(treatments) => save({ treatments })}
            />
            <span className="field-label">Miejsca wykonywania oprysku/żelowania</span>
            <ToggleChips options={settings.places} selected={visit.places} addLabel="Inne miejsce" onChange={(places) => save({ places })} />
            {workSummary(visit) && <p className="field-hint">Do wiadomości: {workSummary(visit)}</p>}
          </Group>

          <Group title="Czy trzeba uszczelnić?" plain>
            <p className="field-hint">Zaznacz, co klient powinien uszczelnić. Trafi do zaleceń w SMS-ie po zabiegu.</p>
            <ToggleChips options={SEALING_OPTIONS} selected={visit.sealing ?? []} addLabel="Inne miejsce do uszczelnienia" onChange={(sealing) => save({ sealing })} />
          </Group>

          <Group title="Zdjęcia" plain>
            <Photos visitId={visit.id} />
          </Group>

          <Group title="Protokół" plain>
            <label className="check">
              <input type="checkbox" checked={Boolean(order.protocol)} onChange={(e) => void run(() => orders.update(order.id, { protocol: e.target.checked }))} />
              Klient chce protokół z zabiegu
            </label>
          </Group>

          <div className={order.pink ? 'pink-box active' : 'pink-box'}>
            <label className="check check-pink">
              <input
                type="checkbox"
                checked={order.pink}
                onChange={(e) => {
                  setPinkJustOn(e.target.checked);
                  void run(() => orders.update(order.id, { pink: e.target.checked }));
                }}
              />
              Kod pink: trudny klient lub problematyczne mieszkanie
            </label>
            {order.pink && (
              <AutoText
                label="Co i jak?"
                placeholder={PINK_PLACEHOLDER}
                rows={3}
                autoFocus={pinkJustOn}
                value={order.pinkNote}
                onSave={(pinkNote) => void run(() => orders.update(order.id, { pinkNote }))}
              />
            )}
          </div>

          <div ref={payRef} className={payAlert && (!visit.payMethod || !visit.amount) ? 'pay-group pay-alert' : 'pay-group'}>
          <Group title="Płatność (wymagana)" plain>
            {payAlert && (!visit.payMethod || !visit.amount) && (
              <p className="pay-alert-text">
                <Icon name="alert" size={16} /> {!visit.payMethod ? 'Wybierz formę płatności' : 'Wpisz kwotę pobraną od klienta'}
              </p>
            )}
            <div className="pay-choice">
              {(['gotowka', 'blik', 'przelew'] as PayMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`pay-option pay-opt-${m}${visit.payMethod === m ? ' active' : ''}${payAlert && !visit.payMethod ? ' missing' : ''}`}
                  aria-pressed={visit.payMethod === m}
                  onClick={() => save({ payMethod: visit.payMethod === m ? null : m })}
                >
                  {PAY_NAMES[m]}
                </button>
              ))}
            </div>
            {visit.payMethod === 'przelew' && company.bankAccount.trim() && (
              <div className="pay-details">
                <CopyRow label="Numer konta do przelewu" value={formatAccount(company.bankAccount)} copyValue={company.bankAccount.replace(/\s/g, '')} />
              </div>
            )}
            {visit.payMethod === 'blik' && company.blikPhone?.trim() && (
              <div className="pay-details">
                <CopyRow label="BLIK na telefon" value={company.blikPhone.trim()} copyValue={company.blikPhone.replace(/\s/g, '')} />
              </div>
            )}
            <AmountField value={visit.amount} missing={payAlert && !visit.amount} hint={price ? (price.gross ? `Ustalona cena: ${price.net}, ${price.gross}` : `Ustalona cena: ${price.net}`) : undefined} onSave={(amount) => save({ amount })} />
            <div className="choice">
              {(Object.entries(INVOICES) as Array<[InvoiceType, string]>).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={order.invoice === value ? 'choice-item active' : 'choice-item'}
                  onClick={() => void run(() => orders.update(order.id, { invoice: value }))}
                >
                  {label}
                </button>
              ))}
            </div>
            <InvoiceData order={order} alert={invoiceAlert} onSave={(patch) => void run(() => orders.update(order.id, patch))} />
          </Group>
          </div>

          {visit.status === 'w_trakcie' ? (
            <>
              {later?.start ? (
                <p className="notice notice-info">
                  <Icon name="calendar" />
                  <span>
                    Kolejny zabieg {roman(later.seq)} umówiony: <strong>{formatTerm(later.start)}</strong>
                  </span>
                </p>
              ) : (
                <button type="button" className="btn btn-block" onClick={() => setPlanningNext(true)}>
                  <Icon name="calendar" /> Umów od razu kolejny zabieg
                </button>
              )}
              <button type="button" className="btn btn-primary btn-block btn-big" onClick={() => void requestFinish()}>
                <Icon name="check" /> Zakończ zabieg
              </button>
              <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => void cancel()}>
                <Icon name="close" /> Odwołaj zabieg
              </button>
            </>
          ) : (
            <Group title="Po zabiegu" plain>
              {/* Dzień wykonania decyduje o raporcie: można go poprawić, gdy zabieg zamknięto później. */}
              <Field label="Data wykonania" hint="Zabieg liczy się do raportu z tego dnia.">
                <input
                  type="date"
                  value={visit.doneOn ?? ''}
                  max={todayWarsaw()}
                  onChange={(e) => e.target.value && void run(async () => { await visits.update(visit.id, { doneOn: e.target.value }); toast(`Data wykonania: ${formatDate(e.target.value)}`); })}
                />
              </Field>
              {visit.bonus > 0 && <Badge tone="ok">Premia {moneyToInput(visit.bonus)} zł</Badge>}
              {later && (
                <p className="field-hint">
                  Zabieg {roman(later.seq)}: {later.start ? formatTerm(later.start) : 'klient umówi się później'}
                </p>
              )}
              <div className="btn-stack">
                <button type="button" className="btn btn-primary" onClick={() => { setEditingId(null); if (params.has('edycja')) navigate(`/zabieg/${visit.id}`, { replace: true }); }}>
                  <Icon name="check" /> Zapisz i wyjdź
                </button>
                <button type="button" className="btn" onClick={() => setFinishing(true)}>
                  Zmień zalecenia lub kolejny zabieg
                </button>
              </div>
            </Group>
          )}
        </>
      )}

      <History list={list} current={visit} order={order} vatRate={settings.vatRate} />

      {finishing && (
        <FinishSheet
          open={finishing}
          onClose={() => setFinishing(false)}
          visit={visit}
          later={later}
          settings={settings}
          initialTerms={later && (later.scope || later.priceMin !== undefined) ? { scope: later.scope ?? { kind: 'calosc', note: '' }, ...visitPrice(later, order) } : proposeTerms(list.filter((v) => v.seq <= visit.seq), order)}
          invoice={order.invoice}
          order={order}
          onFinish={finish}
        />
      )}
      <Sheet open={editingTerms} title={`Co pryskamy i cena · ${visitCode(order, visit.seq)}`} onClose={() => setEditingTerms(false)}>
        {editingTerms && (
          <EditTerms
            initial={terms}
            invoice={order.invoice}
            onSave={(t) =>
              run(async () => {
                await visits.update(visit.id, { scope: t.scope, priceMin: t.priceMin, priceMax: t.priceMax });
                setEditingTerms(false);
                toast('Zapisano ustalenia');
              })
            }
          />
        )}
      </Sheet>
      <Sheet open={editingPlanned} title={`Edytuj zabieg · ${visitCode(order, visit.seq)}`} onClose={() => setEditingPlanned(false)}>
        {editingPlanned && (
          <EditPlanned
            visit={visit}
            terms={terms}
            invoice={order.invoice}
            orderId={order.id}
            onSave={(patch) =>
              run(async () => {
                // Pierwsze ustawienie terminu to umówienie zabiegu: zapisujemy, kto umówił.
                const me = !visit.start && patch.start ? await getProfile() : null;
                await visits.update(visit.id, me ? { ...patch, bookedById: me.userId, bookedByName: me.name, bookedAt: new Date().toISOString() } : patch);
                setEditingPlanned(false);
                toast(patch.start ? `Zapisano. Termin: ${formatTerm(patch.start)}` : 'Zapisano. Termin do umówienia');
              })
            }
          />
        )}
      </Sheet>
      <Sheet open={rescheduling} title="Termin zabiegu" onClose={() => setRescheduling(false)}>
        {rescheduling && <Reschedule visit={visit} onDone={() => setRescheduling(false)} />}
      </Sheet>
    </Page>
  );
}

/** Zmiana zakresu i ceny zabiegu, np. klient chce tylko jeden pokój. */
const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240];

/** Edycja umówionego zabiegu w jednym oknie: data, godzina (co 10 min), czas trwania, zakres i cena. */
function EditPlanned(props: {
  visit: Visit;
  terms: VisitTerms;
  invoice: Order['invoice'];
  orderId: string;
  onSave: (patch: Pick<Visit, 'start' | 'durationMin' | 'scope' | 'priceMin' | 'priceMax'>) => void;
}) {
  const [date, setDate] = useState(props.visit.start?.slice(0, 10) ?? '');
  const [time, setTime] = useState(props.visit.start?.slice(11, 16) ?? '10:00');
  const [duration, setDuration] = useState(props.visit.durationMin || 60);
  const [draft, setDraft] = useState(() => termsDraft(props.terms));
  const parsed = termsFromDraft(draft);
  const durations = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b);
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!parsed) return;
        props.onSave({ start: date ? `${date}T${time}` : null, durationMin: duration, scope: parsed.scope, priceMin: parsed.priceMin, priceMax: parsed.priceMax });
      }}
    >
      <div className="form-row">
        <Field label="Data" hint="Puste: termin do umówienia.">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Godzina">
          <TimeSelect value={time} onChange={setTime} />
        </Field>
      </div>
      <Field label="Czas trwania">
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {durations.map((d) => (
            <option key={d} value={d}>
              {d < 60 ? `${d} min` : `${Math.floor(d / 60)} godz.${d % 60 ? ` ${d % 60} min` : ''}`}
            </option>
          ))}
        </select>
      </Field>
      <TermsFields value={draft} onChange={setDraft} invoice={props.invoice} />
      <button type="submit" className="btn btn-primary btn-block" disabled={!parsed}>
        <Icon name="check" /> Zapisz zmiany
      </button>
      <Link className="btn btn-block" to={`/zlecenia/${props.orderId}/edycja`}>
        <Icon name="edit" /> Edytuj dane zlecenia (klient, adres, telefon)
      </Link>
    </form>
  );
}

function EditTerms(props: { initial: VisitTerms; invoice: Order['invoice']; onSave: (terms: VisitTerms) => void }) {
  const [draft, setDraft] = useState(() => termsDraft(props.initial));
  const parsed = termsFromDraft(draft);
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed) props.onSave(parsed);
      }}
    >
      <TermsFields value={draft} onChange={setDraft} invoice={props.invoice} />
      <button type="submit" className="btn btn-primary btn-block" disabled={!parsed}>
        Zapisz
      </button>
    </form>
  );
}

/** Najwyższa kwota jednego zabiegu (w groszach): 30 000 zł. Więcej to prawie na pewno pomyłka. */
const MAX_VISIT_AMOUNT = 3_000_000;

function AmountField(props: { value: number | null; hint?: string; missing?: boolean; onSave: (value: number | null) => void }) {
  const [text, setText] = useState(props.value !== null ? moneyToInput(props.value) : '');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Nierealna kwota (np. wklejony numer telefonu) nie zapisuje się: zepsułaby raporty firmy.
  const tooBig = (raw: string) => (parseMoney(raw) ?? 0) > MAX_VISIT_AMOUNT;
  const invalid = text.trim() !== '' && (parseMoney(text) === null || tooBig(text));
  const commit = (raw: string) => {
    clearTimeout(timer.current);
    if (raw.trim() !== '' && (parseMoney(raw) === null || tooBig(raw))) return;
    const value = raw.trim() ? parseMoney(raw) : null;
    if (value !== props.value) props.onSave(value);
  };
  return (
    <Field
      label="Kwota pobrana (zł)"
      error={invalid ? (tooBig(text) ? 'Kwota wygląda na pomyłkę (np. numer telefonu). Sprawdź.' : 'Podaj kwotę, np. 350') : props.missing && !text.trim() ? 'Wpisz kwotę pobraną od klienta' : undefined}
      hint={props.hint}
    >
      <input
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          // Zapis po chwili bez pisania, żeby „Zakończ zabieg” widział kwotę bez wychodzenia z pola.
          const raw = e.target.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(raw), 500);
        }}
        onBlur={() => commit(text)}
      />
    </Field>
  );
}

function Reschedule({ visit, onDone }: { visit: Visit; onDone: () => void }) {
  const { run, toast } = useFeedback();
  const [date, setDate] = useState(visit.start?.slice(0, 10) ?? '');
  const [time, setTime] = useState(visit.start?.slice(11, 16) ?? '10:00');
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await visits.update(visit.id, { start: date ? `${date}T${time}` : null });
          toast(date ? `Nowy termin: ${formatTerm(`${date}T${time}`)}` : 'Termin do umówienia');
          onDone();
        });
      }}
    >
      <div className="form-row">
        <Field label="Data" hint="Puste: termin do umówienia.">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Godzina">
          <TimeSelect value={time} onChange={setTime} />
        </Field>
      </div>
      <button type="submit" className="btn btn-primary btn-block">
        Zapisz termin
      </button>
      {visit.status === 'zaplanowany' && (
        <button
          type="button"
          className="btn btn-danger-quiet btn-block"
          onClick={() =>
            void run(async () => {
              const { archived } = await cancelVisit(visit.id);
              toast(archived ? 'Zabieg odwołany, zlecenie w archiwum' : 'Zabieg odwołany', {
                action: {
                  label: 'Cofnij',
                  onClick: () =>
                    void run(async () => {
                      await visits.update(visit.id, { status: 'zaplanowany' });
                      if (archived) await restoreOrder(visit.orderId);
                    }),
                },
              });
              onDone();
            })
          }
        >
          Odwołaj zabieg
        </button>
      )}
    </form>
  );
}
