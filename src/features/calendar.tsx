import FullCalendar from '@fullcalendar/react';
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
import { visitCode } from '../data/codes';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { orders, visits } from '../data/repo';
import { pestName } from '../data/texts';
import type { VisitStatus } from '../data/types';
import { addMinutes, formatTerm, nowWarsaw } from '../lib/dates';
import { useFeedback } from '../ui/feedback';
import { AddLink, Page } from '../ui/kit';

const VIEW_KEY = 'ddd-kalendarz-widok';

const STATUS_COLOR: Record<VisitStatus, string> = {
  zaplanowany: 'var(--primary)',
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
  const narrow = useNarrow();
  const rows = useLiveQuery(async () => ({ visits: await visits.all(), orders: await orders.all() }));

  const events = useMemo(() => {
    if (!rows) return [];
    const orderById = new Map(rows.orders.map((o) => [o.id, o]));
    return rows.visits
      .filter((v) => v.start && v.status !== 'odwolany' && orderById.has(v.orderId))
      .map((v) => {
        const order = orderById.get(v.orderId)!;
        return {
          id: v.id,
          title: `${visitCode(order, v.seq)} ${pestName(order)}, ${order.city}${order.pink ? ' · PINK' : ''}`,
          start: v.start!,
          end: addMinutes(v.start!, v.durationMin),
          color: STATUS_COLOR[v.status],
          textColor: 'var(--surface)',
          editable: v.status === 'zaplanowany',
          extendedProps: { number: visitCode(order, v.seq), pink: order.pink, label: `${pestName(order)}, ${order.city}` },
        };
      });
  }, [rows]);

  return (
    <Page title="Kalendarz" actions={<AddLink to="/zlecenia/nowe" label="Nowe zlecenie" />}>
      <div className="calendar">
        <FullCalendar
          plugins={[classicTheme, dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          locale={plLocale}
          timeZone="UTC"
          now={() => `${nowWarsaw()}:00Z`}
          initialView={view}
          headerToolbar={{ start: 'title', end: 'prev,today,next' }}
          footerToolbar={{ center: 'listWeek,timeGridDay,timeGridWeek,dayGridMonth' }}
          buttons={{
            today: { text: 'Dziś' },
            listWeek: { text: 'Lista' },
            timeGridDay: { text: 'Dzień' },
            timeGridWeek: { text: 'Tydzień' },
            dayGridMonth: { text: 'Miesiąc' },
          }}
          height="auto"
          nowIndicator
          allDaySlot={false}
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          scrollTime="07:00:00"
          eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
          dayMaxEvents={3}
          // Miesiąc wygląda jak tydzień: kolorowe bloczki z godziną i numerem zlecenia, wszystkie bez „+więcej”.
          // Na komputerze bloczek ma też szkodnika i miejscowość, na telefonie (dzień ok. 50 px) tylko numer.
          eventDisplay="block"
          views={{ dayGridMonth: { dayMaxEvents: false } }}
          eventContent={(arg) => {
            if (arg.view.type !== 'dayGridMonth') return true;
            const { number, pink, label } = arg.event.extendedProps as { number: string; pink: boolean; label: string };
            return (
              <span className={pink ? 'cal-block cal-block-pink' : 'cal-block'} title={arg.event.title}>
                <span className="cal-block-time">{arg.event.start ? stripZone(arg.event.start).slice(11, 16) : ''}</span>
                <span className="cal-block-number">
                  {number}
                  {!narrow && <span className="cal-block-label"> {label}</span>}
                </span>
              </span>
            );
          }}
          noEventsText="Brak zabiegów w tym okresie"
          listItemEventTimeClass="cal-list-time"
          listItemEventTitleClass="cal-list-title"
          events={events}
          editable
          eventDurationEditable={false}
          longPressDelay={350}
          datesSet={(info) => {
            try {
              localStorage.setItem(VIEW_KEY, info.view.type);
            } catch {
              // Zapamiętanie widoku to tylko wygoda.
            }
          }}
          dateClick={(info) => {
            const date = info.dateStr.slice(0, 10);
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
