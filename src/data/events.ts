import type { Table } from 'dexie';
import { db } from './db';
import { DomainError } from './domain';
import { Repository } from './repo';
import { getProfile } from './settings';
import type { BaseRecord } from './types';

/**
 * Wydarzenia w kalendarzu poza zleceniami, jak w Kalendarzu Google: wolne, urlop, serwis auta, szkolenie, inne.
 *
 * Zapisane w dawnej tabeli `services` (cennik ze starej wersji aplikacji, dziś nieużywany), którą serwer już
 * przyjmuje: synchronizują się zaszyfrowane i trafiają do kopii bez zmian w bazie na serwerze. Od dawnych pozycji
 * cennika odróżnia je pole `kind: 'wydarzenie'`. `name` (tytuł) i `priceNet` są wymagane przez kopię zapasową.
 */
export type EventType = 'wolne' | 'urlop' | 'serwis' | 'szkolenie' | 'inne';

export const EVENT_TYPES: Array<{ type: EventType; label: string; color: string; allDay: boolean }> = [
  { type: 'wolne', label: 'Wolne', color: '#6b7280', allDay: true },
  { type: 'urlop', label: 'Urlop', color: '#0e9384', allDay: true },
  { type: 'serwis', label: 'Serwis auta', color: '#b54708', allDay: false },
  { type: 'szkolenie', label: 'Szkolenie', color: '#6941c6', allDay: false },
  { type: 'inne', label: 'Inne', color: '#475467', allDay: false },
];

export const eventType = (type: EventType) => EVENT_TYPES.find((t) => t.type === type) ?? EVENT_TYPES[EVENT_TYPES.length - 1];

export interface CalendarEvent extends BaseRecord {
  kind: 'wydarzenie';
  /** Tytuł, np. „Serwis auta”, „Wolne”, „Przegląd gaśnic”. */
  name: string;
  priceNet: 0;
  type: EventType;
  /** Pierwszy i ostatni dzień (włącznie), YYYY-MM-DD. */
  date: string;
  endDate: string;
  allDay: boolean;
  /** Godziny HH:mm, gdy wydarzenie nie trwa cały dzień. */
  start: string | null;
  end: string | null;
  note: string;
  ownerId: string | null;
  ownerName: string;
}

export interface EventDraft {
  type: EventType;
  name: string;
  date: string;
  endDate: string;
  allDay: boolean;
  start: string;
  end: string;
  note: string;
}

export const calendarEvents = new Repository<CalendarEvent>(db.services as unknown as Table<CalendarEvent, string>);

/** Tylko wydarzenia (bez dawnych pozycji cennika), nieusunięte, z regionu na ekranie. */
export async function listEvents(): Promise<CalendarEvent[]> {
  return ((await calendarEvents.all()) as Array<CalendarEvent | (BaseRecord & { kind?: string })>).filter(
    (e): e is CalendarEvent => e.kind === 'wydarzenie',
  );
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/** Sprawdza wpisane wydarzenie: tytuł, poprawne dni i godziny (koniec po początku). */
export function eventErrors(d: EventDraft): string[] {
  const errors: string[] = [];
  if (!d.name.trim()) errors.push('Wpisz, co to za wydarzenie');
  if (!DATE.test(d.date)) errors.push('Wybierz dzień');
  if (!DATE.test(d.endDate) || d.endDate < d.date) errors.push('Koniec nie może być przed początkiem');
  if (!d.allDay) {
    if (!TIME.test(d.start) || !TIME.test(d.end)) errors.push('Wybierz godziny');
    else if (d.endDate === d.date && d.end <= d.start) errors.push('Godzina końca musi być po godzinie początku');
  }
  return errors;
}

function fields(d: EventDraft) {
  return {
    type: d.type,
    name: d.name.trim(),
    date: d.date,
    endDate: d.endDate,
    allDay: d.allDay,
    start: d.allDay ? null : d.start,
    end: d.allDay ? null : d.end,
    note: d.note.trim(),
  };
}

export async function createEvent(d: EventDraft): Promise<CalendarEvent> {
  const errors = eventErrors(d);
  if (errors.length) throw new DomainError(errors[0]);
  const profile = await getProfile();
  return calendarEvents.create({ kind: 'wydarzenie', priceNet: 0, ...fields(d), ownerId: profile.userId, ownerName: profile.name });
}

export async function updateEvent(id: string, d: EventDraft): Promise<void> {
  const errors = eventErrors(d);
  if (errors.length) throw new DomainError(errors[0]);
  await calendarEvents.update(id, fields(d));
}

/** Do kosza (można przywrócić). */
export async function deleteEvent(id: string): Promise<void> {
  await calendarEvents.softDelete(id);
}

/** Czy wydarzenie obejmuje dany dzień (np. kilka dni urlopu). */
export const eventOnDay = (e: Pick<CalendarEvent, 'date' | 'endDate'>, day: string) => day >= e.date && day <= e.endDate;
