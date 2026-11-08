import { orderCode } from '../data/codes';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { locate, suggestSlots, type Suggestion } from '../data/geo';
import { createOrder, type OrderDraft } from '../data/orders';
import { orders, visits } from '../data/repo';
import { getAppSettings } from '../data/settings';
import { BUILDINGS, INVOICES, PESTS, orderAddress, priceRange, PINK_PLACEHOLDER } from '../data/texts';
import type { BuildingType, InvoiceType, Order, PestCategory } from '../data/types';
import { formatDateLong, formatTerm, isValidDate, todayWarsaw } from '../lib/dates';
import { moneyToInput, parseMoney } from '../lib/money';
import { isValidNip } from '../lib/validators';
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
  };
}

function toDraft(s: FormState): OrderDraft {
  const phones = [{ number: s.phone1.trim(), label: '' }];
  if (s.phone2.trim()) phones.push({ number: s.phone2.trim(), label: s.phone2Label.trim() });
  return {
    building: s.building,
    street: s.street.trim(),
    houseNo: s.houseNo.trim(),
    flatNo: s.building === 'blok' ? s.flatNo.trim() : '',
    floor: s.building === 'blok' ? s.floor.trim() : '',
    staircase: s.building === 'blok' ? s.staircase.trim() : '',
    postalCode: s.postalCode.trim(),
    city: s.city.trim(),
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
    nip: s.invoice !== 'brak' ? s.nip.trim() : '',
    invoiceAddress: s.invoice !== 'brak' ? s.invoiceAddress.trim() : '',
    phones,
    pink: s.pink,
    pinkNote: s.pink ? s.pinkNote.trim() : '',
  };
}

type StepId = 'adres' | 'problem' | 'termin' | 'cena' | 'klient' | 'podsumowanie';

const STEP_TITLES: Record<StepId, string> = {
  adres: 'Adres',
  problem: 'Problem',
  termin: 'Termin',
  cena: 'Cena i faktura',
  klient: 'Klient',
  podsumowanie: 'Podsumowanie',
};

type Errors = Partial<Record<keyof FormState, string>>;

