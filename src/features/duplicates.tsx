import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { orderCode } from '../data/codes';
import { findDuplicates, keepOrder, markNotDuplicate, type DuplicatePair } from '../data/duplicates';
import { orders, visits } from '../data/repo';
import { orderAddress, pestName } from '../data/texts';
import type { Order, Visit } from '../data/types';
import { formatDate, formatTerm } from '../lib/dates';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Group, Row, Sheet } from '../ui/kit';

function Side({ order, list }: { order: Order; list: Visit[] }) {
  const first = list.filter((v) => v.orderId === order.id && v.status !== 'odwolany').sort((a, b) => a.seq - b.seq)[0];
  return (
    <div className="dup-side">
      <strong>{orderCode(order)}</strong>
      <span>Dodał: {order.ownerName || '—'}, {formatDate(order.createdAt)} {new Date(order.createdAt).toTimeString().slice(0, 5)}</span>
      <span>Termin: {first?.start ? formatTerm(first.start) : 'do umówienia'}</span>
      <span>{orderAddress(order) || 'brak adresu'}</span>
      <span>{pestName(order)}</span>
      {order.description.trim() && <span className="dup-desc">{order.description.trim()}</span>}
    </div>
  );
}

/**
 * Możliwe duplikaty na Pulpicie: to samo zlecenie przyjęte na dwóch telefonach. Wybierasz, które zostaje (drugie trafia
 * do archiwum z dopiskiem), albo oznaczasz, że to dwa różne zlecenia. Nic nie trzeba wpisywać od nowa.
 */
export function DuplicatesGroup() {
  const { run, toast } = useFeedback();
  const data = useLiveQuery(async () => ({ orders: await orders.all(), visits: await visits.all() }));
  const [open, setOpen] = useState<DuplicatePair | null>(null);
  if (!data) return null;
  const pairs = findDuplicates(data.orders, data.visits);
  if (!pairs.length) return null;
  const keep = (k: Order, d: Order) =>
    run(async () => {
      await keepOrder(k, d);
      setOpen(null);
      toast(`Zostaje ${orderCode(k)}, ${orderCode(d)} w archiwum`);
    });
  return (
    <Group title={`Możliwe duplikaty (${pairs.length})`}>
      {pairs.map((p) => (
        <Row
          key={p.id}
          icon="copy"
          title={`${orderCode(p.a)} i ${orderCode(p.b)}`}
          sub={`Ten sam telefon klienta${p.a.ownerName && p.b.ownerName && p.a.ownerName !== p.b.ownerName ? ` · dodali: ${p.a.ownerName} i ${p.b.ownerName}` : ''}`}
          trailing={<Badge tone="warn">Wybierz</Badge>}
          onClick={() => setOpen(p)}
        />
      ))}
      <Sheet open={Boolean(open)} title="Które zlecenie zostaje?" onClose={() => setOpen(null)}>
        {open && (
          <div className="form">
            <p className="sheet-text">Wygląda na to samo zlecenie zapisane dwa razy (np. na dwóch telefonach). Drugie trafi do archiwum, skąd można je przywrócić.</p>
            <div className="dup-compare">
              <Side order={open.a} list={data.visits} />
              <Side order={open.b} list={data.visits} />
            </div>
            <button type="button" className="btn btn-primary btn-block" onClick={() => void keep(open.a, open.b)}>
              <Icon name="check" /> Zostaw {orderCode(open.a)}
            </button>
            <button type="button" className="btn btn-primary btn-block" onClick={() => void keep(open.b, open.a)}>
              <Icon name="check" /> Zostaw {orderCode(open.b)}
            </button>
            <button
              type="button"
              className="btn btn-block"
              onClick={() =>
                void run(async () => {
                  await markNotDuplicate(open.a, open.b);
                  setOpen(null);
                  toast('Oznaczono jako dwa różne zlecenia');
                })
              }
            >
              To dwa różne zlecenia
            </button>
          </div>
        )}
      </Sheet>
    </Group>
  );
}
