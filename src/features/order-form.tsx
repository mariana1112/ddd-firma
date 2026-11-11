import { orderCode } from '../data/codes';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { locate, suggestSlots, type Suggestion } from '../data/geo';
import { createOrder, type OrderDraft } from '../data/orders';
import { orders, visits } from '../data/repo';
import { getAppSettings } from '../data/settings';
import { BUILDINGS, INVOICES, PESTS, orderAddress, priceRange, PINK_PLACEHOLDER } from '../data/texts';
import type { BuildingType, InvoiceType, Order, PestCategory, ScopeKind, TreatmentMethod } from '../data/types';
import { METHOD_LABEL, METHODS } from '../data/methods';
import { normalizeCity } from '../data/cities';
import { SCOPE_KINDS, scopeText, type VisitTerms } from '../data/visit-terms';
import { coordsFromLink, isIos, isMapsLink, mapsQuery, mapsSearchUrl } from '../data/maps';
import { formatDateLong, formatTerm, isValidDate, todayWarsaw } from '../lib/dates';
import { moneyToInput, parseMoney } from '../lib/money';
import { formatPhoneInput, formatPostalInput, isValidNip } from '../lib/validators';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Field, Group, Info, Loading, NotFound, Page } from '../ui/kit';

interface FormState {
  building: BuildingType;
  street: string;
  houseNo: string;
  flatNo: string;
  floor: string;
  staircase: string;
  postalCode: string;
  city: string;
  access: string;
  pest: PestCategory;
  pestOther: string;
  description: string;
  area: string;
  date: string;
  time: string;
  duration: string;
  second: 'technik' | 'umowiony' | 'brak';
  /** Co pryskamy przy pierwszym zabiegu; drugi dostaje to samo, do zmiany przed zabiegiem. */
  scopeKind: ScopeKind;
  scopeNote: string;
  secondDate: string;
  secondTime: string;
  priceMin: string;
  priceMax: string;
  invoice: InvoiceType;
  clientName: string;
  email: string;
  nip: string;
  invoiceAddress: string;
  phone1: string;
  phone2: string;
  phone2Label: string;
  pink: boolean;
  pinkNote: string;
  /** Link do miejsca z Google Maps (opcjonalny), żeby nawigacja trafiała dokładnie. */
  mapsLink: string;
  /** Co robimy: wymagane przy tworzeniu, od tego zależą zalecenia. */
  methods: TreatmentMethod[];
  /** Klient chce protokół z zabiegu. */
  protocol: boolean;
  /** Nazwa firmy do faktury VAT. */
  invoiceName: string;
}

const EMPTY: FormState = {
  building: 'blok',
  street: '',
  houseNo: '',
  flatNo: '',
  floor: '',
  staircase: '',
  postalCode: '',
  city: '',
  access: '',
  pest: 'karaluchy',
  pestOther: '',
  description: '',
  area: '',
  date: '',
  time: '10:00',
  duration: '60',
  second: 'technik',
  scopeKind: 'calosc',
  scopeNote: '',
  secondDate: '',
  secondTime: '10:00',
  priceMin: '',
  priceMax: '',
  invoice: 'brak',
  clientName: '',
  email: '',
  nip: '',
  invoiceAddress: '',
  phone1: '',
  phone2: '',
  phone2Label: '',
  pink: false,
  pinkNote: '',
  mapsLink: '',
  methods: [],
  protocol: false,
  invoiceName: '',
};

const DRAFT_KEY = 'ddd-szkic-zlecenia';

function loadDraft(): FormState {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<FormState>) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

function saveDraft(state: FormState | null) {
  try {
    if (state) localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Bez pamięci przeglądarki szkic po prostu nie przetrwa zamknięcia aplikacji.
  }
}

function fromOrder(order: Order): FormState {
  return {
    ...EMPTY,
    building: order.building,
    street: order.street,
    houseNo: order.houseNo,
    flatNo: order.flatNo,
    floor: order.floor,
    staircase: order.staircase,
    postalCode: order.postalCode,
    city: order.city,
    access: order.access,
    pest: order.pest,
    pestOther: order.pestOther,
    description: order.description,
    area: order.areaM2 != null ? String(order.areaM2) : '',
    priceMin: order.priceMin != null ? moneyToInput(order.priceMin) : '',
    priceMax: order.priceMax != null ? moneyToInput(order.priceMax) : '',
    invoice: order.invoice,
    clientName: order.clientName,
    email: order.email,
    nip: order.nip,
    invoiceAddress: order.invoiceAddress,
    phone1: order.phones[0]?.number ?? '',
    phone2: order.phones[1]?.number ?? '',
    phone2Label: order.phones[1]?.label ?? '',
    pink: order.pink,
    pinkNote: order.pinkNote,
    mapsLink: order.mapsLink ?? '',
    methods: order.methods ?? [],
    protocol: order.protocol ?? false,
    invoiceName: order.invoiceName ?? '',
  };
}

