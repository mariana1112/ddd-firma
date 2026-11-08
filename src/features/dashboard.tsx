import { roman, visitCode } from '../data/codes';
import { scopeText } from '../data/visit-terms';
import { mainPhone } from '../data/order-search';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { buildReport, formatPln, periodOf } from '../data/reports';
import { expenses, orders, trips, visits } from '../data/repo';
import { getLastBackupAt, getProfile, getSyncState, ownedBy } from '../data/settings';
import { orderAddress, pestName } from '../data/texts';
import type { Order, Visit } from '../data/types';
import { addDays, formatDate, formatDateLong, formatTime, monthOf, todayWarsaw } from '../lib/dates';
import { Icon } from '../ui/icons';
import { Badge, Empty, Group, Loading, Page, Row, Stat } from '../ui/kit';
import { SyncNotice } from './account';
import { PinkBadge, VisitBadge } from './common';
import { kmSummary } from './trips';

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

function VisitRow({ visit, order, timeOnly }: { visit: Visit; order: Order; timeOnly?: boolean }) {
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
          <VisitBadge visit={visit} />
        </span>
      }
    />
  );
}

export function DashboardPage() {
  const data = useLiveQuery(async () => ({
    visits: await visits.all(),
    orders: await orders.all(),
    expenses: await expenses.all(),
    trips: await trips.all(),
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
  const mine = <T extends { ownerId?: string | null }>(list: T[]) =>
    list.filter((x) => ownedBy(x.ownerId, data.profile.userId, true));
  const withOrder = data.visits
    .filter((v) => orderById.has(v.orderId))
    .map((visit) => ({ visit, order: orderById.get(visit.orderId)! }));
  const planned = withOrder
    .filter(({ visit }) => (visit.status === 'zaplanowany' || visit.status === 'w_trakcie') && visit.start)
    .sort((a, b) => a.visit.start!.localeCompare(b.visit.start!));
  // Dzisiaj pokazuje cały dzień, także zakończone zabiegi.
  const todayList = withOrder
    .filter(({ visit }) => visit.status !== 'odwolany' && visit.start?.slice(0, 10) === today)
    .sort((a, b) => a.visit.start!.localeCompare(b.visit.start!));
  const overdue = planned.filter(({ visit }) => visit.start!.slice(0, 10) < today);
  const upcoming = planned.filter(({ visit }) => visit.start!.slice(0, 10) > today && visit.start!.slice(0, 10) <= addDays(today, 7));
  const toSchedule = withOrder.filter(({ visit }) => visit.status === 'zaplanowany' && !visit.start);

  const month = monthOf(today);
  const km = kmSummary(mine(data.trips), `${month}-01`, `${month}-31`);
  const week = buildReport(periodOf('tydzien', today), {
    visits: data.visits.filter((v) => ownedBy(v.technicianId, data.profile.userId, true)),
    orders: data.orders,
    expenses: mine(data.expenses),
    trips: [],
  });

  const hasData = data.orders.length > 0;
  const remindAfter = data.synced ? SYNCED_BACKUP_REMINDER_DAYS : BACKUP_REMINDER_DAYS;
  const backupDue = hasData && (!data.lastBackup || data.lastBackup.slice(0, 10) < addDays(today, -remindAfter));

  return (
    <Page title={data.profile.name ? `Cześć, ${data.profile.name}` : 'Pulpit'}>
      <p className="page-date">{formatDateLong(today)}</p>

      <SyncNotice />

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
      </div>

      <Link to="/kilometry" className="km-card">
        <span className="km-label">Kilometry w tym miesiącu</span>
        <span className="km-values">
          <span>
            <strong className="num">{km.sluzbowy}</strong> km służbowo
          </span>
          <span>
            <strong className="num">{km.prywatny}</strong> km prywatnie
          </span>
        </span>
      </Link>

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

      <Group title={`Dzisiaj${todayList.length ? ` (${todayList.length})` : ''}`}>
        {todayList.length === 0 && <Empty title="Brak zabiegów na dziś" />}
        {todayList.map(({ visit, order }) => (
          <VisitRow key={visit.id} visit={visit} order={order} timeOnly />
        ))}
      </Group>

      {overdue.length > 0 && (
        <Group title={`Niezakończone z poprzednich dni (${overdue.length})`}>
          {overdue.map(({ visit, order }) => (
            <VisitRow key={visit.id} visit={visit} order={order} />
          ))}
        </Group>
      )}

      {toSchedule.length > 0 && (
        <Group title={`Do umówienia z klientem (${toSchedule.length})`}>
          {toSchedule.map(({ visit, order }) => (
            <VisitRow key={visit.id} visit={visit} order={order} />
          ))}
        </Group>
      )}

      {upcoming.length > 0 && (
        <Group title={`Najbliższe 7 dni (${upcoming.length})`}>
          {upcoming.map(({ visit, order }) => (
            <VisitRow key={visit.id} visit={visit} order={order} />
          ))}
        </Group>
      )}

      {hasData && (
        <Group title="Ten tydzień" action={<Link className="link" to="/raporty">Raporty</Link>} plain>
          <div className="stats">
            <Stat label="Obrót" value={formatPln(week.turnover)} />
            <Stat label="Gotówka do oddania" value={formatPln(week.cashForBoss)} />
            <Stat label="Koszty" value={formatPln(week.costs + week.bonus)} />
            <Stat label="Premia" value={formatPln(week.bonus)} tone={week.bonus > 0 ? 'ok' : undefined} />
          </div>
          {week.unpaid > 0 && <Badge tone="warn">Zabiegi bez zapisanej płatności: {week.unpaid}</Badge>}
        </Group>
      )}
    </Page>
  );
}
