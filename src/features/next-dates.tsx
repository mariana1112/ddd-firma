import { useLiveQuery } from 'dexie-react-hooks';
import { visitCode } from '../data/codes';
import { freeSlots, nextVisitDays, type DayStop } from '../data/geo';
import { orders, visits } from '../data/repo';
import { formatDate } from '../lib/dates';
import { dayOff, eventBusy, listEvents } from '../data/events';
import { getProfile } from '../data/settings';
import { WeekPreview } from './week-preview';

const weekday = new Intl.DateTimeFormat('pl-PL', { timeZone: 'UTC', weekday: 'short' });
const dayLabel = (date: string) => `${weekday.format(new Date(`${date}T12:00:00Z`))} ${formatDate(date).slice(0, 5)}`;

/**
 * Proponowane terminy kolejnego zabiegu: zawsze 8–12 dni po poprzednim (bez niedziel), w każdym dniu pierwsza wolna
 * godzina między już umówionymi zabiegami (z 30 minutami na dojazd). Dotknięcie ustawia datę i godzinę.
 */
export function NextDates(props: {
  after: string;
  durationMin: number;
  date: string;
  time: string;
  /** Edytowany zabieg: nie liczy się jako zajęty (inaczej propozycja omija jego własną godzinę). */
  exclude?: string;
  onPick: (date: string, time: string) => void;
}) {
  const days = nextVisitDays(props.after);
  const proposals = useLiveQuery(async () => {
    const byId = new Map((await orders.all()).map((o) => [o.id, o]));
    const all = (await visits.all()).filter((v) => (v.status === 'zaplanowany' || v.status === 'w_trakcie') && v.start && byId.has(v.orderId) && v.id !== props.exclude);
    // Moje wolne i urlop wykluczają dzień, a wydarzenia z godzinami zajmują te godziny.
    const events = await listEvents();
    const me = (await getProfile()).userId;
    return days
      .filter((date) => !dayOff(events, date, me))
      .map((date) => {
        const stops: DayStop[] = all
          .filter((v) => v.start!.slice(0, 10) === date)
          .map((v) => {
            const order = byId.get(v.orderId)!;
            return { start: v.start!, durationMin: v.durationMin || 60, label: visitCode(order, v.seq), city: order.city, point: null };
          })
          .concat(eventBusy(events, date, me).map((b) => ({ ...b, city: '', point: null })));
        // Licznik „(N zab.)” tylko z zabiegów, bez wydarzeń.
        return { date, time: freeSlots(stops, null, props.durationMin || 60)[0] ?? null, busy: all.filter((v) => v.start!.slice(0, 10) === date).length };
      })
      .filter((p): p is { date: string; time: string; busy: number } => p.time !== null);
  }, [props.after, props.durationMin, props.exclude]);
  if (!proposals) return null;
  return (
    <div className="field">
      <span className="field-label">Proponowane terminy: 8–12 dni po zabiegu z {formatDate(props.after)}</span>
      {proposals.length === 0 ? (
        <p className="field-hint">W tych dniach nie ma wolnych godzin (albo masz wolne). Wpisz datę ręcznie.</p>
      ) : (
        <div className="chips chips-wrap">
          {proposals.map((p) => (
            <button
              key={p.date}
              type="button"
              className={props.date === p.date && props.time === p.time ? 'chip active' : 'chip'}
              onClick={() => props.onPick(p.date, p.time)}
            >
              {dayLabel(p.date)} · {p.time}
              {p.busy ? ` (${p.busy} zab.)` : ''}
            </button>
          ))}
        </div>
      )}
      {/* Tydzień wybranego terminu godzinowo: co już jest umówione, gdzie wpada nowy zabieg. */}
      <WeekPreview date={props.date || days[0]} time={props.time} durationMin={props.durationMin} exclude={props.exclude} onPick={props.onPick} />
    </div>
  );
}
