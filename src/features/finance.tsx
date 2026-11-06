import { zodResolver } from '@hookform/resolvers/zod';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { monthSummary, outstandingJobs } from '../data/calc';
import { deleteExpense, restoreRecord } from '../data/domain';
import { clients, expenses, jobs, payments } from '../data/repo';
import type { Expense } from '../data/types';
import { csvBlob, csvMoney } from '../lib/csv';
import { formatDate, formatMonth, monthOf, shiftMonth, todayWarsaw } from '../lib/dates';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '../lib/labels';
import { formatMoney, moneyToInput, parseMoney } from '../lib/money';
import { useFeedback } from '../ui/feedback';
import { dateText, positiveMoneyText, required } from '../ui/forms';
import { Icon } from '../ui/icons';
import { Empty, Field, Group, Loading, Page, Row, Sheet, Stat } from '../ui/kit';

const expenseSchema = z.object({
  date: dateText,
  amount: positiveMoneyText,
  category: required('Podaj kategorię'),
  description: z.string(),
  docNo: z.string(),
});
type ExpenseValues = z.infer<typeof expenseSchema>;

function ExpenseForm(props: { expense?: Expense; defaultDate: string; onDone: () => void }) {
  const { run, toast } = useFeedback();
  const e = props.expense;
  const { register, handleSubmit, formState } = useForm<ExpenseValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      date: e?.date ?? props.defaultDate,
      amount: e ? moneyToInput(e.amount) : '',
      category: e?.category ?? '',
      description: e?.description ?? '',
      docNo: e?.docNo ?? '',
    },
  });
  const { errors } = formState;

  const onSubmit = (v: ExpenseValues) =>
    run(async () => {
      const values = {
        date: v.date,
        amount: parseMoney(v.amount)!,
        category: v.category.trim(),
        description: v.description.trim(),
        docNo: v.docNo.trim(),
      };
      if (e) await expenses.update(e.id, values);
      else await expenses.create({ ...values, movementId: null });
      props.onDone();
    });

  const remove = () =>
    run(async () => {
      if (!e) return;
      await deleteExpense(e.id);
      props.onDone();
      toast(e.movementId ? 'Usunięto koszt i powiązany zakup preparatu' : 'Koszt jest w koszu', {
        action: { label: 'Cofnij', onClick: () => void run(() => restoreRecord('expenses', e.id)) },
      });
    });

  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="form-row">
        <Field label="Kwota (zł)" error={errors.amount?.message}>
          <input {...register('amount')} inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label="Data" error={errors.date?.message}>
          <input type="date" {...register('date')} />
        </Field>
      </div>
      <Field label="Kategoria" error={errors.category?.message}>
        <input {...register('category')} list="expense-categories" autoComplete="off" />
        <datalist id="expense-categories">
          {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>
      <Field label="Opis">
        <input {...register('description')} autoComplete="off" />
      </Field>
      <Field label="Numer dokumentu">
        <input {...register('docNo')} autoComplete="off" />
      </Field>
      {e?.movementId && <p className="field-hint">Ten koszt powstał z zakupu preparatu. Jego usunięcie cofa też zakup.</p>}
      <button type="submit" className="btn btn-primary btn-block">Zapisz koszt</button>
      {e && (
        <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => void remove()}>
          <Icon name="trash" /> Usuń koszt
        </button>
      )}
    </form>
  );
}

