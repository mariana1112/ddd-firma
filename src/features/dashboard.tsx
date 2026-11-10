import { roman, visitCode } from '../data/codes';
import { scopeText } from '../data/visit-terms';
import { mainPhone } from '../data/order-search';
import { paymentMissing } from '../data/order-list';
import { orderCode } from '../data/codes';
import { dropEditDraft, listDrafts } from '../lib/drafts';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { orders, visits } from '../data/repo';
import { getLastBackupAt, getProfile, getSyncState } from '../data/settings';
import { orderAddress, pestName } from '../data/texts';
import type { Order, Visit } from '../data/types';
import { addDays, formatDate, formatDateLong, formatTime, todayWarsaw } from '../lib/dates';
import { Icon } from '../ui/icons';
import { Badge, Empty, Group, Loading, Page, Row } from '../ui/kit';
import { SyncNotice } from './account';
import { RegionLine } from './regions';
import { PinkBadge, VisitBadge } from './common';
import { TomorrowReminders } from './reminders';

const BACKUP_REMINDER_DAYS = 7;
// Przy synchronizacji dane są też na serwerze, więc własna kopia jest rzadziej potrzebna.
const SYNCED_BACKUP_REMINDER_DAYS = 30;

/** Szybkie szukanie zlecenia, np. gdy dzwoni klient: numer telefonu, nazwisko, adres albo kod. */
function QuickSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  return (
    <form
      className="quick-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (query.trim()) navigate(`/zlecenia?q=${encodeURIComponent(query.trim())}`);
      }}
    >
      <Icon name="search" size={18} />
      <input
        type="search"
        inputMode="search"
        value={query}
        placeholder="Kto dzwoni? Telefon, nazwisko, adres, kod"
        aria-label="Szukaj zlecenia"
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="submit" className="btn btn-sm btn-primary" disabled={!query.trim()}>
        Szukaj
      </button>
    </form>
  );
}

/** Powód, dla którego zabieg jest w „Pilnych”. */
type TodoReason = 'w_trakcie' | 'platnosc' | 'zalegly';
const TODO_LABEL: Record<TodoReason, string> = { w_trakcie: 'Niedokończony', platnosc: 'Uzupełnij płatność', zalegly: 'Zaległy termin' };

function VisitRow({ visit, order, timeOnly, urgent, reason }: { visit: Visit; order: Order; timeOnly?: boolean; urgent?: boolean; reason?: TodoReason }) {
  return (
    <Row
      to={`/zabieg/${visit.id}`}
      title={
        <>
          {visit.start && <span className="row-time">{timeOnly ? formatTime(visit.start) : `${formatDate(visit.start)} ${formatTime(visit.start)}`}</span>}
          <span className="order-number">{visitCode(order, visit.seq)}</span> {order.clientName}
        </>
      }
      sub={`${orderAddress(order)} · ${pestName(order)}, zabieg ${roman(visit.seq)}${visit.scope && visit.scope.kind !== 'calosc' ? ` · ${scopeText(visit.scope)}` : ''}${mainPhone(order) ? ` · tel. ${mainPhone(order)}` : ''}`}
      trailing={
        <span className="row-end">
          {order.pink && <PinkBadge />}
          {reason ? (
            <Badge tone={reason === 'w_trakcie' ? 'warn' : 'danger'}>{TODO_LABEL[reason]}</Badge>
          ) : urgent ? (
            <Badge tone="danger">Uzupełnij płatność</Badge>
          ) : (
            <VisitBadge visit={visit} />
          )}
        </span>
      }
    />
  );
}