function toDraft(s: FormState): OrderDraft {
  const phones = s.phone1.trim() ? [{ number: s.phone1.trim(), label: '' }] : [];
  if (s.phone2.trim()) phones.push({ number: s.phone2.trim(), label: s.phone2Label.trim() });
  return {
    building: s.building,
    street: s.street.trim(),
    houseNo: s.houseNo.trim(),
    flatNo: s.building === 'blok' ? s.flatNo.trim() : '',
    floor: s.building === 'blok' ? s.floor.trim() : '',
    staircase: s.building === 'blok' ? s.staircase.trim() : '',
    postalCode: s.postalCode.trim(),
    city: normalizeCity(s.city),
    access: s.access.trim(),
    pest: s.pest,
    pestOther: s.pest === 'inne' ? s.pestOther.trim() : '',
    description: s.description.trim(),
    areaM2: s.area.trim() ? Number(s.area.replace(',', '.')) : null,
    priceMin: s.priceMin.trim() ? parseMoney(s.priceMin) : null,
    priceMax: s.priceMax.trim() ? parseMoney(s.priceMax) : null,
    invoice: s.invoice,
    clientName: s.clientName.trim(),
    email: s.email.trim(),
    // NIP i nazwa firmy tylko przy fakturze VAT; imienna ma imię i nazwisko klienta.
    nip: s.invoice === 'vat' ? s.nip.trim() : '',
    invoiceName: s.invoice === 'vat' ? s.invoiceName.trim() : '',
    invoiceAddress: s.invoice !== 'brak' ? s.invoiceAddress.trim() : '',
    phones,
    pink: s.pink,
    pinkNote: s.pink ? s.pinkNote.trim() : '',
    mapsLink: s.mapsLink.trim(),
    methods: s.methods,
    protocol: s.protocol,
  };
}

type StepId = 'telefon' | 'adres' | 'problem' | 'termin' | 'cena' | 'klient' | 'podsumowanie';

const STEP_TITLES: Record<StepId, string> = {
  telefon: 'Telefon klienta',
  adres: 'Adres',
  problem: 'Co robimy i szkodnik',
  termin: 'Termin',
  cena: 'Cena i faktura',
  klient: 'Klient',
  podsumowanie: 'Podsumowanie',
};

type Errors = Partial<Record<keyof FormState, string>>;

/**
 * Puste pola nieobowiązkowe, o które warto zapytać: aplikacja pyta, czy na pewno ich nie uzupełnić.
 * Data, telefon, adres, widełki i „Co robimy” są obowiązkowe (validate).
 */
function missing(step: StepId, s: FormState): Array<[keyof FormState, string]> {
  const m: Array<[keyof FormState, string]> = [];
  if (step === 'adres' && s.building === 'blok' && !s.flatNo.trim()) m.push(['flatNo', 'numer lokalu']);
  if (step === 'klient' && !s.clientName.trim()) m.push(['clientName', 'imię lub firma']);
  return m;
}

// Telefon na początku: stały klient od razu podpowiada swoje dane i adres.
const ALL_STEPS: StepId[] = ['telefon', 'adres', 'problem', 'termin', 'cena', 'klient'];

/**
 * Błędy, które blokują zapis: puste pola obowiązkowe (adres, co robimy, data, widełki, telefon) i błędnie wpisane
 * wartości, które trafiłyby do zlecenia z błędem (np. kod 00-00).
 */
