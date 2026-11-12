import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { orderCode, roman, visitCode } from '../data/codes';
import { parseAddressText } from '../data/maps';
import { addPastVisit } from '../data/orders';
import { formatPln } from '../data/reports';
import { getProfile, getRegions, getSyncState } from '../data/settings';
import { PAY_NAMES, PESTS } from '../data/texts';
import type { PayMethod, PestCategory } from '../data/types';
import { formatDate, todayWarsaw } from '../lib/dates';
import { parseMoney } from '../lib/money';
import { formatPhoneInput, phoneError } from '../lib/validators';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Field, Group, Loading, Page, Row } from '../ui/kit';
import { enterRegion } from './regions';

const supabaseApi = () => import('../data/sync/supabase');
const PAY: PayMethod[] = ['gotowka', 'blik', 'przelew'];

/**
 * Panel admina → „Dodaj stare zlecenie”: szybkie dopisanie wykonanego zabiegu do raportów. Tylko to, co liczy się
 * w raporcie: telefon, dzień, kwota, forma płatności, który zabieg i kto go zrobił (bez widełek i wywiadu).
 */
export function PastOrderPage() {
  const { run, toast } = useFeedback();
  const [params] = useSearchParams();
  const state = useLiveQuery(async () => (await getSyncState()) ?? null);
  const regions = useLiveQuery(() => getRegions());
  const me = useLiveQuery(() => getProfile());
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState(todayWarsaw());
  const [amount, setAmount] = useState('');
  const [pay, setPay] = useState<PayMethod>('gotowka');
  const [seq, setSeq] = useState(1);
  const [orderNo, setOrderNo] = useState('');
  const [address, setAddress] = useState('');
  const [pest, setPest] = useState<PestCategory | ''>('');
  const [tech, setTech] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const wantedRegion = params.get('region');

  // Technicy regionu do wyboru „kto wykonał” (wymaga internetu); bez niego zostaje „Ja”.
  useEffect(() => {
    if (!state?.orgId) return;
    void (async () => {
      try {
        const api = await supabaseApi();
        const [members, access] = await Promise.all([api.listMembers(state.orgId), api.listMemberBranches(state.orgId).catch(() => [])]);
        const inRegion = new Set(access.filter((a) => a.branchId === state.branchId).map((a) => a.userId));
        setPeople(
          members
            .filter((m) => m.approved && !m.suspended && (m.branchId === state.branchId || inRegion.has(m.userId)))
            .map((m) => ({ id: m.userId, name: m.displayName || m.email })),
        );
      } catch {
        setPeople([]);
      }
    })();
  }, [state?.orgId, state?.branchId]);

  if (state === undefined || !regions || !me) return <Loading />;
  if (!state || state.role !== 'owner') return <Navigate to="/admin" replace />;

  const regionName = state.branchName || (state.branchId ? regions[state.branchId]?.name : '') || 'bez regionu';
  const otherRegion = wantedRegion && wantedRegion !== state.branchId ? { id: wantedRegion, name: regions[wantedRegion]?.name ?? 'region' } : null;
  const value = parseMoney(amount);
  const phoneProblem = phone.trim() ? phoneError(phone) : 'Podaj telefon klienta';
  const amountProblem = value === null ? 'Podaj kwotę, np. 350' : undefined;
  const technicians = [{ id: me.userId ?? '', name: me.name || 'Admin' }, ...people.filter((p) => p.id !== me.userId)];
  const chosen = technicians.find((t) => t.id === tech) ?? technicians[0];

  const save = () =>
    run(async () => {
      if (phoneProblem || amountProblem || !date) return;
      const where = parseAddressText(address);
      const { order, visit, created } = await addPastVisit({
        phone: formatPhoneInput(phone),
        doneOn: date,
        amount: value!,
        payMethod: pay,
        seq,
        technician: { id: chosen.id || null, name: chosen.name },
        orderNumber: orderNo ? Number(orderNo) : null,
        street: where?.street,
        houseNo: where?.houseNo,
        city: where?.city,
        pest: pest || undefined,
      });
      const line = `${visitCode(order, visit.seq)} · ${formatDate(date)} · ${formatPln(value!)} ${PAY_NAMES[pay]} · ${chosen.name}`;
      setAdded((list) => [line, ...list]);
      toast(created ? `Dodano zlecenie ${orderCode(order)} do raportów` : `Dopisano zabieg ${roman(visit.seq)} do zlecenia ${orderCode(order)}`);
      // Kolejne stare zlecenie: zostaje dzień, płatność i technik.
      setPhone('');
      setAmount('');
      setOrderNo('');
      setAddress('');
      setSeq(1);
    });

  return (
    <Page title="Dodaj stare zlecenie" back="/admin">
      <p className="notice notice-info">
        <Icon name="chart" />
        <span>
          Dopisuje wykonany zabieg do raportów: telefon, dzień, kwota i płatność. Zapisze się w regionie <strong>{regionName}</strong> (region tego
          telefonu).
        </span>
      </p>
      {otherRegion && (
        <button type="button" className="btn btn-block" onClick={() => void run(async () => enterRegion(state, otherRegion))}>
          <Icon name="building" /> Przełącz ten telefon na region {otherRegion.name}
        </button>
      )}
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="form-row">
          <Field label="Telefon klienta" error={phone.trim() ? phoneProblem : undefined}>
            <input type="tel" inputMode="tel" value={phone} placeholder="+48 500 600 700" onChange={(e) => setPhone(formatPhoneInput(e.target.value))} />
          </Field>
          <Field label="Data wykonania">
            <input type="date" value={date} max={todayWarsaw()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Kwota pobrana (zł)" error={amount.trim() ? amountProblem : undefined}>
          <input inputMode="decimal" value={amount} placeholder="Np. 350" onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="field">
          <span className="field-label">Forma płatności</span>
          <div className="choice">
            {PAY.map((m) => (
              <button key={m} type="button" className={pay === m ? 'choice-item active' : 'choice-item'} aria-pressed={pay === m} onClick={() => setPay(m)}>
                {PAY_NAMES[m]}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Który zabieg</span>
          <div className="choice">
            {[1, 2, 3, 4].map((n) => (
              <button key={n} type="button" className={seq === n ? 'choice-item active' : 'choice-item'} aria-pressed={seq === n} onClick={() => setSeq(n)}>
                Zabieg {roman(n)}
              </button>
            ))}
          </div>
        </div>
        <Field label="Kto wykonał">
          <select value={chosen.id} onChange={(e) => setTech(e.target.value)}>
            {technicians.map((t) => (
              <option key={t.id || 'ja'} value={t.id}>
                {t.id === me.userId ? `${t.name} (Ty)` : t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Numer zlecenia (opcjonalnie)" hint="Numer istniejącego zlecenia, np. 99: zabieg dopisze się do niego. Puste: nowe zlecenie z kolejnym numerem regionu.">
          <input inputMode="numeric" value={orderNo} onChange={(e) => setOrderNo(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="Adres (opcjonalnie)" hint="Np. Długa 5, Gdańsk">
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field label="Szkodnik (opcjonalnie)">
          <select value={pest} onChange={(e) => setPest(e.target.value as PestCategory | '')}>
            <option value="">nie podano</option>
            {(Object.entries(PESTS) as Array<[PestCategory, string]>).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <button type="submit" className="btn btn-primary btn-block btn-big" disabled={Boolean(phoneProblem || amountProblem || !date)}>
          <Icon name="plus" /> Dodaj do raportów
        </button>
      </form>
      {added.length > 0 && (
        <Group title={`Dodane teraz (${added.length})`}>
          {added.map((line, i) => (
            <Row key={i} icon="check" title={line} />
          ))}
        </Group>
      )}
      <p className="field-hint">
        Dodane zabiegi widać w <Link to="/raporty">Raportach</Link> z dnia wykonania i w zleceniach (zakończone).
      </p>
    </Page>
  );
}
