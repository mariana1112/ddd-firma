import { roman, visitCode } from '../data/codes';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { finishVisit, normalizeInterview, orderVisits, startVisit, type NextVisit } from '../data/orders';
import { orders, visits } from '../data/repo';
import { getAppSettings, type AppSettings } from '../data/settings';
import {
  accessDetails,
  finishSms,
  INVOICES,
  mapsUrl,
  orderAddress,
  PAY_NAMES,
  PINK_PLACEHOLDER,
  pestName,
  priceRange,
  reminderSms,
  workSummary,
} from '../data/texts';
import type { Interview, InvoiceType, Order, PayMethod, Visit, YesNo } from '../data/types';
import { addMinutes, formatDate, formatTerm } from '../lib/dates';
import { moneyToInput, parseMoney } from '../lib/money';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Field, Group, Info, Loading, NotFound, Page, Sheet } from '../ui/kit';
import { ContactBar, PinkBadge, useContactActions, VisitBadge, visitWhen } from './common';
import { Photos } from './photos';
import { VisitSummary } from './visit-summary';

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

function icsFile(order: Order, visit: Visit): Blob {
  const stamp = (term: string) => term.replace(/[-:]/g, '').replace('T', 'T') + '00';
  const end = addMinutes(visit.start!, visit.durationMin);
  const escape = (text: string) => text.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pogromcy Insektow//Aplikacja//PL',
    'BEGIN:VEVENT',
    `UID:${visit.id}@ddd-firma`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=Europe/Warsaw:${stamp(visit.start!)}`,
    `DTEND;TZID=Europe/Warsaw:${stamp(end)}`,
    `SUMMARY:${escape(`${visitCode(order, visit.seq)} ${pestName(order)}, ${order.clientName}`)}`,
    `LOCATION:${escape(orderAddress(order))}`,
    `DESCRIPTION:${escape(`Zabieg ${roman(visit.seq)}. Tel. ${order.phones[0]?.number ?? ''}`)}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Zabieg za godzinę',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return new Blob([lines.join('\r\n')], { type: 'text/calendar' });
}

