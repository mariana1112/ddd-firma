import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addStop, dayPurpose, dayRoute, dayVisits, fillGap, finishDay, getDayStart, startDay, type DayStart } from '../data/day-trip';
import { homeBase, normalizePlate, routeText } from '../data/mileage';
import { lastOdometer } from '../data/orders';
import { orders, trips, visits } from '../data/repo';
import { getProfile, getVehicle } from '../data/settings';
import { formatDate, nowWarsaw, todayWarsaw } from '../lib/dates';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Field, Sheet } from '../ui/kit';

/**
 * Kilometrówka „Dzień w trasie” na Pulpicie. Rano: „Jadę” z licznikiem z wczorajszego wieczoru. W ciągu dnia trasa
 * składa się z zabiegów. Wieczorem: jeden stan licznika i zapis dnia jako przejazd służbowy do ewidencji VAT.
 */
export function DayCard() {
  const { run, toast } = useFeedback();
  const today = todayWarsaw();
  const data = useLiveQuery(async () => {
    const profile = await getProfile();
    const vehicle = await getVehicle();
    const mine = (await trips.all())
      .filter((t) => !profile.userId || !t.ownerId || t.ownerId === profile.userId)
      .sort((a, b) => b.date.localeCompare(a.date) || b.odometerEnd - a.odometerEnd);
    return {
      profile,
      vehicle,
      start: await getDayStart(),
      last: await lastOdometer(profile.userId, vehicle.plate),
      lastPlace: mine.find((t) => t.to.trim())?.to.trim() ?? '',
      base: homeBase(mine.slice(0, 30)),
      savedToday: mine.find((t) => t.date === today && t.kind === 'sluzbowy' && normalizePlate(t.vehicle) === normalizePlate(vehicle.plate)),
      orders: new Map((await orders.all()).map((o) => [o.id, o])),
      visits: await visits.all(),
    };
  }, [today]);
  const [otherOdo, setOtherOdo] = useState<string | null>(null);
  const [fillMissing, setFillMissing] = useState(true);
  const [ending, setEnding] = useState(false);
  const [stop, setStop] = useState('');
  const [addingStop, setAddingStop] = useState(false);

  if (!data) return null;
  const { start, vehicle, profile } = data;
  const from = data.lastPlace || data.base;
  const todayVisits = dayVisits(data.visits, today, profile.userId);
  const driver = vehicle.driver || profile.name;

  // Bez auta nie ma ewidencji: jedna podpowiedź zamiast karty.
  if (!vehicle.plate) {
    if (!todayVisits.length) return null;
    return (
      <Link to="/kilometry" className="notice notice-info">
        <Icon name="car" />
        <span>Ustaw auto w Kilometrach, a kilometrówka będzie się robić sama: rano „Jadę”, wieczorem licznik.</span>
      </Link>
    );
  }

  // Dzień zapisany: tylko krótka informacja.
  if (!start && data.savedToday) {
    const t = data.savedToday;
    return (
      <Link to="/kilometry" className="day-card day-card-done">
        <Icon name="check" />
        <span>
          Dzień zapisany: <strong>{t.odometerEnd - t.odometerStart} km</strong> · {routeText([t.from, ...(t.via ?? '').split(','), t.to])}
        </span>
      </Link>
    );
  }

  // Start dnia: pokazujemy w dni z zabiegami (albo gdy dzień już trwa).
  if (!start) {
    if (!todayVisits.length) return null;
    const typed = otherOdo !== null ? Number(otherOdo.replace(/\D/g, '')) : null;
    const startOdo = typed ?? data.last ?? 0;
    const gap = data.last !== null && startOdo > data.last ? startOdo - data.last : 0;
    const invalid = otherOdo !== null && (!otherOdo.trim() || (data.last !== null && startOdo < data.last));
    const cities = [...new Set(todayVisits.map((v) => data.orders.get(v.orderId)?.city).filter(Boolean))];
    const go = () =>
      run(async () => {
        if (invalid) return;
        // Brakujące kilometry od ostatniego przejazdu: uzupełnienie, żeby ewidencja nie miała luki.
        if (gap > 0 && fillMissing && data.last !== null) {
          await fillGap({ vehicle: vehicle.plate, date: today, from: data.last, to: startOdo, km: gap }, from, profile.userId, driver);
        }
        await startDay({ date: today, odometer: startOdo, vehicle: vehicle.plate, from, startedAt: nowWarsaw() });
        setOtherOdo(null);
        toast(`Dobrej trasy. Licznik: ${startOdo.toLocaleString('pl-PL')} km`);
      });
    return (
      <section className="day-card">
        <div className="day-card-head">
          <Icon name="car" /> <strong>Start dnia</strong>
          <span className="day-card-plate">{vehicle.plate}</span>
        </div>
        {otherOdo === null ? (
          <p className="day-card-odo">
            <span className="row-sub">Licznik z ostatniego przejazdu</span>
            <strong>{data.last !== null ? `${data.last.toLocaleString('pl-PL')} km` : 'brak, wpisz stan'}</strong>
          </p>
        ) : (
          <Field label="Ile pokazuje licznik?" error={invalid ? `Co najmniej ${data.last?.toLocaleString('pl-PL') ?? 0} km` : undefined}>
            <input inputMode="numeric" autoFocus value={otherOdo} onChange={(e) => setOtherOdo(e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        {gap > 0 && (
          <label className="check">
            <input type="checkbox" checked={fillMissing} onChange={(e) => setFillMissing(e.target.checked)} />
            Brakuje {gap} km od ostatniego przejazdu. Dopisz je do ewidencji.
          </label>
        )}
        <p className="row-sub">
          Start: {from || 'ustaw w pierwszym przejeździe'} · dziś {todayVisits.length} {todayVisits.length === 1 ? 'zabieg' : 'zabiegi'}
          {cities.length ? `: ${cities.join(', ')}` : ''}
        </p>
        <button type="button" className="btn btn-primary btn-block btn-big" disabled={data.last === null && otherOdo === null} onClick={() => void go()}>
          <Icon name="play" /> Jadę
        </button>
        {otherOdo === null && (
          <button type="button" className="link" onClick={() => setOtherOdo(data.last !== null ? String(data.last) : '')}>
            Licznik pokazuje inaczej
          </button>
        )}
      </section>
    );
  }

  // Dzień trwa (albo został niezakończony wczoraj).
  const dayList = dayVisits(data.visits, start.date, profile.userId);
  const route = dayRoute(start.from, dayList, data.orders, start.stops ?? []);
  const stale = start.date !== today;
  return (
    <section className={stale ? 'day-card day-card-stale' : 'day-card'}>
      <div className="day-card-head">
        <Icon name="car" /> <strong>{stale ? `Niezakończony dzień ${formatDate(start.date)}` : `W trasie od ${start.startedAt.slice(11, 16)}`}</strong>
        <span className="day-card-plate">{start.vehicle}</span>
      </div>
      <p className="day-card-route">{route.join(' – ') || start.from}</p>
      <p className="row-sub">
        Licznik rano: {start.odometer.toLocaleString('pl-PL')} km · {dayPurpose(dayList, data.orders)}
      </p>
      {addingStop ? (
        <form
          className="inline-add"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await addStop(stop);
              setStop('');
              setAddingStop(false);
              toast('Dodano przystanek');
            });
          }}
        >
          <input autoFocus value={stop} placeholder="Np. Pruszcz Gdański" onChange={(e) => setStop(e.target.value)} />
          <button type="submit" className="btn btn-sm" disabled={!stop.trim()}>
            Dodaj
          </button>
        </form>
      ) : (
        !stale && (
          <button type="button" className="link" onClick={() => setAddingStop(true)}>
            + Przystanek bez zabiegu (stacja, hurtownia)
          </button>
        )
      )}
      <button type="button" className="btn btn-primary btn-block btn-big" onClick={() => setEnding(true)}>
        <Icon name="check" /> {stale ? 'Wpisz licznik z tamtego wieczoru' : 'Zakończ dzień'}
      </button>
      {ending && <EndDaySheet start={start} route={route} purpose={dayPurpose(dayList, data.orders)} driver={driver} ownerId={profile.userId} onClose={() => setEnding(false)} />}
    </section>
  );
}

