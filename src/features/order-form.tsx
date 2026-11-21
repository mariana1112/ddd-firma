import { orderCode, visitCode } from '../data/codes';
import { isSyncConfigured } from '../data/sync/config';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { addressAt, currentPosition, freeSlots, locate, locatePlace, placeLabel, pointMapsLink, previousVisitDay, suggestSlots, type DayStop, type LatLng, type Suggestion } from '../data/geo';
import { newPlacesSession, pickAddress, placesKey, suggestAddresses, type AddressSuggestion } from '../data/places';
import { NextDates } from './next-dates';
import { dayOff, eventBusy, listEvents } from '../data/events';
import { createOrder, orderVisits, type OrderDraft } from '../data/orders';
import { orders, visits } from '../data/repo';
import { getAppSettings, getCompany, getProfile, getVehicle } from '../data/settings';
import { BUILDINGS, INVOICES, PESTS, orderAddress, priceRange, PINK_PLACEHOLDER } from '../data/texts';
import type { BuildingType, InvoiceType, Order, PestCategory, ScopeKind, TreatmentMethod, Visit } from '../data/types';
import { METHOD_LABEL, METHODS, orderMethods } from '../data/methods';
import { normalizeCity } from '../data/cities';
import { SCOPE_KINDS, scopeText, visitPrice, type VisitTerms } from '../data/visit-terms';
import { coordsFromLink, isIos, isMapsLink, mapsQuery, mapsSearchUrl, readMapsInput, isShortMapsLink } from '../data/maps';
import { addDays, addMinutes, formatDateLong, formatTerm, isValidDate, todayWarsaw, nowWarsaw } from '../lib/dates';
import { moneyToInput, parseMoney } from '../lib/money';
import { formatPhoneInput, formatPostalInput, isValidNip, phoneError } from '../lib/validators';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Field, Group, Info, Loading, NotFound, Page, PasteButton, Sheet, goBack, TimeSelect } from '../ui/kit';

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
  /** Klient poda adres później: zlecenie zapisuje się bez adresu, a aplikacja przypomina o uzupełnieniu. */
  addressLater: boolean;
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
  phone1Label: string;
  phone2: string;
  phone2Label: string;
  pink: boolean;
  pinkNote: string;
  /** Link do miejsca z Google Maps (opcjonalny), żeby nawigacja trafiała dokładnie. */
  mapsLink: string;
  /** Co robimy: wymagane przy tworzeniu, od tego zależą zalecenia. */
  methods: TreatmentMethod[];
  /** Metody zaznaczone automatycznie przy wyborze pluskiew (odznaczane, gdy wybierzesz inny szkodnik). */
  autoMethods?: TreatmentMethod[];
  methodOther: string;
  /** Klient chce protokół z zabiegu. */
  protocol: boolean;
  /** Nazwa firmy do faktury VAT. */
  invoiceName: string;
}

const EMPTY: FormState = {
  addressLater: false,
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
  phone1Label: '',
  phone2: '',
  phone2Label: '',
  pink: false,
  pinkNote: '',
  mapsLink: '',
  methods: [],
  methodOther: '',
  protocol: false,
  invoiceName: '',
};

const DRAFT_KEY = 'ddd-szkic-zlecenia';

/**
 * Domyślny termin nowego zlecenia: dziś, najbliższa pełna godzina (najwcześniej 8:00). Wieczorem (od 19:00) jutro 10:00.
 */
function freshStart(): { date: string; time: string } {
  const hour = Number(nowWarsaw().slice(11, 13)) + 1;
  if (hour >= 19) return { date: addDays(todayWarsaw(), 1), time: '10:00' };
  return { date: todayWarsaw(), time: `${String(Math.max(8, hour)).padStart(2, '0')}:00` };
}

/** Pusty formularz (bez względu na proponowany termin): nic jeszcze nie wpisano. */
function isBlank(state: FormState): boolean {
  return JSON.stringify({ ...state, date: '', time: '' }) === JSON.stringify({ ...EMPTY, date: '', time: '' });
}

function loadDraft(): FormState {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const draft = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<FormState>) } : EMPTY;
    return draft.date && !isBlank(draft) ? draft : { ...draft, ...freshStart() };
  } catch {
    return { ...EMPTY, ...freshStart() };
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
    // Zlecenie bez adresu: w edycji zaznaczone „Klient poda adres później”, żeby dało się zapisać inne zmiany.
    addressLater: !order.street.trim() || !order.city.trim(),
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
    phone1Label: order.phones[0]?.label ?? '',
    phone2: order.phones[1]?.number ?? '',
    phone2Label: order.phones[1]?.label ?? '',
    pink: order.pink,
    pinkNote: order.pinkNote,
    mapsLink: order.mapsLink ?? '',
    methods: orderMethods(order),
    methodOther: order.methodOther ?? '',
    protocol: order.protocol ?? false,
    invoiceName: order.invoiceName ?? '',
  };
}

function toDraft(s: FormState): OrderDraft {
  // Numery zawsze z kierunkowym +48.
  const phones = s.phone1.trim() ? [{ number: formatPhoneInput(s.phone1), label: s.phone1Label.trim() }] : [];
  if (s.phone2.trim()) phones.push({ number: formatPhoneInput(s.phone2), label: s.phone2Label.trim() });
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
    methodOther: s.methods.includes('inne') ? s.methodOther.trim() : '',
    protocol: s.protocol,
  };
}

type StepId = 'telefon' | 'adres' | 'problem' | 'termin' | 'cena' | 'podsumowanie';

const STEP_TITLES: Record<StepId, string> = {
  telefon: 'Telefon klienta',
  adres: 'Adres',
  problem: 'Co robimy i szkodnik',
  termin: 'Termin',
  cena: 'Cena i faktura',
  podsumowanie: 'Podsumowanie',
};

type Errors = Partial<Record<keyof FormState, string>>;

