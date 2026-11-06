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
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clients, jobs } from '../data/repo';
import type { JobStatus } from '../data/types';
import { addMinutes, formatTerm, nowWarsaw } from '../lib/dates';
import { useFeedback } from '../ui/feedback';
import { AddLink, Page } from '../ui/kit';

const VIEW_KEY = 'ddd-kalendarz-widok';

const STATUS_COLOR: Record<JobStatus, string> = {
  wycena: 'var(--info)',
  zaplanowane: 'var(--primary)',
  wykonane: 'var(--ok)',
  anulowane: 'var(--muted)',
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

/** Kalendarz działa w "UTC", a terminy są czasem warszawskim, więc nic ich nie przesuwa. */
const stripZone = (d: Date) => d.toISOString().slice(0, 16);

export default function CalendarPage() {
  const navigate = useNavigate();
  const { run, toast } = useFeedback();
  const [view] = useState(initialView);
  const rows = useLiveQuery(async () => ({ jobs: await jobs.all(), clients: await clients.all() }));

  const events = useMemo(() => {
    if (!rows) return [];
    const nameOf = new Map(rows.clients.map((c) => [c.id, c.name]));
    return rows.jobs
      .filter((j) => j.start && j.status !== 'anulowane')
      .map((j) => ({
        id: j.id,
        title: `${nameOf.get(j.clientId) ?? 'Klient'} · ${j.title}`,
        start: j.start!,
        end: addMinutes(j.start!, j.durationMin),
        color: STATUS_COLOR[j.status],
        textColor: 'var(--surface)',
        editable: j.status === 'zaplanowane',
      }));
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
          noEventsText="Brak zleceń w tym okresie"
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
          eventClick={(info) => navigate(`/zlecenia/${info.event.id}`)}
          eventDrop={(info) => {
            const { id, start: newStart } = info.event;
            if (!newStart) return;
            const oldStart = info.oldEvent.start ? stripZone(info.oldEvent.start) : null;
            const start = stripZone(newStart);
            void run(async () => {
              await jobs.update(id, { start });
              toast(`Nowy termin: ${formatTerm(start)}`, {
                action: { label: 'Cofnij', onClick: () => void run(() => jobs.update(id, { start: oldStart })) },
              });
            });
          }}
        />
      </div>
    </Page>
  );
}
