import type { Order, Visit } from './types';

/**
 * Księgowość zlecenia: technik albo przyjmujący zlecenie zaznacza, że klient chce fakturę lub protokół, a zlecenie
 * trafia do księgowej. Faktura jest osobno dla każdego wykonanego zabiegu (I, II…): księgowa zaznacza, który zabieg
 * już zafakturowała. Gdy później wykona się kolejny zabieg, zlecenie samo wraca do „Do zrobienia”.
 */
export type AccountingTask = 'faktura' | 'protokol';

export const TASK_LABEL: Record<AccountingTask, string> = { faktura: 'Faktura', protokol: 'Protokół' };

type DocOrder = Pick<Order, 'invoice' | 'protocol' | 'invoiceDone' | 'protocolDone' | 'accountingClosedAt' | 'archived'>;

/** Co księgowa ma zrobić w zleceniu. */
export function accountingTasks(order: Pick<Order, 'invoice' | 'protocol'>): AccountingTask[] {
  const tasks: AccountingTask[] = [];
  if (order.invoice !== 'brak') tasks.push('faktura');
  if (order.protocol) tasks.push('protokol');
  return tasks;
}

/** Wykonane zabiegi, od pierwszego: każdy to osobna pozycja do faktury. */
export const doneVisits = (list: Visit[]): Visit[] => list.filter((v) => v.status === 'wykonany').sort((a, b) => a.seq - b.seq);

/** Czy zabieg ma już fakturę (zaznaczenie przy zabiegu; zlecenia sprzed tej opcji: zaznaczenie przy zleceniu). */
export function visitInvoiced(order: Pick<Order, 'invoiceDone'>, visit: Pick<Visit, 'invoicedAt'>): boolean {
  return visit.invoicedAt === undefined ? Boolean(order.invoiceDone) : Boolean(visit.invoicedAt);
}

/** Wykonane zabiegi bez faktury (tylko gdy klient chce fakturę). */
export function pendingInvoices(order: Pick<Order, 'invoice' | 'invoiceDone'>, list: Visit[]): Visit[] {
  return order.invoice === 'brak' ? [] : doneVisits(list).filter((v) => !visitInvoiced(order, v));
}

/** Czy zadanie jest zrobione: faktura dla wszystkich wykonanych zabiegów (i co najmniej jednego), protokół. */
export function taskDone(order: DocOrder, task: AccountingTask, list: Visit[]): boolean {
  if (task === 'protokol') return Boolean(order.protocolDone);
  return doneVisits(list).length > 0 && pendingInvoices(order, list).length === 0;
}

/**
 * Stan zlecenia u księgowej:
 * - brak: klient nie chce faktury ani protokołu,
 * - czeka: jest coś do zrobienia albo zlecenie nie jest zamknięte,
 * - zamkniete: zamknięte i nic nowego nie czeka (nowy wykonany zabieg bez faktury otwiera je ponownie).
 */
export type AccountingState = 'brak' | 'czeka' | 'zamkniete';

export function accountingState(order: DocOrder, list: Visit[]): AccountingState {
  const tasks = accountingTasks(order);
  if (tasks.length === 0 || order.archived) return 'brak';
  if (!order.accountingClosedAt) return 'czeka';
  return tasks.every((t) => taskDone(order, t, list)) ? 'zamkniete' : 'czeka';
}

/** Czy wszystkie dokumenty są zrobione, więc zlecenie można zamknąć. */
export function readyToClose(order: DocOrder, list: Visit[]): boolean {
  return accountingTasks(order).every((t) => taskDone(order, t, list));
}

/** Kwota do faktury: suma wykonanych zabiegów (w groszach). */
export const invoiceAmount = (list: Visit[]): number => doneVisits(list).reduce((sum, v) => sum + (v.amount ?? 0), 0);

/** Krótki opis dla technika: co z dokumentami zlecenia. */
export function accountingNote(order: DocOrder, list: Visit[]): string | null {
  const state = accountingState(order, list);
  if (state === 'brak') return null;
  if (state === 'zamkniete') return 'Księgowa: zrobione';
  const waiting: string[] = [];
  if (order.invoice !== 'brak') {
    const pending = pendingInvoices(order, list);
    if (doneVisits(list).length === 0) waiting.push('faktura (po wykonaniu zabiegu)');
    else if (pending.length) waiting.push(`faktura za zabieg ${pending.map((v) => romanSeq(v.seq)).join(', ')}`);
  }
  if (order.protocol && !order.protocolDone) waiting.push('protokół');
  return waiting.length ? `Czeka na księgową: ${waiting.join(', ')}` : 'Księgowa: do zamknięcia';
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
const romanSeq = (n: number) => ROMAN[n] ?? String(n);

/** Płatności do sprawdzenia przez księgową: BLIK i przelewy z wykonanych zabiegów, od najnowszych. */
export function bankPayments(list: Visit[]): Visit[] {
  return list
    .filter((v) => v.status === 'wykonany' && !v.deletedAt && (v.payMethod === 'blik' || v.payMethod === 'przelew') && (v.amount ?? 0) > 0)
    .sort((a, b) => (b.finishedAt ?? b.doneOn ?? '').localeCompare(a.finishedAt ?? a.doneOn ?? ''));
}

/** BLIK albo przelew jeszcze niesprawdzony na koncie: „nowy” dla księgowej. */
export const paymentUnchecked = (v: Pick<Visit, 'paymentCheckedAt'>) => !v.paymentCheckedAt;
