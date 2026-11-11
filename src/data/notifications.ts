import { unread, type Channel } from './chat';
import { orderCode, visitCode } from './codes';
import { orderAddress } from './texts';
import type { Message, Order, Visit } from './types';
import { addDays, formatTime } from '../lib/dates';

/**
 * Powiadomienia pod dzwoneczkiem. Liczą się na telefonie z danych, które i tak są zsynchronizowane:
 * - prośby o usunięcie zlecenia (dla admina, do zatwierdzenia),
 * - decyzje admina w sprawie moich próśb,
 * - nowe wiadomości na czacie,
 * - nowe zlecenia na dziś i jutro dodane przez kogoś innego.
 */
export type NotificationKind = 'usuniecie' | 'decyzja' | 'czat' | 'nowe';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  text: string;
  at: string;
  to: string;
  /** Prośba o usunięcie: zlecenie do zatwierdzenia albo odrzucenia. */
  orderId?: string;
}

export function buildNotifications(input: {
  orders: Order[];
  /** Zlecenia usunięte (z koszem), żeby autor prośby zobaczył, że admin ją zatwierdził. */
  deletedOrders: Order[];
  visits: Visit[];
  messages: Message[];
  channels: Channel[];
  me: string | null;
  owner: boolean;
  read: Record<string, string>;
  today: string;
}): AppNotification[] {
  const out: AppNotification[] = [];
  const { me } = input;

  if (input.owner) {
    for (const o of input.orders) {
      if (o.deleteRequest?.status !== 'czeka') continue;
      out.push({
        id: `usuniecie:${o.id}:${o.deleteRequest.at}`,
        kind: 'usuniecie',
        title: `Prośba o usunięcie: ${orderCode(o)}`,
        text: `${o.deleteRequest.byName || 'Technik'} prosi o usunięcie zlecenia ${o.clientName} (${orderAddress(o)}). Powód: ${o.deleteRequest.reason || 'nie podano'}.`,
        at: o.deleteRequest.at,
        to: `/zlecenia/${o.id}`,
        orderId: o.id,
      });
    }
  }

  for (const o of [...input.orders, ...input.deletedOrders]) {
    const r = o.deleteRequest;
    if (!r || r.byId !== me || r.status === 'czeka' || !r.decidedAt) continue;
    out.push({
      id: `decyzja:${o.id}:${r.decidedAt}`,
      kind: 'decyzja',
      title: r.status === 'zatwierdzone' ? `Usunięto zlecenie ${orderCode(o)}` : `Odrzucono prośbę o usunięcie ${orderCode(o)}`,
      text:
        r.status === 'zatwierdzone'
          ? `${r.decidedBy || 'Admin'} zatwierdził Twoją prośbę: zlecenie ${o.clientName} jest w koszu.`
          : `${r.decidedBy || 'Admin'} nie zgodził się usunąć zlecenia ${o.clientName}. Zlecenie zostaje.`,
      at: r.decidedAt,
      to: r.status === 'zatwierdzone' ? '/kosz' : `/zlecenia/${o.id}`,
    });
  }

  for (const channel of input.channels) {
    const fresh = unread(input.messages, channel.id, me, input.read);
    if (fresh.length === 0) continue;
    const last = fresh.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
    out.push({
      id: `czat:${channel.id}:${last.id}`,
      kind: 'czat',
      title: `${channel.label}: ${fresh.length === 1 ? 'nowa wiadomość' : `nowe wiadomości (${fresh.length})`}`,
      text: `${last.authorName}: ${last.text}`,
      at: last.createdAt,
      to: `/czat?k=${encodeURIComponent(channel.id)}`,
    });
  }

  const byId = new Map(input.orders.map((o) => [o.id, o]));
  const soon = [input.today, addDays(input.today, 1)];
  for (const v of input.visits) {
    const o = byId.get(v.orderId);
    if (!o || v.status !== 'zaplanowany' || !v.start || !soon.includes(v.start.slice(0, 10))) continue;
    if (!o.ownerId || o.ownerId === me || o.archived) continue;
    out.push({
      id: `nowe:${v.id}`,
      kind: 'nowe',
      title: `Nowe zlecenie na ${v.start.slice(0, 10) === input.today ? 'dziś' : 'jutro'}: ${visitCode(o, v.seq)}`,
      text: `${formatTime(v.start)} · ${o.clientName} · ${orderAddress(o)}${o.ownerName ? ` · dodał: ${o.ownerName}` : ''}`,
      at: v.createdAt,
      to: `/zabieg/${v.id}`,
    });
  }

  return out.sort((a, b) => b.at.localeCompare(a.at));
}
