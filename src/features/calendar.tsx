import FullCalendar, { type CalendarRef } from '@fullcalendar/react';
import classicTheme from '@fullcalendar/react/themes/classic';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import interactionPlugin from '@fullcalendar/react/interaction';
import listPlugin from '@fullcalendar/react/list';
import plLocale from '@fullcalendar/react/locales/pl';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/theme.css';
import '@fullcalendar/react/themes/classic/palette.css';
import { useLiveQuery } from 'dexie-react-hooks';
import { roman, visitCode } from '../data/codes';
import { mainPhone } from '../data/order-search';
import { useEffect, useMemo, useRef, useState, type TouchEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { orders, visits } from '../data/repo';
import { pestName } from '../data/texts';
import { methodNames } from '../data/methods';
import { nextVisitOfDay, URGENT_LABEL, visitUrgent } from '../data/order-list';
import type { VisitStatus } from '../data/types';
import { addDays, addMinutes, formatTerm, nowWarsaw, todayWarsaw } from '../lib/dates';
import { getProfile } from '../data/settings';
import { Icon } from '../ui/icons';
import { useFeedback } from '../ui/feedback';
import { Page } from '../ui/kit';
import { eventOnDay, eventType, listEvents, type CalendarEvent } from '../data/events';
import { AddChooser, EventSheet, type CalendarSpot } from './calendar-events';
import { clockInWarsaw, firstName } from '../data/texts';

const VIEW_KEY = 'ddd-kalendarz-widok';
/** Oglądany dzień: po wejściu w zabieg i powrocie kalendarz jest tam, gdzie był (do zamknięcia aplikacji). */
const DATE_KEY = 'ddd-kalendarz-data';
const FROM_MONTH_KEY = 'ddd-kalendarz-z-miesiaca';

const WEEKDAYS = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];

/** „9–15 listopada”, a na przełomie miesięcy „30 listopada – 6 grudnia”. */
function weekTitle(from: string, to: string): string {
  const [m1, m2] = [Number(from.slice(5, 7)) - 1, Number(to.slice(5, 7)) - 1];
  const [d1, d2] = [Number(from.slice(8, 10)), Number(to.slice(8, 10))];
  return m1 === m2 ? `${d1}–${d2} ${MONTHS_GEN[m2]}` : `${d1} ${MONTHS_GEN[m1]} – ${d2} ${MONTHS_GEN[m2]}`;
}

const WEEKDAY_NAMES = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];

interface AgendaEvent {
  id: string;
  start: string;
  color: string;
  extendedProps: { number: string; street: string; city: string; what: string; durationMin: number; pink: boolean; pinkNote: string; urgent: string | null; problem: string | null; next?: boolean; assigned?: string | null };
}

/**
 * Lista: cały tydzień po dniach. Zabieg w jednej linii: godzina i czas trwania, kolor statusu, numer i ulica, pod spodem
 * miejscowość, szkodnik i metoda. Dni bez zabiegów to jedna cienka linia „wolne”.
 */
