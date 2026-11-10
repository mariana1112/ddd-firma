import { useLiveQuery } from 'dexie-react-hooks';
import { visitCode } from '../data/codes';
import { mainPhone } from '../data/order-search';
import { orders, visits } from '../data/repo';
import { getAppSettings } from '../data/settings';
import { remindersDue } from '../data/sms';
import { orderAddress, reminderSms, smsUrl } from '../data/texts';
import type { Order, Visit } from '../data/types';
import { addDays, formatTime, todayWarsaw } from '../lib/dates';
import { Icon } from '../ui/icons';
import { Group } from '../ui/kit';
import { copyText } from './common';

/**
 * Przypomnienia na jutro: SMS z prośbą o potwierdzenie terminu, wysyłany z telefonu technika. Jedno dotknięcie
 * „Wyślij” otwiera Wiadomości z gotową treścią (jest też w schowku) i zdejmuje klienta z listy; po powrocie do
 * aplikacji wysyła się następne. „Pomiń” zdejmuje bez SMS-a (np. po telefonie).
 *
 * afterLastToday: po zakończeniu zabiegu lista pokazuje się tylko wtedy, gdy był to ostatni zabieg dzisiaj.
 */
export function TomorrowReminders({ afterLastToday = false }: { afterLastToday?: boolean }) {
  const data = useLiveQuery(async () => ({ visits: await visits.all(), orders: await orders.all(), settings: await getAppSettings() }));
  if (!data) return null;
  const today = todayWarsaw();
  const byId = new Map(data.orders.map((o) => [o.id, o]));
  const withOrder = data.visits.filter((v) => byId.has(v.orderId) && !v.deletedAt).map((visit) => ({ visit, order: byId.get(visit.orderId)! }));
  const stillToday = withOrder.some(
    ({ visit }) => (visit.status === 'zaplanowany' || visit.status === 'w_trakcie') && visit.start?.slice(0, 10) === today,
  );
  if (afterLastToday && stillToday) return null;
  const due = remindersDue(withOrder, addDays(today, 1));
  if (due.length === 0) return null;

  const send = async (visit: Visit, order: Order) => {
    const phone = mainPhone(order);
    if (!phone) return;
    const text = reminderSms(order, visit, data.settings);
    await copyText(text);
    await visits.update(visit.id, { remindedAt: new Date().toISOString() });
    window.location.href = smsUrl(phone, text);
  };

  return (
    <Group title={`Przypomnienia na jutro do wysłania (${due.length})`}>
      <p className="field-hint group-pad">
        {afterLastToday
          ? 'To był ostatni zabieg dzisiaj. Wyślij klientom z jutra prośbę o potwierdzenie terminu.'
          : 'Wyślij klientom z jutra prośbę o potwierdzenie terminu. Jedno dotknięcie otwiera gotowego SMS-a.'}
      </p>
      {due.map(({ visit, order }) => (
        <div key={visit.id} className="reminder-row">
          <div className="reminder-info">
            <strong>
              {formatTime(visit.start!)} · {visitCode(order, visit.seq)} {order.clientName}
            </strong>
            <span className="row-sub">
              {orderAddress(order)} · tel. {mainPhone(order)}
            </span>
          </div>
          <div className="reminder-actions">
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void send(visit, order)}>
              <Icon name="message" size={16} /> Wyślij SMS
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void visits.update(visit.id, { remindedAt: new Date().toISOString() })}>
              Pomiń
            </button>
          </div>
        </div>
      ))}
    </Group>
  );
}
