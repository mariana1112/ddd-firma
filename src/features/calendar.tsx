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
import type { VisitStatus } from '../data/types';
import { addMinutes, formatTerm, nowWarsaw, todayWarsaw } from '../lib/dates';
import { Icon } from '../ui/icons';
import { useFeedback } from '../ui/feedback';
import { AddLink, Page } from '../ui/kit';

const VIEW_KEY = 'ddd-kalendarz-widok';
/** Oglądany dzień: po wejściu w zabieg i powrocie kalendarz jest tam, gdzie był (do zamknięcia aplikacji). */
const DATE_KEY = 'ddd-kalendarz-data';

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
  const [head, setHead] = useState<{ title: string; view: string; hasToday: boolean; date: string }>({ title: '', view, hasToday: true, date: '' });
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
  const rows = useLiveQuery(async () => ({ visits: await visits.all(), orders: await orders.all() }));

  const events = useMemo(() => {
    if (!rows) return [];
    const orderById = new Map(rows.orders.map((o) => [o.id, o]));
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
        return {
          id: v.id,
          title: `${visitCode(order, v.seq)} · ${place} · ${what}${order.pink ? ' · PINK' : ''}`,
          start: v.start!,
          end: addMinutes(v.start!, v.durationMin),
          color: STATUS_COLOR[v.status],
          textColor: v.status === 'zaplanowany' ? '#ffffff' : 'var(--surface)',
          editable: v.status === 'zaplanowany',
          extendedProps: { number: visitCode(order, v.seq), digits: String(order.number).padStart(4, '0'), seq: v.seq, pink: order.pink, place, city: order.city, what, phone },
        };
      });
  }, [rows]);

  return (
    <Page title="Kalendarz" actions={<AddLink to="/zlecenia/nowe" label="Nowe zlecenie" />}>
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
      <div className="cal-bar">
        <div className="cal-views" role="group" aria-label="Widok kalendarza">
          {VIEWS.map(([type, label]) => (
            <button key={type} type="button" className={head.view === type ? 'chip active' : 'chip'} aria-pressed={head.view === type} onClick={() => api()?.changeView(type)}>
              {label}
            </button>
          ))}
        </div>
        {/* „Dziś” zawsze w tym samym miejscu; wyróżniony, gdy oglądasz inny okres. */}
        <button type="button" className={head.hasToday ? "btn btn-sm" : "btn btn-sm btn-primary"} disabled={head.hasToday} onClick={() => api()?.today()}>
          Dziś
        </button>
      </div>
      <div className="calendar" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
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
          allDaySlot={false}
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
          eventClass="cal-event"
          dayCellClass="cal-day"
          views={{ dayGridMonth: { dayMaxEvents: 3 } }}
          moreLinkClick="timeGridDay"
          moreLinkContent={(arg) => `…+${arg.num}`}
          moreLinkHint={(num) => `Jeszcze ${num}: otwórz dzień`}
          eventContent={(arg) => {
            const { number, digits, seq, pink, place, city, what } = arg.event.extendedProps as {
              number: string;
              digits: string;
              seq: number;
              pink: boolean;
              place: string;
              city: string;
              what: string;
            };
            const time = arg.event.start ? stripZone(arg.event.start).slice(11, 16) : '';
            const month = arg.view.type === 'dayGridMonth';
            // Miesiąc na telefonie (dzień ok. 50 px): godzina, cztery cyfry numeru i miejscowość.
            if (month && narrow) {
              return (
                <span className={pink ? 'cal-block cal-block-pink' : 'cal-block'} title={arg.event.title}>
                  <span className="cal-block-time">{time}</span>
                  <span className="cal-block-number">
                    {digits}
                  </span>
                  <span className="cal-block-city">
                    {seq > 1 ? `${roman(seq)} · ` : ''}
                    {city}
                  </span>
                </span>
              );
            }
            return (
              <span className={`cal-block${pink ? ' cal-block-pink' : ''}${arg.view.type.startsWith('list') ? ' cal-block-list' : ''}`} title={arg.event.title}>
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
          events={events}
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
            setHead({ title: info.view.title, view: info.view.type, hasToday: today >= from && today < to, date });
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
              api()?.changeView('timeGridDay', date);
              return;
            }
            const time = info.allDay ? '' : `&czas=${info.dateStr.slice(11, 16)}`;
            navigate(`/zlecenia/nowe?data=${date}${time}`);
          }}
          eventClick={(info) => navigate(`/zabieg/${info.event.id}`)}
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
    </Page>
  );
}