function validate(step: StepId, s: FormState): Errors {
  const e: Errors = {};
  if (step === 'adres') {
    if (!s.street.trim()) e.street = 'Podaj ulicę';
    if (!s.houseNo.trim()) e.houseNo = 'Podaj numer';
    if (!s.city.trim()) e.city = 'Podaj miejscowość';
    if (s.postalCode.trim() && !/^\d{2}-\d{3}$/.test(s.postalCode.trim())) e.postalCode = 'Kod w formacie 00-000';
    if (s.mapsLink.trim() && !isMapsLink(s.mapsLink)) e.mapsLink = 'Wklej link z Google Maps (Udostępnij → Kopiuj link)';
  }
  if (step === 'problem') {
    if (s.methods.length === 0) e.methods = 'Zaznacz, co dokładnie robimy: oprysk ciśnieniowy, ULV, zamgławianie, żelowanie albo zalanie odpływów';
    if (s.pest === 'inne' && !s.pestOther.trim()) e.pestOther = 'Wpisz, jaki szkodnik';
    if (s.area.trim() && !/^\d+([.,]\d+)?$/.test(s.area.trim())) e.area = 'Podaj liczbę, np. 48';
  }
  if (step === 'termin') {
    if (!s.date) e.date = 'Podaj datę zabiegu';
    else if (!isValidDate(s.date)) e.date = 'Podaj poprawną datę';
    if (s.date && !/^\d{2}:\d{2}$/.test(s.time)) e.time = 'Podaj godzinę';
  }
  if (step === 'cena') {
    if (!s.priceMin.trim()) e.priceMin = 'Podaj cenę od';
    else if (parseMoney(s.priceMin) === null) e.priceMin = 'Podaj kwotę, np. 300';
    if (!s.priceMax.trim()) e.priceMax = 'Podaj cenę do';
    else if (parseMoney(s.priceMax) === null) e.priceMax = 'Podaj kwotę, np. 350';
    const [min, max] = [parseMoney(s.priceMin), parseMoney(s.priceMax)];
    if (min !== null && max !== null && max < min) e.priceMax = 'Górna granica jest niższa niż dolna';
  }
  if (step === 'telefon') {
    if (!s.phone1.trim()) e.phone1 = 'Podaj numer telefonu';
    else if (s.phone1.replace(/\D/g, '').length < 9) e.phone1 = 'Numer ma za mało cyfr';
  }
  if (step === 'klient') {
    if (s.email.trim() && !/^\S+@\S+\.\S+$/.test(s.email.trim())) e.email = 'Adres e-mail jest niepoprawny';
    else if (s.invoice !== 'brak' && !s.email.trim()) e.email = 'Do faktury potrzebny jest e-mail';
    if (s.invoice === 'vat') {
      if (!s.invoiceName.trim()) e.invoiceName = 'Podaj nazwę firmy';
      if (!s.nip.trim()) e.nip = 'Podaj NIP';
      else if (!isValidNip(s.nip)) e.nip = 'NIP jest niepoprawny';
    }
    if (s.invoice === 'imienna' && !s.clientName.trim()) e.clientName = 'Do faktury imiennej podaj imię i nazwisko';
  }
  return e;
}

/**
 * Sprawdzenie adresu w Google Maps i wklejenie linku do miejsca. Formularz zapisuje się sam (szkic), więc można przejść
 * do map i wrócić bez utraty danych. Zapisany link sprawia, że „Nawiguj” prowadzi dokładnie do tego miejsca.
 */
