import { archiveOrder } from './orders';
import { orders } from './repo';
import type { Order, Visit } from './types';
import { orderCode } from './codes';

/** Ile godzin między zapisami dwóch zleceń z tym samym telefonem uznajemy za możliwy duplikat. */
const WINDOW_HOURS = 72;

export interface DuplicatePair {
  id: string;
  a: Order;
  b: Order;
}

const lastDigits = (order: Order) => (order.phones[0]?.number ?? '').replace(/\D/g, '').slice(-9);

/**
 * Możliwe duplikaty: dwa zlecenia z tym samym numerem klienta zapisane w ciągu 3 dni (np. szef i technik przyjęli to
 * samo zlecenie na dwóch telefonach), oba jeszcze bez wykonanego zabiegu. Para oznaczona jako „dwa różne zlecenia”
 * już się nie pokazuje.
 */
export function findDuplicates(list: Order[], allVisits: Visit[]): DuplicatePair[] {
  const done = new Set(allVisits.filter((v) => v.status === 'wykonany').map((v) => v.orderId));
  const open = list.filter((o) => !o.deletedAt && !o.archived && lastDigits(o).length === 9 && !done.has(o.id));
  const out: DuplicatePair[] = [];
  for (let i = 0; i < open.length; i++) {
    for (let j = i + 1; j < open.length; j++) {
      const [a, b] = [open[i], open[j]].sort((x, y) => x.number - y.number);
      if (lastDigits(a) !== lastDigits(b)) continue;
      const hours = Math.abs(Date.parse(a.createdAt) - Date.parse(b.createdAt)) / 3600000;
      if (hours > WINDOW_HOURS) continue;
      if (a.notDuplicateOf?.includes(b.id) || b.notDuplicateOf?.includes(a.id)) continue;
      out.push({ id: `${a.id}:${b.id}`, a, b });
    }
  }
  return out;
}

/** Zostaje jedno zlecenie, drugie trafia do archiwum z dopiskiem (można je przywrócić). */
export async function keepOrder(keep: Order, drop: Order): Promise<void> {
  await archiveOrder(drop.id);
  await orders.update(drop.id, { archivedNote: `Duplikat zlecenia ${orderCode(keep)}` });
}

/** To dwa różne zlecenia (np. dwa mieszkania tego samego klienta): para przestaje być pokazywana. */
export async function markNotDuplicate(a: Order, b: Order): Promise<void> {
  await orders.update(a.id, { notDuplicateOf: [...new Set([...(a.notDuplicateOf ?? []), b.id])] });
  await orders.update(b.id, { notDuplicateOf: [...new Set([...(b.notDuplicateOf ?? []), a.id])] });
}