/**
 * Puste pola nieobowiązkowe, o które warto zapytać: aplikacja pyta, czy na pewno ich nie uzupełnić.
 * Data, telefon, adres, widełki i „Co robimy” są obowiązkowe (validate).
 */
function missing(step: StepId, s: FormState): Array<[keyof FormState, string]> {
  const m: Array<[keyof FormState, string]> = [];
  if (step === 'adres' && !s.addressLater && s.building === 'blok' && !s.flatNo.trim()) m.push(['flatNo', 'numer lokalu']);
  return m;
}

// Telefon na początku: stały klient od razu podpowiada swoje dane i adres.
const ALL_STEPS: StepId[] = ['telefon', 'adres', 'problem', 'termin', 'cena'];

/** Klient chce fakturę albo protokół: wtedy potrzebne są e-mail i dane klienta. */
const needsDocuments = (s: Pick<FormState, 'invoice' | 'protocol'>) => s.invoice !== 'brak' || s.protocol;

/**
 * Błędy, które blokują zapis: puste pola obowiązkowe (adres, co robimy, data, widełki, telefon) i błędnie wpisane
 * wartości, które trafiłyby do zlecenia z błędem (np. kod 00-00).
 */
function validate(step: StepId, s: FormState): Errors {
  const e: Errors = {};
  if (step === 'adres' && !s.addressLater) {
    if (!s.street.trim()) e.street = 'Podaj ulicę';
    if (!s.houseNo.trim()) e.houseNo = 'Podaj numer';
    if (!s.city.trim()) e.city = 'Podaj miejscowość';
  }
  if (step === 'adres') {
    if (s.postalCode.trim() && !/^\d{2}-\d{3}$/.test(s.postalCode.trim())) e.postalCode = 'Kod w formacie 00-000';
    if (s.mapsLink.trim() && !isMapsLink(s.mapsLink)) e.mapsLink = 'Wklej link z Google Maps (Udostępnij → Kopiuj link)';
  }
  if (step === 'problem') {
    if (s.methods.includes('inne') && !s.methodOther.trim()) e.methodOther = 'Wpisz, jaka metoda';
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
    else e.phone1 = phoneError(s.phone1);
    if (!e.phone1) delete e.phone1;
    const second = phoneError(s.phone2);
    if (second) e.phone2 = second;
  }
  if (step === 'cena' && needsDocuments(s)) {
    // E-mail oraz imię i nazwisko (albo firma) są wymagane tylko przy fakturze albo protokole.
    if (s.email.trim() && !/^\S+@\S+\.\S+$/.test(s.email.trim())) e.email = 'Adres e-mail jest niepoprawny';
    else if (!s.email.trim()) e.email = s.invoice !== 'brak' ? 'Do faktury potrzebny jest e-mail' : 'Do protokołu potrzebny jest e-mail';
    if (s.invoice === 'brak' && s.protocol && !s.clientName.trim()) e.clientName = 'Do protokołu podaj imię i nazwisko';
    if (s.invoice === 'vat') {
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
  const { run } = useFeedback();
  const [filling, setFilling] = useState(false);
  /**
   * Wklejony link (albo tekst z Google Maps) uzupełnia adres jak „Jestem na miejscu”: z adresu w tekście lub w linku,
   * a gdy link ma tylko współrzędne, z mapy. Zapisany zostaje sam link.
   */
  const applyInput = (input: string) =>
    run(async () => {
      const raw = input.trim();
      if (!raw) return;
      let { url, address, coords } = readMapsInput(raw);
      // Skrócony link bez adresu obok: serwer rozwija go do pełnego linku z adresem albo współrzędnymi.
      if (url && !address && !coords && isShortMapsLink(url) && isSyncConfigured) {
        setFilling(true);
        try {
          const full = await (await import('../data/sync/supabase')).resolveMapsLink(url);
          if (full) {
            ({ address, coords } = readMapsInput(full));
            url = full;
          }
        } finally {
          setFilling(false);
        }
      }
      // Zapisujemy tylko link; sam wklejony adres (bez linku) nie zostaje w polu linku.
      props.set({ mapsLink: url || (readMapsInput(raw).address ? '' : raw) });
      const fill = (a: { street: string; houseNo: string; flatNo?: string; postalCode: string; city: string }) => {
        props.set({
          // Nowa ulica przynosi swój numer i lokal (także puste), żeby nie zostały numery poprzedniego adresu.
          ...(a.street ? { street: a.street, houseNo: a.houseNo, flatNo: a.flatNo ?? '' } : {}),
          ...(a.flatNo ? { building: 'blok' as BuildingType } : {}),
          ...(a.postalCode ? { postalCode: a.postalCode } : {}),
          ...(a.city ? { city: normalizeCity(a.city) } : {}),
        });
        toast(`Adres z linku: ${[[a.street, a.houseNo].filter(Boolean).join(' '), a.city].filter(Boolean).join(', ')}. Sprawdź numer lokalu.`);
      };
      if (address) {
        fill(address);
        return;
      }
      if (coords) {
        setFilling(true);
        try {
          const found = await addressAt(coords);
          if (found.street || found.city) fill(found);
          else toast('Zapisano miejsce z linku. Adresu nie udało się odczytać: wpisz go ręcznie.');
        } finally {
          setFilling(false);
        }
        return;
      }
      if (url && isShortMapsLink(url)) {
        toast(navigator.onLine === false ? 'Zapisano link. Bez internetu adres z linku uzupełni się później: wpisz go albo wklej link ponownie.' : 'Zapisano link. Nie udało się odczytać z niego adresu: w Google Maps dotknij adresu, wybierz „Kopiuj” i wklej go tutaj, albo wpisz adres.');
      }
    });
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) await applyInput(text);
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
        placeholder="https://maps.app.goo.gl/… albo adres z Google Maps"
        inputMode="url"
        autoComplete="off"
        onChange={(e) => props.set({ mapsLink: e.target.value })}
        onPaste={(e) => {
          // Wklejenie w pole od razu uzupełnia adres (tekst z Google Maps może mieć adres i link razem).
          const text = e.clipboardData.getData('text');
          if (!text.trim()) return;
          e.preventDefault();
          void applyInput(text);
        }}
        onBlur={(e) => {
          const value = e.target.value.trim();
          if (value && !props.state.street.trim()) void applyInput(value);
        }}
        aria-label="Link do miejsca z Google Maps"
      />
      {filling && <span className="field-hint">Odczytuję adres z linku…</span>}
      {props.error ? (
        <span className="field-message">{props.error}</span>
      ) : (
        <span className="field-hint">
          {props.state.mapsLink.trim()
            ? coords
              ? `Zapisane miejsce: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}. Nawigacja poprowadzi dokładnie tutaj.`
              : 'Zapisany link do miejsca. Nawigacja Google otworzy dokładnie to miejsce.'
            : 'Wklej link albo adres z Google Maps: ulica, numer, kod i miejscowość uzupełnią się same. Dane formularza zostają zapisane.'}
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
  const { city, postalCode, duration, street, mapsLink } = props.state;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Chwila po wpisaniu adresu, żeby nie pytać map o każdą literę ulicy.
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (cancelled) return;
      const target = await locatePlace({ street, city, postalCode, mapsLink });
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
        planned.push({ order, visit, point: await locatePlace(order) });
      }
      const events = await listEvents();
      const me = (await getProfile()).userId;
      const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      const len = Number(duration) || 60;
      const free = suggestSlots(target, len, todayWarsaw(), planned).filter((s) => {
        if (dayOff(events, s.date, me)) return false;
        const a = toMin(s.start.slice(11, 16));
        return !eventBusy(events, s.date, me).some((b) => {
          const b0 = toMin(b.start.slice(11, 16));
          return a < b0 + b.durationMin && a + len > b0;
        });
      });
      if (!cancelled) setResult(free);
    })();
    return () => {
      cancelled = true;
    };
  }, [city, postalCode, duration, street, mapsLink]);

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
            {s.distanceKm < 1 ? 'mniej niż 1 km' : `${Math.round(s.distanceKm)} km`} od {orderCode(s.near.order)} ({placeLabel(s.near.order)}), dojazd ok. {s.travelMin} min
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Plan wybranego dnia przy umawianiu: zabiegi po kolei (trasa) z nowym zleceniem w miejscu wybranej godziny
 * i wolne godziny z uwzględnieniem dojazdu. Bez internetu dojazd liczy się jako 30 minut.
 */
