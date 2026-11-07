import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { restoreRecord } from '../data/domain';
import { lastOdometer, tripKm } from '../data/orders';
import { trips } from '../data/repo';
import { getProfile, ownedBy } from '../data/settings';
import type { Trip, TripKind } from '../data/types';
import { formatDate, formatMonth, monthOf, nowWarsaw, shiftMonth, todayWarsaw } from '../lib/dates';
import { tripsDocument } from '../pdf/documents';
import { renderPdf } from '../pdf/render';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Empty, Field, Group, Loading, Page, Stat } from '../ui/kit';

export const KIND_NAMES: Record<TripKind, string> = { sluzbowy: 'Służbowy', prywatny: 'Prywatny' };

export function kmSummary(list: Trip[], from: string, to: string): Record<TripKind, number> {
  const out: Record<TripKind, number> = { sluzbowy: 0, prywatny: 0 };
  for (const t of list) if (t.date >= from && t.date <= to) out[t.kind] += tripKm(t);
  return out;
}

function TripForm({ onSaved }: { onSaved: () => void }) {
  const { run, toast } = useFeedback();
  const [kind, setKind] = useState<TripKind>('sluzbowy');
  const [date, setDate] = useState(todayWarsaw());
  const [timeFrom, setTimeFrom] = useState(nowWarsaw().slice(11, 16));
  const [timeTo, setTimeTo] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [purpose, setPurpose] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  useEffect(() => {
    void (async () => {
      const last = await lastOdometer((await getProfile()).userId);
      if (last !== null) setStart(String(last));
    })();
  }, []);

  const startKm = Number(start);
  const endKm = Number(end);
  const km = start && end ? endKm - startKm : null;
  const error = km !== null && km < 0 ? 'Licznik po przejeździe jest mniejszy niż przed' : undefined;
  const ready = /^\d+$/.test(start) && /^\d+$/.test(end) && !error && from.trim() && to.trim();

  return (
    <form
      className="form card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        void run(async () => {
          await trips.create({
            ownerId: (await getProfile()).userId,
            date,
            kind,
            timeFrom,
            timeTo,
            from: from.trim(),
            to: to.trim(),
            purpose: purpose.trim(),
            odometerStart: startKm,
            odometerEnd: endKm,
          });
          toast(`Zapisano przejazd: ${km} km`);
          setFrom(to.trim());
          setTo('');
          setPurpose('');
          setStart(String(endKm));
          setEnd('');
          onSaved();
        });
      }}
    >
      <div className="segmented" role="group">
        {(['sluzbowy', 'prywatny'] as TripKind[]).map((k) => (
          <button key={k} type="button" className={k === kind ? `active seg-${k}` : ''} aria-pressed={k === kind} onClick={() => setKind(k)}>
            {KIND_NAMES[k]}
          </button>
        ))}
      </div>
      <div className="form-row form-row-3">
        <Field label="Dzień">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Od">
          <input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
        </Field>
        <Field label="Do">
          <input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Skąd">
          <input value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Dokąd">
          <input value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {kind === 'sluzbowy' && (
        <Field label="Cel wyjazdu">
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Np. zlecenie #210" />
        </Field>
      )}
      <div className="form-row">
        <Field label="Licznik przed (km)">
          <input inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Licznik po (km)" error={error}>
          <input inputMode="numeric" value={end} onChange={(e) => setEnd(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      {km !== null && !error && <p className="total-line"><span>Przejechano</span><strong>{km} km</strong></p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={!ready}>
        <Icon name="plus" /> Zapisz przejazd
      </button>
    </form>
  );
}

export function TripsPage() {
  const { deliverFile, run, toast } = useFeedback();
  const [month, setMonth] = useState(monthOf(todayWarsaw()));
  const [filter, setFilter] = useState<TripKind | 'wszystkie'>('wszystkie');
  const [busy, setBusy] = useState(false);
  const data = useLiveQuery(async () => {
    const profile = await getProfile();
    return { list: (await trips.all()).filter((t) => ownedBy(t.ownerId, profile.userId, true)), profile };
  });

  if (!data) return <Loading />;
  const from = `${month}-01`;
  const to = `${month}-31`;
  const year = month.slice(0, 4);
  const summary = kmSummary(data.list, from, to);
  const yearSummary = kmSummary(data.list, `${year}-01-01`, `${year}-12-31`);
  const shown = data.list
    .filter((t) => t.date >= from && t.date <= to && (filter === 'wszystkie' || t.kind === filter))
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeFrom.localeCompare(a.timeFrom));

  const print = async (kind: TripKind) => {
    setBusy(true);
    await run(async () => {
      const list = data.list.filter((t) => t.date >= from && t.date <= to && t.kind === kind);
      const blob = await renderPdf(tripsDocument(list, kind, month, data.profile.name));
      deliverFile(blob, `kilometrowka-${kind}-${month}.pdf`);
    });
    setBusy(false);
  };

  return (
    <Page title="Kilometry" back="/">
      <TripForm onSaved={() => setMonth(monthOf(todayWarsaw()))} />

      <div className="month-nav">
        <button type="button" className="icon-btn" aria-label="Poprzedni miesiąc" onClick={() => setMonth(shiftMonth(month, -1))}>
          <Icon name="left" />
        </button>
        <strong>{formatMonth(month)}</strong>
        <button type="button" className="icon-btn" aria-label="Następny miesiąc" onClick={() => setMonth(shiftMonth(month, 1))}>
          <Icon name="chevron" />
        </button>
      </div>
      <div className="stats">
        <Stat label="Służbowo w miesiącu" value={`${summary.sluzbowy} km`} />
        <Stat label="Prywatnie w miesiącu" value={`${summary.prywatny} km`} />
        <Stat label={`Służbowo w ${year}`} value={`${yearSummary.sluzbowy} km`} />
        <Stat label={`Prywatnie w ${year}`} value={`${yearSummary.prywatny} km`} />
      </div>
      <div className="quick-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void print('sluzbowy')}>
          <Icon name="file" /> Wydruk służbowe
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void print('prywatny')}>
          <Icon name="file" /> Wydruk prywatne
        </button>
      </div>

      <div className="chips" role="group">
        {(['wszystkie', 'sluzbowy', 'prywatny'] as const).map((k) => (
          <button key={k} type="button" className={filter === k ? 'chip active' : 'chip'} onClick={() => setFilter(k)}>
            {k === 'wszystkie' ? 'Wszystkie' : KIND_NAMES[k]}
          </button>
        ))}
      </div>
      <Group>
        {shown.length === 0 && <Empty icon="car" title="Brak przejazdów w tym miesiącu" />}
        {shown.map((t) => (
          <div className="row" key={t.id}>
            <span className="row-main">
              <span className="row-title">
                {t.from} → {t.to}
              </span>
              <span className="row-sub">
                {formatDate(t.date)}, {t.timeFrom}
                {t.timeTo ? `–${t.timeTo}` : ''} · {KIND_NAMES[t.kind]}
                {t.purpose ? ` · ${t.purpose}` : ''}
              </span>
              <span className="row-meta">
                Licznik {t.odometerStart} → {t.odometerEnd}
              </span>
            </span>
            <span className="num">{tripKm(t)} km</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Usuń przejazd"
              onClick={() =>
                void run(async () => {
                  await trips.softDelete(t.id);
                  toast('Usunięto przejazd', { action: { label: 'Cofnij', onClick: () => void run(() => restoreRecord('trips', t.id)) } });
                })
              }
            >
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
      </Group>
    </Page>
  );
}