function MapsLinkField(props: { state: FormState; set: (patch: Partial<FormState>) => void; error?: string }) {
  const { toast } = useFeedback();
  const query = mapsQuery(props.state);
  const coords = coordsFromLink(props.state.mapsLink);
  /** Otwiera wyszukiwanie adresu w Google Maps; szkic formularza jest już zapisany, więc można wrócić. */
  const openSearch = (app: boolean) => {
    if (!query) {
      toast('Najpierw wpisz ulicę, numer i miejscowość.', { tone: 'error' });
      return;
    }
    if (app) {
      window.location.href = `comgooglemaps://?q=${encodeURIComponent(query)}`;
      return;
    }
    const opened = window.open(mapsSearchUrl(query), '_blank');
    if (!opened) window.location.href = mapsSearchUrl(query);
  };
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) props.set({ mapsLink: text });
    } catch {
      // Bez zgody na schowek link wkleja się ręcznie w pole.
    }
  };
  return (
    <div className={props.error ? 'field field-error' : 'field'}>
      <span className="field-label">Miejsce w Google Maps</span>
      <div className="maps-row">
        <button type="button" className="btn btn-sm" onClick={() => openSearch(false)}>
          <Icon name="search" /> Znajdź adres w Google Maps
        </button>
        {isIos() && (
          <button type="button" className="btn btn-sm" onClick={() => openSearch(true)}>
            <Icon name="nav" /> W aplikacji Google Maps
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={() => void paste()}>
          <Icon name="copy" /> Wklej link
        </button>
      </div>
      <input
        value={props.state.mapsLink}
        placeholder="https://maps.app.goo.gl/…"
        inputMode="url"
        autoComplete="off"
        onChange={(e) => props.set({ mapsLink: e.target.value })}
        aria-label="Link do miejsca z Google Maps"
      />
      {props.error ? (
        <span className="field-message">{props.error}</span>
      ) : (
        <span className="field-hint">
          {props.state.mapsLink.trim()
            ? coords
              ? `Zapisane miejsce: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}. Nawigacja poprowadzi dokładnie tutaj.`
              : 'Zapisany link do miejsca. Nawigacja Google otworzy dokładnie to miejsce.'
            : 'Opcjonalnie: sprawdź adres w Google Maps, potem „Udostępnij” → „Kopiuj link” i wklej go tutaj. Dane formularza zostają zapisane.'}
        </span>
      )}
    </div>
  );
}

/** „Co robimy”: jedna albo kilka metod. Przy zamgławianiu ULV od razu widać uwagę dla klienta. */
function MethodsField(props: { value: TreatmentMethod[]; onChange: (value: TreatmentMethod[]) => void; error?: string }) {
  const toggle = (m: TreatmentMethod) => props.onChange(props.value.includes(m) ? props.value.filter((x) => x !== m) : [...props.value, m]);
  return (
    <div className={props.error ? 'field field-error' : 'field'}>
      <span className="field-label">Co dokładnie robimy (obowiązkowe, można kilka)</span>
      <div className="choice">
        {METHODS.map(([m, label]) => (
          <button key={m} type="button" className={props.value.includes(m) ? 'choice-item active' : 'choice-item'} aria-pressed={props.value.includes(m)} onClick={() => toggle(m)}>
            {label}
          </button>
        ))}
      </div>
      {props.error && <span className="field-message">{props.error}</span>}
    </div>
  );
}

function Choice<T extends string>(props: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      <div className="choice">
        {props.options.map(([value, text]) => (
          <button
            key={value}
            type="button"
            className={value === props.value ? 'choice-item active' : 'choice-item'}
            aria-pressed={value === props.value}
            onClick={() => props.onChange(value)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function Suggestions(props: { state: FormState; onPick: (s: Suggestion) => void }) {
  const [result, setResult] = useState<Suggestion[] | null | 'offline'>(null);
  const { city, postalCode, duration } = props.state;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const target = await locate(city, postalCode);
      if (!target) {
        if (!cancelled) setResult('offline');
        return;
      }
      const all = await visits.all();
      const orderById = new Map((await orders.all()).map((o) => [o.id, o]));
      const planned = [];
      for (const visit of all) {
        const order = orderById.get(visit.orderId);
        if (!order || visit.status !== 'zaplanowany' || !visit.start) continue;
        planned.push({ order, visit, point: await locate(order.city, order.postalCode) });
      }
      if (!cancelled) setResult(suggestSlots(target, Number(duration) || 60, todayWarsaw(), planned));
    })();
    return () => {
      cancelled = true;
    };
  }, [city, postalCode, duration]);

  if (result === null) return <p className="field-hint">Szukam terminów blisko innych zleceń…</p>;
  if (result === 'offline') return <p className="field-hint">Nie udało się ustalić położenia {city}. Propozycje terminów wymagają internetu.</p>;
  if (result.length === 0) return <p className="field-hint">W najbliższych 2 tygodniach nie ma zleceń w promieniu 25 km.</p>;
  return (
    <div className="suggestions">
      <span className="field-label">Proponowane terminy, blisko innych zleceń</span>
      {result.map((s) => (
        <button key={s.start} type="button" className="suggestion" onClick={() => props.onPick(s)}>
          <strong>
            {formatDateLong(s.date)}, {s.start.slice(11)}
          </strong>
          <span>
            {Math.round(s.distanceKm)} km od {orderCode(s.near.order)} ({s.near.order.city}), dojazd ok. {s.travelMin} min
          </span>
        </button>
      ))}
    </div>
  );
}

function ReturningClient(props: { phone: string; onFill: (order: Order) => void; currentId?: string; withAddress?: boolean }) {
  const [filled, setFilled] = useState(false);
  const digits = props.phone.replace(/\D/g, '');
  const found = useLiveQuery(async () => {
    if (digits.length < 9) return [];
    return (await orders.all()).filter((o) => o.id !== props.currentId && o.phones.some((p) => p.number.replace(/\D/g, '').endsWith(digits.slice(-9))));
  }, [digits, props.currentId]);
  if (!found?.length) return null;
  const last = found.sort((a, b) => b.number - a.number)[0];
  return (
    <div className="notice notice-info">
      <Icon name="users" />
      <span>
        Ten numer był już w zleceniu <strong>{orderCode(last)}</strong> ({last.clientName}, {orderAddress(last)}).
        <span className="notice-actions">
          {filled ? (
            <strong>Uzupełniono. Sprawdź dane w kolejnych krokach.</strong>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                props.onFill(last);
                setFilled(true);
              }}
            >
              {props.withAddress ? 'Uzupełnij dane i adres' : 'Uzupełnij dane klienta'}
            </button>
          )}
        </span>
      </span>
    </div>
  );
}

/** Ustalenia pierwszego zabiegu z formularza: zakres i widełki z kroku „Cena”. */
function formTerms(s: FormState): VisitTerms {
  return {
    scope: { kind: s.scopeKind, note: s.scopeKind === 'calosc' ? '' : s.scopeNote.trim() },
    priceMin: s.priceMin.trim() ? parseMoney(s.priceMin) : null,
    priceMax: s.priceMax.trim() ? parseMoney(s.priceMax) : null,
  };
}

