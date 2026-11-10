import { describe, expect, it } from 'vitest';
import { accountingNote, accountingState, accountingTasks, invoiceAmount, readyToClose } from './accounting';
import type { Order, Visit } from './types';

const base = { invoice: 'vat', protocol: true, invoiceDone: false, protocolDone: false, accountingClosedAt: null, archived: false } as unknown as Order;

describe('księgowość zlecenia', () => {
  it('zadania z faktury i protokołu; bez nich zlecenie nie trafia do księgowej', () => {
    expect(accountingTasks(base)).toEqual(['faktura', 'protokol']);
    expect(accountingState({ ...base, invoice: 'brak', protocol: false })).toBe('brak');
    expect(accountingState(base)).toBe('czeka');
    expect(accountingState({ ...base, archived: true })).toBe('brak');
  });

  it('zamknięcie dopiero po wszystkich dokumentach; opis dla technika', () => {
    expect(readyToClose(base)).toBe(false);
    expect(accountingNote(base)).toBe('Czeka na księgową: faktura, protokół');
    const half = { ...base, invoiceDone: true };
    expect(readyToClose(half)).toBe(false);
    expect(accountingNote(half)).toBe('Czeka na księgową: protokół');
    const all = { ...half, protocolDone: true };
    expect(readyToClose(all)).toBe(true);
    expect(accountingNote(all)).toBe('Księgowa: do zamknięcia');
    const closed = { ...all, accountingClosedAt: '2026-11-10T20:00:00Z' };
    expect(accountingState(closed)).toBe('zamkniete');
    expect(accountingNote(closed)).toBe('Księgowa: zrobione');
  });

  it('kwota do faktury: suma wykonanych zabiegów', () => {
    const v = (status: string, amount: number | null) => ({ status, amount, seq: 1 }) as unknown as Visit;
    expect(invoiceAmount([v('wykonany', 45000), v('wykonany', 40000), v('zaplanowany', null), v('odwolany', 10000)])).toBe(85000);
  });
});

describe('dane do faktury', () => {
  it('VAT: firma, NIP, e-mail; imienna: imię i nazwisko, e-mail; bez faktury nic', async () => {
    const { invoiceMissing } = await import('./invoice');
    const o = { invoice: 'vat', invoiceName: '', nip: '', clientName: 'Jan', email: '' } as unknown as Order;
    expect(invoiceMissing(o)).toEqual(['invoiceName', 'nip', 'email']);
    expect(invoiceMissing({ ...o, invoiceName: 'Apt', nip: '5833534194', email: 'a@b.pl' })).toEqual([]);
    expect(invoiceMissing({ ...o, invoiceName: 'Apt', nip: '1234567890', email: 'a@b.pl' })).toEqual(['nip']);
    expect(invoiceMissing({ ...o, invoice: 'imienna', clientName: '' })).toEqual(['clientName', 'email']);
    expect(invoiceMissing({ ...o, invoice: 'brak' })).toEqual([]);
  });
});
