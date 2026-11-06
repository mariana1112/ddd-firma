import { zodResolver } from '@hookform/resolvers/zod';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { batchBalances, stockAlerts, stockOf, usedMaterials } from '../data/calc';
import { addPurchase, deleteMovement, deletePreparation, restoreRecord } from '../data/domain';
import { clients, jobs, preparations, services, sites, stockMovements } from '../data/repo';
import { getCompany } from '../data/settings';
import type { Job, Preparation, PreparationUnit, Service, ServiceCategory, StockMovement } from '../data/types';
import { csvBlob } from '../lib/csv';
import { formatDate, monthOf, todayWarsaw, addMonths, addDays } from '../lib/dates';
import { CATEGORIES, joinAddress, UNITS, VAT_RATES, vatFromInput, vatLabel, vatToInput } from '../lib/labels';
import { formatMoney, formatQty, moneyToInput, parseMoney, parseQty, qtyToInput } from '../lib/money';
import { matchesSearch } from '../lib/validators';
import { usageDocument, type UsageRow } from '../pdf/documents';
import { renderPdf } from '../pdf/render';
import { useFeedback } from '../ui/feedback';
import { dateOrNull, dateText, moneyText, optionalDateText, optionalMoneyText, optionalQtyText, qtyText, required } from '../ui/forms';
import { Icon } from '../ui/icons';
import { AddLink, Badge, Empty, Field, Group, Info, Loading, NotFound, Page, Row, Search, Sheet } from '../ui/kit';

// ---------- Cennik ----------

const serviceSchema = z.object({
  name: required('Podaj nazwę usługi'),
  category: z.enum(['dezynsekcja', 'dezynfekcja', 'deratyzacja', 'inne']),
  unit: required('Podaj jednostkę'),
  price: moneyText,
  vat: z.string(),
});
type ServiceValues = z.infer<typeof serviceSchema>;

function ServiceForm(props: { service?: Service; vatPayer: boolean; defaultVat: number; onDone: () => void }) {
  const { run, toast } = useFeedback();
  const s = props.service;
  const { register, handleSubmit, formState } = useForm<ServiceValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      name: s?.name ?? '',
      category: s?.category ?? 'dezynsekcja',
      unit: s?.unit ?? 'usł.',
      price: s ? moneyToInput(s.priceNet) : '',
      vat: s ? vatToInput(s.vatRate) : props.vatPayer ? String(props.defaultVat) : 'zw',
    },
  });
  const { errors } = formState;

  const onSubmit = (v: ServiceValues) =>
    run(async () => {
      const values = {
        name: v.name.trim(),
        category: v.category as ServiceCategory,
        unit: v.unit.trim(),
        priceNet: parseMoney(v.price)!,
        vatRate: vatFromInput(v.vat),
      };
      if (s) await services.update(s.id, values);
      else await services.create(values);
      props.onDone();
    });

  const remove = () =>
    run(async () => {
      if (!s) return;
      await services.softDelete(s.id);
      props.onDone();
      toast('Usługa jest w koszu', {
        action: { label: 'Cofnij', onClick: () => void run(() => restoreRecord('services', s.id)) },
      });
    });

  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Field label="Nazwa usługi" error={errors.name?.message}>
        <input {...register('name')} autoComplete="off" />
      </Field>
      <Field label="Rodzaj">
        <select {...register('category')}>
          {Object.entries(CATEGORIES).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>
      <div className="form-row">
        <Field label="Jednostka" error={errors.unit?.message} hint="Np. usł., m², szt., godz.">
          <input {...register('unit')} autoComplete="off" />
        </Field>
        {props.vatPayer && (
          <Field label="VAT">
            <select {...register('vat')}>
              {VAT_RATES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
        )}
      </div>
      <Field label={props.vatPayer ? 'Cena netto (zł)' : 'Cena (zł)'} error={errors.price?.message}>
        <input {...register('price')} inputMode="decimal" autoComplete="off" />
      </Field>
      <button type="submit" className="btn btn-primary btn-block">Zapisz usługę</button>
      {s && (
        <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => void remove()}>
          <Icon name="trash" /> Usuń usługę
        </button>
      )}
    </form>
  );
}

