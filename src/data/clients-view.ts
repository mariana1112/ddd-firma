import type { Order, Visit } from './types';

/**
 * Klient z jego zleceniami: zlecenia łączymy po numerze telefonu (ostatnie 9 cyfr), a bez telefonu po nazwisku
 * i adresie. Klucz trafia do adresu strony klienta (/klient/:klucz).
 */
export interface ClientGroup {
  key: string;
  name: string;
  phones: Array<{ number: string; label: string }>;
  emails: string[];
  addresses: string[];
  orders: Order[];
  planned: Visit[];
  done: Visit[];
}

const digits = (s: string) => s.replace(/\D/g, '').slice(-9);

export function clientKey(order: Pick<Order, 'phones' | 'clientName' | 'street' | 'houseNo' | 'city'>): string {
  const phone = order.phones.map((p) => digits(p.number)).find((d) => d.length === 9);
  if (phone) return `t${phone}`;
  return `n${encodeURIComponent([order.clientName, order.street, order.houseNo, order.city].map((x) => x.trim().toLowerCase()).join('|'))}`;
}

export function groupClients(orders: Order[], visits: Visit[], address: (o: Order) => string): ClientGroup[] {
  const byKey = new Map<string, ClientGroup>();
  for (const o of orders) {
    if (o.deletedAt) continue;
    const key = clientKey(o);
    const g = byKey.get(key) ?? { key, name: '', phones: [], emails: [], addresses: [], orders: [], planned: [], done: [] };
    g.orders.push(o);
    if (!g.name && o.clientName.trim()) g.name = o.clientName.trim();
    for (const p of o.phones) if (p.number.trim() && !g.phones.some((x) => digits(x.number) === digits(p.number))) g.phones.push({ number: p.number, label: p.label });
    if (o.email.trim() && !g.emails.includes(o.email.trim())) g.emails.push(o.email.trim());
    const a = address(o);
    if (a && !g.addresses.includes(a)) g.addresses.push(a);
    byKey.set(key, g);
  }
  for (const v of visits) {
    if (v.deletedAt || v.status === 'odwolany') continue;
    const o = orders.find((x) => x.id === v.orderId);
    if (!o) continue;
    const g = byKey.get(clientKey(o));
    if (!g) continue;
    if (v.status === 'wykonany') g.done.push(v);
    else g.planned.push(v);
  }
  for (const g of byKey.values()) {
    g.planned.sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999'));
    g.done.sort((a, b) => (b.doneOn ?? '').localeCompare(a.doneOn ?? ''));
  }
  return [...byKey.values()];
}
