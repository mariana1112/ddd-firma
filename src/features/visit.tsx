import { orderCode, roman, visitCode, visitLabel } from '../data/codes';
import { nextVisitDays, previousVisitDay } from '../data/geo';
import { NextDates } from './next-dates';
import { requiredAnswersMissing, sealedBefore } from '../data/interview';
import { withCountryCode } from '../lib/validators';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { COMPLAINT_NAMES, cancelVisit, createComplaint, defaultDoneOn, renumberVisit, finishVisit, nextVisitSeq, normalizeInterview, orderVisits, restoreVisit, revertStartedVisit, scheduleNextVisit, startVisit, type NextVisit } from '../data/orders';
import { googleCalendarUrl } from '../data/calendar';
import { ScheduleNext } from './orders';
import { addressMissing, dayPositions, paymentMissing } from '../data/order-list';
import { orders, visits } from '../data/repo';
import { getAppSettings, getCompany, type AppSettings } from '../data/settings';
import { formatAccount } from '../data/card';
import { formatPln } from '../data/reports';
import { VAT_RATE } from '../data/settings';
import type { CompanySettings } from '../data/types';
import { CopyRow } from './card';
import {
  INVOICES,
  PAY_NAMES,
  PINK_PLACEHOLDER,
  pestName,
  priceRange,
  workSummary,
  bookedBy, firstName, centralExport, descriptionCopy, invoiceCopy, orderAddress, telUrl } from '../data/texts';
import type { ComplaintKind, Interview, InvoiceType, Order, PayMethod, Visit, YesNo } from '../data/types';
import { formatDate, formatTerm, todayWarsaw } from '../lib/dates';
import { TomorrowReminders } from './reminders';
import { moneyToInput, parseMoney } from '../lib/money';
import { useFeedback } from '../ui/feedback';
import { useOnce } from '../ui/once';
import { Icon } from '../ui/icons';
import { Badge, Field, Group, Info, Loading, NotFound, Page, Sheet, TimeSelect, goBack, PasteButton } from '../ui/kit';
import { ContactBar, useCallPicker, PinkBadge, SmsSheet, VisitBadge, visitWhen, AddressBlock, ClientHeading, copyText } from './common';
import { doneMethods, EXTRA_TREATMENTS, METHOD_LABEL, methodOf, recommendationsFor, SEALING_OPTIONS, methodNames } from '../data/methods';
import { Photos } from './photos';
import { AssignSheet } from './assign';
import { documentWord, INVOICE_FIELD_LABEL, invoiceMissing, type InvoiceField } from '../data/invoice';
import { isValidNip } from '../lib/validators';
import { VisitSummary } from './visit-summary';
import { WeekPeek } from './week-preview';
import { TermsFields, termsDraft, termsFromDraft, termsText } from './terms';
import { proposeTerms, visitPrice, type VisitTerms } from '../data/visit-terms';

/** Kolejka zapisów wywiadu, wspólna dla ekranu zabiegu. */
let interviewQueue: Promise<unknown> = Promise.resolve();

