import { visitCode } from './codes';
import { orderAddress, pestName } from './texts';
import { visits } from './repo';
import { getProfile } from './settings';
import { methodNames } from './methods';
import type { Order, Visit } from './types';
import { formatTerm } from '../lib/dates';
import { withCountryCode } from '../lib/validators';

export interface Person {
  id: string;
  name: string;
}

/** Przydziela zabieg technikowi (albo zdejmuje przydział). Technik dostaje powiadomienie w aplikacji. */
export async function assignVisit(visitId: string, person: Person | null): Promise<void> {
  const me = await getProfile();
  await visits.update(
    visitId,
    person
      ? { assignedId: person.id, assignedName: person.name, assignedAt: new Date().toISOString(), assignedById: me.userId, assignedBy: me.name }
      : { assignedId: null, assignedName: null, assignedAt: null, assignedById: null, assignedBy: null },
  );
}

const APP_URL = 'https://mariana1112.github.io/ddd-firma/';

/**
 * Wiadomość do technika (WhatsApp, SMS): termin, adres, co robimy, telefon klienta i link do zabiegu w aplikacji. Technik z innego regionu (`outside`) nie otworzy zlecenia w swojej aplikacji,
 * więc dostaje komplet danych (klient, dojazd) zamiast odnośnika.
 */
export function assignmentText(order: Order, visit: Visit, name: string, outside = false): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const phone = order.phones.find((p) => p.number.trim());
  const what = [pestName(order), ...methodNames(order)].filter(Boolean).join(', ');
  return [
    `Cześć${first ? ` ${first}` : ''}! Masz zlecenie ${visitCode(order, visit.seq)}.`,
    `Termin: ${visit.start ? formatTerm(visit.start) : 'do umówienia'}`,
    `Adres: ${orderAddress(order) || 'klient poda później'}`,
    what && `Co: ${what}`,
    phone && `Klient: ${withCountryCode(phone.number)}${phone.label ? ` (${phone.label})` : ''}`,
    outside && order.clientName.trim() && `Nazwisko: ${order.clientName.trim()}`,
    order.description.trim() && `Opis: ${order.description.trim()}`,
    outside && order.access?.trim() && `Jak dotrzeć: ${order.access.trim()}`,
    outside && order.mapsLink?.trim() && `Mapa: ${order.mapsLink.trim()}`,
    !outside && `Szczegóły w aplikacji: ${APP_URL}#/zabieg/${visit.id}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
export const smsTextUrl = (text: string) => `sms:?&body=${encodeURIComponent(text)}`;
