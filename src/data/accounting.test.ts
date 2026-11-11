import { describe, expect, it } from 'vitest';
import { accountingNote, accountingState, accountingTasks, invoiceAmount, pendingInvoices, readyToClose } from './accounting';
import type { Order, Visit } from './types';

const base = { invoice: 'vat', protocol: true, invoiceDone: false, protocolDone: false, accountingClosedAt: null, archived: false } as unknown as Order;

describe('księgowość zlecenia', () => {
  const v = (seq: number, patch: Partial<Visit> = {}) => ({ seq, status: 'wykonany', amount: 45000, invoicedAt: null, ...patch }) as Visit;

  it('zadania z faktury i protokołu; bez nich zlecenie nie trafia do księgowej', () => {
    expect(accountingTasks(base)).toEqual(['faktura', 'protokol']);
    expect(accountingState({ ...base, invoice: 'brak', protocol: false }, [])).toBe('brak');
    expect(accountingState(base, [v(1)])).toBe('czeka');
    expect(accountingState({ ...base, archived: true }, [v(1)])).toBe('brak');
  });

  it('faktura osobno za każdy zabieg; zamknięcie dopiero po wszystkich; nowy zabieg otwiera zlecenie', () => {
    const order = { ...base, protocolDone: true };
    const both = [v(1, { invoicedAt: '2026-11-10T10:00:00Z' }), v(2)];
    expect(pendingInvoices(order, both).map((x) => x.seq)).toEqual([2]);
    expect(readyToClose(order, both)).toBe(false);
    expect(accountingNote(order, both)).toBe('Czeka na księgową: faktura za zabieg II');
    const all = [both[0], v(2, { invoicedAt: '2026-11-10T11:00:00Z' })];
    expect(readyToClose(order, all)).toBe(true);
    const closed = { ...order, accountingClosedAt: '2026-11-10T12:00:00Z' };
    expect(accountingState(closed, all)).toBe('zamkniete');
    expect(accountingNote(closed, all)).toBe('Księgowa: zrobione');
    // Później wykonany zabieg III bez faktury: zlecenie wraca do „Do zrobienia”.
    expect(accountingState(closed, [...all, v(3)])).toBe('czeka');
    // Bez wykonanego zabiegu faktury nie da się jeszcze wystawić.
    expect(readyToClose(order, [])).toBe(false);
    expect(accountingNote(base, [])).toBe('Czeka na księgową: faktura (po wykonaniu zabiegu), protokół');
  });

  it('kwota do faktury: suma wykonanych zabiegów', () => {
    const w = (status: string, amount: number | null) => ({ status, amount, seq: 1 }) as unknown as Visit;
    expect(invoiceAmount([w('wykonany', 45000), w('wykonany', 40000), w('zaplanowany', null), w('odwolany', 10000)])).toBe(85000);
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