/** Pytanie tak/nie. Ponowne dotknięcie zaznaczonej odpowiedzi ją czyści. */
function YesNoField(props: { label: string; value: YesNo; onChange: (value: YesNo) => void; missing?: boolean }) {
  return (
    <div className={props.missing ? 'field field-missing' : 'field'}>
      <span className="field-label">{props.label}</span>
      <div className={props.missing ? 'segmented yes-no missing' : 'segmented yes-no'} role="group" aria-label={props.label}>
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
      {props.missing && <span className="field-message">Odpowiedz: przy zabiegu II i kolejnych to jest wymagane</span>}
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
    <Field
      label={props.label}
      error={props.error ?? (props.missing ? `Uzupełnij: ${props.label}` : undefined)}
      action={<PasteButton onPaste={(t) => { setValue(t); if (t !== props.value) props.onSave(t); }} />}
    >
      <input
        value={value}
        autoComplete="off"
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
  // Paragon idzie do klienta mailem: wystarczy e-mail.
  if (order.invoice === 'paragon') {
    return (
      <div className="invoice-data">
        <OrderField label="E-mail (paragon idzie mailem)" value={order.email} inputMode="email" missing={flag('email')} onSave={(email) => onSave({ email })} />
      </div>
    );
  }
  return (
    <div className="invoice-data">
      {order.invoice === 'vat' ? (
        <>
          <OrderField label="Nazwa firmy (opcjonalnie)" value={order.invoiceName ?? ''} missing={flag('invoiceName')} placeholder="Np. Apt Production sp. z o.o." onSave={(invoiceName) => onSave({ invoiceName })} />
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

/** Opis po zakończeniu: sytuacja z wywiadu (ten zabieg) i opis zlecenia od przyjmującego. */
function DescriptionForm({ order, visit, onDone }: { order: Order; visit: Visit; onDone: () => void }) {
  const { run, toast } = useFeedback();
  const [situation, setSituation] = useState(() => normalizeInterview(visit.interview).situation);
  const [description, setDescription] = useState(order.description);
  const save = () =>
    run(async () => {
      const current = await visits.get(visit.id);
      if (current) await visits.update(visit.id, { interview: { ...normalizeInterview(current.interview), situation: situation.trim() } });
      if (description.trim() !== order.description.trim()) await orders.update(order.id, { description: description.trim() });
      toast('Zapisano opis');
      onDone();
    });
  return (
    <div className="form">
      <Field label="Opis sytuacji (z tego zabiegu)">
        <textarea rows={5} value={situation} placeholder="Co się dzieje, gdzie, od kiedy" onChange={(e) => setSituation(e.target.value)} />
      </Field>
      <Field label="Opis zlecenia (od przyjmującego)">
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <button type="button" className="btn btn-primary btn-block" onClick={() => void save()}>
        <Icon name="check" /> Zapisz opis
      </button>
    </div>
  );
}

/**
 * Płatność w każdej chwili zabiegu: klient często płaci od razu. Karta na górze rozpoczętego zabiegu pokazuje, czy
 * płatność jest przyjęta, i otwiera arkusz z kwotą, formą, protokołem i fakturą.
 */
/** „gotówka”, „BLIK”, „przelew” w zdaniu. */
const payWord = (m: PayMethod) => (m === 'blik' ? 'BLIK' : PAY_NAMES[m].toLowerCase());

function PayCard({ visit, order, onOpen }: { visit: Visit; order: Order; onOpen: () => void }) {
  const paid = Boolean(visit.payMethod && visit.amount);
  const docs = [order.invoice !== 'brak' && INVOICES[order.invoice], order.protocol && 'Protokół'].filter(Boolean).join(', ');
  return (
    <button type="button" className={paid ? 'pay-card pay-card-paid' : 'pay-card'} onClick={onOpen}>
      <Icon name={paid ? 'check' : 'wallet'} size={22} />
      <span className="pay-card-text">
        <strong>{paid ? `Zapłacono ${formatPln(visit.amount!)}, ${payWord(visit.payMethod!)}` : 'Klient płaci od razu?'}</strong>
        <span>{paid ? docs || 'Bez faktury i protokołu' : 'Kwota, forma płatności, protokół, faktura'}</span>
      </span>
      <span className={paid ? 'btn btn-sm' : 'btn btn-sm btn-primary'}>{paid ? 'Zmień' : 'Przyjmij'}</span>
    </button>
  );
}

/**
 * Kwoty do szybkiego wyboru: dolna i górna granica ustalonej ceny (widełki z rozmowy). Przy fakturze VAT klient płaci
 * brutto, więc kwoty są z VAT (+23%). W groszach, bez powtórzeń.
 */
function agreedAmounts(visit: Visit, order: Order): number[] {
  const agreed = visitPrice(visit, order);
  const vat = order.invoice === 'vat';
  return [...new Set([agreed.priceMin, agreed.priceMax].filter((x): x is number => typeof x === 'number' && x > 0).map((x) => (vat ? Math.round((x * (100 + VAT_RATE)) / 100) : x)))];
}

function PaySheet(props: {
  visit: Visit;
  order: Order;
  company: CompanySettings;
  alert: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** Kolejny zabieg (jeśli już umówiony, zamiast przycisku jest jego termin). */
  later?: Visit | null;
  /** „Umów od razu kolejny zabieg” (tylko w trakcie zabiegu). */
  onPlanNext?: () => void;
}) {
  const { visit, order, company } = props;
  const { run, toast } = useFeedback();
  // Klient płaci brutto: przy fakturze VAT podpowiedzi to ustalona cena z VAT.
  const vat = order.invoice === 'vat';
  const options = agreedAmounts(visit, order);
  const toText = (grosze: number) => moneyToInput(grosze).replace(/,00$/, '');
  // Przy widełkach od razu górna granica (najczęściej tyle klient płaci); kwotę można zmienić albo wybrać dolną.
  const [text, setText] = useState(() => (visit.amount ? toText(visit.amount) : options.length ? toText(Math.max(...options)) : ''));
  const [method, setMethod] = useState<PayMethod | null>(visit.payMethod);
  const [tried, setTried] = useState(false);
  const value = parseMoney(text);
  const amountError = text.trim() && (value === null || value > MAX_VISIT_AMOUNT) ? 'Podaj kwotę, np. 350' : tried && !value ? 'Wpisz kwotę' : undefined;
  const save = () =>
    run(async () => {
      setTried(true);
      if (!method || !value || value > MAX_VISIT_AMOUNT) return;
      await visits.update(visit.id, { payMethod: method, amount: value });
      toast(`Płatność zapisana: ${formatPln(value)}, ${payWord(method)}`);
      props.onClose();
      props.onSaved?.();
    });
  return (
    <div className="form">
      <Field label={vat ? 'Kwota (zł brutto, z VAT)' : 'Kwota (zł)'} error={amountError}>
        <input className="pay-amount" inputMode="decimal" autoComplete="off" value={text} placeholder="0" onChange={(e) => setText(e.target.value)} />
      </Field>
      {options.length > 1 && (
        <div className="chips" role="group" aria-label="Ustalona cena">
          {options.map((o) => (
            <button key={o} type="button" className={value === o ? 'chip active' : 'chip'} onClick={() => setText(toText(o))}>
              {formatPln(o)}
            </button>
          ))}
        </div>
      )}
      <span className="field-label">Forma płatności</span>
      <div className="pay-choice">
        {(['gotowka', 'blik', 'przelew'] as PayMethod[]).map((m) => (
          <button
            key={m}
            type="button"
            className={`pay-option pay-opt-${m}${method === m ? ' active' : ''}${tried && !method ? ' missing' : ''}`}
            aria-pressed={method === m}
            onClick={() => setMethod(m)}
          >
            {PAY_NAMES[m]}
          </button>
        ))}
      </div>
      {tried && !method && <span className="field-message">Wybierz formę płatności</span>}
      {method === 'przelew' && company.bankAccount.trim() && (
        <div className="pay-details">
          <CopyRow label="Numer konta do przelewu" value={formatAccount(company.bankAccount)} copyValue={company.bankAccount.replace(/\s/g, '')} />
        </div>
      )}
      {method === 'blik' && company.blikPhone?.trim() && (
        <div className="pay-details">
          <CopyRow label="BLIK na telefon" value={company.blikPhone.trim()} copyValue={company.blikPhone.replace(/\s/g, '')} />
        </div>
      )}
      <span className="field-label">Dokumenty</span>
      <label className="check">
        <input type="checkbox" checked={Boolean(order.protocol)} onChange={(e) => void run(() => orders.update(order.id, { protocol: e.target.checked }))} />
        Protokół z zabiegu
      </label>
      {order.protocol && order.invoice === 'brak' && <ProtocolEmail order={order} />}
      <div className="choice">
        {(Object.entries(INVOICES) as Array<[InvoiceType, string]>).map(([v, label]) => (
          <button key={v} type="button" className={order.invoice === v ? 'choice-item active' : 'choice-item'} onClick={() => void run(() => orders.update(order.id, { invoice: v }))}>
            {label}
          </button>
        ))}
      </div>
      <InvoiceData order={order} alert={props.alert} onSave={(patch) => void run(() => orders.update(order.id, patch))} />
      {props.onPlanNext &&
        (props.later?.start ? (
          <p className="notice notice-info">
            <Icon name="calendar" />
            <span>
              Kolejny zabieg {roman(props.later.seq)} umówiony: <strong>{formatTerm(props.later.start)}</strong>
            </span>
          </p>
        ) : (
          <button type="button" className="btn btn-block" onClick={props.onPlanNext}>
            <Icon name="calendar" /> Umów od razu kolejny zabieg
          </button>
        ))}
      <button type="button" className="btn btn-primary btn-block btn-big" onClick={() => void save()}>
        <Icon name="check" /> Zapisz płatność
      </button>
    </div>
  );
}

/** E-mail do protokołu: widoczny zawsze po zaznaczeniu protokołu, żeby wpisać albo sprawdzić adres. */
function ProtocolEmail({ order }: { order: Order }) {
  const { run } = useFeedback();
  const value = order.email.trim();
  const invalid = value && !/^\S+@\S+\.\S+$/.test(value) ? 'Adres e-mail jest niepoprawny. Sprawdź go z klientem.' : undefined;
  return (
    <div className="protocol-email">
      <OrderField
        label="E-mail do protokołu"
        value={order.email}
        inputMode="email"
        placeholder="np. jan.kowalski@gmail.com"
        missing={!value}
        error={invalid}
        onSave={(email) => void run(() => orders.update(order.id, { email }))}
      />
      {value && !invalid && <p className="field-hint">Sprawdź z klientem: {value}</p>}
    </div>
  );
}

/**
 * Wybór kilku pozycji. Zaznaczenie zmienia się od razu na ekranie, a zapis idzie w tle: szybkie stukanie jedno po
 * drugim nie gubi zaznaczeń (wcześniej każde stuknięcie liczyło się od stanu sprzed zapisu poprzedniego).
 */
/** Przez tyle ms od ostatniego stuknięcia w opcję stan z bazy nie nadpisuje zaznaczeń na ekranie. */
const CHIPS_GRACE_MS = 1500;

function ToggleChips(props: { options: string[]; selected: string[]; onChange: (selected: string[]) => unknown; addLabel: string }) {
  const [custom, setCustom] = useState('');
  const [selected, setSelected] = useState(props.selected);
  const pending = useRef(0);
  const latest = useRef(props.selected);
  const lastTap = useRef(0);
  const fromDbRef = useRef(props.selected);
  const syncTimer = useRef<number | undefined>(undefined);
  // Stan z bazy przyjmujemy dopiero, gdy nic nie czeka na zapis i od ostatniego stuknięcia minęła chwila. Przy szybkim
  // stukaniu baza potrafi oddać odczyt sprzed ostatniego zapisu już po jego zakończeniu, a taki odczyt cofnąłby
  // świeże zaznaczenie (i następne stuknięcie zapisałoby listę bez niego).
  const fromDb = props.selected.join('\u0000');
  const adopt = () => {
    if (pending.current > 0 || Date.now() - lastTap.current < CHIPS_GRACE_MS) return false;
    latest.current = fromDbRef.current;
    setSelected(fromDbRef.current);
    return true;
  };
  useEffect(() => {
    fromDbRef.current = props.selected;
    adopt();
  }, [fromDb]);
  useEffect(() => () => clearTimeout(syncTimer.current), []);
  /** Po przerwie w stukaniu: ostatni stan z bazy (np. zmiana z innego telefonu), gdy wszystko już zapisane. */
  const syncLater = () => {
    clearTimeout(syncTimer.current);
    const retry = () => {
      if (!adopt()) syncTimer.current = window.setTimeout(retry, 300);
    };
    syncTimer.current = window.setTimeout(retry, CHIPS_GRACE_MS + 50);
  };
  const change = (next: string[]) => {
    latest.current = next;
    lastTap.current = Date.now();
    setSelected(next);
    pending.current += 1;
    void Promise.resolve(props.onChange(next)).finally(() => {
      pending.current -= 1;
    });
    syncLater();
  };
  const all = [...props.options, ...selected.filter((s) => !props.options.includes(s))];
  const toggle = (item: string) => {
    const now = latest.current;
    change(now.includes(item) ? now.filter((s) => s !== item) : [...now, item]);
  };
  return (
    <>
      <div className="chips chips-wrap">
        {all.map((item) => (
          <button key={item} type="button" className={selected.includes(item) ? 'chip active' : 'chip'} aria-pressed={selected.includes(item)} onClick={() => toggle(item)}>
            {item}
          </button>
        ))}
      </div>
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom.trim() && !latest.current.includes(custom.trim())) change([...latest.current, custom.trim()]);
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

/**
 * Szybkie przejście do innych zabiegów zlecenia: kafelki I, II, III (i reklamacje) u góry karty, także w trakcie
 * zabiegu, ze strzałkami do poprzedniego i następnego. Ikonki pokazują stan zabiegu (wykonany, umówiony, w trakcie)
 * i nie zmieniają się przy przechodzeniu; zabieg, na którym jesteś, jest tylko podświetlony. Dotknięcie przenosi
 * prosto do zabiegu. Przy zabiegu II i kolejnych skrót „Na zabiegu I”.
 */
function VisitStrip({ list, current }: { list: Visit[]; current: Visit }) {
  const navigate = useNavigate();
  const rank = (v: Visit) => v.seq * 10 + (v.complaintOf ? 5 : 0);
  const all = list.filter((v) => v.status !== 'odwolany' && !v.deletedAt).sort((a, b) => rank(a) - rank(b) || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  // Kafelki: wykonane, rozpoczęte i umówione oraz ten, na którym jesteś. Nieumówiony zabieg nie ma kafelka.
  const shown = all.filter((v) => v.id === current.id || v.status === 'wykonany' || v.status === 'w_trakcie' || Boolean(v.start));
  const before = all.filter((v) => v.seq < current.seq && v.status === 'wykonany' && v.complaintKind !== 'zwrot').pop();
  const hint = before
    ? [workSummary(before), before.sealing?.length ? `uszczelnić: ${before.sealing.join(', ')}` : ''].filter(Boolean).join(' · ')
    : '';
  if (shown.length < 2 && !before) return null;
  const at = shown.findIndex((v) => v.id === current.id);
  const prev = at > 0 ? shown[at - 1] : null;
  const next = at >= 0 && at < shown.length - 1 ? shown[at + 1] : null;
  const when = (v: Visit) => (v.status === 'wykonany' ? formatDate(v.doneOn ?? v.start).slice(0, 5) : v.status === 'w_trakcie' ? 'w trakcie' : v.start ? formatDate(v.start).slice(0, 5) : 'teraz');
  const label = (v: Visit) => (v.complaintKind === 'zwrot' ? `${roman(v.seq)} · zwrot` : v.complaintOf ? `${roman(v.seq)} reklamacja · ${when(v)}` : `${roman(v.seq)} · ${when(v)}`);
  const icon = (v: Visit) => (v.status === 'wykonany' ? 'check' : v.status === 'w_trakcie' ? 'play' : 'calendar');
  const go = (v: Visit | null) => v && navigate(`/zabieg/${v.id}`);
  return (
    <>
      {shown.length > 1 && (
        <div className="visit-strip-row">
          <button type="button" className="visit-step" disabled={!prev} aria-label={prev ? `Poprzedni: ${label(prev)}` : 'Brak poprzedniego'} onClick={() => go(prev)}>
            <Icon name="left" size={18} />
          </button>
          <div className="visit-strip" role="navigation" aria-label="Zabiegi zlecenia">
            {shown.map((v) => (
              <button
                key={v.id}
                type="button"
                className={[
                  'visit-chip',
                  v.status === 'wykonany' ? 'visit-chip-done' : '',
                  v.complaintOf ? 'visit-chip-complaint' : '',
                  v.id === current.id ? 'visit-chip-current' : '',
                ].filter(Boolean).join(' ')}
                aria-current={v.id === current.id ? 'page' : undefined}
                onClick={() => v.id !== current.id && go(v)}
              >
                <Icon name={icon(v)} size={14} />
                {label(v)}
              </button>
            ))}
          </div>
          <button type="button" className="visit-step" disabled={!next} aria-label={next ? `Następny: ${label(next)}` : 'Brak następnego'} onClick={() => go(next)}>
            <Icon name="chevron" size={18} />
          </button>
        </div>
      )}
      {before && hint && (
        <button type="button" className="visit-prev-hint" onClick={() => go(before)}>
          <span className="visit-prev-title">
            Na zabiegu {roman(before.seq)} ({formatDate(before.doneOn ?? before.start).slice(0, 5)}
            {before.technicianName ? `, ${firstName(before.technicianName)}` : ''})
          </span>
          <span className="visit-prev-text">{hint}</span>
        </button>
      )}
    </>
  );
}

/**
 * Reklamacja do zabiegu: zabieg gratis, zwrot pieniędzy, zabieg z rabatem albo inne rozwiązanie (opis). Zabieg
 * reklamacyjny ma ten sam numer co reklamowany zabieg, dopisek „reklamacja” i fioletowy kolor w kalendarzu.
 */
function ComplaintSheet(props: { open: boolean; order: Order; visit: Visit; onClose: () => void }) {
  const { order, visit } = props;
  const navigate = useNavigate();
  const { run, toast } = useFeedback();
  const { once, pending } = useOnce();
  const [kind, setKind] = useState<ComplaintKind>('gratis');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [price, setPrice] = useState('');
  const [refund, setRefund] = useState(visit.amount && visit.amount > 0 ? moneyToInput(visit.amount) : '');
  const [method, setMethod] = useState<PayMethod>(visit.payMethod ?? 'gotowka');
  const [refundDate, setRefundDate] = useState(todayWarsaw());
  const withTerm = kind !== 'zwrot';
  const needsTerm = kind === 'gratis' || kind === 'rabat';
  const refundValue = parseMoney(refund);
  const priceValue = parseMoney(price);
  const problem =
    kind === 'zwrot'
      ? !refundValue || refundValue <= 0
        ? 'Podaj kwotę zwrotu'
        : ''
      : kind === 'rabat' && (priceValue === null || priceValue < 0)
        ? 'Podaj cenę po rabacie'
        : kind === 'inne' && !note.trim()
          ? 'Opisz rozwiązanie reklamacji'
          : needsTerm && !date
            ? 'Wybierz termin zabiegu'
            : '';
  const save = () =>
    run(async () => {
      const created = await createComplaint(visit.id, {
        kind,
        note,
        start: withTerm && date ? `${date}T${time}` : null,
        durationMin: visit.durationMin || 60,
        price: kind === 'rabat' ? priceValue : null,
        refund: kind === 'zwrot' ? { amount: refundValue!, method, date: refundDate } : undefined,
      });
      props.onClose();
      toast(kind === 'zwrot' ? `Zapisano zwrot ${refund} zł (odejmie się od utargu)` : `Reklamacja: ${COMPLAINT_NAMES[kind].toLowerCase()}${date ? `, ${formatTerm(`${date}T${time}`)}` : ''}`);
      if (kind !== 'zwrot') navigate(`/zabieg/${created.id}`);
    });
  return (
    <Sheet open={props.open} title={`Reklamacja · ${visitCode(order, visit.seq)}`} onClose={props.onClose}>
      <div className="form">
        <div className="field">
          <span className="field-label">Jak rozwiązujemy reklamację?</span>
          <div className="complaint-kinds">
            {(Object.entries(COMPLAINT_NAMES) as Array<[ComplaintKind, string]>).map(([k, name]) => (
              <button key={k} type="button" className={kind === k ? 'choice-item active' : 'choice-item'} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {name}
              </button>
            ))}
          </div>
        </div>
        <Field label={kind === 'inne' ? 'Na czym polega rozwiązanie?' : 'Opis reklamacji (opcjonalnie)'}>
          <textarea rows={3} value={note} placeholder="Np. klient zgłosił karaluchy w łazience po 10 dniach" onChange={(e) => setNote(e.target.value)} />
        </Field>
        {kind === 'rabat' && (
          <Field label={order.invoice === 'vat' ? 'Cena po rabacie (netto, zł)' : 'Cena po rabacie (zł)'}>
            <input inputMode="decimal" value={price} placeholder="Np. 150" onChange={(e) => setPrice(e.target.value)} />
          </Field>
        )}
        {kind === 'zwrot' && (
          <>
            <Field label="Kwota zwrotu (zł)" hint="Odejmie się od utargu w dniu zwrotu (gotówka także od gotówki do oddania).">
              <input inputMode="decimal" value={refund} placeholder="Np. 350" onChange={(e) => setRefund(e.target.value)} />
            </Field>
            <div className="field">
              <span className="field-label">Jak zwracamy?</span>
              <div className="choice">
                {(['gotowka', 'blik', 'przelew'] as PayMethod[]).map((m) => (
                  <button key={m} type="button" className={method === m ? 'choice-item active' : 'choice-item'} onClick={() => setMethod(m)}>
                    {PAY_NAMES[m]}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Dzień zwrotu">
              <input type="date" value={refundDate} max={todayWarsaw()} onChange={(e) => setRefundDate(e.target.value || todayWarsaw())} />
            </Field>
          </>
        )}
        {withTerm && (
          <>
            <div className="form-row">
              <Field label={needsTerm ? 'Data zabiegu' : 'Data (opcjonalnie)'}>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Godzina">
                <TimeSelect value={time} onChange={setTime} />
              </Field>
            </div>
            <WeekPeek
              date={date || todayWarsaw()}
              time={date ? time : ''}
              durationMin={visit.durationMin || 60}
              stay
              backLabel="Wróć do reklamacji"
              onPick={(d, t) => {
                setDate(d);
                setTime(t);
              }}
            />
          </>
        )}
        {problem && <p className="field-hint">{problem}</p>}
        <button type="button" className="btn btn-primary btn-block" disabled={Boolean(problem) || pending} onClick={() => void once(save)}>
          <Icon name="check" /> {kind === 'zwrot' ? 'Zapisz zwrot' : 'Zapisz reklamację'}
        </button>
      </div>
    </Sheet>
  );
}

/** Zmiana numeru zabiegu (I, II, III…): gdy numer ma inny zabieg zlecenia, zamieniają się numerami. */
function RenumberSheet(props: { open: boolean; order: Order; visit: Visit; list: Visit[]; onClose: () => void }) {
  const { order, visit, list } = props;
  const { run, toast } = useFeedback();
  const used = new Map(list.filter((v) => v.status !== 'odwolany' && !v.complaintOf && v.id !== visit.id).map((v) => [v.seq, v]));
  const max = Math.max(3, visit.seq, ...used.keys()) + 1;
  return (
    <Sheet open={props.open} title={`Numer zabiegu · ${visitCode(order, visit.seq)}`} onClose={props.onClose}>
      <div className="form">
        <p className="sheet-text">Który to zabieg u klienta? Gdy wybrany numer ma już inny zabieg, zamienią się numerami.</p>
        <div className="renumber-choice">
          {Array.from({ length: Math.min(max, 10) }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={n === visit.seq ? 'choice-item active' : 'choice-item'}
              aria-pressed={n === visit.seq}
              onClick={() =>
                void run(async () => {
                  if (n === visit.seq) return props.onClose();
                  await renumberVisit(visit.id, n);
                  toast(used.has(n) ? `Zamieniono: teraz to zabieg ${roman(n)}, a tamten ${roman(visit.seq)}` : `Teraz to zabieg ${roman(n)}`);
                  props.onClose();
                })
              }
            >
              {roman(n)}
              {used.has(n) ? ' ↔' : ''}
            </button>
          ))}
        </div>
      </div>
    </Sheet>
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
 * przyjmujący, np. szef), co robimy, szkodnik, zakres i cena, faktura, protokół i telefony. Same informacje: opcje
 * zlecenia (PDF, edycja danych, wszystkie zabiegi) są pod „Więcej opcji”.
 */
function OrderInfo(props: { order: Order; vatRate: number; terms?: string; assigned?: string | null }) {
  const { order } = props;
  const price = priceRange({ priceMin: order.priceMin, priceMax: order.priceMax, invoice: order.invoice }, props.vatRate);
  const methods = methodNames(order);
  const invoiceData = order.invoice === 'vat' ? [order.invoiceName, order.nip && `NIP ${order.nip}`, order.invoiceAddress].filter(Boolean).join(', ') : order.invoice === 'imienna' ? order.invoiceAddress : '';
  return (
    <Group title={`Zlecenie ${orderCode(order)}`}>
      {order.description.trim() && (
        <div className="order-note">
          <span className="order-note-label">Opis{order.ownerName ? ` od ${firstName(order.ownerName)}` : ''}</span>
          <p>{order.description.trim()}</p>
        </div>
      )}
      {methods.length > 0 && <Info label="Co robimy">{methods.join(', ')}</Info>}
      <Info label="Szkodnik">{pestName(order)}</Info>
      {order.areaM2 && <Info label="Metraż">{order.areaM2} m²</Info>}
      {props.terms ? <Info label="Zakres i cena">{props.terms}</Info> : price && <Info label="Cena">{price.gross ? `${price.net}\n${price.gross}` : price.net}</Info>}
      <Info label="Dokument">{INVOICES[order.invoice]}</Info>
      {invoiceData && <Info label="Dane do faktury">{invoiceData}</Info>}
      {order.protocol && <Info label="Protokół">Tak</Info>}
      {order.phones
        .filter((p) => p.number.trim())
        .map((p, i) => (
          <Info key={i} label={i === 0 ? 'Telefon' : 'Drugi telefon'}>
            <a className="info-phone" href={telUrl(p.number)}>
              {withCountryCode(p.number)}
            </a>
            {p.label ? <span className="info-phone-label">{p.label}</span> : null}
          </Info>
        ))}
      {order.email && <Info label="E-mail">{order.email}</Info>}
      {props.assigned && <Info label="Technik">{props.assigned}</Info>}
      {order.ownerName && <Info label="Przyjął">{`${order.ownerName}, ${formatDate(order.createdAt)}`}</Info>}
    </Group>
  );
}

/** Rzadziej potrzebne opcje zlecenia: edycja danych klienta i adresu, PDF, wszystkie zabiegi zlecenia. */
function OrderOptions(props: { order: Order; visits: Visit[]; vatRate: number; noEdit?: boolean; /** Np. zamknięcie „Więcej opcji”, gdy otwiera się PDF. */ onPdf?: () => void }) {
  const { order } = props;
  const { deliverFile, run } = useFeedback();
  return (
    <>
      {!props.noEdit && (
        <Link className="btn" to={`/zlecenia/${order.id}/edycja`}>
          <Icon name="edit" /> Edytuj dane zlecenia (klient, adres, opis)
        </Link>
      )}
      <button
        type="button"
        className="btn"
        onClick={() =>
          void run(async () => {
            props.onPdf?.();
            const [{ orderDocument }, { renderPdf }] = await Promise.all([import('../pdf/documents'), import('../pdf/render')]);
            deliverFile(await renderPdf(orderDocument(order, props.visits, { vatRate: props.vatRate })), `zlecenie-${orderCode(order).replace(/[^\w-]+/g, '-')}.pdf`);
          })
        }
      >
        <Icon name="file" /> PDF zlecenia
      </button>
      <Link className="btn" to={`/zlecenia/${order.id}?pelna=1`}>
        <Icon name="clipboard" /> Wszystkie zabiegi zlecenia
      </Link>
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
  // Bez wybranej daty: pierwszy proponowany dzień (8–12 dni po wykonaniu).
  const pickedDate = date || nextVisitDays(doneOn)[0] || '';
  const [busy, setBusy] = useState(false);
  const nextSeq = visit.seq + 1;
  const booked = later?.start ? later : null;
  // Zabieg reklamacyjny nie umawia kolejnego zabiegu (ma numer reklamowanego).
  const complaint = Boolean(visit.complaintOf);
  const ready = complaint || Boolean(booked) || mode !== 'umowiony' || Boolean(pickedDate && time);

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
        {/* Kolejny zabieg już umówiony (np. „Umów od razu kolejny zabieg” w trakcie): tylko informacja, bez umawiania. */}
        {complaint ? null : booked ? (
          <p className="notice notice-info">
            <Icon name="calendar" />
            <span>
              Zabieg {roman(booked.seq)} jest już umówiony: <strong>{formatTerm(booked.start!)}</strong>
            </span>
          </p>
        ) : (
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
        )}
        {!complaint && !booked && mode === 'umowiony' && (
          <NextDates
            after={doneOn}
            backLabel={`Wróć do zakończenia zabiegu ${roman(visit.seq)}`}
            stay
            durationMin={visit.durationMin || 60}
            date={pickedDate}
            time={time}
            onPick={(d, t) => {
              setDate(d);
              setTime(t);
            }}
          />
        )}
        {!complaint && !booked && mode === 'umowiony' && (
          <div className="form-row">
            <Field label="Data">
              <input type="date" value={pickedDate} onChange={(e) => setDate(e.target.value)} />
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
            // Już umówiony kolejny zabieg zostaje bez zmian (termin, zakres, cena i kto umówił).
            const next: NextVisit = complaint
              ? { mode: 'brak' }
              : booked
              ? { mode: 'umowiony', start: booked.start!, durationMin: booked.durationMin || visit.durationMin }
              : mode === 'umowiony' ? { mode, start: `${pickedDate}T${time}`, durationMin: visit.durationMin, terms: t } : mode === 'technik' ? { mode, terms: t } : { mode };
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

/** Kroki zabiegu w trakcie (jak kroki tworzenia zlecenia). */
const WORK_STEPS = ['Wywiad', 'Co wykonano', 'Zdjęcia', 'Płatność i zakończenie'];

/**
 * Nagłówek zabiegu w trakcie: tylko to, co potrzebne na miejscu. Adres, telefon i opis od przyjmującego (np. szefa);
 * pozostałe dane zlecenia są na karcie zabiegu przed rozpoczęciem i po zakończeniu.
 */
function WorkHeader({ order, visit }: { order: Order; visit: Visit }) {
  const phone = order.phones.find((p) => p.number.trim());
  const picker = useCallPicker(order);
  return (
    <div className="work-head">
      <div className="work-head-top">
        <span>
          <strong>{orderAddress(order)}</strong>
          <span className="row-sub">
            {pestName(order)} · {visitWhen(visit)}
          </span>
        </span>
        {phone && (
          <button type="button" className="btn btn-sm" onClick={picker.start}>
            <Icon name="phone" /> {picker.count > 1 ? 'Zadzwoń (2)' : 'Zadzwoń'}
          </button>
        )}
        {picker.sheet}
      </div>
      {order.description.trim() ? (
        <div className="order-note">
          <span className="order-note-label">Opis{order.ownerName ? ` od ${firstName(order.ownerName)}` : ''}</span>
          <p>{order.description.trim()}</p>
        </div>
      ) : (
        <p className="row-sub">Bez opisu przy zleceniu.</p>
      )}
      {order.pink && (
        <div className="notice notice-pink">
          <Icon name="alert" />
          <span>Kod pink{order.pinkNote ? `: ${order.pinkNote}` : ''}</span>
        </div>
      )}
    </div>
  );
}

export function VisitPage() {
  const { id = '' } = useParams();
  const { confirm, run, toast } = useFeedback();
  const navigate = useNavigate();
  const [finishing, setFinishing] = useState(false);
  // Arkusz płatności („Klient płaci od razu?”) i szybkie zakończenie z opisem na później.
  const [paying, setPaying] = useState(false);
  const [finishLater, setFinishLater] = useState(false);
  const [resumeFinish, setResumeFinish] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [leavingStarted, setLeavingStarted] = useState(false);
  const [planningNext, setPlanningNext] = useState(false);
  // Edycja opisu wykonanego zabiegu (sytuacja z wywiadu i opis zlecenia) bez przechodzenia całych kroków.
  const [editingDesc, setEditingDesc] = useState(false);
  const [assigning, setAssigning] = useState(false);
  // Numer zabiegu w dniu („2 z 5”): ze wszystkich zabiegów tego dnia.
  const dayPos = useLiveQuery(async () => {
    const v = await visits.get(id);
    if (!v?.start) return null;
    return dayPositions((await visits.all()).filter((x) => x.start?.slice(0, 10) === v.start!.slice(0, 10))).get(id) ?? null;
  }, [id]);
  const [editingTerms, setEditingTerms] = useState(false);
  // Próba zakończenia bez płatności: sekcja płatności świeci na czerwono, ekran przewija się do niej.
  const [payAlert, setPayAlert] = useState(false);
  // Faktura bez potrzebnych danych (NIP, firma, imię i nazwisko, e-mail): pola świecą na czerwono.
  const [invoiceAlert, setInvoiceAlert] = useState(false);
  const payRef = useRef<HTMLDivElement>(null);
  const [workStep, setWorkStep] = useState(0);
  // Wymagane pytanie (uszczelnienie) bez odpowiedzi przy próbie zakończenia zabiegu II i kolejnych.
  const [improvementAlert, setImprovementAlert] = useState(false);
  const goStep = (i: number) => {
    setWorkStep(Math.max(0, Math.min(WORK_STEPS.length - 1, i)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  // Pole opisu kodu pink dostaje kursor tylko zaraz po zaznaczeniu, a nie przy każdym wejściu na ekran.
  const [pinkJustOn, setPinkJustOn] = useState(false);
  // Wykonany zabieg pokazuje podsumowanie; formularz otwiera „Edytuj zabieg” albo link z ?edycja=1.
  const [params, setParams] = useSearchParams();
  const [editingId, setEditingId] = useState<string | null>(params.has('edycja') ? id : null);
  useEffect(() => setEditingId(params.has('edycja') ? id : null), [id, params]);
  const editing = editingId === id;
  // Rozpoczęty, niedokończony zabieg otwiera się jak zwykła karta zlecenia z „Dokończ zabieg”, a nie od razu
  // w krokach. Kroki od razu tylko zaraz po „Rozpocznij zabieg” na tym ekranie.
  const [resumedId, setResumedId] = useState<string | null>(null);
  // „Więcej opcji” w nagłówku, reklamacja i zmiana numeru zabiegu.
  const [moreOpen, setMoreOpen] = useState(false);
  const [complaining, setComplaining] = useState(false);
  const [renumbering, setRenumbering] = useState(false);
  const resumed = resumedId === id;

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
  // Uszczelnienie potwierdzone przy wcześniejszym zabiegu: przy kolejnych już o nie nie pytamy.
  const sealedOn = sealedBefore(visit, list);
  const later = list.find((v) => v.seq === visit.seq + 1 && v.status !== 'odwolany' && !v.complaintOf);
  const phone = order.phones[0];
  // Cena i zakres tego zabiegu; zabiegi sprzed tej opcji mają widełki zlecenia i całe mieszkanie.
  const terms: VisitTerms = { scope: visit.scope ?? { kind: 'calosc', note: '' }, ...visitPrice(visit, order) };
  const price = priceRange({ ...terms, invoice: order.invoice }, settings.vatRate);
  const save = (patch: Partial<Visit>) => run(() => visits.update(visit.id, patch));
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
  const active = (visit.status === 'w_trakcie' && resumed) || (visit.status === 'wykonany' && editing);
  const paused = visit.status === 'w_trakcie' && !resumed;

  const scrollToPay = () => {
    setWorkStep(WORK_STEPS.length - 1);
    setTimeout(() => payRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  };

  /**
   * „Zakończ zabieg”: forma płatności i kwota są wymagane. Gdy ich brakuje, płatność świeci na czerwono i ekran
   * przewija się do niej; można też zakończyć teraz i uzupełnić później (zabieg trafia do „Pilnych”).
   */
  /** Zabieg II i kolejne bez wymaganej odpowiedzi (uszczelnienie): powrót do wywiadu z zaznaczonym pytaniem. */
  const blockImprovement = (missing: string[]) => {
    setImprovementAlert(true);
    goStep(0);
    toast(`Zabieg ${roman(visit.seq)}: odpowiedz ${missing.map((q) => `„${q}”`).join(' i ')}`, { tone: 'error' });
  };

  const requestFinish = async (later = false) => {
    setFinishLater(later);
    // Kwota zapisuje się przy wyjściu z pola, więc czytamy świeży stan po chwili.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const fresh = (await visits.get(visit.id)) ?? visit;
    // Zabieg II i kolejne: bez odpowiedzi o uszczelnieniu nie kończymy (przy „opiszę później” wymagane przy opisie).
    const unanswered = later ? [] : requiredAnswersMissing(fresh, list);
    if (unanswered.length) {
      blockImprovement(unanswered);
      return;
    }
    // Faktura wymaga danych klienta: bez nich zabiegu nie da się zakończyć.
    const freshOrder = (await orders.get(order.id)) ?? order;
    const lacking = invoiceMissing(freshOrder);
    if (lacking.length) {
      setInvoiceAlert(true);
      toast(`Do ${documentWord(freshOrder.invoice).of} brakuje: ${lacking.map((f) => INVOICE_FIELD_LABEL[f]).join(', ')}`, { tone: 'error' });
      if (later) {
        setResumeFinish(true);
        setPaying(true);
      }
      else scrollToPay();
      return;
    }
    // Zabieg gratis (reklamacja) kończy się bez płatności.
    const missing = fresh.complaintKind === 'gratis' ? [] : ([!fresh.payMethod && 'formy płatności', !fresh.amount && 'kwoty'].filter(Boolean) as string[]);
    if (missing.length) {
      setPayAlert(true);
      const ok = await confirm({
        title: 'Brak płatności',
        message: `Nie wybrano ${missing.join(' ani ')}. Uzupełnij płatność albo zakończ teraz i uzupełnij później: zabieg trafi do „Pilnych”.`,
        confirmLabel: 'Później (do Pilnych)',
        cancelLabel: 'Uzupełnię teraz',
      });
      if (!ok) {
        if (later) {
        setResumeFinish(true);
        setPaying(true);
      }
        else scrollToPay();
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
    await run(async () => {
      const { archived } = await cancelVisit(visit.id);
      toast(archived ? 'Zabieg odwołany, zlecenie w archiwum' : 'Zabieg odwołany', {
        action: {
          label: 'Cofnij',
          onClick: () =>
            void run(async () => {
              await restoreVisit(visit.id);
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
        detailsLater: finishLater,
      });
      setFinishing(false);
      setEditingId(null);
      if (finishLater) {
        setFinishLater(false);
        toast('Zabieg zakończony. Opis dopiszesz później: czeka w „Pilnych” jako „Do opisania”.');
        return;
      }
      // SMS z zaleceniami wysyła się przyciskiem w podsumowaniu, bez wyskakującego okna.
      toast(phone ? 'Zabieg zakończony. Zalecenia wyślesz przyciskiem „SMS” na górze.' : 'Zabieg zakończony');
    });
  };

  return (
    // Klucz: przejście do innego zabiegu tworzy pola od nowa, żeby nie zostały w nich wartości poprzedniego.
    <Page
      key={visit.id}
      title={active ? `Zabieg ${visitLabel(order, visit)}` : visitLabel(order, visit)}
      back="/zlecenia"
      onBack={visit.status === 'w_trakcie' ? () => setLeavingStarted(true) : undefined}
      actions={
        <button type="button" className="bell more-btn" aria-label="Więcej opcji" onClick={() => setMoreOpen(true)}>
          <Icon name="more" size={22} />
        </button>
      }
    >
      <Sheet open={moreOpen} title={`Więcej opcji · ${visitLabel(order, visit)}`} onClose={() => setMoreOpen(false)}>
        <div className="btn-stack">
          {visit.status === 'zaplanowany' && (
            <Link className="btn" to={`/zlecenia/${order.id}/edycja?zabieg=${visit.id}`}>
              <Icon name="edit" /> {visit.start ? 'Edytuj' : 'Umów termin i edytuj'}
            </Link>
          )}
          {visit.status === 'wykonany' && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                setMoreOpen(false);
                setEditingId(visit.id);
              }}
            >
              <Icon name="edit" /> Edytuj zabieg
            </button>
          )}
          {visit.status === 'zaplanowany' && (
            <button type="button" className="btn" onClick={() => setAssigning(true)}>
              <Icon name="users" /> {visit.assignedName ? `Technik: ${visit.assignedName} (zmień)` : 'Przydziel technika i powiadom'}
            </button>
          )}
          {!visit.complaintOf &&
            (later?.start ? (
              <button type="button" className="btn" onClick={() => navigate(`/zabieg/${later.id}`)}>
                <Icon name="calendar" /> Kolejny zabieg {roman(later.seq)}: {formatTerm(later.start)}
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => setPlanningNext(true)}>
                <Icon name="calendar" /> Umów kolejny zabieg
              </button>
            ))}
          {visit.status !== 'odwolany' && (
            <button type="button" className="btn" onClick={() => setComplaining(true)}>
              <Icon name="alert" /> Reklamacja
            </button>
          )}
          {!visit.complaintOf && visit.status !== 'odwolany' && (
            <button type="button" className="btn" onClick={() => setRenumbering(true)}>
              <Icon name="tag" /> Zmień numer zabiegu ({roman(visit.seq)})
            </button>
          )}
          {visit.start && visit.status === 'zaplanowany' && (
            <a className="btn" href={googleCalendarUrl(order, visit)!} target="_blank" rel="noreferrer">
              <Icon name="calendar" /> Dodaj do Kalendarza Google
            </a>
          )}
          <Link className="btn" to={`/zlecenia/nowe?powiel=${order.id}&zabieg=${visit.id}`}>
            <Icon name="copy" /> Powiel zlecenie (np. sąsiednie mieszkanie)
          </Link>
          <OrderOptions order={order} visits={list} vatRate={settings.vatRate} noEdit={visit.status !== 'wykonany'} onPdf={() => setMoreOpen(false)} />
          {(visit.status === 'zaplanowany' || visit.status === 'w_trakcie') && (
            <button
              type="button"
              className="btn btn-danger-quiet"
              onClick={() => {
                setMoreOpen(false);
                void cancel();
              }}
            >
              <Icon name="close" /> Odwołaj zabieg
            </button>
          )}
        </div>
      </Sheet>
      {complaining && <ComplaintSheet open={complaining} order={order} visit={visit} onClose={() => { setComplaining(false); setMoreOpen(false); }} />}
      {renumbering && <RenumberSheet open={renumbering} order={order} visit={visit} list={list} onClose={() => { setRenumbering(false); setMoreOpen(false); }} />}
      {/* Wyjście z rozpoczętego zabiegu: dokończyć później (czeka w Pilnych) albo wycofać wszystko, co wpisano. */}
      <Sheet open={leavingStarted} title={`Zabieg ${visitLabel(order, visit)} jest rozpoczęty`} onClose={() => setLeavingStarted(false)}>
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
      {active ? (
        <>
          <WorkHeader order={order} visit={visit} />
          <VisitStrip list={list} current={visit} />
        </>
      ) : (
        <>
        <div className="job-hero">
          <div className="hero-badges">
            <VisitBadge visit={visit} />
            {order.pink && <PinkBadge />}
          </div>
          <ClientHeading order={order} />
          <AddressBlock order={order} />
          <p>
            {pestName(order)} · {visitWhen(visit)}
            {dayPos && dayPos.of > 1 && <span className="day-pos day-pos-wide">zabieg {dayPos.n} z {dayPos.of} tego dnia</span>}
          </p>
          {bookedBy(visit, order) && <p className="visit-booked">Umówione przez: {firstName(bookedBy(visit, order))}</p>}
          {visit.complaintOf && visit.complaintKind && (
            <p className="complaint-line">
              <span className="complaint-badge">
                <Icon name="alert" size={14} /> Reklamacja · {COMPLAINT_NAMES[visit.complaintKind]}
                {visit.complaintKind === 'zwrot' && visit.amount ? ` ${moneyToInput(-visit.amount)} zł` : ''}
              </span>
              {visit.complaintNote ? <span> {visit.complaintNote}</span> : null}
            </p>
          )}
          <VisitStrip list={list} current={visit} />
        </div>

        <ContactBar
          order={order}
          visit={visit}
        />
        {summary && visit.detailsLater && (
          <div className="notice notice-warn">
            <Icon name="edit" />
            <span>
              <strong>Do opisania.</strong> Dopisz wywiad, wykonane prace i zdjęcia.
            </span>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                setEditingId(visit.id);
                goStep(0);
              }}
            >
              Dopisz teraz
            </button>
          </div>
        )}

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
              {/* Zaraz po dodaniu zlecenia: przydział technikowi i powiadomienie (WhatsApp, SMS, dzwoneczek). */}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setParams({}, { replace: true });
                  setAssigning(true);
                }}
              >
                Przydziel technikowi
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setParams({}, { replace: true })}>
                Nie teraz
              </button>
            </span>
          </div>
        )}
        {order.access && (
          <div className="notice notice-info">
            <Icon name="pin" />
            <span>{order.access}</span>
          </div>
        )}
        {addressMissing(order) && visit.status !== 'wykonany' && (
          <div className="notice notice-danger">
            <Icon name="pin" />
            <span>
              <strong>Brak adresu.</strong> Klient miał podać adres później. Uzupełnij go przed zabiegiem.
            </span>
            <Link className="btn btn-sm btn-primary" to={`/zlecenia/${order.id}/edycja?zabieg=${visit.id}`}>
              Uzupełnij
            </Link>
          </div>
        )}
        {order.accountingProblem && (
          <div className="notice notice-danger">
            <Icon name="alert" />
            <span>
              <strong>Księgowa zgłasza problem.</strong> {order.accountingNote?.trim() || 'Skontaktuj się z księgową.'}
            </span>
            <Link className="btn btn-sm" to={`/czat?k=ksiegowosc&tekst=${encodeURIComponent(`Zlecenie ${visitLabel(order, visit)}: `)}`}>
              Napisz do księgowej
            </Link>
          </div>
        )}
        {order.pink && (
          <div className="notice notice-pink">
            <Icon name="alert" />
            <span>Kod pink{order.pinkNote ? `: ${order.pinkNote}` : ''}</span>
          </div>
        )}

        {/* Odwołany zabieg można przywrócić (np. odwołany przez pomyłkę albo klient jednak chce). */}
        {visit.status === 'odwolany' && (
          <div className="notice notice-warn">
            <Icon name="alert" />
            <span>
              <strong>Zabieg {roman(visit.seq)} jest odwołany.</strong> Jeśli to pomyłka albo klient jednak chce ten termin, cofnij odwołanie.
            </span>
            <span className="notice-actions">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() =>
                  void run(async () => {
                    await restoreVisit(visit.id);
                    toast(`Zabieg ${roman(visit.seq)} przywrócony`);
                  })
                }
              >
                Cofnij odwołanie
              </button>
            </span>
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
              onClick={() =>
                void run(async () => {
                  await startVisit(visit.id);
                  setResumedId(visit.id);
                })
              }
            >
              <Icon name="play" /> Rozpocznij zabieg
            </button>
            <div className="btn-stack">
              {/* Jedno miejsce na zmiany umówionego zabiegu: termin, czas, zakres i cena; dane klienta w edycji zlecenia. */}
              {/* Jedna edycja wszystkiego: termin, zakres, cena, klient, adres i opis. */}
              <Link className="btn" to={`/zlecenia/${order.id}/edycja?zabieg=${visit.id}`}>
                <Icon name="edit" /> {visit.start ? 'Edytuj' : 'Umów termin i edytuj'}
              </Link>
            </div>
            <details className="more-actions">
              <summary>Więcej opcji</summary>
              <div className="btn-stack">
                <button type="button" className="btn" onClick={() => setAssigning(true)}>
                  <Icon name="users" /> {visit.assignedName ? `Technik: ${visit.assignedName} (zmień)` : 'Przydziel technika i powiadom'}
                </button>
                <OrderOptions order={order} visits={list} vatRate={settings.vatRate} noEdit />
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
                <Link className="btn" to={`/zlecenia/nowe?powiel=${order.id}&zabieg=${visit.id}`}>
                  <Icon name="copy" /> Powiel zlecenie (np. sąsiednie mieszkanie)
                </Link>
                <button type="button" className="btn btn-danger-quiet" onClick={() => void cancel()}>
                  <Icon name="close" /> Odwołaj zabieg
                </button>
              </div>
            </details>
          </>
        )}
        {paused && (
          <>
            <p className="notice notice-info">
              <Icon name="play" />
              <span>
                <strong>Zabieg rozpoczęty, jeszcze niedokończony.</strong> Dokończ, gdy wrócisz do klienta albo masz chwilę na opis.
              </span>
            </p>
            <button type="button" className="btn btn-primary btn-block btn-big" onClick={() => setResumedId(visit.id)}>
              <Icon name="play" /> Dokończ zabieg
            </button>
            <details className="more-actions">
              <summary>Więcej opcji</summary>
              <div className="btn-stack">
                <OrderOptions order={order} visits={list} vatRate={settings.vatRate} noEdit />
                <button type="button" className="btn btn-danger-quiet" onClick={() => void cancel()}>
                  <Icon name="close" /> Odwołaj zabieg
                </button>
              </div>
            </details>
          </>
        )}
        <OrderInfo order={order} vatRate={settings.vatRate} terms={summary ? undefined : termsText(terms, order.invoice, settings.vatRate)} assigned={visit.assignedName} />


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
                onClick={() => void copyText(descriptionCopy(visit, order)).then((ok) => toast(ok ? 'Skopiowano opis' : 'Nie udało się skopiować', ok ? undefined : { tone: 'error' }))}
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
            {order.invoice !== 'brak' && (
              <button
                type="button"
                className="btn"
                onClick={() =>
                  void copyText(invoiceCopy(order, visit, settings.vatRate, visitLabel(order, visit))).then((ok) =>
                    toast(ok ? `Skopiowano dane do ${documentWord(order.invoice).of}` : 'Nie udało się skopiować', ok ? undefined : { tone: 'error' }),
                  )
                }
              >
                <Icon name="copy" /> Kopiuj do {documentWord(order.invoice).of}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setEditingDesc(true)}>
              <Icon name="edit" /> Edytuj opis
            </button>
            {!later?.start && (
              <button type="button" className="btn btn-primary" onClick={() => setPlanningNext(true)}>
                <Icon name="calendar" /> Umów kolejny zabieg
              </button>
            )}
          </div>
          <details className="more-actions">
            <summary>Więcej opcji</summary>
            <div className="btn-stack">
              <button type="button" className="btn" onClick={() => setEditingId(visit.id)}>
                <Icon name="edit" /> Edytuj zabieg
              </button>
              <button type="button" className="btn" onClick={() => setComplaining(true)}>
                <Icon name="alert" /> Reklamacja
              </button>
              <OrderOptions order={order} visits={list} vatRate={settings.vatRate} />
            </div>
          </details>
        </>
      )}

      <Sheet open={planningNext} title={`Umów kolejny zabieg · ${visitCode(order, later?.seq ?? nextVisitSeq(list))}`} onClose={() => setPlanningNext(false)}>
        {planningNext && (
          <ScheduleNext
            durationMin={visit.durationMin || 60}
            after={previousVisitDay(list, later?.seq ?? nextVisitSeq(list)) ?? visit.doneOn ?? visit.start?.slice(0, 10) ?? todayWarsaw()}
            initial={proposeTerms(list, order)}
            invoice={order.invoice}
            onSave={(start, durationMin, nextTerms) =>
              run(async () => {
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
          {/* Klient płaci od razu: płatność można przyjąć na każdym kroku. Na ostatnim kroku jest pełna sekcja płatności. */}
          {workStep < WORK_STEPS.length - 1 && <PayCard visit={visit} order={order} onOpen={() => setPaying(true)} />}
          {/* Zabieg krok po kroku, jak tworzenie zlecenia: wywiad, wykonane, zdjęcia i protokół, płatność. */}
          <div className="wizard-progress" aria-label={`Krok ${workStep + 1} z ${WORK_STEPS.length}`}>
            {WORK_STEPS.map((title, i) => (
              <button key={title} type="button" className={i <= workStep ? 'done' : ''} aria-label={title} onClick={() => goStep(i)} />
            ))}
          </div>
          <h2 className="wizard-title">
            {workStep + 1}. {WORK_STEPS[workStep]}
          </h2>
          {workStep === 0 && (
            <>
              <Group plain>
              <AutoText
                label="Opis"
                placeholder="Co się dzieje, gdzie, od kiedy"
                rows={4}
                value={interview.situation}
                onSave={(v) => saveInterview('situation', v)}
              />
              <AutoText
                label="Jaka jest skala populacji? (wpisz ile)"
                placeholder="Np. kilka, ok. 20, dużo w całym mieszkaniu"
                rows={1}
                value={interview.seenCount}
                onSave={(v) => saveInterview('seenCount', v)}
              />
              {visit.seq > 1 && (
                <>
                  {sealedOn !== null ? (
                    <p className="field-hint">
                      <Icon name="check" size={14} /> Mieszkanie uszczelnione (potwierdzone przy zabiegu {roman(sealedOn)})
                    </p>
                  ) : (
                    <>
                      <YesNoField
                        label="Czy mieszkanie zostało uszczelnione? (wymagane)"
                        value={interview.sealed}
                        missing={improvementAlert && !interview.sealed}
                        onChange={(v) => saveInterview('sealed', v)}
                      />
                      {interview.sealed === 'nie' && (
                        <AutoText
                          label="Co nie jest uszczelnione?"
                          placeholder="Np. kratki wentylacyjne w łazience, klient uszczelni do piątku"
                          rows={2}
                          value={interview.sealedNote}
                          onSave={(v) => saveInterview('sealedNote', v)}
                        />
                      )}
                    </>
                  )}
                </>
              )}
            </Group>

            </>
          )}
          {workStep === 1 && (
            <>
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

            </>
          )}
          {workStep === 2 && (
            <>
            <Group title="Zdjęcia" plain>
              <Photos visitId={visit.id} />
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

            </>
          )}
          {workStep === 3 && (
            <>
            <div className="terms-bar">
              <span>
                <span className="terms-label">Co pryskamy i cena</span>
                {termsText(terms, order.invoice, settings.vatRate)}
              </span>
              <button type="button" className="btn btn-sm" onClick={() => setEditingTerms(true)}>
                <Icon name="edit" /> Zmień
              </button>
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
              <AmountField value={visit.amount} options={agreedAmounts(visit, order)} vat={order.invoice === 'vat'} missing={payAlert && !visit.amount} hint={price ? (price.gross ? `Ustalona cena: ${price.net}, ${price.gross}` : `Ustalona cena: ${price.net}`) : undefined} onSave={(amount) => save({ amount })} />
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
              {/* Protokół razem z fakturą i płatnością: wszystkie dokumenty dla klienta w jednym miejscu. */}
              <label className="check">
                <input type="checkbox" checked={Boolean(order.protocol)} onChange={(e) => void run(() => orders.update(order.id, { protocol: e.target.checked }))} />
                Klient chce protokół z zabiegu
              </label>
              {order.protocol && order.invoice === 'brak' && <ProtocolEmail order={order} />}
            </Group>
            </div>

            {visit.status === 'w_trakcie' ? (
              <>
                {later?.start && (
                  <p className="notice notice-info">
                    <Icon name="calendar" />
                    <span>
                      Kolejny zabieg {roman(later.seq)} umówiony: <strong>{formatTerm(later.start)}</strong>
                    </span>
                  </p>
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
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() =>
                      void run(async () => {
                        // Zabieg II i kolejne: najpierw odpowiedź o uszczelnieniu.
                        const unanswered = requiredAnswersMissing((await visits.get(visit.id)) ?? visit, list);
                        if (unanswered.length) {
                          blockImprovement(unanswered);
                          return;
                        }
                        // Dopisany opis: zabieg znika z „Do opisania”.
                        if (visit.detailsLater) await visits.update(visit.id, { detailsLater: false });
                        setEditingId(null);
                        if (params.has('edycja')) navigate(`/zabieg/${visit.id}`, { replace: true });
                      })
                    }
                  >
                    <Icon name="check" /> {visit.detailsLater ? 'Gotowe, opisane' : 'Zapisz i wyjdź'}
                  </button>
                  <button type="button" className="btn" onClick={() => setFinishing(true)}>
                    Zmień zalecenia lub kolejny zabieg
                  </button>
                </div>
              </Group>
            )}
            </>
          )}
          {workStep < WORK_STEPS.length - 1 && (
            <div className="wizard-nav">
              {workStep > 0 && (
                <button type="button" className="btn" onClick={() => goStep(workStep - 1)}>
                  Wstecz
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => goStep(workStep + 1)}>
                Dalej
              </button>
            </div>
          )}
          {/* Zapłacone i trzeba wychodzić: opis, prace i zdjęcia można dopisać później (w aucie, w domu). */}
          {visit.status === 'w_trakcie' && workStep < WORK_STEPS.length - 1 && (
            <div className="finish-later">
              <button type="button" className="btn btn-block btn-dashed" onClick={() => void requestFinish(true)}>
                <Icon name="check" /> Zakończ teraz, opiszę później
              </button>
              <p className="field-hint">Opis, wykonane prace i zdjęcia dopiszesz w aucie albo w domu. Zabieg poczeka w „Pilnych”.</p>
            </div>
          )}
          {workStep === WORK_STEPS.length - 1 && (
            <button type="button" className="btn btn-block" onClick={() => goStep(workStep - 1)}>
              Wstecz
            </button>
          )}
        </>
      )}

      {!active && <History list={list} current={visit} order={order} vatRate={settings.vatRate} />}

      {assigning && <AssignSheet order={order} visit={visit} open={assigning} onClose={() => setAssigning(false)} />}
      <Sheet open={editingDesc} title={`Opis · ${visitLabel(order, visit)}`} onClose={() => setEditingDesc(false)}>
        {editingDesc && <DescriptionForm order={order} visit={visit} onDone={() => setEditingDesc(false)} />}
      </Sheet>

      <Sheet open={paying} title={`Płatność · ${visitLabel(order, visit)}`} onClose={() => setPaying(false)}>
        {paying && (
          <PaySheet
            visit={visit}
            order={order}
            company={company}
            alert={invoiceAlert}
            later={later}
            onPlanNext={visit.status === 'w_trakcie' ? () => setPlanningNext(true) : undefined}
            onClose={() => setPaying(false)}
            onSaved={() => {
              if (!resumeFinish) return;
              setResumeFinish(false);
              // Z powrotem do „Zakończenia zabiegu” (sprawdza jeszcze dane do faktury).
              setTimeout(() => void requestFinish(true), 200);
            }}
          />
        )}
      </Sheet>

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
      <Sheet open={editingTerms} title={`Co pryskamy i cena · ${visitLabel(order, visit)}`} onClose={() => setEditingTerms(false)}>
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

/** Najwyższa kwota jednego zabiegu (w groszach): 30 000 zł. Więcej to prawie na pewno pomyłka. */
const MAX_VISIT_AMOUNT = 3_000_000;

function AmountField(props: { value: number | null; hint?: string; missing?: boolean; onSave: (value: number | null) => void; options?: number[]; vat?: boolean }) {
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
    <>
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
      {/* Jedno stuknięcie: kwota z widełek ustalonych przy umawianiu (przy fakturze VAT z VAT-em). */}
      {props.options && props.options.length > 0 && (
        <div className="chips amount-chips" role="group" aria-label="Ustalona cena">
          {props.options.map((o) => (
            <button
              key={o}
              type="button"
              className={parseMoney(text) === o ? 'chip active' : 'chip'}
              onClick={() => {
                const raw = moneyToInput(o);
                setText(raw);
                commit(raw);
              }}
            >
              {formatPln(o)}
              {props.vat ? ' brutto' : ''}
            </button>
          ))}
        </div>
      )}
    </>
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
                      await restoreVisit(visit.id);
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