function DayPlan(props: { state: FormState; onPick: (time: string) => void }) {
  const { date, time, duration, city, postalCode, street, mapsLink } = props.state;
  const [plan, setPlan] = useState<{ stops: DayStop[]; slots: string[]; off: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const byId = new Map((await orders.all()).map((o) => [o.id, o]));
      const dayVisits = (await visits.all()).filter((v) => (v.status === 'zaplanowany' || v.status === 'w_trakcie') && v.start?.slice(0, 10) === date);
      const online = typeof navigator === 'undefined' || navigator.onLine;
      const stops: DayStop[] = [];
      for (const v of dayVisits) {
        const order = byId.get(v.orderId);
        if (!order) continue;
        stops.push({
          start: v.start!,
          durationMin: v.durationMin || 60,
          label: visitCode(order, v.seq),
          city: placeLabel(order),
          point: online ? await locatePlace(order) : null,
        });
      }
      // Moje wydarzenia: wolne/urlop blokuje dzień, wydarzenie z godzinami (np. serwis) zajmuje te godziny.
      const events = await listEvents();
      const me = (await getProfile()).userId;
      const off = dayOff(events, date, me);
      for (const b of eventBusy(events, date, me)) stops.push({ ...b, city: '', point: null });
      const target = online && city.trim() ? await locatePlace({ street, city, postalCode, mapsLink }) : null;
      const now = nowWarsaw();
      const nowMin = date === now.slice(0, 10) ? Number(now.slice(11, 13)) * 60 + Number(now.slice(14, 16)) : undefined;
      if (!cancelled)
        setPlan({
          stops: stops.sort((a, b) => a.start.localeCompare(b.start)),
          slots: off ? [] : freeSlots(stops, target, Number(duration) || 60, { nowMin }),
          off: off ? off.name : null,
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [date, duration, city, postalCode, street, mapsLink]);
  if (!plan) return null;
  // Kolizja: wybrana godzina nachodzi na inny zabieg tego dnia (bez liczenia dojazdu).
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const clash = plan.stops.find((st) => {
    const a0 = toMin(st.start.slice(11, 16));
    const b0 = toMin(time);
    return b0 < a0 + st.durationMin && b0 + (Number(duration) || 60) > a0;
  });
  // Trasa z nowym zleceniem wstawionym według wybranej godziny.
  const route = [...plan.stops.map((s) => ({ time: s.start.slice(11, 16), text: s.city ? `${s.city} · ${s.label}` : s.label, fresh: false })), { time, text: `${placeLabel({ city, street }) || 'nowe zlecenie'} · nowe`, fresh: true }].sort((a, b) => a.time.localeCompare(b.time));
  return (
    <div className="day-plan">
      <span className="field-label">Trasa w dniu {formatDateLong(date)}</span>
      {plan.stops.length === 0 ? (
        plan.off ? null : <p className="field-hint">Brak innych zabiegów tego dnia: cały dzień wolny.</p>
      ) : (
        <ol className="day-plan-route">
          {route.map((r, i) => (
            <li key={i} className={r.fresh ? 'fresh' : undefined}>
              <strong>{r.time}</strong> {r.text}
            </li>
          ))}
        </ol>
      )}
      {clash && (
        <p className="notice notice-warn">
          <Icon name="alert" />
          <span>
            O {time} trwa już {clash.label}{clash.city ? ` (${clash.city})` : ''}. Wybierz wolną godzinę poniżej.
          </span>
        </p>
      )}
      {plan.off && (
        <p className="notice notice-warn">
          <Icon name="alert" />
          <span>
            Tego dnia masz w kalendarzu „{plan.off}”. Wybierz inny dzień.
          </span>
        </p>
      )}
      {plan.off ? null : plan.slots.length > 0 ? (
        <div className="chips chips-wrap">
          <span className="chips-label">Wolne godziny:</span>
          {plan.slots.map((t) => (
            <button key={t} type="button" className={t === time ? 'chip active' : 'chip'} onClick={() => props.onPick(t)}>
              {t}
            </button>
          ))}
        </div>
      ) : (
        <p className="field-hint">Tego dnia nie ma już wolnego okna na {duration} min (z dojazdem). Wybierz inny dzień.</p>
      )}
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

/**
 * „Jestem na miejscu”: adres z aktualnej pozycji telefonu (GPS + mapa OpenStreetMap) i dokładny punkt Google Maps
 * do nawigacji. Numer lokalu, klatkę i piętro technik dopisuje sam.
 */
/**
 * „Szukaj adresu”: podpowiedzi z Google Maps podczas pisania (od 3 znaków, 1 s po przerwie w pisaniu), najpierw w okolicy
 * bazy. Wybór wpisuje ulicę, numer, kod, miejscowość i dokładny punkt (link do mapy, gdy pusty). Klucz z ustawień
 * albo wbudowany w aplikację.
 */
function AddressSearch(props: { state: FormState; set: (patch: Partial<FormState>) => void }) {
  const setup = useLiveQuery(async () => {
    const key = placesKey((await getCompany()).googlePlacesKey);
    const base = key ? await locate((await getVehicle()).base, '').catch(() => null) : null;
    return { key, near: base as LatLng | null };
  });
  const [text, setText] = useState('');
  const [list, setList] = useState<AddressSuggestion[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const session = useRef<string | null>(null);
  useEffect(() => {
    if (!setup?.key || text.trim().length < 3) {
      setList([]);
      return;
    }
    const abort = new AbortController();
    // Pytamy Google dopiero po chwili przerwy w pisaniu (mniej zapytań).
    const timer = setTimeout(() => {
      session.current ??= newPlacesSession();
      suggestAddresses({ key: setup.key, input: text, session: session.current, near: setup.near, signal: abort.signal })
        .then((found) => {
          setList(found);
          setError('');
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== 'AbortError') setError((e as Error).message);
        });
    }, 1000);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
    // Tylko tekst, klucz i współrzędne (liczby): zapis czegokolwiek innego w aplikacji nie wysyła nowego zapytania.
  }, [text, setup?.key, setup?.near?.lat, setup?.near?.lng]);
  if (!setup?.key) return null;

  const choose = async (s: AddressSuggestion) => {
    setBusy(true);
    try {
      const a = await pickAddress({ key: setup.key, placeId: s.placeId, session: session.current ?? newPlacesSession() });
      props.set({
        street: a.street,
        houseNo: a.houseNo,
        ...(a.flatNo ? { flatNo: a.flatNo } : {}),
        postalCode: a.postalCode,
        city: normalizeCity(a.city),
        // Dokładny punkt: nawigacja i propozycje terminów liczą od domu klienta. Własny link zostaje.
        ...(a.point && !props.state.mapsLink.trim() ? { mapsLink: pointMapsLink(a.point) } : {}),
      });
      setText('');
      setList([]);
      setError(a.street || a.city ? '' : 'Google nie podał adresu tego miejsca. Uzupełnij pola ręcznie.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      // Po wyborze zaczyna się nowa sesja (kolejny adres).
      session.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="field address-search">
      <span className="field-label">Szukaj adresu</span>
      <div className="address-search-box">
        <Icon name="search" size={18} />
        <input
          type="search"
          value={text}
          placeholder="Np. Świętego Jana 5 Gdańsk"
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {list.length > 0 && (
        <ul className="address-suggestions" role="listbox" aria-label="Podpowiedzi adresu">
          {list.map((s) => (
            <li key={s.placeId}>
              <button type="button" disabled={busy} onClick={() => void choose(s)}>
                <Icon name="pin" size={16} />
                <span>
                  <strong>{s.main}</strong>
                  {s.secondary && <small>{s.secondary}</small>}
                </span>
              </button>
            </li>
          ))}
          <li className="address-attribution">Podpowiedzi: Google Maps</li>
        </ul>
      )}
      {error && <span className="field-message">{error}</span>}
    </div>
  );
}

function HerePosition(props: { set: (patch: Partial<FormState>) => void }) {
  const { run, toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const use = () =>
    run(async () => {
      setBusy(true);
      try {
        const pos = await currentPosition();
        const found = await addressAt(pos);
        props.set({
          ...(found.street ? { street: found.street } : {}),
          ...(found.houseNo ? { houseNo: found.houseNo } : {}),
          ...(found.postalCode ? { postalCode: found.postalCode } : {}),
          ...(found.city ? { city: normalizeCity(found.city) } : {}),
          mapsLink: found.mapsLink,
        });
        const rough = pos.accuracy > 60 ? ` Dokładność tylko ok. ${Math.round(pos.accuracy)} m: sprawdź ulicę i numer.` : '';
        toast(
          found.street
            ? `Adres z pozycji: ${[found.street, found.houseNo].filter(Boolean).join(' ')}, ${found.city}.${rough}`
            : 'Zapisano punkt na mapie. Adresu nie udało się odczytać: wpisz go ręcznie.',
        );
      } finally {
        setBusy(false);
      }
    });
  return (
    <button type="button" className="btn btn-block" disabled={busy} onClick={() => void use()}>
      <Icon name="pin" /> {busy ? 'Ustalam pozycję…' : 'Jestem na miejscu: użyj mojej pozycji'}
    </button>
  );
}

/**
 * Krok 1: telefon klienta. Duże pole numeru z „Wklej” (bez podpowiedzi przeglądarki z własnym numerem), opcjonalnie
 * do kogo ten numer. Drugi telefon dopiero po dotknięciu „+ Drugi telefon”. Stały klient: od razu jego dane i adres.
 */
function PhoneStep(props: { state: FormState; set: (patch: Partial<FormState>) => void; errors: Errors; editId?: string }) {
  const { state: s, set, errors } = props;
  const [second, setSecond] = useState(Boolean(s.phone2.trim()));
  return (
    <div className="form">
      <Field
        label="Telefon klienta"
        error={errors.phone1}
        hint="Stały klient: aplikacja sama podpowie jego dane i adres."
        action={<PasteButton onPaste={(t) => set({ phone1: formatPhoneInput(t) })} />}
      >
        <input
          type="text"
          inputMode="tel"
          name="ddd-numer-klienta"
          autoComplete="off"
          value={s.phone1}
          placeholder="500 600 700"
          onChange={(e) => set({ phone1: formatPhoneInput(e.target.value) })}
        />
      </Field>
      <Field label="Do kogo? (opcjonalnie)">
        <input name="ddd-do-kogo" autoComplete="off" value={s.phone1Label} placeholder="Np. pani Anna" onChange={(e) => set({ phone1Label: e.target.value })} />
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
      {second ? (
        <>
          <Field label="Drugi telefon" error={errors.phone2} action={<PasteButton onPaste={(t) => set({ phone2: formatPhoneInput(t) })} />}>
            <input
              type="text"
              inputMode="tel"
              name="ddd-drugi-numer"
              autoComplete="off"
              value={s.phone2}
              placeholder="500 600 700"
              onChange={(e) => set({ phone2: formatPhoneInput(e.target.value) })}
            />
          </Field>
          <Field label="Do kogo drugi numer? (opcjonalnie)">
            <input name="ddd-do-kogo-2" autoComplete="off" value={s.phone2Label} placeholder="Np. tata" onChange={(e) => set({ phone2Label: e.target.value })} />
          </Field>
          <button
            type="button"
            className="link link-danger"
            onClick={() => {
              set({ phone2: '', phone2Label: '' });
              setSecond(false);
            }}
          >
            Usuń drugi telefon
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-block btn-dashed" onClick={() => setSecond(true)}>
          <Icon name="plus" /> Drugi telefon (np. do kogoś z rodziny)
        </button>
      )}
    </div>
  );
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
          {/* Termin rezerwujemy od razu, a adres klient poda później: zlecenie czeka w „Pilnych”. */}
          <label className={s.addressLater ? 'check check-later active' : 'check check-later'}>
            <input type="checkbox" checked={s.addressLater} onChange={(e) => set({ addressLater: e.target.checked })} />
            <span>
              <strong>Klient poda adres później</strong>
              <span className="field-hint">Zlecenie zapisze się bez adresu i będzie w „Pilnych”, dopóki go nie uzupełnisz.</span>
            </span>
          </label>
          <AddressSearch state={s} set={set} />
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
          <Field label="Jak dotrzeć" hint="Np. wejście od podwórka, domofon nie działa, kod do bramy.">
            <textarea rows={2} value={s.access} onChange={(e) => set({ access: e.target.value })} />
          </Field>
          {/* Rzadziej potrzebne: adres z pozycji telefonu i link do miejsca w Google Maps (zwinięte; rozwija się przy błędzie linku). */}
          <details className="more-actions address-more" open={Boolean(errors.mapsLink) || undefined}>
            <summary>Więcej</summary>
            <div className="address-more-body">
              <HerePosition set={set} />
              <MapsLinkField state={s} set={set} error={errors.mapsLink} />
            </div>
          </details>
        </div>
      );
    case 'problem':
      return (
        <div className="form">
          <MethodsField value={s.methods} onChange={(methods) => set({ methods })} error={errors.methods} />
          {s.methods.includes('inne') && (
            <Field label="Jaka metoda?" error={errors.methodOther} hint="Bez pakietu zaleceń: zalecenia wybierzesz przy zakończeniu zabiegu.">
              <input value={s.methodOther} placeholder="Np. dezynfekcja, opylanie" onChange={(e) => set({ methodOther: e.target.value })} />
            </Field>
          )}
          <Choice
            label="Szkodnik"
            value={s.pest}
            options={Object.entries(PESTS) as Array<[PestCategory, string]>}
            onChange={(pest) => {
              // Pluskwy: od razu oprysk ciśnieniowy, ULV i parowanie (zwykły zestaw); można odznaczyć.
              if (pest === 'pluskwy') {
                const auto = (['oprysk', 'ulv', 'parowanie'] as TreatmentMethod[]).filter((m) => !s.methods.includes(m));
                set({ pest, methods: [...s.methods, ...auto], autoMethods: auto });
              } else {
                // Inny szkodnik zamiast pluskiew: zdejmujemy to, co zaznaczyło się samo (to, co zaznaczone ręcznie, zostaje).
                const auto = s.autoMethods ?? [];
                set({ pest, methods: s.methods.filter((m) => !auto.includes(m)), autoMethods: [] });
              }
            }}
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
              <TimeSelect value={s.time} onChange={(time) => set({ time })} />
            </Field>
          </div>
          {s.date && isValidDate(s.date) && <DayPlan state={s} onPick={(time) => set({ time })} />}
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
          {/* Dane klienta tylko do faktury albo protokołu: rozwijają się tutaj po wyborze, bez osobnego kroku. */}
          {needsDocuments(s) && (
            <div className="docs-box">
              <span className="docs-box-title">{s.invoice !== 'brak' ? (s.protocol ? 'Dane do faktury i protokołu' : 'Dane do faktury') : 'Dane do protokołu'}</span>
              {s.invoice === 'vat' ? (
                <>
                  <Field label="Nazwa firmy (opcjonalnie)" error={errors.invoiceName} action={<PasteButton onPaste={(t) => set({ invoiceName: t })} />}>
                    <input value={s.invoiceName} name="ddd-firma" placeholder="Np. Apt Production sp. z o.o." onChange={(e) => set({ invoiceName: e.target.value })} autoComplete="off" />
                  </Field>
                  <Field label="NIP" error={errors.nip} action={<PasteButton onPaste={(t) => set({ nip: t.replace(/[^\d]/g, '') })} />}>
                    <input inputMode="numeric" name="ddd-nip" value={s.nip} onChange={(e) => set({ nip: e.target.value })} autoComplete="off" />
                  </Field>
                </>
              ) : (
                <Field label="Imię i nazwisko" error={errors.clientName} action={<PasteButton onPaste={(t) => set({ clientName: t })} />}>
                  <input value={s.clientName} name="ddd-klient" onChange={(e) => set({ clientName: e.target.value })} autoComplete="off" />
                </Field>
              )}
              <Field label="E-mail" error={errors.email} action={<PasteButton onPaste={(t) => set({ email: t })} />}>
                <input type="text" inputMode="email" name="ddd-email" autoCapitalize="none" value={s.email} onChange={(e) => set({ email: e.target.value })} autoComplete="off" />
              </Field>
              {s.invoice !== 'brak' && (
                <Field label="Adres do faktury" hint="Puste: adres zlecenia." action={<PasteButton onPaste={(t) => set({ invoiceAddress: t })} />}>
                  <input value={s.invoiceAddress} name="ddd-adres-faktury" onChange={(e) => set({ invoiceAddress: e.target.value })} autoComplete="off" />
                </Field>
              )}
            </div>
          )}
        </div>
      );
    case 'telefon':
      return <PhoneStep state={s} set={set} errors={errors} editId={props.editId} />;
    case 'podsumowanie': {
      const draft = toDraft(s);
      return (
        <Group>
          <Info label="Adres">
            {draft.street.trim() || draft.city.trim()
              ? `${orderAddress(draft)}${draft.postalCode ? `, ${draft.postalCode}` : ''} (${BUILDINGS[draft.building].toLowerCase()})`
              : 'Klient poda adres później (przypomnienie w „Pilnych”)'}
          </Info>
          <Info label="Co robimy">{s.methods.map((m) => (m === 'inne' ? s.methodOther.trim() || METHOD_LABEL[m] : METHOD_LABEL[m])).join(', ')}</Info>
          <Info label="Szkodnik">{draft.pest === 'inne' ? draft.pestOther : PESTS[draft.pest]}</Info>
          {draft.description.trim() && <Info label="Opis">{draft.description.trim()}</Info>}
          <Info label="Termin">{formatTerm(`${s.date}T${s.time}`)}</Info>
          <Info label="Co pryskamy">{scopeText(formTerms(s).scope)}</Info>
          {price && <Info label="Widełki">{price.gross ? `${price.net}\n${price.gross}` : price.net}</Info>}
          <Info label="Faktura">{INVOICES[draft.invoice]}</Info>
          {draft.invoice === 'vat' && <Info label="Do faktury">{`${draft.invoiceName}\nNIP ${draft.nip}`}</Info>}
          <Info label="Protokół">{s.protocol ? 'Tak' : 'Nie'}</Info>
          <Info label="Klient">{[draft.clientName.trim(), ...draft.phones.map((p) => (p.label ? `${p.number} (${p.label})` : p.number))].filter(Boolean).join('\n')}</Info>
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
  const [leaving, setLeaving] = useState(false);
  // „Powiel zlecenie” (?powiel=id zlecenia&zabieg=id zabiegu): ten sam formularz co nowe zlecenie, wypełniony
  // danymi powielanego. Numer mieszkania jest pusty, a termin zaraz po powielanym zabiegu.
  const copyFrom = params.get('powiel');
  const copyVisit = params.get('zabieg');
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copyFrom || copied === copyFrom) return;
    void (async () => {
      const source = await orders.get(copyFrom);
      if (!source || source.deletedAt) return;
      if (!isBlank(loadDraft())) {
        const ok = await confirm({
          title: 'Zastąpić rozpoczęte nowe zlecenie?',
          message: 'Masz niedokończone nowe zlecenie. Powielenie wpisze w formularz dane powielanego zlecenia, a wpisane dane znikną.',
          confirmLabel: 'Powiel mimo to',
          cancelLabel: 'Zostaw rozpoczęte',
        });
        if (!ok) {
          setCopied(copyFrom);
          return;
        }
      }
      const list = await orderVisits(copyFrom);
      const visit = list.find((v) => v.id === copyVisit) ?? list.find((v) => v.start) ?? list[0];
      const duration = visit?.durationMin || 60;
      const after = visit?.start ? addMinutes(visit.start, duration) : null;
      const next: FormState = {
        ...fromOrder(source),
        flatNo: '',
        date: after?.slice(0, 10) ?? todayWarsaw(),
        time: after?.slice(11, 16) ?? '10:00',
        duration: String(duration),
        scopeKind: visit?.scope?.kind ?? 'calosc',
        scopeNote: visit?.scope?.note ?? '',
      };
      setState(next);
      saveDraft(next);
      setStepIndex(0);
      setCopied(copyFrom);
      toast(`Powielasz zlecenie ${orderCode(source)}. Sprawdź numer mieszkania i termin.`);
    })();
  }, [copyFrom, copyVisit, copied]);
  const steps: StepId[] = [...ALL_STEPS, 'podsumowanie'];
  const step = steps[stepIndex];
  const hasDraft = useMemo(() => !isBlank(state), [state]);

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
      const { order, offlineNumber } = await createOrder(
        toDraft(state),
        { start: state.date ? `${state.date}T${state.time}` : null, durationMin: duration, terms: formTerms(state) },
        null,
      );
      saveDraft(null);
      toast(
        offlineNumber
          ? `Zapisano zlecenie ${orderCode(order)} bez internetu: numer może się powtórzyć z numerem z innego telefonu. Sprawdź po połączeniu.`
          : `Zapisano zlecenie ${orderCode(order)}`,
      );
      // Karta nowego zlecenia od razu proponuje dodanie terminu do Kalendarza Google.
      navigate(`/zlecenia/${order.id}?nowe=1`, { replace: true });
    });

  if (!settings) return <Loading />;

  // Wyjście ze szkicu: dokończyć później (szkic zostaje, widać go na Pulpicie) albo usunąć.
  const leave = () => (hasDraft ? setLeaving(true) : goBack(navigate, '/zlecenia'));

  return (
    <Page title="Nowe zlecenie" back="/zlecenia" onBack={leave}>
      <Sheet open={leaving} title="Wyjść z nowego zlecenia?" onClose={() => setLeaving(false)}>
        <div className="form">
          <p className="sheet-text">Wpisane dane są zapisane w szkicu. Możesz dokończyć zlecenie później (szkic czeka na Pulpicie) albo je usunąć.</p>
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              setLeaving(false);
              toast('Szkic zapisany. Dokończysz go z Pulpitu.');
              goBack(navigate, '/zlecenia');
            }}
          >
            <Icon name="clipboard" /> Dokończ potem
          </button>
          <button
            type="button"
            className="btn btn-danger-quiet btn-block"
            onClick={() => {
              saveDraft(null);
              setLeaving(false);
              toast('Szkic usunięty');
              goBack(navigate, '/zlecenia');
            }}
          >
            <Icon name="trash" /> Usuń szkic
          </button>
          <button type="button" className="btn btn-block" onClick={() => setLeaving(false)}>
            Zostań i wypełniaj dalej
          </button>
        </div>
      </Sheet>
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
            setState({ ...EMPTY, date: todayWarsaw() });
          }}
        >
          Wyczyść szkic i zacznij od nowa
        </button>
      )}
    </Page>
  );
}

