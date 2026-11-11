import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { restoreRecord } from '../data/domain';
import { driverSummary, mileageSheets, normalizePlate, routeText } from '../data/mileage';
import { lastOdometer, tripKm } from '../data/orders';
import { trips } from '../data/repo';
import { COMPANY_NAME, getCompany, getProfile, getSyncState, getVehicle, ownedBy, saveVehicle, type VehicleSettings } from '../data/settings';
import type { CompanySettings, Trip, TripKind } from '../data/types';
import { formatDate, formatMonth, monthOf, nowWarsaw, shiftMonth, todayWarsaw } from '../lib/dates';
import { mileageDocument } from '../pdf/documents';
import { renderPdf } from '../pdf/render';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Empty, Field, Group, Loading, Page, Sheet, Stat } from '../ui/kit';

export const KIND_NAMES: Record<TripKind, string> = { sluzbowy: 'Służbowy', prywatny: 'Prywatny' };

export function kmSummary(list: Trip[], from: string, to: string): Record<TripKind, number> {
  const out: Record<TripKind, number> = { sluzbowy: 0, prywatny: 0 };
  for (const t of list) {
    if (t.date < from || t.date > to) continue;
    // Do VAT każdy przejazd jest służbowy; prywatne liczone dodatkowo, do wglądu.
    out.sluzbowy += tripKm(t);
    if (t.kind === 'prywatny') out.prywatny += tripKm(t);
  }
  return out;
}

/** Dane podatnika do nagłówka ewidencji: nazwa, adres i NIP firmy. */
export function taxpayerLine(company: CompanySettings): string {
  const city = [company.postalCode, company.city].filter(Boolean).join(' ');
  const name = company.taxpayerName?.trim() || COMPANY_NAME;
  return [name, company.street, city, company.nip ? `NIP ${company.nip}` : ''].filter(Boolean).join(', ');
}

