import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { visitCode } from '../data/codes';
import { eventOnDay, eventType, listEvents } from '../data/events';
import { orders, visits } from '../data/repo';
import { orderAddress, pestName } from '../data/texts';
import type { Order, Visit } from '../data/types';
import { addDays, formatDate, todayWarsaw } from '../lib/dates';
import { withCountryCode } from '../lib/validators';
import { Icon } from '../ui/icons';
import { Info, Sheet } from '../ui/kit';

const H0 = 7;
const H1 = 20;
const HOUR_PX = 24;
/** Wysokość nagłówka dnia (jak .wp-head w CSS): od niej liczymy linię godziny przy przeciąganiu. */
const HEAD_PX = 34;
const DAYS = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const monday = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));

/**
 * Podgląd tygodnia przy umawianiu terminu: siatka godzin 7–20 z umówionymi zabiegami i wydarzeniami oraz wybranym
 * terminem (pomarańczowa ramka). Dotknięcie zabiegu otwiera jego podgląd (i powrót), dotknięcie pustego miejsca
 * ustawia ten dzień i godzinę.
 */
export function WeekPreview(props: {
  date: string;
  time: string;
  durationMin: number;
  exclude?: string;
  onPick?: (date: string, time: string) => void;
  /** Napis przycisku powrotu, np. „Wróć do zakończenia zabiegu I”. */
  backLabel?: string;
  /** Bez „Otwórz kartę zabiegu” (np. w trakcie kończenia zabiegu, żeby nie wyjść z zakończenia). */
  stay?: boolean;
}) {
  const [peek, setPeek] = useState<{ visit: Visit; order: Order } | null>(null);
  // Przeciąganie wybranego terminu: przytrzymanie (na telefonie) albo od razu myszką.
  const [drag, setDrag] = useState<{ day: string; time: string } | null>(null);
  const bodies = useRef<Array<HTMLDivElement | null>>([]);
  const start = monday(props.date || todayWarsaw());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const data = useLiveQuery(async () => {
    const byId = new Map((await orders.all()).map((o) => [o.id, o]));
    const list = (await visits.all()).filter((v) => v.start && v.status !== 'odwolany' && v.id !== props.exclude && byId.has(v.orderId) && v.start.slice(0, 10) >= start && v.start.slice(0, 10) <= days[6]);
    return { list: list.map((visit) => ({ visit, order: byId.get(visit.orderId)! })), events: await listEvents() };
  }, [start, props.exclude]);
  if (!data) return null;

  /** Godzina w miejscu y kolumny (co 30 min, tak żeby zabieg mieścił się do 20:00). */
  const timeAt = (y: number) => {
    const min = Math.max(0, Math.min((H1 - H0) * 60 - (props.durationMin || 60), Math.round(((y / HOUR_PX) * 60) / 30) * 30));
    const t = H0 * 60 + min;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  const pick = (day: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (!props.onPick) return;
    props.onPick(day, timeAt(e.clientY - e.currentTarget.getBoundingClientRect().top));
  };
  /** Dzień i godzina pod palcem (przy przeciąganiu terminu). */
  const slotAt = (x: number, y: number) => {
    const i = bodies.current.findIndex((b) => b && x >= b.getBoundingClientRect().left && x < b.getBoundingClientRect().right);
    const last = x < (bodies.current[0]?.getBoundingClientRect().left ?? 0) ? 0 : 6;
    const body = bodies.current[i >= 0 ? i : last];
    if (!body) return null;
    // Przy przeciąganiu wskazujemy środek bloku, a nie jego górną krawędź.
    const offset = ((props.durationMin || 60) / 60) * HOUR_PX * 0.5;
    return { day: days[i >= 0 ? i : last], time: timeAt(y - body.getBoundingClientRect().top - offset) };
  };
  // Ruch i puszczenie śledzimy na całym oknie: blok przeskakuje między kolumnami (nowy element), więc nie może sam
  // trzymać palca.
  const startDrag = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!props.onPick) return;
    e.stopPropagation();
    const onPick = props.onPick;
    const from = { day: props.date, time: props.time };
    let current = from;
    let on = false;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const begin = () => {
      on = true;
      navigator.vibrate?.(15);
      setDrag(from);
    };
    const timer = e.pointerType === 'mouse' ? 0 : window.setTimeout(begin, 300);
    if (e.pointerType === 'mouse') begin();
    const move = (ev: PointerEvent) => {
      if (!on) {
        // Palec ruszył przed przytrzymaniem: to przewijanie, nie przeciąganie.
        if (Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 10) stop();
        return;
      }
      ev.preventDefault();
      const slot = slotAt(ev.clientX, ev.clientY);
      if (slot && (slot.day !== current.day || slot.time !== current.time)) {
        current = slot;
        setDrag(slot);
      }
    };
    const up = () => {
      stop();
      if (on && (current.day !== from.day || current.time !== from.time)) onPick(current.day, current.time);
    };
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      setDrag(null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
  };
  const shown = drag ?? { day: props.date, time: props.time };
  const top = (time: string) => ((toMin(time) - H0 * 60) / 60) * HOUR_PX;
  const height = (min: number) => Math.max(14, (min / 60) * HOUR_PX - 2);
  const today = todayWarsaw();
  // Zabieg poza siatką 7–20 (np. wieczorem) nie znika: stoi przy krawędzi siatki z godziną, żeby dzień nie wyglądał na wolny.
  const GRID_PX = (H1 - H0) * HOUR_PX;
  const place = (time: string, min: number) => {
    const t = top(time);
    const h = height(min);
    if (t >= 0 && t + h <= GRID_PX) return { top: t, height: h, outside: false };
    const clampedTop = Math.min(Math.max(t, 0), GRID_PX - 14);
    return { top: clampedTop, height: Math.max(14, Math.min(h, GRID_PX - clampedTop, t + h - clampedTop)), outside: t < 0 || t >= GRID_PX };
  };

  return (
    <div className="week-preview">
      <span className="field-label">
        Tydzień {formatDate(start).slice(0, 5)}–{formatDate(days[6]).slice(0, 5)}: dotknij zabiegu, żeby go podejrzeć
        {props.onPick && props.time ? '; przytrzymaj pomarańczowy termin, żeby go przesunąć' : ''}
      </span>
      <div className="wp-grid">
        <div className="wp-hours">
          <span className="wp-head" />
          {Array.from({ length: H1 - H0 }, (_, i) => (
            <span key={i} className="wp-hour" style={{ height: HOUR_PX }}>
              {H0 + i}
            </span>
          ))}
        </div>
        {days.map((day, i) => (
          <div key={day} className={day === today ? 'wp-col wp-col-today' : 'wp-col'}>
            <span className={['wp-head', day === today && 'wp-head-today', day === shown.day && 'wp-head-picked'].filter(Boolean).join(' ')}>
              {DAYS[i]}
              <b>{Number(day.slice(8, 10))}</b>
            </span>
            <div
              ref={(el) => {
                bodies.current[i] = el;
              }}
              className="wp-body"
              style={{ height: (H1 - H0) * HOUR_PX }}
              onClick={(e) => pick(day, e)}
            >
              {data.events
                .filter((ev) => eventOnDay(ev, day))
                .map((ev) => (
                  <span
                    key={ev.id}
                    className="wp-block wp-event"
                    title={ev.name}
                    style={{
                      background: eventType(ev.type).color,
                      top: ev.allDay ? 0 : top(ev.date === day ? ev.start! : `${H0}:00`.padStart(5, '0')),
                      height: ev.allDay ? (H1 - H0) * HOUR_PX : height(toMin(ev.endDate === day ? ev.end! : `${H1}:00`) - toMin(ev.date === day ? ev.start! : `${String(H0).padStart(2, '0')}:00`)),
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {ev.name}
                  </span>
                ))}
              {data.list
                .filter(({ visit }) => visit.start!.slice(0, 10) === day)
                .map(({ visit, order }) => (
                  <button
                    key={visit.id}
                    type="button"
                    className={`wp-block wp-visit wp-${visit.status}${place(visit.start!.slice(11, 16), visit.durationMin || 60).outside ? ' wp-outside' : ''}`}
                    style={{ top: place(visit.start!.slice(11, 16), visit.durationMin || 60).top, height: place(visit.start!.slice(11, 16), visit.durationMin || 60).height }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPeek({ visit, order });
                    }}
                  >
                    {place(visit.start!.slice(11, 16), visit.durationMin || 60).outside ? `${visit.start!.slice(11, 16)} ` : ''}
                    {String(order.number).padStart(4, '0')}
                  </button>
                ))}
              {day === shown.day && shown.time && (
                <span
                  className={drag ? 'wp-block wp-picked wp-dragging' : props.onPick ? 'wp-block wp-picked wp-movable' : 'wp-block wp-picked'}
                  style={{ top: top(shown.time), height: height(props.durationMin || 60) }}
                  onPointerDown={startDrag}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  {shown.time}
                </span>
              )}
            </div>
          </div>
        ))}
        {/* Przy przeciąganiu: biała linia przez cały tydzień na godzinie, na którą przesuwasz termin. */}
        {drag && (
          <span className="wp-drag-line" style={{ top: HEAD_PX + top(drag.time) }}>
            <b>{drag.time}</b>
          </span>
        )}
      </div>
      <Sheet open={Boolean(peek)} title={peek ? `Podgląd: ${visitCode(peek.order, peek.visit.seq)}` : ''} onClose={() => setPeek(null)}>
        {peek && (
          <div className="form">
            <Info label="Termin">{`${formatDate(peek.visit.start)} ${peek.visit.start!.slice(11, 16)} (${peek.visit.durationMin || 60} min)`}</Info>
            <Info label="Adres">{orderAddress(peek.order) || 'brak adresu'}</Info>
            <Info label="Szkodnik">{pestName(peek.order)}</Info>
            {peek.order.clientName.trim() && <Info label="Klient">{peek.order.clientName}</Info>}
            {peek.order.phones[0]?.number && <Info label="Telefon">{withCountryCode(peek.order.phones[0].number)}</Info>}
            {peek.order.description.trim() && <Info label="Opis">{peek.order.description.trim()}</Info>}
            <button type="button" className="btn btn-primary btn-block" onClick={() => setPeek(null)}>
              <Icon name="back" /> {props.backLabel ?? 'Wróć do umawiania'}
            </button>
            {!props.stay && (
              <Link className="btn btn-block" to={`/zabieg/${peek.visit.id}`} onClick={() => setPeek(null)}>
                Otwórz kartę zabiegu
              </Link>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

/**
 * Podgląd tygodnia zwinięty pod „Podgląd kalendarza”: rozwija się dopiero po kliknięciu (i dopiero wtedy wczytuje
 * zabiegi). Nowe zlecenie (krok „Termin”) i „Umów kolejny zabieg”.
 */
export function WeekPeek(props: Parameters<typeof WeekPreview>[0]) {
  const [open, setOpen] = useState(false);
  return (
    <details className="more-actions calendar-peek" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Podgląd kalendarza</summary>
      {open && (
        <div className="calendar-peek-body">
          <WeekPreview {...props} />
        </div>
      )}
    </details>
  );
}