/** Termin i zakres umówionego zabiegu w edycji (strona „Edytuj” z karty zabiegu). */
interface VisitEdit {
  date: string;
  time: string;
  duration: number;
  kind: ScopeKind;
  note: string;
}

const EDIT_DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240];

/**
 * Edycja zlecenia. Z karty umówionego zabiegu (?zabieg=…) to jedna strona do wszystkiego: na górze termin, czas
 * i zakres tego zabiegu, niżej telefon, adres, opis, cena i faktura. Cena dotyczy wtedy tego zabiegu.
 */
export function OrderEditPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const visitId = params.get('zabieg');
  const navigate = useNavigate();
  const { confirm, run, toast } = useFeedback();
  const loaded = useLiveQuery(async () => {
    const order = await orders.get(id);
    if (!order || order.deletedAt) return null;
    const visit = visitId ? await visits.get(visitId) : undefined;
    const editVisit = visit && visit.orderId === id && visit.status === 'zaplanowany' && !visit.deletedAt ? visit : null;
    return { order, settings: await getAppSettings(), visit: editVisit, list: editVisit ? await orderVisits(id) : ([] as Visit[]) };
  }, [id, visitId]);
  const [state, setState] = useState<FormState | null>(null);
  const [visitEdit, setVisitEdit] = useState<VisitEdit | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  // Numer zlecenia do poprawienia (np. przepisany z kartki); pusty to bez zmiany.
  const [numberText, setNumberText] = useState('');
  const editKey = `ddd-edycja-zlecenia-${id}${visitId ? `-${visitId}` : ''}`;

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
    const v = loaded.visit;
    // Cena na stronie to cena tego zabiegu (II może mieć inną niż zlecenie).
    const base = fromOrder(loaded.order);
    if (v) {
      const price = visitPrice(v, loaded.order);
      base.priceMin = price.priceMin != null ? moneyToInput(price.priceMin) : '';
      base.priceMax = price.priceMax != null ? moneyToInput(price.priceMax) : '';
      setVisitEdit({
        date: v.start?.slice(0, 10) ?? '',
        time: v.start?.slice(11, 16) ?? '10:00',
        duration: v.durationMin || 60,
        kind: v.scope?.kind ?? 'calosc',
        note: v.scope?.note ?? '',
      });
    }
    setState(restored ?? base);
    if (restored) toast('Przywrócono niezapisane zmiany');
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
  const sections: StepId[] = ['telefon', 'adres', 'problem', 'cena'];

  const current = loaded.order;
  const newNumber = numberText.trim() ? Number(numberText) : current.number;
  const numberError = numberText.trim() && (!Number.isInteger(newNumber) || newNumber < 1 || newNumber > 99999) ? 'Podaj numer od 1 do 99999' : undefined;

  const save = async () => {
    const found = Object.assign({}, ...sections.map((step) => validate(step, state))) as Errors;
    setErrors(found);
    if (numberError) {
      toast(numberError, { tone: 'error' });
      return;
    }
    if (newNumber !== current.number) {
      // Ten sam numer w tym samym regionie: ostrzeżenie, bo numer służy do wyszukiwania i w dokumentach.
      const same = (await orders.all()).find(
        (o) => o.id !== current.id && !o.deletedAt && o.number === newNumber && (o.prefix ?? '') === (current.prefix ?? '') && (o.branchId ?? null) === (current.branchId ?? null),
      );
      if (same) {
        const ok = await confirm({
          title: `Numer ${orderCode({ ...current, number: newNumber })} jest już zajęty`,
          message: `Ma go zlecenie ${[same.clientName, orderAddress(same)].filter(Boolean).join(', ') || orderCode(same)}. Dwa zlecenia z tym samym numerem łatwo pomylić.`,
          confirmLabel: 'Zapisz mimo to',
          cancelLabel: 'Zmienię numer',
        });
        if (!ok) return;
      }
    }
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
      const v = loaded.visit;
      // Cena zabiegu II, III…: zostaje przy zabiegu, widełki zlecenia bez zmian.
      const orderPatch = v && v.seq > 1 ? { ...draft, priceMin: before.priceMin, priceMax: before.priceMax } : draft;
      await orders.update(id, newNumber !== before.number ? { ...orderPatch, number: newNumber } : orderPatch);
      if (v && visitEdit) {
        const start = visitEdit.date ? `${visitEdit.date}T${visitEdit.time}` : null;
        // Pierwsze ustawienie terminu to umówienie zabiegu: zapisujemy, kto umówił.
        const me = !v.start && start ? await getProfile() : null;
        await visits.update(v.id, {
          start,
          durationMin: visitEdit.duration,
          scope: { kind: visitEdit.kind, note: visitEdit.kind === 'calosc' ? '' : visitEdit.note.trim() },
          priceMin: draft.priceMin,
          priceMax: draft.priceMax,
          ...(me ? { bookedById: me.userId, bookedByName: me.name, bookedAt: new Date().toISOString() } : {}),
        });
      }
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
      navigate(v ? `/zabieg/${v.id}` : `/zlecenia/${id}`, { replace: true });
    });
  };

  return (
    <Page title={loaded.visit ? `Edycja ${visitCode(loaded.order, loaded.visit.seq)}` : `Edycja ${orderCode(loaded.order)}`} back={loaded.visit ? `/zabieg/${loaded.visit.id}` : `/zlecenia/${id}`}>
      {loaded.visit && visitEdit && (
        <section className="edit-section">
          <h2 className="wizard-title">Termin zabiegu {visitCode(loaded.order, loaded.visit.seq)}</h2>
          <VisitEditFields visit={loaded.visit} after={previousVisitDay(loaded.list, loaded.visit.seq)} value={visitEdit} onChange={(patch) => setVisitEdit((prev) => ({ ...prev!, ...patch }))} />
        </section>
      )}
      <section className="edit-section">
        <h2 className="wizard-title">Numer zlecenia</h2>
        <Field
          label="Numer"
          error={numberError}
          hint={newNumber !== current.number ? `Po zapisaniu: ${orderCode({ ...current, number: newNumber })} (zabiegi: ${orderCode({ ...current, number: newNumber })}/I, /II…)` : `Teraz: ${orderCode(current)}. Zmień, np. gdy numer był nadany na kartce.`}
        >
          <input inputMode="numeric" value={numberText} placeholder={String(current.number)} onChange={(e) => setNumberText(e.target.value.replace(/\D/g, '').slice(0, 5))} />
        </Field>
      </section>
      {sections.map((step) => (
        <section key={step} className="edit-section">
          <h2 className="wizard-title">{STEP_TITLES[step]}</h2>
          <Steps state={state} set={set} step={step} errors={errors} vatRate={loaded.settings.vatRate} editId={id} />
        </section>
      ))}
      <button type="button" className="btn btn-primary btn-block" onClick={() => void save()}>
        Zapisz zmiany
      </button>
      <button
        type="button"
        className="btn btn-block"
        onClick={() => navigate(`/zlecenia/nowe?powiel=${id}${loaded.visit ? `&zabieg=${loaded.visit.id}` : ''}`)}
      >
        <Icon name="copy" /> Powiel zlecenie (np. sąsiednie mieszkanie)
      </button>
    </Page>
  );
}

