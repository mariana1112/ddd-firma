import { isValidNip } from '../lib/validators';
import type { Order } from './types';

/**
 * Dane potrzebne do faktury:
 * - faktura VAT (na firmę): nazwa firmy, NIP i e-mail,
 * - faktura imienna: imię i nazwisko oraz e-mail (bez NIP),
 * - paragon: sam e-mail (paragon idzie do klienta mailem),
 * - bez faktury: nic.
 * Brak danych blokuje zapis zlecenia i zakończenie zabiegu, także gdy klient zmieni zdanie w trakcie zabiegu.
 */
export type InvoiceField = 'invoiceName' | 'nip' | 'clientName' | 'email';

export const INVOICE_FIELD_LABEL: Record<InvoiceField, string> = {
  invoiceName: 'nazwa firmy',
  nip: 'NIP',
  clientName: 'imię i nazwisko',
  email: 'e-mail',
};

export function invoiceMissing(order: Pick<Order, 'invoice' | 'invoiceName' | 'nip' | 'clientName' | 'email'>): InvoiceField[] {
  const missing: InvoiceField[] = [];
  if (order.invoice === 'vat') {
    if (!order.nip.trim() || !isValidNip(order.nip)) missing.push('nip');
  }
  if (order.invoice === 'imienna' && !order.clientName.trim()) missing.push('clientName');
  if (order.invoice !== 'brak' && !/^\S+@\S+\.\S+$/.test(order.email.trim())) missing.push('email');
  return missing;
}

/** Nazwa dokumentu w zdaniu: „Faktura”/„faktury” albo „Paragon”/„paragonu” (paragon przy InvoiceType „paragon”). */
export function documentWord(invoice: Order['invoice']): { name: string; of: string; issued: string; plural: string } {
  return invoice === 'paragon'
    ? { name: 'Paragon', of: 'paragonu', issued: 'wystawiony', plural: 'Paragony' }
    : { name: 'Faktura', of: 'faktury', issued: 'wystawiona', plural: 'Faktury' };
}

/** Nazwa na fakturze: firma przy VAT, imię i nazwisko przy imiennej. */
export function invoiceHolder(order: Pick<Order, 'invoice' | 'invoiceName' | 'clientName'>): string {
  return order.invoice === 'vat' ? (order.invoiceName ?? '').trim() || order.clientName : order.clientName;
}