export function ServicesPage() {
  const data = useLiveQuery(async () => ({ rows: await services.all(), company: await getCompany() }));
  const [editing, setEditing] = useState<Service | 'new' | null>(null);

  const groups = useMemo(() => {
    const sorted = [...(data?.rows ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    return (Object.keys(CATEGORIES) as ServiceCategory[])
      .map((category) => ({ category, rows: sorted.filter((s) => s.category === category) }))
      .filter((g) => g.rows.length > 0);
  }, [data]);

  return (
    <Page
      title="Cennik usług"
      back="/wiecej"
      actions={
        <button type="button" className="icon-btn icon-btn-primary" aria-label="Nowa usługa" onClick={() => setEditing('new')}>
          <Icon name="plus" size={24} />
        </button>
      }
    >
      {!data ? (
        <Loading />
      ) : data.rows.length === 0 ? (
        <Empty icon="tag" title="Cennik jest pusty">
          <p>Usługi z cennika wstawisz do zlecenia jednym dotknięciem.</p>
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>Dodaj usługę</button>
        </Empty>
      ) : (
        groups.map((g) => (
          <Group key={g.category} title={CATEGORIES[g.category]}>
            {g.rows.map((s) => (
              <Row
                key={s.id}
                onClick={() => setEditing(s)}
                title={s.name}
                sub={`za ${s.unit}${data.company.vatPayer ? `, VAT ${vatLabel(s.vatRate)}` : ''}`}
                trailing={<span className="num">{formatMoney(s.priceNet)}</span>}
              />
            ))}
          </Group>
        ))
      )}
      <Sheet open={editing !== null} title={editing === 'new' ? 'Nowa usługa' : 'Edycja usługi'} onClose={() => setEditing(null)}>
        {editing !== null && data && (
          <ServiceForm
            key={editing === 'new' ? 'new' : editing.id}
            service={editing === 'new' ? undefined : editing}
            vatPayer={data.company.vatPayer}
            defaultVat={data.company.defaultVatRate}
            onDone={() => setEditing(null)}
          />
        )}
      </Sheet>
    </Page>
  );
}

// ---------- Preparaty ----------

const preparationSchema = z.object({
  name: required('Podaj nazwę preparatu'),
  activeSubstance: z.string(),
  permitNo: z.string(),
  unit: z.enum(['l', 'kg', 'szt']),
  minStock: optionalQtyText,
  targetPests: z.string(),
  dosage: z.string(),
  safetyPeriod: z.string(),
});
type PreparationValues = z.infer<typeof preparationSchema>;

function PreparationForm(props: { preparation?: Preparation; onSaved: (p: Preparation) => void }) {
  const { run } = useFeedback();
  const p = props.preparation;
  const { register, handleSubmit, formState } = useForm<PreparationValues>({
    resolver: zodResolver(preparationSchema),
    defaultValues: {
      name: p?.name ?? '',
      activeSubstance: p?.activeSubstance ?? '',
      permitNo: p?.permitNo ?? '',
      unit: p?.unit ?? 'l',
      minStock: p?.minStockMilli ? qtyToInput(p.minStockMilli) : '',
      targetPests: p?.targetPests ?? '',
      dosage: p?.dosage ?? '',
      safetyPeriod: p?.safetyPeriod ?? '',
    },
  });
  const { errors } = formState;

  const onSubmit = ({ minStock, ...rest }: PreparationValues) =>
    run(async () => {
      const values = {
        ...rest,
        name: rest.name.trim(),
        unit: rest.unit as PreparationUnit,
        minStockMilli: minStock.trim() ? parseQty(minStock)! : 0,
      };
      if (p) {
        await preparations.update(p.id, values);
        props.onSaved({ ...p, ...values });
      } else {
        props.onSaved(await preparations.create(values));
      }
    });

  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Field label="Nazwa" error={errors.name?.message}>
        <input {...register('name')} autoComplete="off" />
      </Field>
      <Field label="Substancja czynna">
        <input {...register('activeSubstance')} autoComplete="off" />
      </Field>
      <Field label="Numer pozwolenia">
        <input {...register('permitNo')} autoComplete="off" />
      </Field>
      <div className="form-row">
        <Field label="Jednostka">
          <select {...register('unit')}>
            {Object.entries(UNITS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Minimalny stan" error={errors.minStock?.message}>
          <input {...register('minStock')} inputMode="decimal" autoComplete="off" />
        </Field>
      </div>
      <Field label="Zwalczane szkodniki">
        <input {...register('targetPests')} autoComplete="off" />
      </Field>
      <Field label="Dawkowanie">
        <textarea {...register('dosage')} rows={2} />
      </Field>
      <Field label="Okres karencji / prewencji" hint="Wstawi się do protokołu po wybraniu preparatu.">
        <input {...register('safetyPeriod')} autoComplete="off" />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={formState.isSubmitting}>
        Zapisz preparat
      </button>
    </form>
  );
}

export function PreparationsPage() {
  const data = useLiveQuery(async () => ({
    rows: await preparations.all(),
    movements: await stockMovements.all(),
    jobs: await jobs.all(),
  }));
  const [query, setQuery] = useState('');
  const today = todayWarsaw();

  return (
    <Page title="Preparaty" back="/wiecej" actions={<AddLink to="/preparaty/nowy" label="Nowy preparat" />}>
      {!data ? (
        <Loading />
      ) : data.rows.length === 0 ? (
        <Empty icon="flask" title="Brak preparatów">
          <p>Dodaj preparaty, żeby śledzić stan, partie i terminy ważności.</p>
          <Link className="btn btn-primary" to="/preparaty/nowy">Dodaj preparat</Link>
        </Empty>
      ) : (
        <>
          <Search value={query} onChange={setQuery} placeholder="Szukaj: nazwa, substancja, pozwolenie" />
          <Group>
            {data.rows
              .filter((p) => matchesSearch(query, p.name, p.activeSubstance, p.permitNo, p.targetPests))
              .sort((a, b) => a.name.localeCompare(b.name, 'pl'))
              .map((p) => {
                const alerts = stockAlerts([p], data.movements, data.jobs, today);
                const worst = alerts.find((a) => a.kind !== 'termin') ?? alerts[0];
                return (
                  <Row
                    key={p.id}
                    to={`/preparaty/${p.id}`}
                    title={p.name}
                    sub={<span className="num">{formatQty(stockOf(p.id, data.movements, data.jobs))} {UNITS[p.unit]}</span>}
                    meta={p.activeSubstance}
                    trailing={worst && <Badge tone={worst.kind === 'termin' ? 'warn' : 'danger'}>{worst.message}</Badge>}
                  />
                );
              })}
          </Group>
        </>
      )}
      <div className="btn-stack">
        <Link className="btn" to="/ewidencja"><Icon name="book" /> Ewidencja zużycia</Link>
      </div>
    </Page>
  );
}

export function PreparationNewPage() {
  const navigate = useNavigate();
  const { toast } = useFeedback();
  return (
    <Page title="Nowy preparat" back="/preparaty">
      <PreparationForm
        onSaved={(p) => {
          toast('Zapisano preparat');
          navigate(`/preparaty/${p.id}`, { replace: true });
        }}
      />
    </Page>
  );
}

export function PreparationEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const preparation = useLiveQuery(() => preparations.get(id).then((p) => (p && !p.deletedAt ? p : null)), [id]);
  if (preparation === undefined) return <Loading />;
  if (preparation === null) return <NotFound back="/preparaty" />;
  return (
    <Page title="Edycja preparatu" back={`/preparaty/${id}`}>
      <PreparationForm
        key={preparation.id}
        preparation={preparation}
        onSaved={() => {
          toast('Zapisano zmiany');
          navigate(`/preparaty/${id}`, { replace: true });
        }}
      />
    </Page>
  );
}

const purchaseSchema = z.object({
  date: dateText,
  qty: qtyText,
  batchNo: z.string(),
  expiryDate: optionalDateText,
  cost: optionalMoneyText,
  supplier: z.string(),
  note: z.string(),
});
type PurchaseValues = z.infer<typeof purchaseSchema>;

function PurchaseForm({ preparation, onDone }: { preparation: Preparation; onDone: () => void }) {
  const { run, toast } = useFeedback();
  const { register, handleSubmit, formState } = useForm<PurchaseValues>({
    resolver: zodResolver(purchaseSchema),
    defaultValues: { date: todayWarsaw(), qty: '', batchNo: '', expiryDate: '', cost: '', supplier: '', note: '' },
  });
  const { errors } = formState;
  const onSubmit = (v: PurchaseValues) =>
    run(async () => {
      await addPurchase({
        preparationId: preparation.id,
        preparationName: preparation.name,
        date: v.date,
        qtyMilli: parseQty(v.qty)!,
        batchNo: v.batchNo.trim(),
        expiryDate: dateOrNull(v.expiryDate),
        cost: v.cost.trim() ? parseMoney(v.cost)! : 0,
        supplier: v.supplier.trim(),
        note: v.note.trim(),
      });
      toast('Zapisano zakup');
      onDone();
    });
  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="form-row">
        <Field label={`Ilość (${UNITS[preparation.unit]})`} error={errors.qty?.message}>
          <input {...register('qty')} inputMode="decimal" autoComplete="off" />
        </Field>
        <Field label="Data zakupu" error={errors.date?.message}>
          <input type="date" {...register('date')} />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Numer partii">
          <input {...register('batchNo')} autoComplete="off" />
        </Field>
        <Field label="Ważny do" error={errors.expiryDate?.message}>
          <input type="date" {...register('expiryDate')} />
        </Field>
      </div>
      <Field label="Koszt zakupu (zł)" error={errors.cost?.message} hint="Podana kwota trafi też do kosztów firmy.">
        <input {...register('cost')} inputMode="decimal" autoComplete="off" />
      </Field>
      <Field label="Dostawca">
        <input {...register('supplier')} autoComplete="off" />
      </Field>
      <button type="submit" className="btn btn-primary btn-block">Zapisz zakup</button>
    </form>
  );
}

const correctionSchema = z.object({
  direction: z.enum(['-1', '1']),
  qty: qtyText,
  batchNo: z.string(),
  date: dateText,
  note: required('Podaj powód korekty'),
});
type CorrectionValues = z.infer<typeof correctionSchema>;

function CorrectionForm({ preparation, onDone }: { preparation: Preparation; onDone: () => void }) {
  const { run, toast } = useFeedback();
  const { register, handleSubmit, formState } = useForm<CorrectionValues>({
    resolver: zodResolver(correctionSchema),
    defaultValues: { direction: '-1', qty: '', batchNo: '', date: todayWarsaw(), note: '' },
  });
  const { errors } = formState;
  const onSubmit = (v: CorrectionValues) =>
    run(async () => {
      await stockMovements.create({
        preparationId: preparation.id,
        type: 'korekta',
        date: v.date,
        qtyMilli: Number(v.direction) * parseQty(v.qty)!,
        batchNo: v.batchNo.trim(),
        expiryDate: null,
        cost: 0,
        supplier: '',
        note: v.note.trim(),
        expenseId: null,
      });
      toast('Zapisano korektę');
      onDone();
    });
  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="form-row">
        <Field label="Rodzaj">
          <select {...register('direction')}>
            <option value="-1">Zmniejsz stan</option>
            <option value="1">Zwiększ stan</option>
          </select>
        </Field>
        <Field label={`Ilość (${UNITS[preparation.unit]})`} error={errors.qty?.message}>
          <input {...register('qty')} inputMode="decimal" autoComplete="off" />
        </Field>
      </div>
      <div className="form-row">
        <Field label="Partia">
          <input {...register('batchNo')} autoComplete="off" />
        </Field>
        <Field label="Data" error={errors.date?.message}>
          <input type="date" {...register('date')} />
        </Field>
      </div>
      <Field label="Powód" error={errors.note?.message} hint="Np. inwentaryzacja, utylizacja, rozlanie.">
        <input {...register('note')} autoComplete="off" />
      </Field>
      <button type="submit" className="btn btn-primary btn-block">Zapisz korektę</button>
    </form>
  );
}

