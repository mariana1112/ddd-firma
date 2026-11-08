import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { deleteExpense, restoreRecord } from '../data/domain';
import { COST_SUGGESTIONS, costName, formatPln, periodOf, shiftPeriod, type Period } from '../data/reports';
import { expenses } from '../data/repo';
import { getProfile, ownedBy } from '../data/settings';
import { formatDate, formatDateLong, todayWarsaw } from '../lib/dates';
import { parseMoney } from '../lib/money';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Empty, Field, Group, Loading, Page, Stat } from '../ui/kit';

export function CostsPage() {
  const { run, toast } = useFeedback();
  const [period, setPeriod] = useState<Period>(() => periodOf('tydzien', todayWarsaw()));
  const [date, setDate] = useState(todayWarsaw());
  // Jedna kategoria „inne koszty”: nazwę kosztu wpisuje technik, a przyciski tylko ją podpowiadają.
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const list = useLiveQuery(async () => {
    const profile = await getProfile();
    return (await expenses.all()).filter((e) => ownedBy(e.ownerId, profile.userId, true));
  });

  if (!list) return <Loading />;
  const inPeriod = list.filter((e) => e.date >= period.from && e.date <= period.to);
  const byDay = new Map<string, typeof inPeriod>();
  for (const e of inPeriod.sort((a, b) => b.date.localeCompare(a.date))) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const total = inPeriod.reduce((s, e) => s + e.amount, 0);
  const valid = parseMoney(amount) !== null && (parseMoney(amount) ?? 0) > 0 && category.trim().length > 0;
  const used = [...new Set(list.map((e) => costName(e)))].filter((n) => !COST_SUGGESTIONS.some((s) => s.toLowerCase() === n.toLowerCase()));
  const suggestions = [...COST_SUGGESTIONS, ...used.slice(0, 6)];

  const add = () =>
    run(async () => {
      const profile = await getProfile();
      await expenses.create({
        date,
        category: category.trim(),
        amount: parseMoney(amount)!,
        description: description.trim(),
        docNo: '',
        movementId: null,
        ownerId: profile.userId,
      });
      setAmount('');
      setDescription('');
      setCategory('');
      toast(`Dodano: ${category.trim()} ${formatPln(parseMoney(amount)!)}`);
    });

  return (
    <Page title="Koszty" back="/wiecej">
      <form
        className="form card"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void add();
        }}
      >
        <Field label="Koszt" hint="Wpisz, co to za koszt, albo wybierz poniżej. Każdy koszt pomniejsza gotówkę dla szefa.">
          <input value={category} placeholder="Np. Paliwo, Zaliczka, Myjnia" onChange={(e) => setCategory(e.target.value)} />
        </Field>
        <div className="chips" role="group" aria-label="Podpowiedzi kosztów">
          {suggestions.map((c) => (
            <button
              key={c}
              type="button"
              className={c.toLowerCase() === category.trim().toLowerCase() ? 'chip active' : 'chip'}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="form-row">
          <Field label="Kwota (zł)">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Dzień">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Notatka (opcjonalnie)">
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Np. A1 Stryków, faktura" />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={!valid}>
          <Icon name="plus" /> Dodaj koszt
        </button>
      </form>

      <div className="month-nav">
        <button type="button" className="icon-btn" aria-label="Poprzedni tydzień" onClick={() => setPeriod(shiftPeriod(period, -1))}>
          <Icon name="left" />
        </button>
        <strong>
          {formatDate(period.from)} – {formatDate(period.to)}
        </strong>
        <button type="button" className="icon-btn" aria-label="Następny tydzień" onClick={() => setPeriod(shiftPeriod(period, 1))}>
          <Icon name="chevron" />
        </button>
      </div>
      <div className="stats">
        <Stat label="Koszty w tygodniu" value={formatPln(total)} />
        <Stat label="Liczba wpisów" value={String(inPeriod.length)} />
      </div>

      {byDay.size === 0 && <Empty icon="receipt" title="Brak kosztów w tym tygodniu" />}
      {[...byDay.entries()].map(([day, items]) => (
        <Group key={day} title={`${formatDateLong(day)} · ${formatPln(items.reduce((s, e) => s + e.amount, 0))}`}>
          {items.map((e) => (
            <div className="row" key={e.id}>
              <span className="row-main">
                <span className="row-title">{costName(e)}</span>
                {e.description && costName(e) !== e.description.trim() && <span className="row-sub">{e.description}</span>}
              </span>
              <span className="num">{formatPln(e.amount)}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="Usuń koszt"
                onClick={() =>
                  void run(async () => {
                    await deleteExpense(e.id);
                    toast('Usunięto koszt', { action: { label: 'Cofnij', onClick: () => void run(() => restoreRecord('expenses', e.id)) } });
                  })
                }
              >
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
        </Group>
      ))}
    </Page>
  );
}