function History({ list, current, order }: { list: Visit[]; current: Visit; order: Order }) {
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
          <VisitSummary order={order} visit={preview} short />
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
  onFinish: (input: { recommendations: string[]; next: NextVisit }) => Promise<void>;
}) {
  const { visit, later, settings } = props;
  const [recommendations, setRecommendations] = useState<string[]>(visit.recommendations);
  const [mode, setMode] = useState<NextVisit['mode']>(later ? (later.start ? 'umowiony' : 'technik') : visit.seq === 1 ? 'technik' : 'brak');
  const [date, setDate] = useState(later?.start?.slice(0, 10) ?? '');
  const [time, setTime] = useState(later?.start?.slice(11, 16) ?? visit.start?.slice(11, 16) ?? '10:00');
  const [busy, setBusy] = useState(false);
  const nextSeq = visit.seq + 1;
  const ready = mode !== 'umowiony' || Boolean(date && time);

  return (
    <Sheet open={props.open} title={`Zakończenie zabiegu ${roman(visit.seq)}`} onClose={props.onClose}>
      <div className="form">
        <div className="field">
          <span className="field-label">Zalecenia dla klienta</span>
          <div className="check-list">
            {settings.recommendations.map((r) => (
              <label key={r} className="check">
                <input
                  type="checkbox"
                  checked={recommendations.includes(r)}
                  onChange={(e) => setRecommendations(e.target.checked ? [...recommendations, r] : recommendations.filter((x) => x !== r))}
                />
                {r}
              </label>
            ))}
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
            const next: NextVisit =
              mode === 'umowiony' ? { mode, start: `${date}T${time}`, durationMin: visit.durationMin } : { mode };
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
  const { confirm, deliverFile, run, toast } = useFeedback();
  const { sms } = useContactActions();
  const navigate = useNavigate();
  const [finishing, setFinishing] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
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
    return { visit, order, list: await orderVisits(order.id), settings: await getAppSettings() };
  }, [id]);

  if (data === undefined) return <Loading />;
  if (data === null) return <NotFound back="/zlecenia" />;
  const { visit, order, list, settings } = data;
  const later = list.find((v) => v.seq === visit.seq + 1 && v.status !== 'odwolany');
  const phone = order.phones[0];
  const price = priceRange(order, settings.vatRate);
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

  const finish = async (input: { recommendations: string[]; next: NextVisit }) => {
    if (!visit.payMethod || !visit.amount) {
      const ok = await confirm({
        title: 'Brak płatności',
        message: 'Nie zapisano formy płatności lub kwoty. Zakończyć mimo to?',
        confirmLabel: 'Zakończ',
      });
      if (!ok) return;
    }
    await run(async () => {
      const { next } = await finishVisit(visit.id, {
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
      toast('Zabieg zakończony');
      await sendFinishSms({ ...visit, recommendations: input.recommendations }, next);
    });
  };

  return (
    <Page title={visitCode(order, visit.seq)} back={`/zlecenia/${order.id}`}>
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
        mapsHref={mapsUrl(order)}
        onSms={(p) => void sms(p, visit.status === 'zaplanowany' && visit.start ? reminderSms(order, visit, settings) : '')}
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

      {visit.status === 'zaplanowany' && (
        <>
          <button type="button" className="btn btn-primary btn-block btn-big" onClick={() => void run(() => startVisit(visit.id))}>
            <Icon name="play" /> Rozpocznij zabieg
          </button>
          <div className="btn-stack">
            <button type="button" className="btn" onClick={() => setRescheduling(true)}>
              <Icon name="calendar" /> {visit.start ? 'Zmień termin' : 'Umów termin'}
            </button>
            {visit.start && (
              <button type="button" className="btn" onClick={() => deliverFile(icsFile(order, visit), `zabieg-${visitCode(order, visit.seq).replace('/', '-')}.ics`)}>
                <Icon name="calendar" /> Dodaj do kalendarza iPhone'a
              </button>
            )}
          </div>
          <Group title="Zlecenie">
            {order.description && <Info label="Opis">{order.description}</Info>}
            {order.areaM2 && <Info label="Metraż">{order.areaM2} m²</Info>}
            {price && <Info label="Widełki">{price.gross ? `${price.net}\n${price.gross}` : price.net}</Info>}
            <Info label="Faktura">{INVOICES[order.invoice]}</Info>
          </Group>
        </>
      )}

      {summary && (
        <>
          <VisitSummary order={order} visit={visit} later={later} photos={<Photos visitId={visit.id} readOnly />} />
          <div className="btn-stack">
            <button type="button" className="btn btn-primary" onClick={() => setEditingId(visit.id)}>
              <Icon name="edit" /> Edytuj zabieg
            </button>
            <button type="button" className="btn" disabled={!phone} onClick={() => void sendFinishSms(visit, later ?? null)}>
              <Icon name="message" /> SMS do klienta z zaleceniami
            </button>
            <button type="button" className="btn" onClick={() => navigate(`/zlecenia/${order.id}`)}>
              Wróć do zlecenia
            </button>
          </div>
        </>
      )}

      {active && (
        <>
          <Group title="Płatność" plain>
            <div className="pay-choice">
              {(['gotowka', 'blik', 'przelew'] as PayMethod[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`pay-option pay-${m}${visit.payMethod === m ? ' active' : ''}`}
                  aria-pressed={visit.payMethod === m}
                  onClick={() => save({ payMethod: visit.payMethod === m ? null : m })}
                >
                  {PAY_NAMES[m]}
                </button>
              ))}
            </div>
            <AmountField value={visit.amount} hint={price ? (price.gross ? `Widełki: ${price.net}, ${price.gross}` : `Widełki: ${price.net}`) : undefined} onSave={(amount) => save({ amount })} />
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
          </Group>

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
            <ToggleChips options={settings.treatments} selected={visit.treatments} addLabel="Inny zabieg" onChange={(treatments) => save({ treatments })} />
            <span className="field-label">Miejsca</span>
            <ToggleChips options={settings.places} selected={visit.places} addLabel="Inne miejsce" onChange={(places) => save({ places })} />
            {workSummary(visit) && <p className="field-hint">Do wiadomości: {workSummary(visit)}</p>}
          </Group>

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

          {visit.status === 'w_trakcie' ? (
            <button type="button" className="btn btn-primary btn-block btn-big" onClick={() => setFinishing(true)}>
              <Icon name="check" /> Zakończ zabieg
            </button>
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

      <History list={list} current={visit} order={order} />

      <FinishSheet open={finishing} onClose={() => setFinishing(false)} visit={visit} later={later} settings={settings} onFinish={finish} />
      <Sheet open={rescheduling} title="Termin zabiegu" onClose={() => setRescheduling(false)}>
        {rescheduling && <Reschedule visit={visit} onDone={() => setRescheduling(false)} />}
      </Sheet>
    </Page>
  );
}

function AmountField(props: { value: number | null; hint?: string; onSave: (value: number | null) => void }) {
  const [text, setText] = useState(props.value !== null ? moneyToInput(props.value) : '');
  const invalid = text.trim() !== '' && parseMoney(text) === null;
  return (
    <Field label="Kwota pobrana (zł)" error={invalid ? 'Podaj kwotę, np. 350' : undefined} hint={props.hint}>
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (invalid) return;
          const value = text.trim() ? parseMoney(text) : null;
          if (value !== props.value) props.onSave(value);
        }}
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
              await visits.update(visit.id, { status: 'odwolany' });
              toast('Zabieg odwołany', { action: { label: 'Cofnij', onClick: () => void run(() => visits.update(visit.id, { status: 'zaplanowany' })) } });
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
