import { useLiveQuery } from 'dexie-react-hooks';
import { fillGap, odometerGaps } from '../data/day-trip';
import { normalizeCity } from '../data/cities';
import { useEffect, useState } from 'react';
import { restoreRecord } from '../data/domain';
import { driverSummary, mileageSheets, normalizePlate, routeText, suggestRoutes } from '../data/mileage';
import { lastOdometer, odometerAround, tripKm } from '../data/orders';
import { trips, orders, visits } from '../data/repo';
import { COMPANY_NAME, DEFAULT_BASE, getCompany, getProfile, getUiSyncState, getVehicle, ownedBy, saveVehicle, type VehicleSettings } from '../data/settings';
import { DayCard } from './day-card';
import type { CompanySettings, Trip, TripKind } from '../data/types';
import { formatDate, formatMonth, monthOf, nowWarsaw, shiftMonth, todayWarsaw } from '../lib/dates';
import { mileageDocument } from '../pdf/documents';
import { renderPdf } from '../pdf/render';
import { useFeedback } from '../ui/feedback';
import { useOnce } from '../ui/once';
import { Icon } from '../ui/icons';
import { Empty, Field, Group, Loading, Page, Sheet, Stat, Row } from '../ui/kit';

export const KIND_NAMES: Record<TripKind, string> = { sluzbowy: 'Służbowy', prywatny: 'Prywatny' };