const SEEN_KEY = 'ddd:widziane-nowe';

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function DashboardPage() {
  // Szkice są w pamięci przeglądarki, której baza nie obserwuje: po porzuceniu szkicu odświeżamy ręcznie.
  const [, refresh] = useState(0);
  // Nowe zlecenia od innych, które technik już zobaczył (tylko na tym urządzeniu).
  const [seen, setSeen] = useState<string[]>(readSeen);
  const markSeen = (ids: string[]) => {
    const next = [...new Set([...seen, ...ids])].slice(-500);
    setSeen(next);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    } catch {
      // Bez pamięci przeglądarki komunikat wróci po ponownym otwarciu.
    }
  };
  const data = useLiveQuery(async () => ({
    visits: await visits.all(),
    orders: await orders.all(),
    profile: await getProfile(),
    lastBackup: await getLastBackupAt(),
    synced: Boolean(await getSyncState()),
  }));

  if (!data) {
    return (
      <Page title="Pulpit">
        <Loading />
      </Page>
    );
  }

  const today = todayWarsaw();
  const orderById = new Map(data.orders.map((o) => [o.id, o]));
  const withOrder = data.visits
    .filter((v) => orderById.has(v.orderId))
    .map((visit) => ({ visit, order: orderById.get(visit.orderId)! }));
  const planned = withOrder
    .filter(({ visit }) => (visit.status === 'zaplanowany' || visit.status === 'w_trakcie') && visit.start)
    .sort((a, b) => a.visit.start!.localeCompare(b.visit.start!));
  // Dzisiaj: tylko to, co jest jeszcze do zrobienia (wykonane znikają z Pulpitu).
  const todayList = planned.filter(({ visit }) => visit.start!.slice(0, 10) === today);
  // Nowe zlecenia na dziś i jutro dodane przez kogoś innego (np. szefa), jeszcze nieoznaczone jako widziane.
  const fresh = planned.filter(
    ({ visit, order }) =>
      visit.status === 'zaplanowany' &&
      [today, addDays(today, 1)].includes(visit.start!.slice(0, 10)) &&
      Boolean(order.ownerId) &&
      order.ownerId !== data.profile.userId &&
      !seen.includes(visit.id),
  );
  const overdue = planned.filter(({ visit }) => visit.status === 'zaplanowany' && visit.start!.slice(0, 10) < today);
  const tomorrow = addDays(today, 1);
  const tomorrowList = planned.filter(({ visit }) => visit.start!.slice(0, 10) === tomorrow);
  // Pilne: rozpoczęte i niedokończone, bez płatności („później”) i zaległe terminy, od najnowszych.
  const todo = [
    ...withOrder.filter(({ visit }) => visit.status === 'w_trakcie').map((x) => ({ ...x, reason: 'w_trakcie' as TodoReason, at: x.visit.startedAt ?? x.visit.start ?? '' })),
    ...withOrder
      .filter(({ visit, order }) => paymentMissing(visit) && !order.archived)
      .map((x) => ({ ...x, reason: 'platnosc' as TodoReason, at: x.visit.finishedAt ?? x.visit.doneOn ?? '' })),
    ...overdue.map((x) => ({ ...x, reason: 'zalegly' as TodoReason, at: x.visit.start ?? '' })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const drafts = listDrafts();
  const draftEdits = drafts.edits.map((id) => orderById.get(id)).filter((o): o is Order => Boolean(o));
  const todoCount = todo.length + (drafts.newOrder ? 1 : 0) + draftEdits.length;

  const hasData = data.orders.length > 0;
  const remindAfter = data.synced ? SYNCED_BACKUP_REMINDER_DAYS : BACKUP_REMINDER_DAYS;
  const backupDue = hasData && (!data.lastBackup || data.lastBackup.slice(0, 10) < addDays(today, -remindAfter));

  return (
    <Page title={data.profile.name ? `Cześć, ${data.profile.name}` : 'Pulpit'}>
      <RegionLine />
      <p className="page-date">{formatDateLong(today)}</p>

      <SyncNotice />

      {fresh.length > 0 && (
        <section className="new-orders" role="alert">
          <div className="new-orders-head">
            <Icon name="alert" />
            <strong>
              {fresh.length === 1 ? 'Nowe zlecenie' : `Nowe zlecenia (${fresh.length})`} na {fresh.every(({ visit }) => visit.start!.slice(0, 10) === today) ? 'dziś' : 'dziś i jutro'}
            </strong>
          </div>
          {fresh.map(({ visit, order }) => (
            <Link key={visit.id} to={`/zabieg/${visit.id}`} className="new-order" onClick={() => markSeen([visit.id])}>
              <span className="new-order-when">
                {visit.start!.slice(0, 10) === today ? 'Dziś' : 'Jutro'} {formatTime(visit.start!)}
              </span>
              <span>
                <strong>{visitCode(order, visit.seq)}</strong> {order.clientName} · {orderAddress(order)}
                {order.ownerName ? ` · dodał: ${order.ownerName}` : ''}
              </span>
            </Link>
          ))}
          <button type="button" className="btn btn-block" onClick={() => markSeen(fresh.map(({ visit }) => visit.id))}>
            Widzę, OK
          </button>
        </section>
      )}

      <QuickSearch />

      <div className="tiles">
        <Link to="/zlecenia/nowe" className="tile tile-primary">
          <Icon name="plus" size={26} />
          <span>Nowe zlecenie</span>
        </Link>
        <Link to="/koszty" className="tile">
          <Icon name="receipt" size={26} />
          <span>Dodaj koszt</span>
        </Link>
        <Link to="/kilometry" className="tile">
          <Icon name="car" size={26} />
          <span>Przejazd</span>
        </Link>
        <Link to="/wizytowka" className="tile">
          <Icon name="wallet" size={26} />
          <span>Wizytówka</span>
        </Link>
      </div>

      {!data.profile.name && (
        <Link to="/ustawienia" className="notice notice-info">
          <Icon name="users" />
          <span>Wpisz swoje imię w ustawieniach. Trafi do raportów i danych dla centrali.</span>
        </Link>
      )}

      {backupDue && (
        <Link to="/kopie" className="notice notice-warn">
          <Icon name="alert" />
          <span>
            <strong>Zrób kopię zapasową.</strong> {data.lastBackup ? `Ostatnia: ${formatDate(data.lastBackup)}.` : ''}
          </span>
        </Link>
      )}

      {todoCount > 0 && (
        <Group title={`Pilne (${todoCount})`}>
          {drafts.newOrder && (
            <Row to="/zlecenia/nowe" icon="clipboard" title="Niedokończone nowe zlecenie" sub={drafts.newOrder} trailing={<Badge tone="warn">Szkic</Badge>} />
          )}
          {draftEdits.map((o) => (
            <div key={o.id} className="row-with-action">
              <Row
                to={`/zlecenia/${o.id}/edycja`}
                icon="edit"
                title={`Niezapisane zmiany: ${orderCode(o)}`}
                sub={o.clientName || orderAddress(o)}
                trailing={<Badge tone="warn">Edycja</Badge>}
              />
              <button type="button" className="icon-btn" aria-label={`Porzuć zmiany: ${orderCode(o)}`} onClick={() => {
                  dropEditDraft(o.id);
                  refresh((n) => n + 1);
                }}>
                <Icon name="close" size={18} />
              </button>
            </div>
          ))}
          {todo.map(({ visit, order, reason }) => (
            <VisitRow key={`${reason}-${visit.id}`} visit={visit} order={order} reason={reason} />
          ))}
        </Group>
      )}

      <TomorrowReminders />

      <Group title={`Dzisiaj${todayList.length ? ` (${todayList.length})` : ''}`}>
        {todayList.length === 0 && <Empty title="Brak zabiegów na dziś" />}
        {todayList.map(({ visit, order }) => (
          <VisitRow key={visit.id} visit={visit} order={order} timeOnly />
        ))}
      </Group>

      <Group title={`Jutro${tomorrowList.length ? ` (${tomorrowList.length})` : ''}`}>
        {tomorrowList.length === 0 && <Empty title="Brak zabiegów na jutro" />}
        {tomorrowList.map(({ visit, order }) => (
          <VisitRow key={visit.id} visit={visit} order={order} timeOnly />
        ))}
      </Group>
    </Page>
  );
}
