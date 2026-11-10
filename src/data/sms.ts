import { visitCode } from './codes';
import { fill, orderAddress } from './texts';
import type { AppSettings } from './settings';
import type { Order, Visit } from './types';
import { addMinutes, formatTime } from '../lib/dates';

/** Gotowe wiadomości do klienta z menu „SMS”. */
export type SmsKind = 'zalecenia' | 'przypomnienie' | 'spoznienie' | 'wczesniej' | 'wlasna';

export const LATE_MINUTES = [10, 15, 20, 30, 45, 60];
export const EARLY_MINUTES = [15, 30, 45, 60, 90];

const sign = (technician: string) => (technician ? `${technician}, Pogromcy Insektów` : 'Pogromcy Insektów');

/** „Spóźnię się około 15 minut” na umówiony zabieg, z szablonu w Ustawieniach. */
export function lateSms(order: Order, visit: Pick<Visit, 'start' | 'seq'>, minutes: number, technician: string, settings: Pick<AppSettings, 'lateTemplate'>): string {
  return fill(settings.lateTemplate, {
    minuty: String(minutes),
    godzina: visit.start ? formatTime(visit.start) : '',
    adres: orderAddress(order),
    podpis: sign(technician),
  })
    .replace(' na zabieg o  (', ' na zabieg (')
    .trim();
}

/** Prośba o przyjazd wcześniej („około 9:30 zamiast 10:00”), z szablonu w Ustawieniach. */
export function earlierSms(order: Order, visit: Pick<Visit, 'start' | 'seq'>, minutes: number, technician: string, settings: Pick<AppSettings, 'earlyTemplate'>): string {
  return fill(settings.earlyTemplate, {
    minuty: String(minutes),
    nowa_godzina: visit.start ? formatTime(addMinutes(visit.start, -minutes)) : `${minutes} minut wcześniej`,
    godzina: visit.start ? formatTime(visit.start) : 'umówionej godziny',
    adres: orderAddress(order),
    podpis: sign(technician),
  }).trim();
}

/** Zabiegi na jutro, o których klient nie dostał jeszcze przypomnienia z prośbą o potwierdzenie. */
export function remindersDue<T extends { visit: Visit; order: Order }>(list: T[], tomorrow: string): T[] {
  return list
    .filter(({ visit, order }) => visit.status === 'zaplanowany' && visit.start?.slice(0, 10) === tomorrow && !visit.remindedAt && order.phones.some((p) => p.number.trim()))
    .sort((a, b) => a.visit.start!.localeCompare(b.visit.start!));
}

export const reminderLabel = (order: Order, visit: Visit) => `${visitCode(order, visit.seq)} ${order.clientName}`;