function Steps(props: { state: FormState; set: (patch: Partial<FormState>) => void; step: StepId; errors: Errors; vatRate: number; editId?: string }) {
  const { state: s, set, errors } = props;
  const price = priceRange(
    { priceMin: parseMoney(s.priceMin), priceMax: parseMoney(s.priceMax), invoice: s.invoice },
    props.vatRate,
  );

  switch (props.step) {
    case 'adres':
      return (
        <div className="form">
          <Choice
            label="Rodzaj budynku"
            value={s.building}
            options={Object.entries(BUILDINGS) as Array<[BuildingType, string]>}
            onChange={(building) => set({ building })}
          />
          <div className="form-row">
            <Field label="Ulica" error={errors.street}>
              <input value={s.street} onChange={(e) => set({ street: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Nr domu" error={errors.houseNo}>
              <input className="input-short" value={s.houseNo} onChange={(e) => set({ houseNo: e.target.value })} autoComplete="off" />
            </Field>
          </div>
          {s.building === 'blok' && (
            <div className="form-row form-row-3">
              <Field label="Nr lokalu" error={errors.flatNo}>
                <input value={s.flatNo} onChange={(e) => set({ flatNo: e.target.value })} inputMode="numeric" autoComplete="off" />
              </Field>
              <Field label="Piętro">
                <input value={s.floor} onChange={(e) => set({ floor: e.target.value })} inputMode="numeric" autoComplete="off" />
              </Field>
              <Field label="Klatka">
                <input value={s.staircase} onChange={(e) => set({ staircase: e.target.value })} autoComplete="off" />
              </Field>
            </div>
          )}
          <div className="form-row form-row-postal">
            <Field label="Kod" error={errors.postalCode}>
              <input value={s.postalCode} onChange={(e) => set({ postalCode: formatPostalInput(e.target.value) })} inputMode="numeric" pattern="[0-9-]*" maxLength={6} placeholder="00-000" autoComplete="off" />
            </Field>
            <Field label="Miejscowość" error={errors.city}>
              <input value={s.city} onChange={(e) => set({ city: e.target.value })} onBlur={() => set({ city: normalizeCity(s.city) })} autoCapitalize="words" autoComplete="off" />
            </Field>
          </div>
          <MapsLinkField state={s} set={set} error={errors.mapsLink} />
          <Field label="Jak dotrzeć" hint="Np. wejście od podwórka, domofon nie działa, kod do bramy.">
            <textarea rows={2} value={s.access} onChange={(e) => set({ access: e.target.value })} />
          </Field>
        </div>
      );
    case 'problem':
      return (
        <div className="form">
          <MethodsField value={s.methods} onChange={(methods) => set({ methods })} error={errors.methods} />
          <Choice
            label="Szkodnik"
            value={s.pest}
            options={Object.entries(PESTS) as Array<[PestCategory, string]>}
            onChange={(pest) => set({ pest })}
          />
          {s.pest === 'inne' && (
            <Field label="Jaki szkodnik" error={errors.pestOther}>
              <input value={s.pestOther} onChange={(e) => set({ pestOther: e.target.value })} autoComplete="off" />
            </Field>
          )}
          <Field label="Krótki opis">
            <textarea rows={3} value={s.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="Metraż (m²)" error={errors.area}>
            <input value={s.area} onChange={(e) => set({ area: e.target.value })} inputMode="decimal" autoComplete="off" />
          </Field>
          <div className={s.pink ? 'pink-box active' : 'pink-box'}>
            <label className="check check-pink">
              <input type="checkbox" checked={s.pink} onChange={(e) => set({ pink: e.target.checked })} />
              Kod pink: trudny klient lub problematyczne mieszkanie
            </label>
            {s.pink && (
              <Field label="Co i jak?">
                <textarea rows={3} value={s.pinkNote} placeholder={PINK_PLACEHOLDER} autoFocus onChange={(e) => set({ pinkNote: e.target.value })} />
              </Field>
            )}
          </div>
        </div>
      );
    case 'termin':
      return (
        <div className="form">
          {s.city.trim() && (
            <Suggestions state={s} onPick={(sug) => set({ date: sug.date, time: sug.start.slice(11) })} />
          )}
          <div className="form-row">
            <Field label="Data" error={errors.date}>
              <input type="date" value={s.date} onChange={(e) => set({ date: e.target.value })} />
            </Field>
            <Field label="Godzina" error={errors.time}>
              <input type="time" step={900} value={s.time} onChange={(e) => set({ time: e.target.value })} />
            </Field>
          </div>
          <Field label="Przewidywany czas">
            <select value={s.duration} onChange={(e) => set({ duration: e.target.value })}>
              {[30, 45, 60, 90, 120, 180].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min` : `${m / 60} h`.replace('.5', ',5')}
                </option>
              ))}
            </select>
          </Field>
          <Choice label="Co pryskamy" value={s.scopeKind} options={SCOPE_KINDS} onChange={(scopeKind) => set({ scopeKind })} />
          {s.scopeKind !== 'calosc' && (
            <Field label={s.scopeKind === 'pokoj' ? 'Który pokój?' : 'Co dokładnie?'}>
              <input
                value={s.scopeNote}
                placeholder={s.scopeKind === 'pokoj' ? 'Np. sypialnia' : 'Np. kuchnia i łazienka, piwnica'}
                onChange={(e) => set({ scopeNote: e.target.value })}
                autoComplete="off"
              />
            </Field>
          )}
          <p className="field-hint">O kolejnym zabiegu zdecydujesz przy zakończeniu tego (albo „Umów kolejny zabieg” w zleceniu).</p>
        </div>
      );
    case 'cena':
      return (
        <div className="form">
          <div className="form-row">
            <Field label={s.invoice === 'vat' ? 'Od (netto, zł)' : 'Od (zł)'} error={errors.priceMin}>
              <input value={s.priceMin} onChange={(e) => set({ priceMin: e.target.value })} inputMode="decimal" autoComplete="off" />
            </Field>
            <Field label={s.invoice === 'vat' ? 'Do (netto, zł)' : 'Do (zł)'} error={errors.priceMax}>
              <input value={s.priceMax} onChange={(e) => set({ priceMax: e.target.value })} inputMode="decimal" autoComplete="off" />
            </Field>
          </div>
          <Choice
            label="Faktura"
            value={s.invoice}
            options={Object.entries(INVOICES) as Array<[InvoiceType, string]>}
            onChange={(invoice) => set({ invoice })}
          />
          <Choice
            label="Protokół z zabiegu"
            value={s.protocol ? 'tak' : 'nie'}
            options={[
              ['nie', 'Nie'],
              ['tak', 'Klient chce protokół'],
            ]}
            onChange={(v) => set({ protocol: v === 'tak' })}
          />
          {price && (
            <div className="price-box">
              <strong>{price.net}</strong>
              {price.gross && <span>{price.gross}</span>}
            </div>
          )}
        </div>
      );
    case 'telefon':
      return (
        <div className="form">
          <Field label="Telefon" error={errors.phone1} hint="Stały klient: aplikacja podpowie jego dane i adres.">
            <input type="tel" inputMode="tel" value={s.phone1} placeholder="500 600 700" onChange={(e) => set({ phone1: formatPhoneInput(e.target.value) })} autoComplete="off" />
          </Field>
          <ReturningClient
            phone={s.phone1}
            currentId={props.editId}
            withAddress={!props.editId}
            onFill={(o) => {
              const client = { clientName: o.clientName, email: o.email, nip: o.nip, invoiceName: o.invoiceName ?? '', invoiceAddress: o.invoiceAddress, pink: o.pink || s.pink, pinkNote: o.pinkNote || s.pinkNote };
              if (props.editId) {
                set(client);
                return;
              }
              const old = fromOrder(o);
              set({
                ...client,
                invoice: o.invoice,
                building: old.building,
                street: old.street,
                houseNo: old.houseNo,
                flatNo: old.flatNo,
                floor: old.floor,
                staircase: old.staircase,
                postalCode: old.postalCode,
                city: old.city,
                access: old.access,
                mapsLink: old.mapsLink,
              });
            }}
          />
        </div>
      );
    case 'klient':
      return (
        <div className="form">
          <Field label="Imię i nazwisko albo nazwa firmy" error={errors.clientName}>
            <input value={s.clientName} onChange={(e) => set({ clientName: e.target.value })} autoComplete="off" />
          </Field>
          <div className="form-row">
            <Field label="Drugi telefon">
              <input type="tel" inputMode="tel" value={s.phone2} placeholder="500 600 700" onChange={(e) => set({ phone2: formatPhoneInput(e.target.value) })} autoComplete="off" />
            </Field>
            <Field label="Dopisek" hint="Np. tata, tutaj dzwonić">
              <input value={s.phone2Label} onChange={(e) => set({ phone2Label: e.target.value })} autoComplete="off" />
            </Field>
          </div>
          <Field label={s.invoice === 'brak' ? 'E-mail' : 'E-mail (do faktury)'} error={errors.email}>
            <input type="email" inputMode="email" autoCapitalize="none" value={s.email} onChange={(e) => set({ email: e.target.value })} autoComplete="off" />
          </Field>
          {s.invoice === 'vat' && (
            <>
              <Field label="Nazwa firmy" error={errors.invoiceName}>
                <input value={s.invoiceName} placeholder="Np. Apt Production sp. z o.o." onChange={(e) => set({ invoiceName: e.target.value })} autoComplete="off" />
              </Field>
              <Field label="NIP" error={errors.nip}>
                <input inputMode="numeric" value={s.nip} onChange={(e) => set({ nip: e.target.value })} autoComplete="off" />
              </Field>
            </>
          )}
          {s.invoice !== 'brak' && (
            <Field label="Adres do faktury" hint="Puste: adres zlecenia.">
              <input value={s.invoiceAddress} onChange={(e) => set({ invoiceAddress: e.target.value })} autoComplete="off" />
            </Field>
          )}
        </div>
      );
    case 'podsumowanie': {
      const draft = toDraft(s);
      return (
        <Group>
          <Info label="Adres">{`${orderAddress(draft)}${draft.postalCode ? `, ${draft.postalCode}` : ''} (${BUILDINGS[draft.building].toLowerCase()})`}</Info>
          <Info label="Co robimy">{s.methods.map((m) => METHOD_LABEL[m]).join(', ')}</Info>
          <Info label="Szkodnik">{draft.pest === 'inne' ? draft.pestOther : PESTS[draft.pest]}</Info>
          <Info label="Termin">{formatTerm(`${s.date}T${s.time}`)}</Info>
          <Info label="Co pryskamy">{scopeText(formTerms(s).scope)}</Info>
          {price && <Info label="Widełki">{price.gross ? `${price.net}\n${price.gross}` : price.net}</Info>}
          <Info label="Faktura">{INVOICES[draft.invoice]}</Info>
          {draft.invoice === 'vat' && <Info label="Do faktury">{`${draft.invoiceName}\nNIP ${draft.nip}`}</Info>}
          <Info label="Protokół">{s.protocol ? 'Tak' : 'Nie'}</Info>
          <Info label="Klient">{`${draft.clientName}\n${draft.phones.map((p) => (p.label ? `${p.number} (${p.label})` : p.number)).join('\n')}`}</Info>
          {draft.pink && <Info label="Kod pink">{draft.pinkNote || 'Tak'}</Info>}
        </Group>
      );
    }
  }
}

export function OrderNewPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { confirm, run, toast } = useFeedback();
  const settings = useLiveQuery(() => getAppSettings());
  // Kliknięcie w kalendarzu przekazuje dzień i godzinę nowego zlecenia.
  const [state, setState] = useState<FormState>(() => {
    const draft = loadDraft();
    const date = params.get('data');
    return date && isValidDate(date) ? { ...draft, date, time: params.get('czas') ?? draft.time } : draft;
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const steps: StepId[] = [...ALL_STEPS, 'podsumowanie'];
  const step = steps[stepIndex];
  const hasDraft = useMemo(() => JSON.stringify(state) !== JSON.stringify(EMPTY), [state]);

  const set = (patch: Partial<FormState>) =>
    setState((prev) => {
      const next = { ...prev, ...patch };
      saveDraft(next);
      return next;
    });

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stepIndex]);

  /** Pyta o puste pola. true: przejść dalej bez nich; false: zostać i uzupełnić (pola zostają zaznaczone). */
  const askMissing = async (list: Array<[keyof FormState, string]>, goLabel: string): Promise<boolean> => {
    if (list.length === 0) return true;
    const ok = await confirm({
      title: 'Na pewno nie chcesz uzupełnić?',
      message: `Puste: ${list.map(([, label]) => label).join(', ')}. Możesz to dodać później w edycji zlecenia.`,
      confirmLabel: goLabel,
      cancelLabel: 'Uzupełnię',
    });
    if (!ok) setErrors(Object.fromEntries(list.map(([key, label]) => [key, `Uzupełnij: ${label}`])) as Errors);
    return ok;
  };

  const go = async (delta: number) => {
    if (delta > 0) {
      const found = validate(step, state);
      setErrors(found);
      if (Object.keys(found).length) {
        toast('Uzupełnij zaznaczone pola', { tone: 'error' });
        return;
      }
      if (!(await askMissing(missing(step, state), 'Dalej bez tego'))) return;
      setErrors({});
    }
    setStepIndex((i) => Math.min(steps.length - 1, Math.max(0, i + delta)));
  };

  /** Zapis od razu, z pominięciem pozostałych kroków: błędy blokują, o puste pola tylko pyta. */
  const saveNow = async () => {
    const found = Object.assign({}, ...ALL_STEPS.map((st) => validate(st, state))) as Errors;
    setErrors(found);
    if (Object.keys(found).length) {
      toast('Popraw zaznaczone pola', { tone: 'error' });
      setStepIndex(Math.max(0, ALL_STEPS.findIndex((st) => Object.keys(validate(st, state)).length > 0)));
      return;
    }
    if (!(await askMissing(ALL_STEPS.flatMap((st) => missing(st, state)), 'Zapisz bez tego'))) return;
    await save();
  };

  const save = () =>
    run(async () => {
      const duration = Number(state.duration) || 60;
      const { order } = await createOrder(
        toDraft(state),
        { start: state.date ? `${state.date}T${state.time}` : null, durationMin: duration, terms: formTerms(state) },
        null,
      );
      saveDraft(null);
      toast(`Zapisano zlecenie ${orderCode(order)}`);
      // Karta nowego zlecenia od razu proponuje dodanie terminu do Kalendarza Google.
      navigate(`/zlecenia/${order.id}?nowe=1`, { replace: true });
    });

  if (!settings) return <Loading />;

  return (
    <Page title="Nowe zlecenie" back="/zlecenia">
      <div className="wizard-progress" aria-label={`Krok ${stepIndex + 1} z ${steps.length}`}>
        {steps.map((s, i) => (
          <span key={s} className={i <= stepIndex ? 'done' : ''} />
        ))}
      </div>
      <h2 className="wizard-title">
        {stepIndex + 1}. {STEP_TITLES[step]}
      </h2>
      <Steps state={state} set={set} step={step} errors={errors} vatRate={settings.vatRate} />
      <div className="wizard-nav">
        {stepIndex > 0 && (
          <button type="button" className="btn" onClick={() => void go(-1)}>
            Wstecz
          </button>
        )}
        {step === 'podsumowanie' ? (
          <button type="button" className="btn btn-primary" onClick={() => void saveNow()}>
            <Icon name="check" /> Zapisz zlecenie
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void go(1)}>
            Dalej
          </button>
        )}
      </div>
      {hasDraft && stepIndex === 0 && (
        <button
          type="button"
          className="link"
          onClick={() => {
            saveDraft(null);
            setState(EMPTY);
          }}
        >
          Wyczyść szkic i zacznij od nowa
        </button>
      )}
    </Page>
  );
}

export function OrderEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { confirm, run, toast } = useFeedback();
  const loaded = useLiveQuery(async () => {
    const order = await orders.get(id);
    return order && !order.deletedAt ? { order, settings: await getAppSettings() } : null;
  }, [id]);
  const [state, setState] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const editKey = `ddd-edycja-zlecenia-${id}`;

  // Niezapisane zmiany są w pamięci przeglądarki: przejście do Google Maps albo zamknięcie aplikacji ich nie gubi.
  useEffect(() => {
    if (!loaded || state) return;
    let restored: FormState | null = null;
    try {
      const raw = localStorage.getItem(editKey);
      restored = raw ? { ...fromOrder(loaded.order), ...(JSON.parse(raw) as Partial<FormState>) } : null;
    } catch {
      restored = null;
    }
    setState(restored ?? fromOrder(loaded.order));
    if (restored) toast('Przywrócono niezapisane zmiany');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, state]);

  if (loaded === undefined || (loaded && !state)) return <Loading />;
  if (loaded === null || !state) return <NotFound back="/zlecenia" />;

  const set = (patch: Partial<FormState>) =>
    setState((prev) => {
      const next = { ...prev!, ...patch };
      try {
        localStorage.setItem(editKey, JSON.stringify(next));
      } catch {
        // Bez pamięci przeglądarki zmiany trzeba zapisać przed wyjściem.
      }
      return next;
    });
  const sections: StepId[] = ['telefon', 'adres', 'problem', 'cena', 'klient'];

  const save = async () => {
    const found = Object.assign({}, ...sections.map((step) => validate(step, state))) as Errors;
    setErrors(found);
    if (Object.keys(found).length) {
      toast('Popraw zaznaczone pola', { tone: 'error' });
      return;
    }
    const empty = sections.flatMap((step) => missing(step, state));
    if (empty.length) {
      const ok = await confirm({
        title: 'Na pewno nie chcesz uzupełnić?',
        message: `Puste: ${empty.map(([, label]) => label).join(', ')}.`,
        confirmLabel: 'Zapisz bez tego',
        cancelLabel: 'Uzupełnię',
      });
      if (!ok) {
        setErrors(Object.fromEntries(empty.map(([key, label]) => [key, `Uzupełnij: ${label}`])) as Errors);
        return;
      }
    }
    void run(async () => {
      const draft = toDraft(state);
      const before = loaded.order;
      await orders.update(id, draft);
      // Zmiana widełek zlecenia przechodzi na zabiegi do zrobienia, które miały dotychczasowe widełki.
      if (draft.priceMin !== before.priceMin || draft.priceMax !== before.priceMax) {
        for (const v of await visits.where('orderId', id)) {
          const same = (v.priceMin ?? null) === before.priceMin && (v.priceMax ?? null) === before.priceMax;
          if (v.status === 'zaplanowany' && same) await visits.update(v.id, { priceMin: draft.priceMin, priceMax: draft.priceMax });
        }
      }
      try {
        localStorage.removeItem(editKey);
      } catch {
        // nic
      }
      toast('Zapisano zmiany');
      navigate(`/zlecenia/${id}`, { replace: true });
    });
  };

  return (
    <Page title={`Edycja ${orderCode(loaded.order)}`} back={`/zlecenia/${id}`}>
      {sections.map((step) => (
        <section key={step} className="edit-section">
          <h2 className="wizard-title">{STEP_TITLES[step]}</h2>
          <Steps state={state} set={set} step={step} errors={errors} vatRate={loaded.settings.vatRate} editId={id} />
        </section>
      ))}
      <button type="button" className="btn btn-primary btn-block" onClick={() => void save()}>
        Zapisz zmiany
      </button>
    </Page>
  );
}