export function kmSummary(list: Trip[], from: string, to: string): Record<TripKind, number> {
  const out: Record<TripKind, number> = { sluzbowy: 0, prywatny: 0 };
  for (const t of list) {
    if (t.date < from || t.date > to) continue;
    // Do VAT każdy przejazd jest służbowy; prywatne liczone dodatkowo, do wglądu.
    out.sluzbowy += tripKm(t);
    if (t.kind === 'prywatny') out.prywatny += tripKm(t);
    else out.prywatny += Math.min(tripKm(t), t.privateKm ?? 0);
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
  const [base, setBase] = useState(props.vehicle.base);

  useEffect(() => {
    if (props.open) {
      setPlate(props.vehicle.plate);
      setDriver(props.vehicle.driver || props.profileName);
      setBase(props.vehicle.base);
    }
  }, [props.open, props.vehicle, props.profileName]);

  return (
    <Sheet open={props.open} title="Auto i kierowca" onClose={props.onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await saveVehicle({ plate: plate.trim().toUpperCase().replace(/\s+/g, ' '), driver: driver.trim(), base: normalizeCity(base) || DEFAULT_BASE });
            toast('Zapisano auto. Obowiązuje do następnej zmiany.');
            props.onClose();
          });
        }}
      >
        <Field label="Numer rejestracyjny" hint="Ustawiasz raz. Kolejne przejazdy zapiszą się na to auto, aż go nie zmienisz.">
          <input value={plate} autoCapitalize="characters" autoComplete="off" placeholder="Np. WE 1KR10" onChange={(e) => setPlate(e.target.value.toUpperCase())} />
        </Field>
        <Field label="Imię i nazwisko kierowcy" hint="Trafia do kolumny „osoba kierująca pojazdem” w ewidencji.">
          <input value={driver} autoComplete="off" onChange={(e) => setDriver(e.target.value)} />
        </Field>
        <Field label="Start i koniec każdej trasy" hint={`Każdy dzień zaczyna się i kończy tutaj. Puste: ${DEFAULT_BASE}.`}>
          <input value={base} autoComplete="off" placeholder={DEFAULT_BASE} onChange={(e) => setBase(e.target.value)} />
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
  const { once, pending } = useOnce();
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
  const [privateKm, setPrivateKm] = useState('');
  const last = useLiveQuery(async () => {
    const count = await trips.all();
    const me = (await getProfile()).userId;
    const latest = await lastOdometer(me, vehicle.plate);
    const around = await odometerAround(me, vehicle.plate, date);
    // Dzień wcześniejszy niż ostatni przejazd: licznik z tamtego dnia (przejazd „wskakuje” na swoje miejsce).
    const past = around.after !== null;
    return { value: past ? around.before : latest, after: around.after, past, count: count.length };
  }, [vehicle.plate, date]);
  useEffect(() => {
    if (last?.value != null) setStart(String(last.value));
  }, [last?.value]);

  // Propozycja trasy tylko z zabiegów wybranego dnia: z bazy przez ich miejscowości i z powrotem do bazy.
  const routes = useLiveQuery(async () => {
    const me = (await getProfile()).userId;
    const byOrder = new Map((await orders.all()).map((o) => [o.id, o]));
    const dayVisits = (await visits.all())
      .filter((v) => v.status !== 'odwolany' && (v.doneOn === date || v.start?.slice(0, 10) === date) && (!me || !v.technicianId || v.technicianId === me))
      .sort((a, b) => (a.startedAt ?? a.start ?? '').localeCompare(b.startedAt ?? b.start ?? ''));
    const visitCities = dayVisits.map((v) => byOrder.get(v.orderId)?.city ?? '').filter(Boolean);
    return { list: suggestRoutes({ base: vehicle.base, visitCities }) };
  }, [date, vehicle.base]);
  // „Skąd” to baza (domyślnie Gdańsk); można ją zmienić.
  useEffect(() => {
    setFrom((current) => current || vehicle.base);
  }, [vehicle.base]);
  const applyRoute = (points: string[]) => {
    setFrom(points[0] ?? '');
    setTo(points[points.length - 1] ?? '');
    setVia(points.slice(1, -1).join(', '));
  };

  // Puste „Licznik przed”: bierzemy stan po poprzednim przejeździe.
  const effectiveStart = start || (last?.value != null ? String(last.value) : '');
  const startKm = Number(effectiveStart);
  const endKm = Number(end);
  const km = effectiveStart && end ? endKm - startKm : null;
  const error = km !== null && km < 0 ? 'Licznik po przejeździe jest mniejszy niż przed' : undefined;
  // Przejazd z dawnego dnia nie powinien wyjść poza licznik kolejnego przejazdu (ostrzeżenie, nie blokada).
  const overlap = last?.past && last.after !== null && end && endKm > last.after ? `Licznik po jest większy niż na początku kolejnego przejazdu (${last.after} km). Sprawdź wpis.` : undefined;
  const priv = privateKm ? Number(privateKm) : 0;
  const privError = kind === 'sluzbowy' && km !== null && priv > km ? 'Więcej niż cały przejazd' : undefined;
  // Puste „Dokąd”: jazda lokalna (w obrębie miejscowości startu).
  const destination = to.trim() || from.trim();
  const ready = /^\d+$/.test(effectiveStart) && /^\d+$/.test(end) && !error && !privError && from.trim();

  return (
    <form
      className="form card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        void once(() => run(async () => {
          const profile = await getProfile();
          await trips.create({
            ownerId: profile.userId,
            date,
            kind,
            timeFrom: kind === 'sluzbowy' ? timeFrom || nowWarsaw().slice(11, 16) : timeFrom,
            timeTo: kind === 'sluzbowy' ? '' : timeTo,
            // Miejscowości z poprawioną pisownią; trasa „Gdańsk - Gdańsk” w ewidencji to jeden „Gdańsk”.
            from: normalizeCity(from),
            via: via.split(',').map(normalizeCity).filter(Boolean).join(', '),
            to: normalizeCity(destination),
            purpose: '',
            vehicle: vehicle.plate,
            driver: vehicle.driver || profile.name,
            odometerStart: startKm,
            odometerEnd: endKm,
            // Służbowy z prywatną częścią: w ewidencji VAT cały przejazd, prywatne km osobno w raporcie.
            ...(kind === 'sluzbowy' && priv > 0 ? { privateKm: priv } : {}),
          });
          toast(`Zapisano przejazd: ${km} km${kind === 'sluzbowy' && priv > 0 ? ` (w tym prywatnie ${priv} km)` : ''}`);
          setPrivateKm('');
          setFrom(vehicle.base);
          setVia('');
          setTo('');
          setStart(String(endKm));
          setEnd('');
          onSaved();
        }));
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
      {/* Służbowy: wystarczy dzień i dokąd; godziny są tylko przy prywatnym (kolejność przejazdów ustala zapis). */}
      {kind === 'sluzbowy' ? (
        <Field label="Dzień">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      ) : (
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
      )}
      {kind === 'sluzbowy' && routes && routes.list.length > 0 && (
        <div className="field">
          <span className="field-label">Trasa po zleceniach z tego dnia</span>
          <div className="chips chips-wrap">
            {routes.list.map((r) => (
              <button key={r.join('|')} type="button" className="chip" onClick={() => applyRoute(r)}>
                {r.join(' - ')}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="form-row">
        <Field label="Skąd">
          <input value={from} placeholder={vehicle.base} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Dokąd" hint="Puste: jazda lokalna.">
          <input value={to} placeholder="lokalnie" onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Przez (opcjonalnie)" hint="Miejscowości po drodze po przecinku, np. Kutno, Kłodawa.">
        <input value={via} onChange={(e) => setVia(e.target.value)} />
      </Field>
      {from.trim() && (
        <p className="field-hint">
          Trasa w ewidencji: {routeText([from, ...via.split(','), destination]) || '—'}
          {!to.trim() && !via.trim() ? ' (jazda lokalna)' : ''}
        </p>
      )}
      <div className="form-row">
        <Field label="Licznik przed (km)" hint={last?.value != null ? `Puste: ${last.value} km z poprzedniej jazdy.` : undefined}>
          <input inputMode="numeric" value={start} placeholder={last?.value != null ? String(last.value) : ''} onChange={(e) => setStart(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Licznik po (km)" error={error}>
          <input inputMode="numeric" value={end} onChange={(e) => setEnd(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </div>
      {last?.past && (
        <p className="notice notice-info">
          <Icon name="calendar" />
          <span>Przejazd z dawnego dnia: licznik z tamtego dnia{last.value != null ? ` (${last.value} km)` : ''}. Zapisany trafi na swoje miejsce w ewidencji, przed późniejszymi przejazdami.</span>
        </p>
      )}
      {overlap && <p className="field-message">{overlap}</p>}
      {kind === 'sluzbowy' && (
        <Field label="W tym prywatnie (km, opcjonalnie)" error={privError} hint="Np. podjazd po prywatnej sprawie w trakcie dnia pracy.">
          <input inputMode="numeric" value={privateKm} onChange={(e) => setPrivateKm(e.target.value.replace(/\D/g, ''))} />
        </Field>
      )}
      {km !== null && !error && (
        <p className="total-line">
          <span>Przejechano</span>
          <strong>{km} km</strong>
        </p>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={!ready || pending}>
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
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = useLiveQuery(async () => {
    const profile = await getProfile();
    const sync = await getUiSyncState();
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
          <span className="row-sub">
            Kierowca: {myName || 'nie ustawiono'} · trasy z {vehicle.base}
          </span>
        </span>
        <span className="link">Zmień</span>
      </button>
      {!vehicle.plate && (
        <div className="notice notice-warn">
          <Icon name="alert" />
          <span>Ustaw numer rejestracyjny auta. Ewidencja przebiegu jest prowadzona osobno dla każdego auta.</span>
        </div>
      )}

      <DayCard always />
      {manual ? (
        <TripForm vehicle={vehicle} onSaved={() => setMonth(monthOf(todayWarsaw()))} />
      ) : (
        <button type="button" className="btn btn-block" onClick={() => setManual(true)}>
          <Icon name="plus" /> Dopisz przejazd ręcznie (np. z innego dnia)
        </button>
      )}

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
      {/* Ciągłość licznika: luki między przejazdami w tym miesiącu (rano licznik wyższy niż wieczorem). */}
      {(() => {
        const gaps = odometerGaps(list).filter((g) => g.date >= from && g.date <= to);
        return (
          <Group title="Ciągłość licznika">
            {gaps.length === 0 ? (
              <p className="field-hint group-pad">Bez luk: każdy przejazd zaczyna się tam, gdzie skończył się poprzedni.</p>
            ) : (
              gaps.map((g) => (
                <Row
                  key={g.vehicle + g.from}
                  icon="alert"
                  title={`${formatDate(g.date)}: brakuje ${g.km} km`}
                  sub={`${g.vehicle} · licznik ${g.from.toLocaleString('pl-PL')} → ${g.to.toLocaleString('pl-PL')}`}
                  trailing={
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() =>
                        void run(async () => {
                          const place = list.find((t) => t.odometerEnd === g.from)?.to ?? '';
                          await fillGap(g, place, profile.userId, vehicle.driver || myName);
                          toast(`Dopisano ${g.km} km`);
                        })
                      }
                    >
                      Dopisz
                    </button>
                  }
                />
              ))
            )}
          </Group>
        );
      })()}
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