function VisitEditFields(props: { visit: Visit; after: string | null; value: VisitEdit; onChange: (patch: Partial<VisitEdit>) => void }) {
  const v = props.value;
  const durations = EDIT_DURATIONS.includes(v.duration) ? EDIT_DURATIONS : [...EDIT_DURATIONS, v.duration].sort((a, b) => a - b);
  return (
    <div className="form">
      {props.after && props.visit.seq > 1 && (
        <NextDates after={props.after} durationMin={v.duration} date={v.date} time={v.time} exclude={props.visit.id} onPick={(date, time) => props.onChange({ date, time })} />
      )}
      <div className="form-row">
        <Field label="Data" hint="Puste: termin do umówienia.">
          <input type="date" value={v.date} onChange={(e) => props.onChange({ date: e.target.value })} />
        </Field>
        <Field label="Godzina">
          <TimeSelect value={v.time} onChange={(time) => props.onChange({ time })} />
        </Field>
      </div>
      <Field label="Czas trwania">
        <select value={v.duration} onChange={(e) => props.onChange({ duration: Number(e.target.value) })}>
          {durations.map((d) => (
            <option key={d} value={d}>
              {d < 60 ? `${d} min` : `${Math.floor(d / 60)} godz.${d % 60 ? ` ${d % 60} min` : ''}`}
            </option>
          ))}
        </select>
      </Field>
      <div className="field">
        <span className="field-label">Co pryskamy</span>
        <div className="choice">
          {SCOPE_KINDS.map(([kind, label]) => (
            <button key={kind} type="button" className={v.kind === kind ? 'choice-item active' : 'choice-item'} aria-pressed={v.kind === kind} onClick={() => props.onChange({ kind })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {v.kind !== 'calosc' && (
        <Field label={v.kind === 'pokoj' ? 'Który pokój?' : 'Co dokładnie?'}>
          <input value={v.note} placeholder={v.kind === 'pokoj' ? 'Np. sypialnia' : 'Np. kuchnia i łazienka, piwnica'} onChange={(e) => props.onChange({ note: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

