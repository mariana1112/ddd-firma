import { roman, visitCode } from '../data/codes';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { cancelVisit, finishVisit, normalizeInterview, orderVisits, restoreOrder, scheduleNextVisit, startVisit, type NextVisit } from '../data/orders';
import { googleCalendarUrl } from '../data/calendar';
import { ScheduleNext } from './orders';
import { paymentMissing } from '../data/order-list';
import { orders, visits } from '../data/repo';
import { getAppSettings, getCompany, type AppSettings } from '../data/settings';
import { formatAccount } from '../data/card';
import { CopyRow } from './card';
import {
  accessDetails,
  finishSms,
  INVOICES,
  orderAddress,
  PAY_NAMES,
  PINK_PLACEHOLDER,
  pestName,
  priceRange,
  workSummary,
} from '../data/texts';
import type { Interview, InvoiceType, Order, PayMethod, Visit, YesNo } from '../data/types';
import { formatDate, formatTerm, todayWarsaw } from '../lib/dates';
import { TomorrowReminders } from './reminders';
import { moneyToInput, parseMoney } from '../lib/money';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Field, Group, Info, Loading, NotFound, Page, Sheet } from '../ui/kit';
import { ContactBar, PinkBadge, UlvNotice, useContactActions, VisitBadge, visitWhen } from './common';
import { doneMethods, hasFogging, METHOD_LABEL, methodOf, orderMethods, recommendationsFor } from '../data/methods';
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
  onFinish: (input: { recommendations: string[]; next: NextVisit }) => Promise<void>;
}) {
  const { visit, later, settings } = props;
  // Zalecenia do wykonanych metod są zaznaczone od razu; zalecenia ULV są obowiązkowe.
  const forMethods = recommendationsFor(doneMethods(visit.treatments, props.order), props.order.pest);
  const others = settings.recommendations.filter((r) => !forMethods.list.includes(r));
  const [recommendations, setRecommendations] = useState<string[]>(() =>
    visit.recommendations.length ? [...new Set([...forMethods.required, ...visit.recommendations])] : forMethods.list,
  );
  // Inne zalecenia są zwinięte; rozwinięte od razu, gdy któreś było już wybrane.
  const [showOthers, setShowOthers] = useState(() => visit.recommendations.some((r) => others.includes(r)));
  const recommendationRow = (r: string) => {
    const required = forMethods.required.includes(r);
    return (
      <label key={r} className={required ? 'check check-required' : 'check'}>
        <input
          type="checkbox"
          checked={required || recommendations.includes(r)}
          disabled={required}
          onChange={(e) => setRecommendations(e.target.checked ? [...recommendations, r] : recommendations.filter((x) => x !== r))}
        />
        {r}
      </label>
    );
  };
  const [mode, setMode] = useState<NextVisit['mode']>(later ? (later.start ? 'umowiony' : 'technik') : visit.seq === 1 ? 'technik' : 'brak');
  const [date, setDate] = useState(later?.start?.slice(0, 10) ?? '');
  const [time, setTime] = useState(later?.start?.slice(11, 16) ?? visit.start?.slice(11, 16) ?? '10:00');
  const [busy, setBusy] = useState(false);
  const nextSeq = visit.seq + 1;
  const ready = mode !== 'umowiony' || Boolean(date && time);

  return (
    <Sheet open={props.open} title={`Zakończenie zabiegu ${roman(visit.seq)}`} onClose={props.onClose}>
      <div className="form">
        {hasFogging(doneMethods(visit.treatments, props.order)) && <UlvNotice />}
        <div className="field">
          <span className="field-label">
            Zalecenia do wykonanych metod
            {doneMethods(visit.treatments, props.order).length ? `: ${doneMethods(visit.treatments, props.order).map((m) => METHOD_LABEL[m]).join(', ')}` : ''}
          </span>
          <div className="check-list">{forMethods.list.map(recommendationRow)}</div>
        </div>
        {others.length > 0 &&
          (showOthers ? (
            <div className="field">
              <span className="field-label">Inne zalecenia</span>
              <div className="check-list">{others.map(recommendationRow)}</div>
            </div>
          ) : (
            <button type="button" className="link" onClick={() => setShowOthers(true)}>
              Pokaż inne zalecenia ({others.length})
            </button>
          ))}
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
              <input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
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
            await props.onFinish({ recommendations, next });
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
  const { sms } = useContactActions();
  const navigate = useNavigate();
  const [finishing, setFinishing] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
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
  const [params] = useSearchParams();
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

  const sendFinishSms = async (done: Visit, next: Visit | null) => {
    if (phone) await sms(phone, finishSms(done, next, settings));
  };

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

  const finish = async (input: { recommendations: string[]; next: NextVisit }) => {
    await run(async () => {
      await finishVisit(visit.id, {
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
      toast(phone ? 'Zabieg zakończony. Wyślij klientowi SMS z zaleceniami.' : 'Zabieg zakończony');
    });
  };

  return (
    // Klucz: przejście do innego zabiegu tworzy pola od nowa, żeby nie zostały w nich wartości poprzedniego.
    <Page key={visit.id} title={visitCode(order, visit.seq)} back={`/zlecenia/${order.id}`}>
      <div className="job-hero">
        <div className="hero-badges">
          <VisitBadge visit={visit} />
          {order.pink && <PinkBadge />}
        </div>
        <h2>{order.clientName}</h2>
        <p>
          {orderAddress(order)}
          {accessDetails(order) ? ` · ${accessDetails(order)}` : ''}
        </p>
        <p>
          {pestName(order)} · {visitWhen(visit)}
        </p>
      </div>

      <ContactBar
        order={order}
        visit={visit}
      />

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
      {orderMethods(order).length > 0 && (
        <p className="methods-line">
          <span className="terms-label">Co robimy</span> {orderMethods(order).map((m) => METHOD_LABEL[m]).join(', ')}
        </p>
      )}
      {hasFogging([...orderMethods(order), ...visit.treatments.map(methodOf).filter((m): m is NonNullable<typeof m> => m !== null)]) && <UlvNotice />}

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
            <button type="button" className="btn" onClick={() => setRescheduling(true)}>
              <Icon name="calendar" /> {visit.start ? 'Zmień termin' : 'Umów termin'}
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
          <Group title="Zlecenie">
            {order.description && <Info label="Opis">{order.description}</Info>}
            {order.areaM2 && <Info label="Metraż">{order.areaM2} m²</Info>}
            {price && <Info label="Cena">{price.gross ? `${price.net}\n${price.gross}` : price.net}</Info>}
            <Info label="Faktura">{INVOICES[order.invoice]}</Info>
          </Group>
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
          {visit.doneOn === todayWarsaw() && <TomorrowReminders afterLastToday />}
          <VisitSummary order={order} visit={visit} vatRate={settings.vatRate} later={later} photos={<Photos visitId={visit.id} readOnly />} />
          <div className="btn-stack">
            <button type="button" className="btn btn-primary" disabled={!phone} onClick={() => void sendFinishSms(visit, later ?? null)}>
              <Icon name="message" /> Wyślij klientowi SMS z zaleceniami
            </button>
            <button type="button" className="btn" onClick={() => setEditingId(visit.id)}>
              <Icon name="edit" /> Edytuj zabieg
            </button>
            {!later?.start && (
              <button type="button" className="btn" onClick={() => setPlanningNext(true)}>
                <Icon name="calendar" /> Umów kolejny zabieg
              </button>
            )}
            <button type="button" className="btn" onClick={() => navigate(`/zlecenia/${order.id}`)}>
              Wróć do zlecenia
            </button>
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

          <Group title="Wywiad" plain>
            <AutoText
              label="Opis sytuacji"
              placeholder="Co się dzieje, gdzie, od kiedy"
              rows={4}
              value={interview.situation}
              onSave={(v) => saveInterview('situation', v)}
            />
            <YesNoField label="Czy są ugryzienia?" value={interview.bites} onChange={(v) => saveInterview('bites', v)} />
            <YesNoField label="Czy widziano owady?" value={interview.seen} onChange={(v) => saveInterview('seen', v)} />
            {interview.seen === 'tak' && (
              <AutoText label="Ile owadów?" placeholder="Np. kilka, ok. 20" rows={1} value={interview.seenCount} onSave={(v) => saveInterview('seenCount', v)} />
            )}
            <YesNoField label="Czy klient używał środków na własną rękę?" value={interview.selfTreatment} onChange={(v) => saveInterview('selfTreatment', v)} />
            <AutoText label="Inne uwagi" placeholder="Czy coś zauważyłem podczas zabiegu" rows={3} value={interview.other} onSave={(v) => saveInterview('other', v)} />
          </Group>

          <Group title="Wykonane" plain>
            <ToggleChips
              options={[...Object.values(METHOD_LABEL), ...settings.treatments.filter((t) => !methodOf(t))]}
              selected={visit.treatments}
              addLabel="Inny zabieg"
              onChange={(treatments) => save({ treatments })}
            />
            <span className="field-label">Miejsca wykonywania oprysku/żelowania</span>
            <ToggleChips options={settings.places} selected={visit.places} addLabel="Inne miejsce" onChange={(places) => save({ places })} />
            {workSummary(visit) && <p className="field-hint">Do wiadomości: {workSummary(visit)}</p>}
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

          {visit.status === 'w_trakcie' ? (
            <>
              <button type="button" className="btn btn-primary btn-block btn-big" onClick={() => void requestFinish()}>
                <Icon name="check" /> Zakończ zabieg
              </button>
              <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => void cancel()}>
                <Icon name="close" /> Odwołaj zabieg
              </button>
            </>
          ) : (
            <Group title="Po zabiegu" plain>
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
                <button type="button" className="btn" disabled={!phone} onClick={() => void sendFinishSms(visit, later ?? null)}>
                  <Icon name="message" /> SMS do klienta z zaleceniami
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
      <Sheet open={rescheduling} title="Termin zabiegu" onClose={() => setRescheduling(false)}>
        {rescheduling && <Reschedule visit={visit} onDone={() => setRescheduling(false)} />}
      </Sheet>
    </Page>
  );
}

/** Zmiana zakresu i ceny zabiegu, np. klient chce tylko jeden pokój. */
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

function AmountField(props: { value: number | null; hint?: string; missing?: boolean; onSave: (value: number | null) => void }) {
  const [text, setText] = useState(props.value !== null ? moneyToInput(props.value) : '');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const invalid = text.trim() !== '' && parseMoney(text) === null;
  const commit = (raw: string) => {
    clearTimeout(timer.current);
    if (raw.trim() !== '' && parseMoney(raw) === null) return;
    const value = raw.trim() ? parseMoney(raw) : null;
    if (value !== props.value) props.onSave(value);
  };
  return (
    <Field
      label="Kwota pobrana (zł)"
      error={invalid ? 'Podaj kwotę, np. 350' : props.missing && !text.trim() ? 'Wpisz kwotę pobraną od klienta' : undefined}
      hint={props.hint}
    >
      <input
        inputMode="decimal"
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
          <input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
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