function EndDaySheet(props: { start: DayStart; route: string[]; purpose: string; driver: string; ownerId: string | null; onClose: () => void }) {
  const { run, toast } = useFeedback();
  const [odo, setOdo] = useState('');
  const [privateOn, setPrivateOn] = useState(false);
  const [privateKm, setPrivateKm] = useState('');
  const end = Number(odo);
  const km = odo ? end - props.start.odometer : null;
  const error = km !== null && km < 0 ? `Licznik wieczorem musi być co najmniej ${props.start.odometer.toLocaleString('pl-PL')} km` : undefined;
  const save = () =>
    run(async () => {
      if (!odo || error) return;
      const trip = await finishDay({
        start: props.start,
        odometerEnd: end,
        route: props.route,
        purpose: props.purpose,
        privateKm: privateOn ? Number(privateKm) || 0 : 0,
        ownerId: props.ownerId,
        driver: props.driver,
        timeTo: props.start.date === todayWarsaw() ? nowWarsaw().slice(11, 16) : '',
      });
      props.onClose();
      toast(`Zapisano dzień: ${trip.odometerEnd - trip.odometerStart} km`);
    });
  return (
    <Sheet open title={`Koniec dnia · ${formatDate(props.start.date)}`} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label="Ile pokazuje licznik?" error={error}>
          <input inputMode="numeric" autoFocus value={odo} placeholder={String(props.start.odometer)} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <p className="total-line">
          <span>Przejechano (służbowo, VAT)</span>
          <strong>{km !== null && !error ? `${km} km` : '—'}</strong>
        </p>
        <p className="day-card-route">{props.route.join(' – ')}</p>
        <p className="row-sub">Cel: {props.purpose}</p>
        <label className="check">
          <input type="checkbox" checked={privateOn} onChange={(e) => setPrivateOn(e.target.checked)} />W tym prywatny odcinek
        </label>
        {privateOn && (
          <Field label="Prywatne km (do wglądu)">
            <input inputMode="numeric" value={privateKm} onChange={(e) => setPrivateKm(e.target.value.replace(/\D/g, ''))} />
          </Field>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={!odo || Boolean(error)}>
          <Icon name="check" /> Zapisz dzień
        </button>
      </form>
    </Sheet>
  );
}
