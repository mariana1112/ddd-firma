import { roman, visitCode } from './codes';
import { orderAddress, pestName } from './texts';
import type { Order, Visit } from './types';
import { addMinutes } from '../lib/dates';

/** „2026-11-10T10:00” → „20261110T100000” (czas lokalny; strefę podaje parametr ctz). */
const stamp = (term: string) => `${term.slice(0, 10).replace(/-/g, '')}T${term.slice(11, 16).replace(':', '')}00`;

/**
 * Link „Dodaj do Kalendarza Google” dla umówionego zabiegu: otwiera gotowe wydarzenie (tytuł z numerem zlecenia,
 * adres, telefon) w Kalendarzu Google zalogowanego konta Google, gdzie wystarczy je zapisać.
 */
export function googleCalendarUrl(
  order: Order,
  visit: Pick<Visit, 'seq' | 'start' | 'durationMin'>,
): string | null {
  if (!visit.start) return null;
  const end = addMinutes(visit.start, visit.durationMin || 60);
  const address = [orderAddress(order), order.postalCode].filter(Boolean).join(', ');
  const phone = order.phones[0]?.number;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${visitCode(order, visit.seq)} ${pestName(order)}, ${order.clientName}`,
    dates: `${stamp(visit.start)}/${stamp(end)}`,
    ctz: 'Europe/Warsaw',
    location: address,
    details: [`Zabieg ${roman(visit.seq)}`, phone ? `Tel. ${phone}` : ''].filter(Boolean).join('\n'),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
