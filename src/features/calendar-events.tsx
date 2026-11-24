import { useState } from 'react';
import { createEvent, deleteEvent, EVENT_TYPES, eventErrors, eventType, updateEvent, type CalendarEvent, type EventDraft, type EventType } from '../data/events';
import { formatDate } from '../lib/dates';
import { useFeedback } from '../ui/feedback';
import { useOnce } from '../ui/once';
import { Icon } from '../ui/icons';
import { Field, Sheet, TimeSelect } from '../ui/kit';

/** Miejsce w kalendarzu, w które dotknięto (dzień i ewentualnie godzina). */
export interface CalendarSpot {
  date: string;
  time: string | null;
}

const plusHour = (time: string) => {
  const h = Math.min(23, Number(time.slice(0, 2)) + 1);
  return `${String(h).padStart(2, '0')}:${time.slice(3, 5)}`;
};

/** „+” w kalendarzu albo dotknięcie godziny: nowe zlecenie czy wydarzenie (wolne, serwis…), jak w Kalendarzu Google. */
export function AddChooser(props: { spot: CalendarSpot | null; onOrder: (spot: CalendarSpot) => void; onEvent: (spot: CalendarSpot) => void; onClose: () => void }) {
  const spot = props.spot;
  return (
    <Sheet open={Boolean(spot)} title={spot ? `Dodaj: ${formatDate(spot.date)}${spot.time ? `, ${spot.time}` : ''}` : 'Dodaj'} onClose={props.onClose}>
      {spot && (
        <div className="form">
          <button type="button" className="btn btn-primary btn-block btn-big" onClick={() => props.onOrder(spot)}>
            <Icon name="clipboard" /> Nowe zlecenie
          </button>
          <button type="button" className="btn btn-block btn-big" onClick={() => props.onEvent(spot)}>
            <Icon name="calendar" /> Wydarzenie (wolne, urlop, serwis…)
          </button>
        </div>
      )}
    </Sheet>
  );
}

function draftFrom(source: CalendarEvent | CalendarSpot): EventDraft {
  if ('kind' in source) {
    return {
      type: source.type,
      name: source.name,
      date: source.date,
      endDate: source.endDate,
      allDay: source.allDay,
      start: source.start ?? '09:00',
      end: source.end ?? '10:00',
      note: source.note,
    };
  }
  const start = source.time ?? '09:00';
  return { type: 'wolne', name: 'Wolne', date: source.date, endDate: source.date, allDay: !source.time, start, end: plusHour(start), note: '' };
}

/** Nowe albo zmieniane wydarzenie: rodzaj, tytuł, cały dzień albo godziny, kilka dni, notatka. */
export function EventSheet(props: { source: CalendarEvent | CalendarSpot | null; onClose: () => void }) {
  return (
    <Sheet open={Boolean(props.source)} title={props.source && 'kind' in props.source ? 'Wydarzenie' : 'Nowe wydarzenie'} onClose={props.onClose}>
      {props.source && <EventForm key={'kind' in props.source ? props.source.id : `${props.source.date}${props.source.time}`} source={props.source} onClose={props.onClose} />}
    </Sheet>
  );
}

function EventForm({ source, onClose }: { source: CalendarEvent | CalendarSpot; onClose: () => void }) {
  const { confirm, run, toast } = useFeedback();
  const { once, pending } = useOnce();
  const editing = 'kind' in source ? source : null;
  const [d, setD] = useState<EventDraft>(() => draftFrom(source));
  const [tried, setTried] = useState(false);
  const set = (patch: Partial<EventDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const errors = eventErrors(d);
  // Rodzaj podpowiada tytuł (gdy nie wpisano własnego) i „cały dzień” dla wolnego i urlopu.
  const pickType = (type: EventType) => {
    const labels = EVENT_TYPES.map((t) => t.label);
    const info = eventType(type);
    set({ type, name: !d.name.trim() || labels.includes(d.name.trim()) ? info.label : d.name, allDay: info.allDay });
  };
  const save = () =>
    run(async () => {
      setTried(true);
      if (errors.length) return;
      if (editing) await updateEvent(editing.id, d);
      else await createEvent(d);
      toast(editing ? 'Zapisano wydarzenie' : `Dodano: ${d.name.trim()}, ${formatDate(d.date)}`);
      onClose();
    });
  const remove = async () => {
    if (!editing) return;
    const ok = await confirm({ title: `Usunąć „${editing.name}”?`, message: 'Wydarzenie trafi do kosza.', confirmLabel: 'Usuń', danger: true });
    if (!ok) return;
    await run(async () => {
      await deleteEvent(editing.id);
      toast('Usunięto wydarzenie');
      onClose();
    });
  };
  return (
    <div className="form">
      <div className="field">
        <span className="field-label">Rodzaj</span>
        <div className="chips chips-wrap" role="group" aria-label="Rodzaj wydarzenia">
          {EVENT_TYPES.map((t) => (
            <button key={t.type} type="button" className={d.type === t.type ? 'chip active' : 'chip'} aria-pressed={d.type === t.type} onClick={() => pickType(t.type)}>
              <span className="event-dot" style={{ background: t.color }} /> {t.label}
            </button>
          ))}
        </div>
      </div>
      <Field label="Tytuł" error={tried && !d.name.trim() ? 'Wpisz, co to za wydarzenie' : undefined}>
        <input value={d.name} placeholder="Np. Serwis auta, Wolne, Szkolenie BHP" onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={d.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
        Cały dzień
      </label>
      <div className="form-row">
        <Field label="Od dnia">
          <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value, endDate: e.target.value > d.endDate ? e.target.value : d.endDate })} />
        </Field>
        <Field label="Do dnia" error={tried && d.endDate < d.date ? 'Przed początkiem' : undefined}>
          <input type="date" value={d.endDate} min={d.date} onChange={(e) => set({ endDate: e.target.value })} />
        </Field>
      </div>
      {!d.allDay && (
        <div className="form-row">
          <Field label="Od godziny">
            <TimeSelect value={d.start} onChange={(start) => set({ start, end: d.end <= start && d.endDate === d.date ? plusHour(start) : d.end })} />
          </Field>
          <Field label="Do godziny">
            <TimeSelect value={d.end} onChange={(end) => set({ end })} />
          </Field>
        </div>
      )}
      <Field label="Notatka (opcjonalnie)">
        <textarea rows={2} value={d.note} placeholder="Np. warsztat na Grunwaldzkiej, wymiana opon" onChange={(e) => set({ note: e.target.value })} />
      </Field>
      {tried && errors.length > 0 && <p className="field-message">{errors[0]}</p>}
      <button type="button" className="btn btn-primary btn-block" disabled={pending} onClick={() => void once(save)}>
        <Icon name="check" /> {editing ? 'Zapisz zmiany' : 'Dodaj wydarzenie'}
      </button>
      {editing && (
        <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => void remove()}>
          <Icon name="trash" /> Usuń wydarzenie
        </button>
      )}
    </div>
  );
}