function validate(step: StepId, s: FormState): Errors {
  const e: Errors = {};
  if (step === 'adres') {
    if (!s.street.trim()) e.street = 'Podaj ulicę';
    if (!s.houseNo.trim()) e.houseNo = 'Podaj numer';
    if (!s.city.trim()) e.city = 'Podaj miejscowość';
    if (s.building === 'blok' && !s.flatNo.trim()) e.flatNo = 'W bloku podaj numer lokalu';
    if (s.postalCode.trim() && !/^\d{2}-\d{3}$/.test(s.postalCode.trim())) e.postalCode = 'Kod w formacie 00-000';
  }
  if (step === 'problem') {
    if (s.pest === 'inne' && !s.pestOther.trim()) e.pestOther = 'Napisz, jaki to szkodnik';
    if (s.area.trim() && !/^\d+([.,]\d+)?$/.test(s.area.trim())) e.area = 'Podaj liczbę, np. 48';
  }
  if (step === 'termin') {
    if (s.date && !isValidDate(s.date)) e.date = 'Podaj poprawną datę';
    if (s.date && !/^\d{2}:\d{2}$/.test(s.time)) e.time = 'Podaj godzinę';
    if (s.second === 'umowiony') {
      if (!isValidDate(s.secondDate)) e.secondDate = 'Podaj datę drugiego zabiegu';
      else if (s.date && s.secondDate <= s.date) e.secondDate = 'Drugi zabieg musi być po pierwszym';
    }
  }
  if (step === 'cena') {
    if (s.priceMin.trim() && parseMoney(s.priceMin) === null) e.priceMin = 'Podaj kwotę, np. 300';
    if (s.priceMax.trim() && parseMoney(s.priceMax) === null) e.priceMax = 'Podaj kwotę, np. 350';
    const [min, max] = [parseMoney(s.priceMin), parseMoney(s.priceMax)];
    if (min !== null && max !== null && max < min) e.priceMax = 'Górna granica jest niższa niż dolna';
  }
  if (step === 'klient') {
    if (!s.clientName.trim()) e.clientName = 'Podaj imię i nazwisko albo nazwę firmy';
    if (s.phone1.replace(/\D/g, '').length < 9) e.phone1 = 'Podaj numer telefonu';
    if (s.email.trim() && !/^\S+@\S+\.\S+$/.test(s.email.trim())) e.email = 'Adres e-mail jest niepoprawny';
    if (s.invoice !== 'brak' && s.nip.trim() && !isValidNip(s.nip)) e.nip = 'NIP jest niepoprawny';
  }
  return e;
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

function ReturningClient(props: { phone: string; onFill: (order: Order) => void; currentId?: string }) {
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
          <button type="button" className="link" onClick={() => props.onFill(last)}>
            Uzupełnij dane klienta
          </button>
        </span>
      </span>
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
              <input value={s.postalCode} onChange={(e) => set({ postalCode: e.target.value })} inputMode="numeric" placeholder="00-000" autoComplete="off" />
            </Field>
            <Field label="Miejscowość" error={errors.city}>
              <input value={s.city} onChange={(e) => set({ city: e.target.value })} autoComplete="off" />
            </Field>
          </div>
          <Field label="Jak dotrzeć" hint="Np. wejście od podwórka, domofon nie działa, kod do bramy.">
            <textarea rows={2} value={s.access} onChange={(e) => set({ access: e.target.value })} />
          </Field>
        </div>
      );
    case 'problem':
      return (
        <div className="form">
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
            <Field label="Data" error={errors.date} hint={s.date ? undefined : 'Puste: termin do umówienia.'}>
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
          <Choice
            label="Drugi zabieg"
            value={s.second}
            options={[
              ['technik', 'Technik umówi z klientem'],
              ['umowiony', 'Umów od razu'],
              ['brak', 'Bez drugiego'],
            ]}
            onChange={(second) => set({ second })}
          />
          {s.second === 'umowiony' && (
            <div className="form-row">
              <Field label="Data drugiego" error={errors.secondDate}>
                <input type="date" value={s.secondDate} onChange={(e) => set({ secondDate: e.target.value })} />
              </Field>
              <Field label="Godzina">
                <input type="time" step={900} value={s.secondTime} onChange={(e) => set({ secondTime: e.target.value })} />
              </Field>
            </div>
          )}
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
          {price && (
            <div className="price-box">
              <strong>{price.net}</strong>
              {price.gross && <span>{price.gross}</span>}
            </div>
          )}
        </div>
      );
    case 'klient':
      return (
        <div className="form">
          <Field label="Telefon" error={errors.phone1}>
            <input type="tel" inputMode="tel" value={s.phone1} onChange={(e) => set({ phone1: e.target.value })} autoComplete="off" />
          </Field>
          <ReturningClient
            phone={s.phone1}
            currentId={props.editId}
            onFill={(o) =>
              set({ clientName: o.clientName, email: o.email, nip: o.nip, invoiceAddress: o.invoiceAddress, pink: o.pink || s.pink, pinkNote: o.pinkNote || s.pinkNote })
            }
          />
          <Field label="Imię i nazwisko albo nazwa firmy" error={errors.clientName}>
            <input value={s.clientName} onChange={(e) => set({ clientName: e.target.value })} autoComplete="off" />
          </Field>
          <div className="form-row">
            <Field label="Drugi telefon">
              <input type="tel" inputMode="tel" value={s.phone2} onChange={(e) => set({ phone2: e.target.value })} autoComplete="off" />
            </Field>
            <Field label="Dopisek" hint="Np. tata, tutaj dzwonić">
              <input value={s.phone2Label} onChange={(e) => set({ phone2Label: e.target.value })} autoComplete="off" />
            </Field>
          </div>
          <Field label="E-mail" error={errors.email}>
            <input type="email" inputMode="email" autoCapitalize="none" value={s.email} onChange={(e) => set({ email: e.target.value })} autoComplete="off" />
          </Field>
          {s.invoice !== 'brak' && (
            <>
              <Field label={s.invoice === 'vat' ? 'NIP' : 'NIP (opcjonalnie)'} error={errors.nip}>
                <input inputMode="numeric" value={s.nip} onChange={(e) => set({ nip: e.target.value })} autoComplete="off" />
              </Field>
              <Field label="Adres do faktury" hint="Puste: adres zlecenia.">
                <input value={s.invoiceAddress} onChange={(e) => set({ invoiceAddress: e.target.value })} autoComplete="off" />
              </Field>
            </>
          )}
        </div>
      );
    case 'podsumowanie': {
      const draft = toDraft(s);
      return (
        <Group>
          <Info label="Adres">{`${orderAddress(draft)}${draft.postalCode ? `, ${draft.postalCode}` : ''} (${BUILDINGS[draft.building].toLowerCase()})`}</Info>
          <Info label="Szkodnik">{draft.pest === 'inne' ? draft.pestOther : PESTS[draft.pest]}</Info>
          <Info label="Termin">{s.date ? formatTerm(`${s.date}T${s.time}`) : 'Do umówienia'}</Info>
          <Info label="Drugi zabieg">
            {s.second === 'umowiony' ? formatTerm(`${s.secondDate}T${s.secondTime}`) : s.second === 'technik' ? 'Technik umówi z klientem' : 'Bez drugiego'}
          </Info>
          {price && <Info label="Widełki">{price.gross ? `${price.net}\n${price.gross}` : price.net}</Info>}
          <Info label="Faktura">{INVOICES[draft.invoice]}</Info>
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
  const { run, toast } = useFeedback();
  const settings = useLiveQuery(() => getAppSettings());
  // Kliknięcie w kalendarzu przekazuje dzień i godzinę nowego zlecenia.
  const [state, setState] = useState<FormState>(() => {
    const draft = loadDraft();
    const date = params.get('data');
    return date && isValidDate(date) ? { ...draft, date, time: params.get('czas') ?? draft.time } : draft;
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const steps: StepId[] = ['adres', 'problem', 'termin', 'cena', 'klient', 'podsumowanie'];
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

  const go = (delta: number) => {
    if (delta > 0) {
      const found = validate(step, state);
      setErrors(found);
      if (Object.keys(found).length) return;
    }
    setStepIndex((i) => Math.min(steps.length - 1, Math.max(0, i + delta)));
  };

  const save = () =>
    run(async () => {
      const duration = Number(state.duration) || 60;
      const { order } = await createOrder(
        toDraft(state),
        { start: state.date ? `${state.date}T${state.time}` : null, durationMin: duration },
        state.second === 'umowiony' ? { start: `${state.secondDate}T${state.secondTime}`, durationMin: duration } : null,
      );
      saveDraft(null);
      toast(`Zapisano zlecenie ${orderCode(order)}`);
      navigate(`/zlecenia/${order.id}`, { replace: true });
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
          <button type="button" className="btn" onClick={() => go(-1)}>
            Wstecz
          </button>
        )}
        {step === 'podsumowanie' ? (
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            <Icon name="check" /> Zapisz zlecenie
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => go(1)}>
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
  const { run, toast } = useFeedback();
  const loaded = useLiveQuery(async () => {
    const order = await orders.get(id);
    return order && !order.deletedAt ? { order, settings: await getAppSettings() } : null;
  }, [id]);
  const [state, setState] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (loaded && !state) setState(fromOrder(loaded.order));
  }, [loaded, state]);

  if (loaded === undefined || (loaded && !state)) return <Loading />;
  if (loaded === null || !state) return <NotFound back="/zlecenia" />;

  const set = (patch: Partial<FormState>) => setState((prev) => ({ ...prev!, ...patch }));
  const sections: StepId[] = ['adres', 'problem', 'cena', 'klient'];

  const save = () => {
    const found = Object.assign({}, ...sections.map((step) => validate(step, state))) as Errors;
    setErrors(found);
    if (Object.keys(found).length) {
      toast('Popraw zaznaczone pola', { tone: 'error' });
      return;
    }
    void run(async () => {
      await orders.update(id, toDraft(state));
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
      <button type="button" className="btn btn-primary btn-block" onClick={save}>
        Zapisz zmiany
      </button>
    </Page>
  );
}
