import { visitCode } from './codes';
import { orderAddress } from './texts';
import type { Order, Visit } from './types';
import { addMinutes, formatTime } from '../lib/dates';

/** Gotowe wiadomości do klienta z menu „SMS”. */
export type SmsKind = 'przypomnienie' | 'spoznienie' | 'wczesniej' | 'wlasna';

export const LATE_MINUTES = [10, 15, 20, 30, 45, 60];
export const EARLY_MINUTES = [15, 30, 45, 60, 90];

const sign = (technician: string) => (technician ? `${technician}, Pogromcy Insektów` : 'Pogromcy Insektów');

/** „Spóźnię się około 15 minut” na umówiony zabieg. */
export function lateSms(order: Order, visit: Pick<Visit, 'start' | 'seq'>, minutes: number, technician: string): string {
  const at = visit.start ? ` na zabieg o ${formatTime(visit.start)}` : '';
  return `Dzień dobry, przepraszam, spóźnię się około ${minutes} minut${at} (${orderAddress(order)}). Pozdrawiam, ${sign(technician)}`;
}

/** Prośba o przyjazd wcześniej: „około 9:30 zamiast 10:00”. */
export function earlierSms(order: Order, visit: Pick<Visit, 'start' | 'seq'>, minutes: number, technician: string): string {
  const when = visit.start ? `około ${formatTime(addMinutes(visit.start, -minutes))} zamiast ${formatTime(visit.start)}` : `około ${minutes} minut wcześniej`;
  return `Dzień dobry, czy mogę przyjechać na zabieg wcześniej, ${when} (${orderAddress(order)})? Proszę o odpowiedź. Pozdrawiam, ${sign(technician)}`;
}

/** Zabiegi na jutro, o których klient nie dostał jeszcze przypomnienia z prośbą o potwierdzenie. */
export function remindersDue<T extends { visit: Visit; order: Order }>(list: T[], tomorrow: string): T[] {
  return list
    .filter(({ visit, order }) => visit.status === 'zaplanowany' && visit.start?.slice(0, 10) === tomorrow && !visit.remindedAt && order.phones.some((p) => p.number.trim()))
    .sort((a, b) => a.visit.start!.localeCompare(b.visit.start!));
}

export const reminderLabel = (order: Order, visit: Visit) => `${visitCode(order, visit.seq)} ${order.clientName}`;
