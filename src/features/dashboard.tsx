import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { followUpsDue, monthSummary, outstandingJobs, overdueJobs, stockAlerts } from '../data/calc';
import * as repo from '../data/repo';
import { getCompany, getLastBackupAt } from '../data/settings';
import { addDays, formatDate, formatDateLong, formatMonth, monthOf, todayWarsaw } from '../lib/dates';
import { UNITS } from '../lib/labels';
import { formatMoney, formatQty } from '../lib/money';
import { Icon } from '../ui/icons';
import { Badge, Empty, Group, Loading, Page, Row, Stat } from '../ui/kit';
import { JobRow } from './job-row';

const BACKUP_REMINDER_DAYS = 7;

export function DashboardPage() {
  const data = useLiveQuery(async () => ({
    jobs: await repo.jobs.all(),
    clients: await repo.clients.all(),
    sites: await repo.sites.all(),
    payments: await repo.payments.all(),
    expenses: await repo.expenses.all(),
    preparations: await repo.preparations.all(),
    movements: await repo.stockMovements.all(),
    company: await getCompany(),
    lastBackup: await getLastBackupAt(),
  }));

  if (!data) {
    return (
      <Page title="Pulpit">
        <Loading />
      </Page>
    );
  }

  const today = todayWarsaw();
  const { jobs, clients, sites, payments, expenses, preparations, movements, company, lastBackup } = data;
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const siteById = new Map(sites.map((s) => [s.id, s]));

  const planned = jobs
    .filter((j) => j.status === 'zaplanowane' && j.start)
    .sort((a, b) => a.start!.localeCompare(b.start!));
  const todayJobs = planned.filter((j) => j.start!.slice(0, 10) === today);
  const weekLimit = addDays(today, 7);
  const upcoming = planned.filter((j) => j.start!.slice(0, 10) > today && j.start!.slice(0, 10) <= weekLimit);
  const overdue = overdueJobs(jobs, today);
  const followUps = followUpsDue(jobs, today);
  const unpaid = outstandingJobs(jobs, payments);
  const unpaidTotal = unpaid.reduce((sum, u) => sum + u.balance, 0);
  const alerts = stockAlerts(preparations, movements, jobs, today);
  const month = monthOf(today);
  const summary = monthSummary(month, payments, expenses);

  const hasData = clients.length + jobs.length > 0;
  const backupDue =
    hasData && (!lastBackup || lastBackup.slice(0, 10) < addDays(today, -BACKUP_REMINDER_DAYS));
  const setupDone = Boolean(company.name);

  return (
    <Page title="Pulpit">
      <p className="page-date">{formatDateLong(today)}</p>

      {!setupDone && (
        <Group title="Na początek">
          <Row to="/ustawienia" icon="gear" title="Uzupełnij dane firmy" sub="Trafią na protokoły i oferty" />
          {clients.length === 0 && <Row to="/klienci/nowy" icon="users" title="Dodaj pierwszego klienta" />}
          {preparations.length === 0 && <Row to="/preparaty/nowy" icon="flask" title="Dodaj preparaty" sub="Magazyn i ewidencja zużycia" />}
        </Group>
      )}

      {backupDue && (
        <Link to="/kopie" className="notice notice-warn">
          <Icon name="alert" />
          <span>
            <strong>Zrób kopię zapasową.</strong>{' '}
            {lastBackup ? `Ostatnia: ${formatDate(lastBackup)}.` : 'Dane są tylko na tym urządzeniu.'}
          </span>
        </Link>
      )}

      <Link to="/zlecenia/nowe" className="btn btn-primary btn-block">
        <Icon name="plus" /> Nowe zlecenie
      </Link>

      <Group title={`Dzisiaj${todayJobs.length ? ` (${todayJobs.length})` : ''}`}>
        {todayJobs.length === 0 && <Empty title="Brak zleceń na dziś" />}
        {todayJobs.map((job) => (
          <JobRow key={job.id} job={job} client={clientById.get(job.clientId)} site={job.siteId ? siteById.get(job.siteId) : undefined} timeOnly />
        ))}
      </Group>

      {overdue.length > 0 && (
        <Group title={`Do zamknięcia (${overdue.length})`}>
          {overdue.map((job) => (
            <JobRow key={job.id} job={job} client={clientById.get(job.clientId)} site={job.siteId ? siteById.get(job.siteId) : undefined} overdue />
          ))}
        </Group>
      )}

      {followUps.length > 0 && (
        <Group title={`Wizyty do umówienia (${followUps.length})`}>
          {followUps.map((job) => (
            <Row
              key={job.id}
              to={`/zlecenia/${job.id}`}
              title={clientById.get(job.clientId)?.name ?? 'Klient'}
              sub={job.title}
              trailing={
                <Badge tone={job.followUpDate! < today ? 'danger' : 'warn'}>{formatDate(job.followUpDate)}</Badge>
              }
            />
          ))}
        </Group>
      )}

      {upcoming.length > 0 && (
        <Group title={`Najbliższe 7 dni (${upcoming.length})`}>
          {upcoming.map((job) => (
            <JobRow key={job.id} job={job} client={clientById.get(job.clientId)} site={job.siteId ? siteById.get(job.siteId) : undefined} />
          ))}
        </Group>
      )}

      {hasData && (
        <Group title={formatMonth(month)} action={<Link className="link" to="/finanse">Finanse</Link>} plain>
          <div className="stats">
            <Stat label="Wpływy" value={formatMoney(summary.income)} />
            <Stat label="Koszty" value={formatMoney(summary.costs)} />
            <Stat label="Wynik" value={formatMoney(summary.result)} tone={summary.result < 0 ? 'danger' : 'ok'} />
            <Stat label="Do zapłaty" value={formatMoney(unpaidTotal)} tone={unpaidTotal > 0 ? 'warn' : undefined} />
          </div>
        </Group>
      )}

      {alerts.length > 0 && (
        <Group title={`Magazyn (${alerts.length})`}>
          {alerts.map((alert) => (
            <Row
              key={`${alert.preparation.id}-${alert.kind}-${alert.batchNo ?? ''}`}
              to={`/preparaty/${alert.preparation.id}`}
              title={alert.preparation.name}
              sub={
                alert.batchNo !== undefined
                  ? `Partia ${alert.batchNo || 'bez numeru'}, termin ${formatDate(alert.expiryDate)}`
                  : `Stan: ${formatQty(alert.stockMilli)} ${UNITS[alert.preparation.unit]}`
              }
              trailing={<Badge tone={alert.kind === 'termin' ? 'warn' : 'danger'}>{alert.message}</Badge>}
            />
          ))}
        </Group>
      )}
    </Page>
  );
}
