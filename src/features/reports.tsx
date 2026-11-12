import { visitCode } from '../data/codes';
import { useReportKm } from '../lib/report-prefs';
import { useLiveQuery } from 'dexie-react-hooks';
import { useContext, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { buildReport, costName, formatPln, PAY_METHODS, periodOf, periodTitle, reportText, shiftPeriod, type Period, type PeriodKind, byTechnician, initials, technicianLines } from '../data/reports';
import { expenses, orders, trips, visits } from '../data/repo';
import { getAppSettings, getProfile, getSyncState, ownedBy } from '../data/settings';
import { orderAddress, PAY_NAMES, pestName, firstName } from '../data/texts';
import { formatDate, todayWarsaw } from '../lib/dates';
import { reportDocument } from '../pdf/documents';
import { renderPdf } from '../pdf/render';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Chips, Empty, Group, Loading, Page, Row, ScopeBannerContext, Stat } from '../ui/kit';
import { PayBadge, useContactActions } from './common';

export function ReportsPage() {
  const { deliverFile, run } = useFeedback();
  const { share, copy } = useContactActions();
  const [period, setPeriod] = useState<Period>(() => periodOf('tydzien', todayWarsaw()));
  const [busy, setBusy] = useState(false);
  // Szef otwiera raport technika z listy oddziałów; domyślnie raport jest własny.
  const [params] = useSearchParams();
  const otherId = params.get('technik');
  // Admin widzi domyślnie zabiegi wszystkich techników (w panelu: wybranego regionu albo firmy); technik tylko swoje.
  const inPanel = useContext(ScopeBannerContext) !== null;
  // Null: domyślnie admin i księgowa widzą wszystkich, technik swoje (może przełączyć na cały region).
  const [onlyMine, setOnlyMine] = useState<boolean | null>(null);
  const data = useLiveQuery(async () => {
    const profile = await getProfile();
    const state = await getSyncState();
    // Admin i księgowa widzą domyślnie wszystkich techników.
    const owner = state?.role === 'owner' || state?.role === 'ksiegowosc';
    const mine = onlyMine ?? !owner;
    // Technik też może zrobić raport całego regionu (z podziałem na techników po inicjałach).
    const everyone = !otherId && Boolean(state) && (inPanel || !mine);
    const who = otherId ?? profile.userId;
    const self = !otherId || otherId === profile.userId;
    const own = <T extends { ownerId?: string | null }>(list: T[]) => (everyone ? list : list.filter((x) => ownedBy(x.ownerId, who, self)));
    return {
      owner,
      synced: Boolean(state),
      everyone,
      regionName: state?.branchName ?? '',
      profile: otherId ? { name: params.get('imie') ?? 'technik', userId: otherId } : profile,
      settings: await getAppSettings(),
      visits: (await visits.all()).filter((v) => everyone || ownedBy(v.technicianId, who, self)),
      orders: await orders.all(),
      expenses: own(await expenses.all()),
      trips: own(await trips.all()),
    };
  }, [otherId, onlyMine, inPanel]);

  const [withKm, setWithKm] = useReportKm();

  if (!data) {
    return (
      <Page title="Raporty">
        <Loading />
      </Page>
    );
  }

  const report = buildReport(period, data);
  const allName = inPanel ? 'wszyscy technicy' : data.regionName ? `wszyscy technicy, region ${data.regionName}` : 'wszyscy technicy';
  const names = { technician: data.everyone ? allName : data.profile.name || 'technik', bossGenitive: data.settings.bossName };
  const shares = data.everyone ? byTechnician(report) : [];
  const text = shares.length ? `${reportText(report, names)}\n\nPodział na techników:\n${technicianLines(shares).join('\n')}` : reportText(report, names);
  const isCurrent = period.from === periodOf(period.kind, todayWarsaw()).from;

  const pdf = async () => {
    setBusy(true);
    await run(async () => deliverFile(await renderPdf(reportDocument(report, names, { km: withKm, split: data.everyone })), `raport-${period.kind}-${period.from}.pdf`));
    setBusy(false);
  };

  return (
    <Page title={otherId ? `Raport: ${data.profile.name}` : 'Raporty'} back={otherId ? '/oddzialy' : undefined}>
      {data.synced && !otherId && !inPanel && (
        <Chips
          value={data.everyone ? 'wszyscy' : 'moje'}
          onChange={(v: string) => setOnlyMine(v === 'moje')}
          options={
            data.owner
              ? [
                  { value: 'wszyscy', label: 'Wszyscy technicy' },
                  { value: 'moje', label: 'Tylko moje' },
                ]
              : [
                  { value: 'moje', label: 'Mój raport' },
                  { value: 'wszyscy', label: 'Cały region' },
                ]
          }
        />
      )}
      {data.everyone && shares.length > 0 && (
        <Group title="Podział na techników">
          {shares.map((s) => (
            <Row
              key={s.key}
              lead={<span className="initials">{s.initials}</span>}
              title={s.label}
              sub={technicianLines([s])[0].slice(s.label.length + 3)}
              trailing={<strong className="num">{formatPln(s.turnover)}</strong>}
            />
          ))}
        </Group>
      )}
      <Chips
        value={period.kind}
        onChange={(kind: PeriodKind) => setPeriod(periodOf(kind, todayWarsaw()))}
        options={[
          { value: 'dzien', label: 'Dzień' },
          { value: 'tydzien', label: 'Tydzień' },
          { value: 'miesiac', label: 'Miesiąc' },
        ]}
      />
      <div className="month-nav">
        <button type="button" className="icon-btn" aria-label="Poprzedni okres" onClick={() => setPeriod(shiftPeriod(period, -1))}>
          <Icon name="left" />
        </button>
        <strong>{periodTitle(report).replace(/^\S+ /, '')}</strong>
        <button type="button" className="icon-btn" aria-label="Następny okres" disabled={isCurrent} onClick={() => setPeriod(shiftPeriod(period, 1))}>
          <Icon name="chevron" />
        </button>
      </div>

      <Chips
        value={withKm ? 'z' : 'bez'}
        onChange={(v: string) => setWithKm(v === 'z')}
        options={[
          { value: 'bez', label: 'Bez kilometrów' },
          { value: 'z', label: 'Z kilometrami' },
        ]}
      />
      <div className="stats">
        <Stat label="Obrót" value={formatPln(report.turnover)} />
        <Stat label={`Gotówka dla ${names.bossGenitive}`} value={formatPln(report.cashForBoss)} tone={report.cashForBoss < 0 ? 'danger' : 'ok'} />
        {PAY_METHODS.map((m) => (
          <Stat key={m} label={PAY_NAMES[m]} value={formatPln(report.byMethod[m])} />
        ))}
        <Stat label="Koszty" value={formatPln(report.costs)} />
        <Stat label="Premia" value={formatPln(report.bonus)} />
        {withKm && <Stat label="Km służbowo (VAT)" value={`${report.km.sluzbowy} km`} />}
        {withKm && <Stat label="w tym prywatne" value={`${report.km.prywatny} km`} />}
      </div>
      {report.unpaid > 0 && <Badge tone="warn">Zabiegi bez zapisanej płatności: {report.unpaid}</Badge>}

      <Group title="Rozliczenie do wysłania" plain>
        <pre className="report-text">{text}</pre>
        <div className="quick-actions">
          <button type="button" className="btn btn-primary" onClick={() => void share(text, `Rozliczenie ${periodTitle(report)}`)}>
            <Icon name="share" /> Wyślij
          </button>
          <button type="button" className="btn" onClick={() => void copy(text)}>
            <Icon name="copy" /> Kopiuj
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => void pdf()}>
            <Icon name="file" /> PDF
          </button>
        </div>
      </Group>

      <Group title={`Zabiegi (${report.visits.length})`}>
        {report.visits.length === 0 && <Empty title="Brak wykonanych zabiegów w tym okresie" />}
        {report.visits.map(({ visit, order }) => (
          <Row
            key={visit.id}
            to={`/zabieg/${visit.id}`}
            title={order ? `${visitCode(order, visit.seq)} ${order.clientName}` : 'Zabieg'}
            lead={data.everyone ? <span className="initials" title={visit.technicianName}>{initials(visit.technicianName)}</span> : undefined}
            meta={data.everyone ? firstName(visit.technicianName) || undefined : undefined}
            sub={order ? `${formatDate(visit.doneOn)} · ${orderAddress(order)} · ${pestName(order)}` : formatDate(visit.doneOn)}
            trailing={
              <span className="row-end">
                <span className="num">{visit.amount ? formatPln(visit.amount) : '—'}</span>
                {visit.payMethod && <PayBadge method={visit.payMethod} />}
                {visit.bonus > 0 && <Badge tone="ok">+{formatPln(visit.bonus)}</Badge>}
              </span>
            }
          />
        ))}
      </Group>

      <Group title={`Koszty (${report.expenses.length})`}>
        {report.expenses.length === 0 && <Empty title="Brak kosztów w tym okresie" />}
        {report.expenses.map((e) => (
          <Row key={e.id} title={costName(e)} sub={[formatDate(e.date), costName(e) === e.description.trim() ? '' : e.description].filter(Boolean).join(' · ')} trailing={<span className="num">{formatPln(e.amount)}</span>} />
        ))}
      </Group>
    </Page>
  );
}