export function FinancePage() {
  const { deliverFile } = useFeedback();
  const today = todayWarsaw();
  const [month, setMonth] = useState(monthOf(today));
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);

  const data = useLiveQuery(async () => ({
    payments: await payments.all(),
    expenses: await expenses.all(),
    jobs: await jobs.all(),
    clients: await clients.all(),
  }));

  if (!data) {
    return (
      <Page title="Finanse" back="/wiecej">
        <Loading />
      </Page>
    );
  }

  const summary = monthSummary(month, data.payments, data.expenses);
  const jobById = new Map(data.jobs.map((j) => [j.id, j]));
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const monthPayments = data.payments.filter((p) => monthOf(p.date) === month).sort((a, b) => b.date.localeCompare(a.date));
  const monthExpenses = data.expenses.filter((e) => monthOf(e.date) === month).sort((a, b) => b.date.localeCompare(a.date));
  const unpaid = outstandingJobs(data.jobs, data.payments).sort((a, b) => (a.job.completedOn ?? '').localeCompare(b.job.completedOn ?? ''));
  const unpaidTotal = unpaid.reduce((sum, u) => sum + u.balance, 0);

  const exportMonth = () => {
    const rows = [
      ...monthPayments.map((p) => {
        const job = jobById.get(p.jobId);
        return [
          formatDate(p.date),
          'Wpływ',
          PAYMENT_METHODS[p.method],
          [job?.number, job && clientById.get(job.clientId)?.name, p.note].filter(Boolean).join(', '),
          job?.invoiceNo ?? '',
          csvMoney(p.amount),
        ];
      }),
      ...monthExpenses.map((e) => [formatDate(e.date), 'Koszt', e.category, e.description, e.docNo, csvMoney(-e.amount)]),
    ];
    deliverFile(csvBlob(['Data', 'Typ', 'Kategoria / forma', 'Opis', 'Dokument', 'Kwota PLN'], rows), `finanse-${month}.csv`);
  };

  const hasEntries = monthPayments.length + monthExpenses.length > 0;

  return (
    <Page
      title="Finanse"
      back="/wiecej"
      actions={
        <button type="button" className="icon-btn icon-btn-primary" aria-label="Nowy koszt" onClick={() => setEditing('new')}>
          <Icon name="plus" size={24} />
        </button>
      }
    >
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
        <Stat label="Wpływy" value={formatMoney(summary.income)} />
        <Stat label="Koszty" value={formatMoney(summary.costs)} />
        <Stat label="Wynik" value={formatMoney(summary.result)} tone={summary.result < 0 ? 'danger' : 'ok'} />
        <Stat label="Do zapłaty, łącznie" value={formatMoney(unpaidTotal)} tone={unpaidTotal > 0 ? 'warn' : undefined} />
      </div>
      <p className="field-hint">Wpływy liczone są według dat wpłat. To podgląd dla Ciebie, nie księga podatkowa.</p>

      {unpaid.length > 0 && (
        <Group title={`Nieopłacone zlecenia (${unpaid.length})`}>
          {unpaid.map(({ job, balance }) => (
            <Row
              key={job.id}
              to={`/zlecenia/${job.id}`}
              title={clientById.get(job.clientId)?.name ?? job.number}
              sub={`${job.number} · wykonano ${formatDate(job.completedOn)}`}
              trailing={<span className="num text-warn">{formatMoney(balance)}</span>}
            />
          ))}
        </Group>
      )}

      <Group title={`Wpływy (${monthPayments.length})`}>
        {monthPayments.length === 0 && <Empty title="Brak wpłat w tym miesiącu" />}
        {monthPayments.map((p) => {
          const job = jobById.get(p.jobId);
          return (
            <Row
              key={p.id}
              to={job ? `/zlecenia/${job.id}` : undefined}
              title={(job && clientById.get(job.clientId)?.name) ?? 'Wpłata'}
              sub={`${formatDate(p.date)} · ${PAYMENT_METHODS[p.method]}${job ? ` · ${job.number}` : ''}`}
              trailing={<span className="num">{formatMoney(p.amount)}</span>}
            />
          );
        })}
      </Group>

      <Group title={`Koszty (${monthExpenses.length})`}>
        {monthExpenses.length === 0 && <Empty title="Brak kosztów w tym miesiącu" />}
        {monthExpenses.map((e) => (
          <Row
            key={e.id}
            onClick={() => setEditing(e)}
            title={e.category}
            sub={[formatDate(e.date), e.description, e.docNo].filter(Boolean).join(' · ')}
            trailing={<span className="num">{formatMoney(e.amount)}</span>}
          />
        ))}
      </Group>

      <button type="button" className="btn btn-block" disabled={!hasEntries} onClick={exportMonth}>
        <Icon name="file" /> Eksport miesiąca do CSV
      </button>

      <Sheet open={editing !== null} title={editing === 'new' ? 'Nowy koszt' : 'Edycja kosztu'} onClose={() => setEditing(null)}>
        {editing !== null && (
          <ExpenseForm
            key={editing === 'new' ? 'new' : editing.id}
            expense={editing === 'new' ? undefined : editing}
            defaultDate={monthOf(today) === month ? today : `${month}-01`}
            onDone={() => setEditing(null)}
          />
        )}
      </Sheet>
    </Page>
  );
}