function VehicleSheet(props: { open: boolean; vehicle: VehicleSettings; profileName: string; onClose: () => void }) {
  const { run, toast } = useFeedback();
  const [plate, setPlate] = useState(props.vehicle.plate);
  const [driver, setDriver] = useState(props.vehicle.driver);

  useEffect(() => {
    if (props.open) {
      setPlate(props.vehicle.plate);
      setDriver(props.vehicle.driver || props.profileName);
    }
  }, [props.open, props.vehicle, props.profileName]);

  return (
    <Sheet open={props.open} title="Auto i kierowca" onClose={props.onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await saveVehicle({ plate: plate.trim().toUpperCase().replace(/\s+/g, ' '), driver: driver.trim() });
            toast('Zapisano auto. Obowiązuje do następnej zmiany.');
            props.onClose();
          });
        }}
      >
        <Field label="Numer rejestracyjny" hint="Ustawiasz raz. Kolejne przejazdy zapiszą się na to auto, aż go nie zmienisz.">
          <input value={plate} autoCapitalize="characters" autoComplete="off" placeholder="Np. WE 1KR10" onChange={(e) => setPlate(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Imię i nazwisko kierowcy" hint="Trafia do kolumny „osoba kierująca pojazdem” w ewidencji.">
          <input value={driver} autoComplete="name" onChange={(e) => setDriver(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={normalizePlate(plate).length < 4 || !driver.trim()}>
          Zapisz
        </button>
      </form>
    </Sheet>
  );
}

function TripForm({ vehicle, onSaved }: { vehicle: VehicleSettings; onSaved: () => void }) {
  const { run, toast } = useFeedback();
  const [kind, setKind] = useState<TripKind>('sluzbowy');
  const [date, setDate] = useState(todayWarsaw());
  const [timeFrom, setTimeFrom] = useState(nowWarsaw().slice(11, 16));
  const [timeTo, setTimeTo] = useState('');
  const [from, setFrom] = useState('');
  const [via, setVia] = useState('');
  const [to, setTo] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  // Licznik startowy to stan po ostatnim przejeździe tym autem, służbowym albo prywatnym: jeden licznik dla obu.
  // Odświeża się, gdy dojdzie przejazd (także z innego urządzenia).
  const last = useLiveQuery(async () => {
    const count = await trips.all();
    return { value: await lastOdometer((await getProfile()).userId, vehicle.plate), count: count.length };
  }, [vehicle.plate]);
  useEffect(() => {
    if (last?.value != null) setStart(String(last.value));
  }, [last?.value]);

  // Puste „Licznik przed”: bierzemy stan po poprzednim przejeździe.
  const effectiveStart = start || (last?.value != null ? String(last.value) : '');
  const startKm = Number(effectiveStart);
  const endKm = Number(end);
  const km = effectiveStart && end ? endKm - startKm : null;
  const error = km !== null && km < 0 ? 'Licznik po przejeździe jest mniejszy niż przed' : undefined;
  const ready = /^\d+$/.test(effectiveStart) && /^\d+$/.test(end) && !error && from.trim() && to.trim();

  return (
    <form
      className="form card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        void run(async () => {
          const profile = await getProfile();
          await trips.create({
            ownerId: profile.userId,
            date,
            kind,
            timeFrom,
            timeTo,
            from: from.trim(),
            via: via.trim(),
            to: to.trim(),
            purpose: '',
            vehicle: vehicle.plate,
            driver: vehicle.driver || profile.name,
            odometerStart: startKm,
            odometerEnd: endKm,
          });
          toast(`Zapisano przejazd: ${km} km`);
          setFrom(to.trim());
          setVia('');
          setTo('');
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
      <p className="field-hint">
        {kind === 'sluzbowy'
          ? 'Służbowy: trafia do ewidencji przebiegu dla celów VAT.'
          : 'Prywatny: w aplikacji zapisany jako prywatny (do wglądu), ale do ewidencji VAT wchodzi jako służbowy. Licznik jest ten sam dla obu rodzajów.'}
      </p>
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
          <input value={from} placeholder="Np. Łódź" onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Dokąd">
          <input value={to} placeholder="Np. Łódź" onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Przez (opcjonalnie)" hint="Miejscowości po drodze po przecinku, np. Kutno, Kłodawa.">
        <input value={via} onChange={(e) => setVia(e.target.value)} />
      </Field>
      {(from.trim() || to.trim()) && <p className="field-hint">Trasa w ewidencji: {routeText([from, ...via.split(','), to]) || '—'}</p>}
      <div className="form-row">
        <Field label="Licznik przed (km)" hint={last?.value != null ? `Puste: ${last.value} km z poprzedniej jazdy.` : undefined}>
          <input inputMode="numeric" value={start} placeholder={last?.value != null ? String(last.value) : ''} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Licznik po (km)" error={error}>
          <input inputMode="numeric" value={end} onChange={(e) => setEnd(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      {km !== null && !error && (
        <p className="total-line">
          <span>Przejechano</span>
          <strong>{km} km</strong>
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={!ready}>
        <Icon name="plus" /> Zapisz przejazd
      </button>
    </form>
  );
}

const driverKeyOf = (t: Trip) => t.ownerId ?? `name:${t.driver ?? ''}`;

export function TripsPage() {
  const { deliverFile, run, toast } = useFeedback();
  const [month, setMonth] = useState(monthOf(todayWarsaw()));
  const [filter, setFilter] = useState<TripKind | 'wszystkie'>('wszystkie');
  const [who, setWho] = useState('moje');
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = useLiveQuery(async () => {
    const profile = await getProfile();
    const sync = await getSyncState();
    return {
      all: await trips.all(),
      profile,
      vehicle: await getVehicle(),
      company: await getCompany(),
      owner: Boolean(sync && (sync.role === 'owner' || sync.role === 'ksiegowosc')),
    };
  });

  if (!data) return <Loading />;
  const { profile, vehicle } = data;
  const myName = vehicle.driver || profile.name;
  const driverName = (t: Trip) => t.driver || (ownedBy(t.ownerId, profile.userId, true) ? myName : '');
  // Szef widzi przejazdy wszystkich kierowców, technik tylko swoje.
  const drivers = new Map<string, string>();
  for (const t of data.all) if (!ownedBy(t.ownerId, profile.userId, true)) drivers.set(driverKeyOf(t), driverName(t) || 'Bez nazwiska');
  const list = data.all.filter((t) =>
    !data.owner || who === 'moje' ? ownedBy(t.ownerId, profile.userId, true) : who === 'wszyscy' || driverKeyOf(t) === who,
  );

  const from = `${month}-01`;
  const to = `${month}-31`;
  const year = month.slice(0, 4);
  const summary = kmSummary(list, from, to);
  const yearSummary = kmSummary(list, `${year}-01-01`, `${year}-12-31`);
  const shown = list
    .filter((t) => t.date >= from && t.date <= to && (filter === 'wszystkie' || t.kind === filter))
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeFrom.localeCompare(a.timeFrom));

  const print = async (kind: TripKind) => {
    setBusy(true);
    await run(async () => {
      const sheets = mileageSheets(list, kind, month, driverName);
      const monthTrips = list.filter((t) => t.date >= from && t.date <= to);
      const blob = await renderPdf(
        mileageDocument({
          kind,
          month,
          taxpayer: taxpayerLine(data.company),
          sheets: sheets.length > 0 ? sheets : [{ vehicle: vehicle.plate, entries: [] }],
          summary: kind === 'prywatny' ? driverSummary(monthTrips, driverName) : undefined,
        }),
      );
      deliverFile(blob, kind === 'sluzbowy' ? `ewidencja-przebiegu-vat-${month}.pdf` : `przejazdy-prywatne-${month}.pdf`);
    });
    setBusy(false);
  };

  return (
    <Page title="Kilometry" back="/">
      <button type="button" className="vehicle-card" onClick={() => setVehicleOpen(true)}>
        <Icon name="car" size={22} />
        <span className="vehicle-main">
          {vehicle.plate ? <strong className="plate">{vehicle.plate}</strong> : <strong>Auto: nie ustawiono</strong>}
          <span className="row-sub">Kierowca: {myName || 'nie ustawiono'}</span>
        </span>
        <span className="link">Zmień</span>
      </button>
      {!vehicle.plate && (
        <div className="notice notice-warn">
          <Icon name="alert" />
          <span>Ustaw numer rejestracyjny auta. Ewidencja przebiegu jest prowadzona osobno dla każdego auta.</span>
        </div>
      )}

      <TripForm vehicle={vehicle} onSaved={() => setMonth(monthOf(todayWarsaw()))} />

      {data.owner && (
        <label className="inline-select">
          <span>Kierowca</span>
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="moje">Moje przejazdy</option>
            <option value="wszyscy">Wszyscy kierowcy</option>
            {[...drivers.entries()].map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}

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
        <Stat label="Służbowo (VAT) w miesiącu" value={`${summary.sluzbowy} km`} />
        <Stat label="w tym prywatne" value={`${summary.prywatny} km`} />
        <Stat label={`Służbowo (VAT) w ${year}`} value={`${yearSummary.sluzbowy} km`} />
        <Stat label="w tym prywatne" value={`${yearSummary.prywatny} km`} />
      </div>
      <div className="btn-stack">
        <button type="button" className="btn" disabled={busy} onClick={() => void print('sluzbowy')}>
          <Icon name="file" /> Ewidencja przebiegu dla celów VAT
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void print('prywatny')}>
          <Icon name="file" /> Przejazdy prywatne dla pracodawcy
        </button>
      </div>
      <p className="field-hint">
        Ewidencja VAT zawiera tylko przejazdy służbowe, każdy jako „SŁUŻBOWO”, osobno dla każdego auta. Przejazdy z jednego dnia
        jednym autem łączą się w jeden wpis z całą trasą. Prywatne drukują się na osobnych kartkach z zestawieniem kilometrów
        kierowców.
      </p>

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
              <span className="row-title">{routeText([t.from, ...(t.via ?? '').split(','), t.to])}</span>
              <span className="row-sub">
                {formatDate(t.date)}, {t.timeFrom}
                {t.timeTo ? `–${t.timeTo}` : ''} · {KIND_NAMES[t.kind]}
                {t.vehicle ? ` · ${t.vehicle}` : ''}
                {who !== 'moje' && driverName(t) ? ` · ${driverName(t)}` : ''}
              </span>
              <span className="row-meta">
                Licznik {t.odometerStart} → {t.odometerEnd}
              </span>
            </span>
            <span className="num">{tripKm(t)} km</span>
            {ownedBy(t.ownerId, profile.userId, true) && (
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
            )}
          </div>
        ))}
      </Group>

      <VehicleSheet open={vehicleOpen} vehicle={vehicle} profileName={profile.name} onClose={() => setVehicleOpen(false)} />
    </Page>
  );
}

