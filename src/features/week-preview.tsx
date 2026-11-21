import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
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
const DAYS = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const monday = (date: string) => addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));

/**
 * Podgląd tygodnia przy umawianiu terminu: siatka godzin 7–20 z umówionymi zabiegami i wydarzeniami oraz wybranym
 * terminem (pomarańczowa ramka). Dotknięcie zabiegu otwiera jego podgląd (i powrót), dotknięcie pustego miejsca
 * ustawia ten dzień i godzinę.
 */
export function WeekPreview(props: { date: string; time: string; durationMin: number; exclude?: string; onPick?: (date: string, time: string) => void }) {
  const [peek, setPeek] = useState<{ visit: Visit; order: Order } | null>(null);
  const start = monday(props.date || todayWarsaw());
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const data = useLiveQuery(async () => {
    const byId = new Map((await orders.all()).map((o) => [o.id, o]));
    const list = (await visits.all()).filter((v) => v.start && v.status !== 'odwolany' && v.id !== props.exclude && byId.has(v.orderId) && v.start.slice(0, 10) >= start && v.start.slice(0, 10) <= days[6]);
    return { list: list.map((visit) => ({ visit, order: byId.get(visit.orderId)! })), events: await listEvents() };
  }, [start, props.exclude]);
  if (!data) return null;

  const pick = (day: string, e: React.MouseEvent<HTMLDivElement>) => {
    if (!props.onPick) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const min = Math.max(0, Math.min((H1 - H0) * 60 - (props.durationMin || 60), Math.round(((y / HOUR_PX) * 60) / 30) * 30));
    const t = H0 * 60 + min;
    props.onPick(day, `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  };
  const top = (time: string) => ((toMin(time) - H0 * 60) / 60) * HOUR_PX;
  const height = (min: number) => Math.max(14, (min / 60) * HOUR_PX - 2);

  return (
    <div className="week-preview">
      <span className="field-label">
        Tydzień {formatDate(start).slice(0, 5)}–{formatDate(days[6]).slice(0, 5)}: dotknij zabiegu, żeby go podejrzeć
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
          <div key={day} className="wp-col">
            <span className={day === props.date ? 'wp-head wp-head-picked' : 'wp-head'}>
              {DAYS[i]}
              <b>{Number(day.slice(8, 10))}</b>
            </span>
            <div className="wp-body" style={{ height: (H1 - H0) * HOUR_PX }} onClick={(e) => pick(day, e)}>
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
                    className={`wp-block wp-visit wp-${visit.status}`}
                    style={{ top: top(visit.start!.slice(11, 16)), height: height(visit.durationMin || 60) }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPeek({ visit, order });
                    }}
                  >
                    {String(order.number).padStart(4, '0')}
                  </button>
                ))}
              {day === props.date && props.time && (
                <span className="wp-block wp-picked" style={{ top: top(props.time), height: height(props.durationMin || 60) }}>
                  {props.time}
                </span>
              )}
            </div>
          </div>
        ))}
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
              <Icon name="back" /> Wróć do umawiania
            </button>
            <Link className="btn btn-block" to={`/zabieg/${peek.visit.id}`} onClick={() => setPeek(null)}>
              Otwórz kartę zabiegu
            </Link>
          </div>
        )}
      </Sheet>
    </div>
  );
}