function WeekAgenda(props: { events: AgendaEvent[]; custom: CalendarEvent[]; me: string | null; from: string; to: string; onOpen: (id: string) => void; onEvent: (e: CalendarEvent) => void }) {
  const today = todayWarsaw();
  const days: string[] = [];
  for (let d = props.from; d < props.to; d = addDays(d, 1)) days.push(d);
  return (
    <div className="agenda">
      {days.map((day) => {
        const list = props.events.filter((e) => e.start.slice(0, 10) === day).sort((a, b) => a.start.localeCompare(b.start));
        const extra = props.custom.filter((e) => eventOnDay(e, day)).sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.start ?? '').localeCompare(b.start ?? ''));
        const extraRows = extra.map((e) => (
          <button key={e.id} type="button" className="agenda-row agenda-event" onClick={() => props.onEvent(e)}>
            <span className="agenda-time">
              {e.allDay ? 'cały' : e.date === day ? e.start : '…'}
              <small>{e.allDay ? 'dzień' : e.endDate === day ? `do ${e.end}` : ''}</small>
            </span>
            <span className="agenda-bar" style={{ background: eventType(e.type).color }} />
            <span className="agenda-text">
              <span>
                <b>{e.name}</b>
                {e.ownerId !== props.me && e.ownerName ? ` · ${firstName(e.ownerName)}` : ''}
              </span>
              {(e.note || eventType(e.type).label !== e.name) && <small>{e.note || eventType(e.type).label}</small>}
            </span>
          </button>
        ));
        const wd = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
        const name = `${day === today ? 'Dziś · ' : ''}${WEEKDAY_NAMES[wd]} ${Number(day.slice(8, 10))}`;
        if (!list.length && !extra.length) {
          return (
            <div key={day} className={day === today ? 'agenda-day agenda-free today' : 'agenda-day agenda-free'}>
              <span>{name}</span>
              <span>wolne</span>
            </div>
          );
        }
        return (
          <section key={day}>
            <div className={day === today ? 'agenda-day today' : 'agenda-day'}>
              <span>{name}</span>
              <span>{list.length || ''}</span>
            </div>
            {extraRows}
            {list.map((e, index) => {
              const x = e.extendedProps;
              const dur = x.durationMin >= 60 ? `${String(x.durationMin / 60).replace('.', ',')} h` : `${x.durationMin} min`;
              return (
                <button key={e.id} type="button" className={x.next ? 'agenda-row agenda-next' : 'agenda-row'} onClick={() => props.onOpen(e.id)}>
                  <span className="agenda-time">
                    <span className="day-pos">
                      {index + 1}/{list.length}
                    </span>
                    {e.start.slice(11, 16)}
                    <small>{dur}</small>
                  </span>
                  <span className="agenda-bar" style={{ background: e.color }} />
                  <span className="agenda-text">
                    <span>
                      <b>{x.number}</b> · {x.street || x.city || 'brak adresu'}
                      {x.assigned ? <span className="agenda-assigned"> · {x.assigned.split(' ')[0]}</span> : null}
                    </span>
                    {(x.pink || x.urgent || x.problem !== null || x.next) && (
                      <span className="agenda-tags">
                        {x.next && <span className="next-badge">Następny</span>}
                        {x.pink && <span className="agenda-pink">PINK</span>}
                        {x.urgent && <span className="agenda-tag agenda-urgent">{x.urgent}</span>}
                        {x.problem !== null && <span className="agenda-tag agenda-problem">Księgowa</span>}
                      </span>
                    )}
                    {x.problem && <small className="agenda-problem-note">Księgowa: {x.problem}</small>}
                    {x.pink && x.pinkNote.trim() ? (
                      <small className="agenda-pink-note">{x.pinkNote.trim()}</small>
                    ) : (
                      <small>{[x.city, x.what].filter(Boolean).join(' · ')}</small>
                    )}
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

const VIEWS: Array<[string, string]> = [
  ['listWeek', 'Lista'],
  ['timeGridDay', 'Dzień'],
  ['timeGridWeek', 'Tydzień'],
  ['dayGridMonth', 'Miesiąc'],
];

function initialDate(): string | undefined {
  try {
    return sessionStorage.getItem(DATE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

const STATUS_COLOR: Record<VisitStatus, string> = {
  // Umówione wyraźnie na niebiesko, odróżniają się od wykonanych (zielone).
  zaplanowany: 'var(--planned)',
  w_trakcie: 'var(--warn)',
  wykonany: 'var(--ok)',
  odwolany: 'var(--muted)',
};

function initialView(): string {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved) return saved;
  } catch {
    // Pamięć przeglądarki bywa zablokowana; wtedy wybieramy widok domyślny.
  }
  return window.matchMedia('(min-width: 900px)').matches ? 'timeGridWeek' : 'listWeek';
}

const NARROW = '(max-width: 600px)';

/** Wąski ekran telefonu: w widoku miesiąca mieści się tylko numer zlecenia. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

/** Kalendarz działa w "UTC", a terminy są czasem warszawskim, więc nic ich nie przesuwa. */
const stripZone = (d: Date) => d.toISOString().slice(0, 16);

export default function CalendarPage() {
  const navigate = useNavigate();
  const { run, toast } = useFeedback();
  const [view] = useState(initialView);
  const [startDate] = useState(initialDate);
  const narrow = useNarrow();
  const calendar = useRef<CalendarRef>(null);
  const api = () => calendar.current?.getApi();
  // Wejście w dzień z miesiąca (dotknięcie dnia albo „+N”): przycisk „Wróć do miesiąca”.
  // Pamiętane do zamknięcia aplikacji: po wejściu w zabieg i powrocie przycisk dalej jest.
  const [fromMonth, setFromMonthState] = useState(() => {
    try {
      return sessionStorage.getItem(FROM_MONTH_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setFromMonth = (on: boolean) => {
    setFromMonthState(on);
    try {
      if (on) sessionStorage.setItem(FROM_MONTH_KEY, '1');
      else sessionStorage.removeItem(FROM_MONTH_KEY);
    } catch {
      // Zapamiętanie to tylko wygoda.
    }
  };
  const [head, setHead] = useState<{ title: string; view: string; hasToday: boolean; date: string; from: string; to: string }>({ title: '', view, hasToday: true, date: '', from: '', to: '' });
  // Przesunięcie palcem w lewo / w prawo: następny / poprzedni dzień, tydzień albo miesiąc.
  const touch = useRef<{ x: number; y: number; at: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || document.querySelector('.fc-event-dragging, .fc-event-mirror')) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Date.now() - start.at > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) api()?.next();
    else api()?.prev();
  };
  const rows = useLiveQuery(async () => ({ visits: await visits.all(), orders: await orders.all(), custom: await listEvents(), me: (await getProfile()).userId }));
  // „+” i dotknięcie godziny: wybór „zlecenie / wydarzenie”; dotknięcie wydarzenia: jego edycja.
  const [adding, setAdding] = useState<CalendarSpot | null>(null);
  const [eventSource, setEventSource] = useState<CalendarEvent | CalendarSpot | null>(null);

  const events = useMemo(() => {
    if (!rows) return [];
    const orderById = new Map(rows.orders.map((o) => [o.id, o]));
    const today = todayWarsaw();
    // Następny zabieg dnia: pomarańczowe wyróżnienie i znaczek „Następny”.
    const nextId = nextVisitOfDay(rows.visits, nowWarsaw());
    return rows.visits
      .filter((v) => v.start && v.status !== 'odwolany' && orderById.has(v.orderId))
      .map((v) => {
        const order = orderById.get(v.orderId)!;
        const phone = mainPhone(order);
        // Czytelnie: gdzie (ulica i miejscowość), co (szkodnik, metoda) i numer zlecenia.
        const street = [order.street, order.houseNo].filter(Boolean).join(' ');
        const place = [street, order.city].filter(Boolean).join(', ') || '—';
        const methods = methodNames(order);
        const what = [pestName(order), methods[0]].filter(Boolean).join(' · ');
        // Krótka ulica do małych bloczków (tydzień, miesiąc): „Zakopiańska”.
        // Znaczniki: pilne lub niedokończone (np. brak płatności, zaległy termin) i problem zgłoszony przez księgową.
        const reason = visitUrgent(order, v, today);
        const urgent = reason ? URGENT_LABEL[reason] : null;
        const problem = order.accountingProblem ? order.accountingNote?.trim() || '' : null;
        // Wykonany innego dnia niż umówiony (np. wcześniej): w kalendarzu w dniu wykonania, o godzinie rozpoczęcia.
        const at =
          v.status === 'wykonany' && v.doneOn && v.doneOn !== v.start!.slice(0, 10)
            ? `${v.doneOn}T${v.startedAt ? clockInWarsaw(v.startedAt) : v.start!.slice(11, 16)}`
            : v.start!;
        const short = (order.street || order.city || '').replace(/^(ul\.|al\.|os\.|pl\.)\s*/i, '').split(/\s+/)[0] ?? '';
        return {
          id: v.id,
          title: `${visitCode(order, v.seq)} · ${place} · ${what}${order.pink ? ' · PINK' : ''}${urgent ? ` · ${urgent}` : ''}${problem !== null ? ' · problem u księgowej' : ''}`,
          start: at,
          end: addMinutes(at, v.durationMin),
          color: STATUS_COLOR[v.status],
          textColor: v.status === 'zaplanowany' ? '#ffffff' : 'var(--surface)',
          editable: v.status === 'zaplanowany',
          extendedProps: { number: visitCode(order, v.seq), digits: String(order.number).padStart(4, '0'), seq: v.seq, pink: order.pink, next: v.id === nextId, assigned: v.status === 'zaplanowany' ? (v.assignedName ?? null) : null, pinkNote: order.pinkNote ?? '', urgent, problem, place, city: order.city, what, phone, short, street, status: v.status, durationMin: v.durationMin },
        };
      });
  }, [rows]);
  // Wydarzenia (wolne, serwis…) jako osobne bloczki: cały dzień u góry dnia, z godzinami w siatce.
  const customEvents = useMemo(() => {
    if (!rows) return [];
    return rows.custom.map((e) => {
      const who = e.ownerId !== rows.me && e.ownerName ? `${firstName(e.ownerName)}: ` : '';
      return {
        id: `ev:${e.id}`,
        title: `${who}${e.name}`,
        start: e.allDay ? e.date : `${e.date}T${e.start}`,
        end: e.allDay ? addDays(e.endDate, 1) : `${e.endDate}T${e.end}`,
        allDay: e.allDay,
        color: eventType(e.type).color,
        textColor: '#ffffff',
        editable: false,
        extendedProps: { custom: true, eventId: e.id },
      };
    });
  }, [rows]);
  const allEvents = useMemo(() => [...events, ...customEvents], [events, customEvents]);
  // Dni z zabiegiem pilnym albo z problemem u księgowej: czerwona kropka przy numerze dnia w miesiącu.
  const alertDays = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) if (e.extendedProps.urgent || e.extendedProps.problem !== null) set.add(e.start.slice(0, 10));
    return set;
  }, [events]);

  return (
    <Page
      title="Kalendarz"
      actions={
        <button type="button" className="icon-btn icon-btn-primary" aria-label="Dodaj zlecenie albo wydarzenie" title="Dodaj" onClick={() => setAdding({ date: head.date || todayWarsaw(), time: null })}>
          <Icon name="plus" size={24} />
        </button>
      }
    >
      <AddChooser
        spot={adding}
        onClose={() => setAdding(null)}
        onOrder={(spot) => navigate(`/zlecenia/nowe?data=${spot.date}${spot.time ? `&czas=${spot.time}` : ''}`)}
        onEvent={(spot) => {
          setAdding(null);
          setEventSource(spot);
        }}
      />
      <EventSheet source={eventSource} onClose={() => setEventSource(null)} />
      <div className="cal-head">
        <button type="button" className="cal-nav cal-nav-prev" aria-label="Wcześniej" onClick={() => api()?.prev()}>
          <Icon name="chevron" />
        </button>
        {/* Dotknięcie tytułu otwiera wybór daty: szybki skok do dowolnego dnia. */}
        <label className="cal-title">
          <span>{head.title}</span>
          <input
            type="date"
            aria-label="Przejdź do dnia"
            value={head.date}
            onChange={(e) => e.target.value && api()?.gotoDate(e.target.value)}
          />
        </label>
        <button type="button" className="cal-nav" aria-label="Później" onClick={() => api()?.next()}>
          <Icon name="chevron" />
        </button>
      </div>
      {fromMonth && head.view === 'timeGridDay' && (
        <button
          type="button"
          className="btn btn-block cal-back"
          onClick={() => {
            const day = api()?.getDate();
            setFromMonth(false);
            api()?.changeView('dayGridMonth', day);
          }}
        >
          <Icon name="back" /> Wróć do miesiąca
        </button>
      )}
      <div className="cal-bar">
        <div className="cal-views" role="group" aria-label="Widok kalendarza">
          {VIEWS.map(([type, label]) => (
            <button key={type} type="button" className={head.view === type ? 'chip active' : 'chip'} aria-pressed={head.view === type} onClick={() => {
                setFromMonth(false);
                api()?.changeView(type);
              }}>
              {label}
            </button>
          ))}
        </div>
        {/* „Dziś” zawsze w tym samym miejscu; wyróżniony, gdy oglądasz inny okres. */}
        <button type="button" className={head.hasToday ? "btn btn-sm" : "btn btn-sm btn-primary"} disabled={head.hasToday} onClick={() => api()?.today()}>
          Dziś
        </button>
      </div>
      <div className={head.view === 'listWeek' ? 'calendar calendar-agenda' : 'calendar'} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {head.view === 'listWeek' && head.from && <WeekAgenda events={events} custom={rows?.custom ?? []} me={rows?.me ?? null} from={head.from} to={head.to} onOpen={(id) => navigate(`/zabieg/${id}`)} onEvent={setEventSource} />}
        <div className={head.view === 'listWeek' ? 'cal-hidden' : undefined}>
        <FullCalendar
          ref={calendar}
          plugins={[classicTheme, dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          locale={plLocale}
          timeZone="UTC"
          now={() => `${nowWarsaw()}:00Z`}
          initialView={view}
          initialDate={startDate}
          headerToolbar={false}
          footerToolbar={false}
          height="auto"
          nowIndicator
          // Wiersz „cały dzień” na wydarzenia jak wolne czy urlop.
          allDaySlot
          allDayText="cały dzień"
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          scrollTime="07:00:00"
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          dayMaxEvents={3}
          // Miesiąc wygląda jak tydzień: kolorowe bloczki z godziną i numerem zlecenia. Najwyżej 3 w dniu, reszta jako
          // „…+2”: dotknięcie otwiera ten dzień (jak w Kalendarzu Google), więc okienko dnia się nie rozciąga.
          // Na komputerze bloczek ma pełny kod, szkodnika i miejscowość. Na telefonie (dzień ok. 50 px) mieszczą się tylko
          // cztery cyfry, a numer kolejnego zabiegu (II, III) jest w osobnej, małej linii.
          eventDisplay="block"
          eventClass={(arg) => {
            const x = arg.event.extendedProps as { pink?: boolean; custom?: boolean; next?: boolean };
            if (x.custom) return 'cal-event cal-event-custom';
            return `cal-event${x.pink ? ' cal-event-pink' : ''}${x.next ? ' cal-event-next' : ''}`;
          }}
          dayCellClass="cal-day"
          views={{
            dayGridMonth: { dayMaxEvents: 3 },
            // Tydzień: godziny od 7 do 20 (wysokość jak w widoku dnia), kolorowe bloczki.
            timeGridWeek: { slotMinTime: '07:00:00', slotMaxTime: '20:00:00' },
          }}
          // Nagłówek tygodnia: skrót dnia i numer, dziś w niebieskim kółku.
          dayHeaderContent={(arg) =>
            arg.view.type === 'timeGridWeek' ? (
              <span className="cal-dh">
                <span>{WEEKDAYS[(arg.date.getUTCDay() + 6) % 7]}</span>
                <span className={arg.isToday ? 'cal-dh-num today' : 'cal-dh-num'}>{arg.date.getUTCDate()}</span>
              </span>
            ) : (
              arg.text
            )
          }
          // Miesiąc: numer dnia, dziś w niebieskim kółku.
          dayCellTopContent={(arg) =>
            arg.view.type === 'dayGridMonth' ? (
              <span className="cal-dn-wrap">
                <span className={arg.isToday ? 'cal-dn today' : arg.isOther ? 'cal-dn other' : 'cal-dn'}>{arg.date.getUTCDate()}</span>
                {alertDays.has(stripZone(arg.date).slice(0, 10)) && <span className="cal-dn-alert" aria-label="Pilne" />}
              </span>
            ) : (
              arg.dayNumberText
            )
          }
          dayCellTopClass="cal-day-top"
          moreLinkClass="cal-more"
          moreLinkClick={() => {
            setFromMonth(true);
            return 'timeGridDay';
          }}
          moreLinkContent={(arg) => `+${arg.num}`}
          moreLinkHint={(num) => `Jeszcze ${num}: otwórz dzień`}
          eventContent={(arg) => {
            // Przeciąganie zabiegu: kopia pod palcem pokazuje dużą godzinę (w miesiącu dzień), na którą trafi.
            if (arg.isMirror && arg.event.start) {
              const at = stripZone(arg.event.start);
              const label = arg.view.type === 'dayGridMonth' ? `${at.slice(8, 10)}.${at.slice(5, 7)}` : at.slice(11, 16);
              return (
                <span className="cal-drag">
                  <b>{label}</b>
                  <span>{(arg.event.extendedProps as { digits?: string }).digits ?? arg.event.title}</span>
                </span>
              );
            }
            if ((arg.event.extendedProps as { custom?: boolean }).custom) {
              const time = arg.event.allDay || !arg.event.start ? '' : stripZone(arg.event.start).slice(11, 16);
              return arg.view.type === 'dayGridMonth' || arg.event.allDay ? (
                <span className="cal-chip cal-chip-event" title={arg.event.title}>
                  {time ? `${time} ` : ''}
                  {arg.event.title}
                </span>
              ) : (
                <span className="cal-gblock cal-gblock-event" title={arg.event.title}>
                  <b>{arg.event.title}</b>
                  <span>{time}</span>
                </span>
              );
            }
            const { number, digits, seq, pink, place, what } = arg.event.extendedProps as {
              number: string;
              digits: string;
              seq: number;
              pink: boolean;
              place: string;
              city: string;
              what: string;
            };
            const { short, urgent, problem } = arg.event.extendedProps as { short: string; urgent: string | null; problem: string | null };
            const marks =
              urgent || problem !== null ? (
                <span className="cal-marks">
                  {urgent && <span className="cal-mark cal-mark-urgent" aria-label={urgent}>!</span>}
                  {problem !== null && <span className="cal-mark cal-mark-problem" aria-label="Problem u księgowej">K</span>}
                </span>
              ) : null;
            const time = arg.event.start ? stripZone(arg.event.start).slice(11, 16) : '';
            const month = arg.view.type === 'dayGridMonth';
            const label = `${digits}${seq > 1 ? ` ${roman(seq)}` : ''}`;
            // Miesiąc jak w Google: jeden kolorowy pasek z numerem i ulicą (na komputerze także godzina).
            if (month) {
              return (
                <span className="cal-chip" title={arg.event.title}>
                  {pink && <span className="cal-pink-dot" aria-label="Kod pink" />}
                  {marks}
                  {narrow ? '' : `${time} `}
                  <b>{label}</b> {narrow ? short : place}
                </span>
              );
            }
            // Tydzień na telefonie (kolumna ok. 45 px): numer i ulica w kolorowym bloczku.
            if (arg.view.type === 'timeGridWeek' && narrow) {
              return (
                // Wąska kolumna: kod pink to sama różowa ramka (narożnik zasłaniałby numer zabiegu).
                <span className="cal-gblock" title={arg.event.title}>
                  {marks}
                  <b>{label}</b>
                  <span>{short}</span>
                </span>
              );
            }
            return (
              <span className={`cal-block${arg.view.type.startsWith('list') ? ' cal-block-list' : ''}`} title={arg.event.title}>
                {pink && <span className="cal-pink-flag" aria-label="Kod pink" />}
                {marks}
                <span className="cal-block-number">
                  {`${time} `}
                  {number}
                </span>
                <span className="cal-block-place">{place}</span>
                <span className="cal-block-what">{what}</span>
              </span>
            );
          }}
          noEventsText="Brak zabiegów w tym okresie"
          listItemEventTimeClass="cal-list-time"
          listItemEventTitleClass="cal-list-title"
          events={allEvents}
          editable
          // Przeciąganie zabiegu przesuwa termin co 10 minut.
          snapDuration="00:10:00"
          eventDurationEditable={false}
          longPressDelay={350}
          datesSet={(info) => {
            const today = todayWarsaw();
            const from = stripZone(info.view.currentStart).slice(0, 10);
            const to = stripZone(info.view.currentEnd).slice(0, 10);
            // Oglądany dzień: dziś, gdy jest w widoku, inaczej początek okresu.
            const date = today >= from && today < to ? today : from;
            // Tydzień i lista: „9–15 listopada” zamiast samego miesiąca.
            const week = info.view.type === 'timeGridWeek' || info.view.type === 'listWeek';
            const title = week ? weekTitle(from, addDays(to, -1)) : info.view.title;
            setHead({ title, view: info.view.type, hasToday: today >= from && today < to, date, from, to });
            try {
              localStorage.setItem(VIEW_KEY, info.view.type);
              sessionStorage.setItem(DATE_KEY, date);
            } catch {
              // Zapamiętanie widoku i dnia to tylko wygoda.
            }
          }}
          dateClick={(info) => {
            const date = info.dateStr.slice(0, 10);
            // Miesiąc: dotknięcie dnia otwiera ten dzień (nowe zlecenie dodaje się przyciskiem +).
            if (info.view.type === 'dayGridMonth') {
              setFromMonth(true);
              api()?.changeView('timeGridDay', date);
              return;
            }
            // Dzień i tydzień: dotknięcie godziny pyta, czy to zlecenie, czy wydarzenie (np. serwis auta).
            setAdding({ date, time: info.allDay ? null : info.dateStr.slice(11, 16) });
          }}
          eventClick={(info) => {
            const x = info.event.extendedProps as { custom?: boolean; eventId?: string };
            if (x.custom) {
              const found = rows?.custom.find((e) => e.id === x.eventId);
              if (found) setEventSource(found);
              return;
            }
            navigate(`/zabieg/${info.event.id}`);
          }}
          eventDrop={(info) => {
            const { id, start: newStart } = info.event;
            if (!newStart) return;
            const oldStart = info.oldEvent.start ? stripZone(info.oldEvent.start) : null;
            const start = stripZone(newStart);
            void run(async () => {
              await visits.update(id, { start });
              toast(`Nowy termin: ${formatTerm(start)}`, {
                action: { label: 'Cofnij', onClick: () => void run(() => visits.update(id, { start: oldStart })) },
              });
            });
          }}
        />
        </div>
      </div>
      <p className="cal-legend">
        <span><span className="cal-mark cal-mark-urgent">!</span> pilne / niedokończone</span>
        <span><span className="cal-mark cal-mark-problem">K</span> problem u księgowej</span>
        <span><span className="cal-legend-pink" /> kod pink</span>
      </p>
    </Page>
  );
}