export function PreparationDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { confirm, run, toast } = useFeedback();
  const [sheet, setSheet] = useState<'purchase' | 'correction' | null>(null);
  const today = todayWarsaw();

  const data = useLiveQuery(async () => {
    const preparation = await preparations.get(id);
    if (!preparation || preparation.deletedAt) return null;
    return {
      preparation,
      movements: await stockMovements.where('preparationId', id),
      jobs: await jobs.all(),
    };
  }, [id]);

  if (data === undefined) return <Loading />;
  if (data === null) return <NotFound back="/preparaty" />;

  const { preparation, movements, jobs: jobRows } = data;
  const unit = UNITS[preparation.unit];
  const stock = stockOf(id, movements, jobRows);
  const batches = batchBalances(id, movements, jobRows).filter((b) => b.qtyMilli !== 0);
  const used = usedMaterials(jobRows, id);

  type HistoryEntry =
    | { kind: 'movement'; date: string; movement: StockMovement }
    | { kind: 'use'; date: string; job: Job; qtyMilli: number; batchNo: string };

  const history: HistoryEntry[] = [
    ...movements.map((movement): HistoryEntry => ({ kind: 'movement', date: movement.date, movement })),
    ...used.map(({ job, material }): HistoryEntry => ({
      kind: 'use',
      date: job.completedOn ?? job.start?.slice(0, 10) ?? '',
      job,
      qtyMilli: material.qtyMilli,
      batchNo: material.batchNo,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const removeMovement = (m: StockMovement) =>
    run(async () => {
      await deleteMovement(m.id);
      toast(m.expenseId ? 'Usunięto zakup i powiązany koszt' : 'Usunięto wpis', {
        action: { label: 'Cofnij', onClick: () => void run(() => restoreRecord('stockMovements', m.id)) },
      });
    });

  const remove = async () => {
    const ok = await confirm({
      title: 'Usunąć preparat?',
      message: `${preparation.name} trafi do kosza razem z historią zakupów i powiązanymi kosztami.`,
      confirmLabel: 'Usuń',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await deletePreparation(id);
      navigate('/preparaty', { replace: true });
      toast('Preparat jest w koszu', {
        action: { label: 'Cofnij', onClick: () => void run(() => restoreRecord('preparations', id)) },
      });
    });
  };

  return (
    <Page
      title={preparation.name}
      back="/preparaty"
      actions={
        <Link className="icon-btn" to={`/preparaty/${id}/edycja`} aria-label="Edytuj preparat">
          <Icon name="edit" />
        </Link>
      }
    >
      <div className="job-hero">
        <span className="hero-label">Stan magazynowy</span>
        <h2 className={`num${stock < 0 || stock < preparation.minStockMilli ? ' text-danger' : ''}`}>{formatQty(stock)} {unit}</h2>
        {preparation.minStockMilli > 0 && <p>Minimum: {formatQty(preparation.minStockMilli)} {unit}</p>}
      </div>

      <div className="quick-actions">
        <button type="button" className="btn btn-primary" onClick={() => setSheet('purchase')}>
          <Icon name="plus" /> Zakup
        </button>
        <button type="button" className="btn" onClick={() => setSheet('correction')}>Korekta</button>
      </div>

      <Group title="Dane preparatu">
        {preparation.activeSubstance && <Info label="Substancja">{preparation.activeSubstance}</Info>}
        {preparation.permitNo && <Info label="Pozwolenie">{preparation.permitNo}</Info>}
        {preparation.targetPests && <Info label="Szkodniki">{preparation.targetPests}</Info>}
        {preparation.dosage && <Info label="Dawkowanie">{preparation.dosage}</Info>}
        {preparation.safetyPeriod && <Info label="Karencja">{preparation.safetyPeriod}</Info>}
        {!preparation.activeSubstance && !preparation.permitNo && <Info label="Dane">Uzupełnij numer pozwolenia i substancję.</Info>}
      </Group>

      <Group title="Partie na stanie">
        {batches.length === 0 && <Empty title="Brak partii. Dodaj zakup." />}
        {batches.map((b) => (
          <Row
            key={b.batchNo}
            title={b.batchNo || 'Bez numeru partii'}
            sub={b.expiryDate ? `Ważna do ${formatDate(b.expiryDate)}` : 'Bez terminu'}
            trailing={
              <span className="row-end">
                <span className="num">{formatQty(b.qtyMilli)} {unit}</span>
                {b.expiryDate && b.qtyMilli > 0 && b.expiryDate < today && <Badge tone="danger">Po terminie</Badge>}
                {b.expiryDate && b.qtyMilli > 0 && b.expiryDate >= today && b.expiryDate <= addDays(today, 60) && <Badge tone="warn">Kończy się</Badge>}
              </span>
            }
          />
        ))}
      </Group>

      <Group title="Historia">
        {history.length === 0 && <Empty title="Brak wpisów" />}
        {history.map((h) =>
          h.kind === 'use' ? (
            <Row
              key={`use-${h.job.id}-${h.batchNo}-${h.qtyMilli}`}
              to={`/zlecenia/${h.job.id}`}
              title={`Zużycie: ${h.job.number}`}
              sub={`${formatDate(h.date)}${h.batchNo ? ` · partia ${h.batchNo}` : ''}`}
              trailing={<span className="num">−{formatQty(h.qtyMilli)} {unit}</span>}
            />
          ) : (
            <div className="row" key={h.movement.id}>
              <span className="row-main">
                <span className="row-title">{h.movement.type === 'zakup' ? 'Zakup' : 'Korekta'}</span>
                <span className="row-sub">
                  {[
                    formatDate(h.date),
                    h.movement.batchNo && `partia ${h.movement.batchNo}`,
                    h.movement.cost > 0 && formatMoney(h.movement.cost),
                    h.movement.note,
                  ].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="num">{h.movement.qtyMilli > 0 ? '+' : '−'}{formatQty(Math.abs(h.movement.qtyMilli))} {unit}</span>
              <button type="button" className="icon-btn" aria-label="Usuń wpis" onClick={() => void removeMovement(h.movement)}>
                <Icon name="trash" size={18} />
              </button>
            </div>
          ),
        )}
      </Group>

      <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => void remove()}>
        <Icon name="trash" /> Usuń preparat
      </button>

      <Sheet open={sheet === 'purchase'} title="Zakup preparatu" onClose={() => setSheet(null)}>
        <PurchaseForm preparation={preparation} onDone={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === 'correction'} title="Korekta stanu" onClose={() => setSheet(null)}>
        <CorrectionForm preparation={preparation} onDone={() => setSheet(null)} />
      </Sheet>
    </Page>
  );
}

// ---------- Ewidencja zużycia ----------

export function UsagePage() {
  const { deliverFile, run, toast } = useFeedback();
  const navigate = useNavigate();
  const today = todayWarsaw();
  const [from, setFrom] = useState(`${monthOf(today)}-01`);
  const [to, setTo] = useState(addDays(addMonths(`${monthOf(today)}-01`, 1), -1));
  const [busy, setBusy] = useState(false);

  const data = useLiveQuery(async () => ({
    jobs: await jobs.all(),
    clients: await clients.all(),
    sites: await sites.all(),
    company: await getCompany(),
  }));

  const rows = useMemo<UsageRow[]>(() => {
    if (!data) return [];
    const clientById = new Map(data.clients.map((c) => [c.id, c]));
    const siteById = new Map(data.sites.map((s) => [s.id, s]));
    return usedMaterials(data.jobs)
      .map(({ job, material }) => {
        const client = clientById.get(job.clientId);
        const site = job.siteId ? siteById.get(job.siteId) : undefined;
        return {
          date: job.completedOn ?? job.start?.slice(0, 10) ?? '',
          jobNumber: job.number,
          client: client?.name ?? '',
          place: site
            ? joinAddress(site.street, site.postalCode, site.city) || site.name
            : client
              ? joinAddress(client.street, client.postalCode, client.city)
              : '',
          preparation: material.name,
          permitNo: material.permitNo,
          batchNo: material.batchNo,
          qty: `${formatQty(material.qtyMilli)} ${material.unit}`,
        };
      })
      .filter((r) => r.date >= from && r.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data, from, to]);

  const period = `${from}_${to}`;

  const exportCsv = () => {
    deliverFile(
      csvBlob(
        ['Data', 'Zlecenie', 'Klient', 'Miejsce', 'Preparat', 'Nr pozwolenia', 'Partia', 'Ilość'],
        rows.map((r) => [formatDate(r.date), r.jobNumber, r.client, r.place, r.preparation, r.permitNo, r.batchNo, r.qty]),
      ),
      `ewidencja-zuzycia-${period}.csv`,
    );
  };

  const exportPdf = async () => {
    if (!data) return;
    if (!data.company.name) {
      toast('Najpierw uzupełnij dane firmy. Trafią na dokument.', {
        tone: 'error',
        action: { label: 'Ustawienia', onClick: () => navigate('/ustawienia') },
      });
      return;
    }
    setBusy(true);
    await run(async () => {
      deliverFile(await renderPdf(usageDocument(rows, from, to, data.company)), `ewidencja-zuzycia-${period}.pdf`);
    });
    setBusy(false);
  };

  return (
    <Page title="Ewidencja zużycia" back="/preparaty">
      <div className="form-row">
        <Field label="Od"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Do"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="quick-actions">
        <button type="button" className="btn" disabled={busy || rows.length === 0} onClick={() => void exportPdf()}>
          <Icon name="file" /> {busy ? 'Tworzę PDF…' : 'PDF'}
        </button>
        <button type="button" className="btn" disabled={rows.length === 0} onClick={exportCsv}>
          <Icon name="file" /> CSV
        </button>
      </div>
      <Group title={`Wpisy (${rows.length})`}>
        {rows.length === 0 && <Empty title="Brak zużycia w tym okresie" />}
        {rows.map((r, i) => (
          <Row
            key={`${r.jobNumber}-${r.preparation}-${i}`}
            title={r.preparation}
            sub={`${formatDate(r.date)} · ${r.jobNumber} · ${r.client}`}
            meta={[r.permitNo && `Pozwolenie ${r.permitNo}`, r.batchNo && `Partia ${r.batchNo}`].filter(Boolean).join(' · ')}
            trailing={<span className="num">{r.qty}</span>}
          />
        ))}
      </Group>
    </Page>
  );
}
