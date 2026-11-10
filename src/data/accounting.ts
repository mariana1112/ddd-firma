import type { Order, Visit } from './types';

/**
 * Księgowość zlecenia: technik albo przyjmujący zlecenie zaznacza, że klient chce fakturę lub protokół, a zlecenie
 * trafia do księgowej. Księgowa wystawia dokumenty, zaznacza je i zamyka zlecenie u siebie.
 */
export type AccountingTask = 'faktura' | 'protokol';

export const TASK_LABEL: Record<AccountingTask, string> = { faktura: 'Faktura', protokol: 'Protokół' };

/** Co księgowa ma zrobić w zleceniu. */
export function accountingTasks(order: Pick<Order, 'invoice' | 'protocol'>): AccountingTask[] {
  const tasks: AccountingTask[] = [];
  if (order.invoice !== 'brak') tasks.push('faktura');
  if (order.protocol) tasks.push('protokol');
  return tasks;
}

export function taskDone(order: Pick<Order, 'invoiceDone' | 'protocolDone'>, task: AccountingTask): boolean {
  return task === 'faktura' ? Boolean(order.invoiceDone) : Boolean(order.protocolDone);
}

/**
 * Stan zlecenia u księgowej:
 * - brak: klient nie chce faktury ani protokołu,
 * - czeka: jest coś do zrobienia (albo zrobione, ale niezamknięte),
 * - zamkniete: księgowa zamknęła zlecenie.
 */
export type AccountingState = 'brak' | 'czeka' | 'zamkniete';

export function accountingState(order: Pick<Order, 'invoice' | 'protocol' | 'accountingClosedAt' | 'archived'>): AccountingState {
  if (accountingTasks(order).length === 0 || order.archived) return 'brak';
  return order.accountingClosedAt ? 'zamkniete' : 'czeka';
}

/** Czy wszystkie dokumenty są zrobione, więc zlecenie można zamknąć. */
export function readyToClose(order: Pick<Order, 'invoice' | 'protocol' | 'invoiceDone' | 'protocolDone'>): boolean {
  return accountingTasks(order).every((t) => taskDone(order, t));
}

/** Wykonane zabiegi z kwotą: na ich podstawie księgowa wystawia fakturę. */
export const doneVisits = (list: Visit[]): Visit[] => list.filter((v) => v.status === 'wykonany').sort((a, b) => a.seq - b.seq);

/** Kwota do faktury: suma wykonanych zabiegów (w groszach). */
export const invoiceAmount = (list: Visit[]): number => doneVisits(list).reduce((sum, v) => sum + (v.amount ?? 0), 0);

/** Krótki opis dla technika: co z dokumentami zlecenia. */
export function accountingNote(order: Pick<Order, 'invoice' | 'protocol' | 'invoiceDone' | 'protocolDone' | 'accountingClosedAt' | 'archived'>): string | null {
  const state = accountingState(order);
  if (state === 'brak') return null;
  if (state === 'zamkniete') return 'Księgowa: zrobione';
  const waiting = accountingTasks(order).filter((t) => !taskDone(order, t)).map((t) => TASK_LABEL[t].toLowerCase());
  return waiting.length ? `Czeka na księgową: ${waiting.join(', ')}` : 'Księgowa: do zamknięcia';
}
