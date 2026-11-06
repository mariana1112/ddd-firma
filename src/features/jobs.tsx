import { zodResolver } from '@hookform/resolvers/zod';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm, type UseFormSetValue } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { batchBalances, jobBalance, jobTotals, outstandingJobs, paidForJob } from '../data/calc';
import { createJob, deleteJob, DomainError, planFollowUp, restoreRecord, stationReviewRows, updateJob } from '../data/domain';
import { attachments, clients, jobs, newId, payments, preparations, services, sites, stockMovements } from '../data/repo';
import { getCompany } from '../data/settings';
import type {
  Attachment,
  Client,
  Job,
  JobLine,
  JobMaterial,
  JobStationCheck,
  JobStatus,
  Payment,
  PaymentMethod,
  ServiceCategory,
  Site,
  StationState,
} from '../data/types';
import { addMonths, formatDate, formatTerm, todayWarsaw } from '../lib/dates';
import { blobToDataUrl, resizePhoto } from '../lib/images';
import {
  CATEGORIES,
  joinAddress,
  METHODS,
  PAYMENT_METHODS,
  PESTS,
  STATION_STATE_TONES,
  STATION_STATES,
  STATUS_TONES,
  STATUSES,
  UNITS,
  VAT_RATES,
  vatFromInput,
  vatLabel,
  vatToInput,
} from '../lib/labels';
import { formatMoney, formatQty, lineNet, moneyToInput, parseMoney, parseQty, qtyToInput } from '../lib/money';
import { matchesSearch } from '../lib/validators';
import { offerDocument, protocolDocument, type JobDocumentData } from '../pdf/documents';
import { pdfFileName, renderPdf } from '../pdf/render';
import { useFeedback } from '../ui/feedback';
import { dateOrNull, dateText, moneyText, optionalDateText, positiveMoneyText, qtyText, required } from '../ui/forms';
import { Icon } from '../ui/icons';
import { AddLink, Badge, Chips, Empty, Field, Group, Info, Loading, NotFound, Page, Row, Search, Sheet } from '../ui/kit';
import { ClientForm, SiteForm } from './clients';
import { JobRow } from './job-row';
import { SignaturePad } from './signature-pad';

// ---------- Lista ----------

type JobFilter = 'aktywne' | 'wykonane' | 'nieoplacone' | 'wszystkie';

export function JobsPage() {
  const data = useLiveQuery(async () => ({
    jobs: await jobs.all(),
    clients: await clients.all(),
    sites: await sites.all(),
    payments: await payments.all(),
  }));
  const [filter, setFilter] = useState<JobFilter>('aktywne');
  const [query, setQuery] = useState('');

  const view = useMemo(() => {
    if (!data) return null;
    const clientById = new Map(data.clients.map((c) => [c.id, c]));
    const siteById = new Map(data.sites.map((s) => [s.id, s]));
    const unpaid = new Set(outstandingJobs(data.jobs, data.payments).map((u) => u.job.id));
    const isActive = (j: Job) => j.status === 'wycena' || j.status === 'zaplanowane';
    const tests: Record<JobFilter, (j: Job) => boolean> = {
      aktywne: isActive,
      wykonane: (j) => j.status === 'wykonane',
      nieoplacone: (j) => unpaid.has(j.id),
      wszystkie: () => true,
    };
    const rows = data.jobs
      .filter(tests[filter])
      .filter((j) => {
        const client = clientById.get(j.clientId);
        const site = j.siteId ? siteById.get(j.siteId) : undefined;
        return matchesSearch(query, j.number, j.title, j.pest, client?.name, client?.phone, client?.city, site?.name, site?.street, site?.city);
      })
      .sort((a, b) => {
        const [x, y] = [a.start ?? '9999', b.start ?? '9999'];
        return filter === 'aktywne' ? x.localeCompare(y) : y.localeCompare(x);
      });
    return {
      rows,
      clientById,
      siteById,
      counts: { aktywne: data.jobs.filter(isActive).length, nieoplacone: unpaid.size },
    };
  }, [data, filter, query]);

  return (
    <Page title="Zlecenia" actions={<AddLink to="/zlecenia/nowe" label="Nowe zlecenie" />}>
      {!data || !view ? (
        <Loading />
      ) : data.jobs.length === 0 ? (
        <Empty icon="clipboard" title="Nie masz jeszcze zleceń">
          <Link className="btn btn-primary" to="/zlecenia/nowe">Dodaj zlecenie</Link>
        </Empty>
      ) : (
        <>
          <Search value={query} onChange={setQuery} placeholder="Szukaj: klient, numer, adres" />
          <Chips
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'aktywne', label: 'Do zrobienia', count: view.counts.aktywne },
              { value: 'nieoplacone', label: 'Nieopłacone', count: view.counts.nieoplacone },
              { value: 'wykonane', label: 'Wykonane' },
              { value: 'wszystkie', label: 'Wszystkie' },
            ]}
          />
          <Group>
            {view.rows.length === 0 && <Empty title="Brak zleceń w tym widoku" />}
            {view.rows.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                client={view.clientById.get(job.clientId)}
                site={job.siteId ? view.siteById.get(job.siteId) : undefined}
              />
            ))}
          </Group>
        </>
      )}
    </Page>
  );
}

// ---------- Formularz zlecenia ----------

const lineSchema = z.object({
  id: z.string(),
  name: required('Podaj nazwę pozycji'),
  unit: z.string(),
  qty: qtyText,
  price: moneyText,
  vat: z.string(),
});

const jobSchema = z
  .object({
    clientId: required('Wybierz klienta'),
    siteId: z.string(),
    status: z.enum(['wycena', 'zaplanowane', 'wykonane', 'anulowane']),
    date: optionalDateText,
    time: z.string(),
    durationMin: z.string().refine((v) => Number(v) > 0, 'Podaj czas'),
    category: z.enum(['dezynsekcja', 'dezynfekcja', 'deratyzacja', 'inne']),
    title: z.string(),
    pest: z.string(),
    method: z.string(),
    scope: z.string(),
    notes: z.string(),
    lines: z.array(lineSchema),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'zaplanowane' && !v.date) {
      ctx.addIssue({ code: 'custom', path: ['date'], message: 'Zaplanowane zlecenie musi mieć datę' });
    }
    if (v.date && !/^\d{2}:\d{2}$/.test(v.time)) {
      ctx.addIssue({ code: 'custom', path: ['time'], message: 'Podaj godzinę' });
    }
  });
type JobValues = z.infer<typeof jobSchema>;

const DURATIONS = [30, 60, 90, 120, 180, 240, 480];

function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const hours = Math.floor(min / 60);
  return min % 60 ? `${hours} h ${min % 60} min` : `${hours} h`;
}

function lineToValues(line: JobLine) {
  return {
    id: line.id,
    name: line.name,
    unit: line.unit,
    qty: qtyToInput(line.qtyMilli),
    price: moneyToInput(line.unitPriceNet),
    vat: vatToInput(line.vatRate),
  };
}

function JobForm(props: { job?: Job; onSaved: (job: Job) => void }) {
  const { job } = props;
  const [params] = useSearchParams();
  const { confirm, run } = useFeedback();
  const lookups = useLiveQuery(async () => ({
    clients: (await clients.all()).sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    sites: await sites.all(),
    services: (await services.all()).sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    company: await getCompany(),
  }));
  const [sheet, setSheet] = useState<'client' | 'site' | null>(null);

  const initialClient = job?.clientId ?? params.get('klient') ?? '';
  const initialDate = job?.start?.slice(0, 10) ?? params.get('data') ?? '';

  const { register, handleSubmit, watch, setValue, control, formState } = useForm<JobValues>({
    resolver: zodResolver(jobSchema),
    defaultValues: {
      clientId: initialClient,
      siteId: job?.siteId ?? '',
      status: job?.status ?? 'zaplanowane',
      date: initialDate,
      time: job?.start?.slice(11, 16) ?? params.get('czas') ?? '09:00',
      durationMin: String(job?.durationMin ?? 60),
      category: job?.category ?? 'dezynsekcja',
      title: job?.title ?? '',
      pest: job?.pest ?? '',
      method: job?.method ?? '',
      scope: job?.scope ?? '',
      notes: job?.notes ?? '',
      lines: job?.lines.map(lineToValues) ?? [],
    },
  });
  const { errors } = formState;
  const { fields, append, remove } = useFieldArray({ control, name: 'lines', keyName: 'key' });

  const clientId = watch('clientId');
  const siteId = watch('siteId');
  const status = watch('status');
  const lineValues = watch('lines');
  const durationMin = watch('durationMin');

  const company = lookups?.company;
  const clientSites = useMemo(() => (lookups?.sites ?? []).filter((s) => s.clientId === clientId), [lookups, clientId]);
  const liveTotals = jobTotals(
    lineValues.map((l) => ({
      id: l.id,
      name: l.name,
      unit: l.unit,
      qtyMilli: parseQty(l.qty) ?? 0,
      unitPriceNet: parseMoney(l.price) ?? 0,
      vatRate: vatFromInput(l.vat),
    })),
  );

  const selectClient = (id: string) => {
    setValue('clientId', id, { shouldValidate: true });
    const own = (lookups?.sites ?? []).filter((s) => s.clientId === id);
    setValue('siteId', own.length === 1 ? own[0].id : '');
  };

  const newLineVat = () => (company?.vatPayer === false ? 'zw' : String(company?.defaultVatRate ?? 23));

  const addFromCatalog = (serviceId: string) => {
    const service = lookups?.services.find((s) => s.id === serviceId);
    if (!service) return;
    append({
      id: newId(),
      name: service.name,
      unit: service.unit,
      qty: '1',
      price: moneyToInput(service.priceNet),
      vat: company?.vatPayer === false ? 'zw' : vatToInput(service.vatRate),
    });
    setValue('category', service.category);
    if (!watch('title')) setValue('title', service.name);
  };

  const onSubmit = (v: JobValues) =>
    run(async () => {
      const lines: JobLine[] = v.lines.map((l) => ({
        id: l.id,
        name: l.name.trim(),
        unit: l.unit.trim(),
        qtyMilli: parseQty(l.qty)!,
        unitPriceNet: parseMoney(l.price)!,
        vatRate: vatFromInput(l.vat),
      }));
      const values = {
        clientId: v.clientId,
        siteId: v.siteId || null,
        status: v.status as JobStatus,
        start: v.date ? `${v.date}T${v.time}` : null,
        durationMin: Number(v.durationMin),
        category: v.category as ServiceCategory,
        title: v.title.trim() || CATEGORIES[v.category as ServiceCategory],
        pest: v.pest.trim(),
        method: v.method.trim(),
        scope: v.scope.trim(),
        notes: v.notes.trim(),
        lines,
      };
      if (job) {
        if (values.siteId !== job.siteId && job.stationChecks.length > 0) {
          const ok = await confirm({
            title: 'Zmienić obiekt zlecenia?',
            message: `Przegląd stacji (wpisy: ${job.stationChecks.length}) dotyczy poprzedniego obiektu i zostanie usunięty ze zlecenia.`,
            confirmLabel: 'Zmień obiekt',
            danger: true,
          });
          if (!ok) return;
        }
        await updateJob(job.id, values);
        props.onSaved({ ...job, ...values });
      } else {
        props.onSaved(await createJob(values));
      }
    });

  if (!lookups) return <Loading />;

  const durationOptions = DURATIONS.includes(Number(durationMin)) ? DURATIONS : [...DURATIONS, Number(durationMin)].sort((a, b) => a - b);
  const vatPayer = company?.vatPayer !== false;

  return (
    <>
      <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset>
          <legend>Klient i miejsce</legend>
          <Field label="Klient" error={errors.clientId?.message}>
            <select value={clientId} onChange={(e) => selectClient(e.target.value)}>
              <option value="">Wybierz klienta</option>
              {lookups.clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <button type="button" className="link" onClick={() => setSheet('client')}>+ Nowy klient</button>
          {clientId && (
            <>
              <Field label="Obiekt" hint={clientSites.length === 0 ? 'Bez obiektu zlecenie użyje adresu klienta.' : undefined}>
                <select value={siteId} onChange={(e) => setValue('siteId', e.target.value)}>
                  <option value="">Adres klienta</option>
                  {clientSites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </Field>
              <button type="button" className="link" onClick={() => setSheet('site')}>+ Nowy obiekt</button>
            </>
          )}
        </fieldset>

        <fieldset>
          <legend>Termin</legend>
          {status !== 'wykonane' && status !== 'anulowane' && (
            <Field label="Etap">
              <select {...register('status')}>
                <option value="zaplanowane">Zaplanowane</option>
                <option value="wycena">Wycena, jeszcze bez zgody klienta</option>
              </select>
            </Field>
          )}
          <div className="form-row">
            <Field label="Data" error={errors.date?.message}>
              <input type="date" {...register('date')} />
            </Field>
            <Field label="Godzina" error={errors.time?.message}>
              <input type="time" step={300} {...register('time')} />
            </Field>
          </div>
          <Field label="Przewidywany czas" error={errors.durationMin?.message}>
            <select {...register('durationMin')}>
              {durationOptions.map((m) => (
                <option key={m} value={m}>{formatDuration(m)}</option>
              ))}
            </select>
          </Field>
        </fieldset>

        <fieldset>
          <legend>Usługa</legend>
          <Field label="Rodzaj">
            <select {...register('category')}>
              {Object.entries(CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Krótki opis" hint="Np. Karaluchy w kuchni. Puste pole przyjmie nazwę rodzaju.">
            <input {...register('title')} autoComplete="off" />
          </Field>
          <div className="form-row">
            <Field label="Szkodnik">
              <input {...register('pest')} list="pests" autoComplete="off" />
              <datalist id="pests">{PESTS.map((p) => <option key={p} value={p} />)}</datalist>
            </Field>
            <Field label="Metoda">
              <input {...register('method')} list="methods" autoComplete="off" />
              <datalist id="methods">{METHODS.map((m) => <option key={m} value={m} />)}</datalist>
            </Field>
          </div>
          <Field label="Zakres / powierzchnia">
            <input {...register('scope')} autoComplete="off" />
          </Field>
          <Field label="Uwagi">
            <textarea {...register('notes')} rows={2} />
          </Field>
        </fieldset>

        <fieldset>
          <legend>Wycena</legend>
          {fields.map((field, index) => {
            const lineErrors = errors.lines?.[index];
            return (
              <div className="line-card" key={field.key}>
                <Field label="Pozycja" error={lineErrors?.name?.message}>
                  <input {...register(`lines.${index}.name`)} autoComplete="off" />
                </Field>
                <div className="form-row form-row-3">
                  <Field label="Ilość" error={lineErrors?.qty?.message}>
                    <input {...register(`lines.${index}.qty`)} inputMode="decimal" autoComplete="off" />
                  </Field>
                  <Field label="Jedn.">
                    <input {...register(`lines.${index}.unit`)} autoComplete="off" />
                  </Field>
                  {vatPayer && (
                    <Field label="VAT">
                      <select {...register(`lines.${index}.vat`)}>
                        {VAT_RATES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </Field>
                  )}
                </div>
                <Field label={vatPayer ? 'Cena netto (zł)' : 'Cena (zł)'} error={lineErrors?.price?.message}>
                  <input {...register(`lines.${index}.price`)} inputMode="decimal" autoComplete="off" />
                </Field>
                <button type="button" className="link link-danger" onClick={() => remove(index)}>Usuń pozycję</button>
              </div>
            );
          })}
          {lookups.services.length > 0 && (
            <Field label="Dodaj z cennika">
              <select
                value=""
                onChange={(e) => addFromCatalog(e.target.value)}
              >
                <option value="">Wybierz usługę</option>
                {lookups.services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}, {formatMoney(s.priceNet)}</option>
                ))}
              </select>
            </Field>
          )}
          <button
            type="button"
            className="btn btn-block"
            onClick={() => append({ id: newId(), name: '', unit: 'usł.', qty: '1', price: '', vat: newLineVat() })}
          >
            <Icon name="plus" /> Dodaj pozycję
          </button>
          {fields.length > 0 && (
            <div className="total-line">
              <span>{vatPayer ? 'Razem brutto' : 'Razem'}</span>
              <strong className="num">{formatMoney(liveTotals.gross)}</strong>
            </div>
          )}
        </fieldset>

        <button type="submit" className="btn btn-primary btn-block" disabled={formState.isSubmitting}>
          Zapisz zlecenie
        </button>
      </form>

      <Sheet open={sheet === 'client'} title="Nowy klient" onClose={() => setSheet(null)}>
        <ClientForm
          compact
          onSaved={(c) => {
            setSheet(null);
            setValue('clientId', c.id, { shouldValidate: true });
            setValue('siteId', '');
          }}
        />
      </Sheet>
      <Sheet open={sheet === 'site'} title="Nowy obiekt" onClose={() => setSheet(null)}>
        <SiteForm
          clientId={clientId}
          onSaved={(s) => {
            setSheet(null);
            setValue('siteId', s.id);
          }}
        />
      </Sheet>
    </>
  );
}

export function JobNewPage() {
  const navigate = useNavigate();
  const { toast } = useFeedback();
  return (
    <Page title="Nowe zlecenie" back="/zlecenia">
      <JobForm
        onSaved={(job) => {
          toast(`Zapisano zlecenie ${job.number}`);
          navigate(`/zlecenia/${job.id}`, { replace: true });
        }}
      />
    </Page>
  );
}

export function JobEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const job = useLiveQuery(() => jobs.get(id).then((j) => (j && !j.deletedAt ? j : null)), [id]);
  if (job === undefined) return <Loading />;
  if (job === null) return <NotFound back="/zlecenia" />;
  return (
    <Page title="Edycja zlecenia" back={`/zlecenia/${id}`}>
      <JobForm
        key={job.id}
        job={job}
        onSaved={() => {
          toast('Zapisano zmiany');
          navigate(`/zlecenia/${id}`, { replace: true });
        }}
      />
    </Page>
  );
}

// ---------- Szczegóły ----------

function usePhotoUrl(blob: Blob) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}

function PhotoThumb({ photo, onOpen }: { photo: Attachment; onOpen: () => void }) {
  const url = usePhotoUrl(photo.blob);
  return (
    <button type="button" className="photo" onClick={onOpen} aria-label={`Zdjęcie ${photo.name}`}>
      {url && <img src={url} alt="" />}
    </button>
  );
}

function PhotoView({ photo, onDelete }: { photo: Attachment; onDelete: () => void }) {
  const url = usePhotoUrl(photo.blob);
  return (
    <>
      {url && <img className="photo-large" src={url} alt={photo.name} />}
      <button type="button" className="btn btn-danger-quiet btn-block" onClick={onDelete}>
        <Icon name="trash" /> Usuń zdjęcie
      </button>
    </>
  );
}

const paymentSchema = z.object({
  date: dateText,
  amount: positiveMoneyText,
  method: z.enum(['gotowka', 'przelew', 'karta', 'blik']),
  note: z.string(),
});
type PaymentValues = z.infer<typeof paymentSchema>;

function PaymentForm(props: { jobId: string; suggested: number; onSaved: () => void }) {
  const { run, toast } = useFeedback();
  const { register, handleSubmit, formState } = useForm<PaymentValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      date: todayWarsaw(),
      amount: props.suggested > 0 ? moneyToInput(props.suggested) : '',
      method: 'gotowka',
      note: '',
    },
  });
  const { errors } = formState;
  const onSubmit = (v: PaymentValues) =>
    run(async () => {
      await payments.create({
        jobId: props.jobId,
        date: v.date,
        amount: parseMoney(v.amount)!,
        method: v.method as PaymentMethod,
        note: v.note.trim(),
      });
      toast('Zapisano wpłatę');
      props.onSaved();
    });
  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <Field label="Kwota (zł)" error={errors.amount?.message}>
        <input {...register('amount')} inputMode="decimal" autoComplete="off" />
      </Field>
      <div className="form-row">
        <Field label="Data" error={errors.date?.message}>
          <input type="date" {...register('date')} />
        </Field>
        <Field label="Forma">
          <select {...register('method')}>
            {Object.entries(PAYMENT_METHODS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Uwagi">
        <input {...register('note')} autoComplete="off" />
      </Field>
      <button type="submit" className="btn btn-primary btn-block">Zapisz wpłatę</button>
    </form>
  );
}

function FollowUpForm(props: { job: Job; onSaved: (job: Job) => void }) {
  const { run } = useFeedback();
  const today = todayWarsaw();
  const [date, setDate] = useState(props.job.followUpDate && props.job.followUpDate > today ? props.job.followUpDate : today);
  const [time, setTime] = useState(props.job.start?.slice(11, 16) ?? '09:00');
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => props.onSaved(await planFollowUp(props.job.id, `${date}T${time}`)));
      }}
    >
      <p className="sheet-text">Nowe zlecenie przejmie klienta, obiekt, zakres i ceny z tego zlecenia.</p>
      <div className="form-row">
        <Field label="Data">
          <input type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Godzina">
          <input type="time" value={time} required step={300} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <button type="submit" className="btn btn-primary btn-block">Zaplanuj wizytę</button>
    </form>
  );
}

function InvoiceForm(props: { job: Job; onSaved: () => void }) {
  const { run } = useFeedback();
  const [value, setValue] = useState(props.job.invoiceNo);
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          await jobs.update(props.job.id, { invoiceNo: value.trim() });
          props.onSaved();
        });
      }}
    >
      <p className="sheet-text">Aplikacja nie wystawia faktur. Zapisz tu numer faktury z programu księgowego lub KSeF.</p>
      <Field label="Numer faktury">
        <input value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
      </Field>
      <button type="submit" className="btn btn-primary btn-block">Zapisz</button>
    </form>
  );
}

type DetailSheet = 'payment' | 'followup' | 'invoice' | null;

export function JobDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { confirm, deliverFile, run, toast } = useFeedback();
  const [sheet, setSheet] = useState<DetailSheet>(null);
  const [openPhoto, setOpenPhoto] = useState<Attachment | null>(null);
  const [withPhotos, setWithPhotos] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const data = useLiveQuery(async () => {
    const job = await jobs.get(id);
    if (!job || job.deletedAt) return null;
    return {
      job,
      client: await clients.get(job.clientId),
      site: job.siteId ? await sites.get(job.siteId) : undefined,
      payments: await payments.where('jobId', id),
      photos: await attachments.where('jobId', id),
      company: await getCompany(),
    };
  }, [id]);

  if (data === undefined) return <Loading />;
  if (data === null) return <NotFound back="/zlecenia" />;

  const { job, client, site, photos, company } = data;
  const paymentRows = data.payments;
  const totals = jobTotals(job.lines);
  const paid = paidForJob(job.id, paymentRows);
  const balance = jobBalance(job, paymentRows);
  const place = site
    ? [site.name, joinAddress(site.street, site.postalCode, site.city)].filter(Boolean).join(', ')
    : client
      ? joinAddress(client.street, client.postalCode, client.city)
      : '';
  const mapQuery = site ? joinAddress(site.street, site.postalCode, site.city) : client ? joinAddress(client.street, client.postalCode, client.city) : '';

  const documentData = async (includePhotos: boolean): Promise<JobDocumentData> => {
    if (!client) throw new DomainError('Brak klienta tego zlecenia.');
    return {
      job,
      client,
      site: site ?? null,
      company,
      photos: includePhotos ? await Promise.all(photos.map((p) => blobToDataUrl(p.blob))) : [],
    };
  };

  const generate = async (kind: 'protocol' | 'offer') => {
    if (!company.name) {
      toast('Najpierw uzupełnij dane firmy. Trafią na dokument.', {
        tone: 'error',
        action: { label: 'Ustawienia', onClick: () => navigate('/ustawienia') },
      });
      return;
    }
    setBusy(kind);
    await run(async () => {
      if (kind === 'protocol') {
        const blob = await renderPdf(protocolDocument(await documentData(withPhotos)));
        deliverFile(blob, pdfFileName('protokol', job.number));
      } else {
        const blob = await renderPdf(offerDocument(await documentData(false), todayWarsaw()));
        deliverFile(blob, pdfFileName('oferta', job.number));
      }
    });
    setBusy(null);
  };

  const addPhotos = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy('photos');
    await run(async () => {
      for (const file of files) {
        const blob = await resizePhoto(file);
        await attachments.create({ jobId: job.id, name: file.name, mime: 'image/jpeg', blob });
      }
      toast(files.length === 1 ? 'Dodano zdjęcie' : `Dodano zdjęcia: ${files.length}`);
    });
    setBusy(null);
  };

  const removePhoto = (photo: Attachment) => {
    setOpenPhoto(null);
    void run(async () => {
      await attachments.softDelete(photo.id);
      toast('Zdjęcie jest w koszu', {
        action: { label: 'Cofnij', onClick: () => void run(() => attachments.restore(photo.id)) },
      });
    });
  };

  const removePayment = (payment: Payment) =>
    run(async () => {
      await payments.softDelete(payment.id);
      toast('Usunięto wpłatę', {
        action: { label: 'Cofnij', onClick: () => void run(() => payments.restore(payment.id)) },
      });
    });

  const setStatus = async (status: JobStatus, message: string) => {
    const previous = job.status;
    await run(async () => {
      await jobs.update(job.id, { status });
      toast(message, { action: { label: 'Cofnij', onClick: () => void run(() => jobs.update(job.id, { status: previous })) } });
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Usunąć zlecenie?',
      message: `${job.number} trafi do kosza. Numer nie zostanie użyty ponownie.`,
      confirmLabel: 'Usuń',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await deleteJob(job.id);
      navigate('/zlecenia', { replace: true });
      toast('Zlecenie jest w koszu', {
        action: { label: 'Cofnij', onClick: () => void run(() => restoreRecord('jobs', job.id)) },
      });
    });
  };

  const isDone = job.status === 'wykonane';
  const canComplete = job.status === 'zaplanowane' || job.status === 'wycena';
  const showFollowUp = isDone && job.followUpDate && !job.followUpDone;

  return (
    <Page
      title={job.number}
      back="/zlecenia"
      actions={
        <Link className="icon-btn" to={`/zlecenia/${id}/edycja`} aria-label="Edytuj zlecenie">
          <Icon name="edit" />
        </Link>
      }
    >
      <div className="job-hero">
        <Badge tone={STATUS_TONES[job.status]}>{STATUSES[job.status]}</Badge>
        <h2>{job.title}</h2>
        <p>{job.status === 'wykonane' ? `Wykonano ${formatDate(job.completedOn)}` : formatTerm(job.start)}</p>
      </div>

      <div className="quick-actions">
        {client?.phone && (
          <a className="btn" href={`tel:${client.phone.replace(/\s/g, '')}`}>
            <Icon name="phone" /> Zadzwoń
          </a>
        )}
        {mapQuery && (
          <a className="btn" href={`https://maps.apple.com/?q=${encodeURIComponent(mapQuery)}`} target="_blank" rel="noreferrer">
            <Icon name="pin" /> Mapa
          </a>
        )}
      </div>

      {canComplete && (
        <Link className="btn btn-primary btn-block" to={`/zlecenia/${id}/protokol`}>
          <Icon name="check" /> Zakończ i sporządź protokół
        </Link>
      )}

      {showFollowUp && (
        <div className="notice notice-info">
          <Icon name="calendar" />
          <span>
            <strong>Kolejna wizyta: {formatDate(job.followUpDate)}</strong>
            <span className="notice-actions">
              <button type="button" className="link" onClick={() => setSheet('followup')}>Zaplanuj</button>
              <button type="button" className="link" onClick={() => void run(() => jobs.update(job.id, { followUpDone: true }))}>
                Nie przypominaj
              </button>
            </span>
          </span>
        </div>
      )}

      <Group title="Klient i miejsce">
        {client ? (
          <Row to={`/klienci/${client.id}`} title={client.name} sub={client.phone} />
        ) : (
          <Row title="Klient niedostępny" />
        )}
        {place && <Info label="Miejsce">{place}</Info>}
        {site?.accessNotes && <Info label="Dostęp">{site.accessNotes}</Info>}
      </Group>

      <Group title="Usługa">
        <Info label="Rodzaj">{CATEGORIES[job.category]}</Info>
        {job.pest && <Info label="Szkodnik">{job.pest}</Info>}
        {job.method && <Info label="Metoda">{job.method}</Info>}
        {job.scope && <Info label="Zakres">{job.scope}</Info>}
        {job.start && <Info label="Termin">{formatTerm(job.start)}, {formatDuration(job.durationMin)}</Info>}
        {job.notes && <Info label="Uwagi">{job.notes}</Info>}
      </Group>

      <Group title="Wycena">
        {job.lines.length === 0 && <Empty title="Brak pozycji" />}
        {job.lines.map((line) => (
          <Row
            key={line.id}
            title={line.name}
            sub={`${formatQty(line.qtyMilli)} ${line.unit} × ${formatMoney(line.unitPriceNet)}${company.vatPayer ? `, VAT ${vatLabel(line.vatRate)}` : ''}`}
            trailing={<span className="num">{formatMoney(lineNet(line.qtyMilli, line.unitPriceNet))}</span>}
          />
        ))}
        {job.lines.length > 0 && (
          <div className="totals">
            {company.vatPayer && (
              <>
                <div><span>Netto</span><span className="num">{formatMoney(totals.net)}</span></div>
                <div><span>VAT</span><span className="num">{formatMoney(totals.vat)}</span></div>
              </>
            )}
            <div className="totals-strong"><span>{company.vatPayer ? 'Brutto' : 'Razem'}</span><span className="num">{formatMoney(totals.gross)}</span></div>
          </div>
        )}
      </Group>

      <Group
        title="Płatności"
        action={<button type="button" className="link" onClick={() => setSheet('payment')}>Dodaj wpłatę</button>}
      >
        {paymentRows.map((p) => (
          <div className="row" key={p.id}>
            <span className="row-main">
              <span className="row-title num">{formatMoney(p.amount)}</span>
              <span className="row-sub">{formatDate(p.date)} · {PAYMENT_METHODS[p.method]}{p.note ? ` · ${p.note}` : ''}</span>
            </span>
            <button type="button" className="icon-btn" aria-label="Usuń wpłatę" onClick={() => void removePayment(p)}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        ))}
        <div className="totals">
          <div><span>Wpłacono</span><span className="num">{formatMoney(paid)}</span></div>
          <div className={balance > 0 ? 'totals-strong text-warn' : 'totals-strong'}>
            <span>{balance >= 0 ? 'Pozostało' : 'Nadpłata'}</span>
            <span className="num">{formatMoney(Math.abs(balance))}</span>
          </div>
        </div>
        <Row
          onClick={() => setSheet('invoice')}
          title="Numer faktury"
          sub={job.invoiceNo || 'Nie podano'}
        />
      </Group>

      {isDone && (
        <Group title="Protokół" action={<Link className="link" to={`/zlecenia/${id}/protokol`}>Edytuj</Link>}>
          {job.materials.length === 0 && <Info label="Preparaty">Nie użyto</Info>}
          {job.materials.map((m: JobMaterial) => (
            <Row
              key={m.id}
              title={m.name}
              sub={[m.permitNo && `Pozwolenie ${m.permitNo}`, m.batchNo && `Partia ${m.batchNo}`].filter(Boolean).join(' · ')}
              trailing={<span className="num">{formatQty(m.qtyMilli)} {m.unit}</span>}
            />
          ))}
          {job.safetyPeriod && <Info label="Karencja">{job.safetyPeriod}</Info>}
          {job.recommendations && <Info label="Zalecenia">{job.recommendations}</Info>}
          {job.warrantyUntil && <Info label="Gwarancja do">{formatDate(job.warrantyUntil)}</Info>}
          {job.followUpDate && <Info label="Kolejna wizyta">{formatDate(job.followUpDate)}</Info>}
          <Info label="Podpis klienta">{job.signatureDataUrl ? `Złożony${job.signerName ? `: ${job.signerName}` : ''}` : 'Brak'}</Info>
        </Group>
      )}

      {job.stationChecks.length > 0 && (
        <Group title={`Przegląd stacji (${job.stationChecks.length})`}>
          {job.stationChecks.map((check) => (
            <Row
              key={check.stationId}
              title={`Stacja nr ${check.number}`}
              sub={[check.type, check.location, check.notes].filter(Boolean).join(' · ')}
              trailing={<Badge tone={STATION_STATE_TONES[check.state]}>{STATION_STATES[check.state]}</Badge>}
            />
          ))}
        </Group>
      )}

      <Group title={`Zdjęcia (${photos.length})`} plain>
        <div className="photos">
          {photos.map((p) => (
            <PhotoThumb key={p.id} photo={p} onOpen={() => setOpenPhoto(p)} />
          ))}
          <label className="photo photo-add">
            <Icon name="camera" />
            <span>{busy === 'photos' ? 'Zapisuję…' : 'Dodaj'}</span>
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={busy === 'photos'}
              onChange={(e) => {
                // FileList jest żywa: wyczyszczenie pola opróżniłoby ją przed końcem zapisu.
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                void addPhotos(files);
              }}
            />
          </label>
        </div>
      </Group>

      <Group title="Dokumenty" plain>
        {isDone && photos.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
            Dołącz zdjęcia do protokołu
          </label>
        )}
        <div className="btn-stack">
          {isDone && (
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void generate('protocol')}>
              <Icon name="file" /> {busy === 'protocol' ? 'Tworzę PDF…' : 'Protokół PDF'}
            </button>
          )}
          <button type="button" className="btn" disabled={busy !== null || job.lines.length === 0} onClick={() => void generate('offer')}>
            <Icon name="file" /> {busy === 'offer' ? 'Tworzę PDF…' : 'Oferta PDF'}
          </button>
        </div>
      </Group>

      <div className="btn-stack">
        <button type="button" className="btn" onClick={() => setSheet('followup')}>
          <Icon name="copy" /> Zaplanuj podobne zlecenie
        </button>
        {isDone && (
          <button type="button" className="btn" onClick={() => void setStatus('zaplanowane', 'Cofnięto wykonanie. Zużycie wróciło na stan.')}>
            Cofnij wykonanie
          </button>
        )}
        {canComplete && (
          <button type="button" className="btn" onClick={() => void setStatus('anulowane', 'Zlecenie anulowane')}>
            Anuluj zlecenie
          </button>
        )}
        {job.status === 'anulowane' && (
          <button type="button" className="btn" onClick={() => void setStatus(job.start ? 'zaplanowane' : 'wycena', 'Przywrócono zlecenie')}>
            Przywróć zlecenie
          </button>
        )}
        <button type="button" className="btn btn-danger-quiet" onClick={() => void remove()}>
          <Icon name="trash" /> Usuń zlecenie
        </button>
      </div>

      <Sheet open={sheet === 'payment'} title="Nowa wpłata" onClose={() => setSheet(null)}>
        <PaymentForm jobId={job.id} suggested={balance} onSaved={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === 'followup'} title="Kolejna wizyta" onClose={() => setSheet(null)}>
        <FollowUpForm
          job={job}
          onSaved={(next) => {
            setSheet(null);
            toast(`Zapisano zlecenie ${next.number}`);
            navigate(`/zlecenia/${next.id}`);
          }}
        />
      </Sheet>
      <Sheet open={sheet === 'invoice'} title="Numer faktury" onClose={() => setSheet(null)}>
        <InvoiceForm job={job} onSaved={() => setSheet(null)} />
      </Sheet>
      <Sheet open={Boolean(openPhoto)} title="Zdjęcie" onClose={() => setOpenPhoto(null)}>
        {openPhoto && <PhotoView photo={openPhoto} onDelete={() => removePhoto(openPhoto)} />}
      </Sheet>
    </Page>
  );
}

// ---------- Protokół ----------

const materialSchema = z.object({
  id: z.string(),
  preparationId: required('Wybierz preparat'),
  batchNo: z.string(),
  qty: qtyText,
});

const stationCheckSchema = z
  .object({
    state: z.enum(['', 'bez-sladow', 'slady-zerowania', 'wymiana-trutki', 'uszkodzona', 'brak']),
    notes: z.string(),
  })
  // Stacja bez stanu nie trafia do protokołu, więc wpisane uwagi przepadłyby bez ostrzeżenia.
  .refine((v) => v.state !== '' || v.notes.trim() === '', { path: ['state'], message: 'Wybierz stan lub usuń uwagi' });

const completeSchema = z.object({
  completedOn: dateText,
  materials: z.array(materialSchema),
  stationChecks: z.array(stationCheckSchema),
  safetyPeriod: z.string(),
  recommendations: z.string(),
  warrantyUntil: optionalDateText,
  followUpDate: optionalDateText,
  signerName: z.string(),
});
type CompleteValues = z.infer<typeof completeSchema>;

function QuickMonths(props: {
  from: string;
  name: 'warrantyUntil' | 'followUpDate';
  setValue: UseFormSetValue<CompleteValues>;
}) {
  return (
    <div className="quick-months">
      {[1, 3, 6, 12].map((months) => (
        <button
          key={months}
          type="button"
          className="chip"
          onClick={() => props.setValue(props.name, addMonths(props.from, months), { shouldValidate: true })}
        >
          +{months} mies.
        </button>
      ))}
      <button type="button" className="chip" onClick={() => props.setValue(props.name, '')}>Brak</button>
    </div>
  );
}

function JobCompleteForm({ job, client, site }: { job: Job; client: Client | undefined; site: Site | undefined }) {
  const navigate = useNavigate();
  const { run, toast } = useFeedback();
  const stock = useLiveQuery(async () => ({
    preparations: (await preparations.all()).sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    movements: await stockMovements.all(),
    jobs: await jobs.all(),
  }));
  const [signature, setSignature] = useState(job.signatureDataUrl);
  // Wiersze ustalone raz: wartości formularza są powiązane z nimi po pozycji.
  const [stationRows] = useState(() => stationReviewRows(site, job.stationChecks));

  const { register, handleSubmit, watch, setValue, control, formState } = useForm<CompleteValues>({
    resolver: zodResolver(completeSchema),
    defaultValues: {
      completedOn: job.completedOn ?? todayWarsaw(),
      materials: job.materials.map((m) => ({
        id: m.id,
        preparationId: m.preparationId,
        batchNo: m.batchNo,
        qty: qtyToInput(m.qtyMilli),
      })),
      stationChecks: stationRows.map((row) => ({ state: row.state, notes: row.notes })),
      safetyPeriod: job.safetyPeriod,
      recommendations: job.recommendations,
      warrantyUntil: job.warrantyUntil ?? '',
      followUpDate: job.followUpDate ?? '',
      signerName: job.signerName || client?.contactPerson || (client?.kind === 'osoba' ? client.name : ''),
    },
  });
  const { errors } = formState;
  const { fields, append, remove } = useFieldArray({ control, name: 'materials', keyName: 'key' });
  const materialValues = watch('materials');
  const completedOn = watch('completedOn');

  if (!stock) return <Loading />;

  const balancesFor = (preparationId: string) =>
    preparationId ? batchBalances(preparationId, stock.movements, stock.jobs) : [];

  const selectPreparation = (index: number, preparationId: string) => {
    setValue(`materials.${index}.preparationId`, preparationId, { shouldValidate: true });
    const available = balancesFor(preparationId).filter((b) => b.qtyMilli > 0);
    setValue(`materials.${index}.batchNo`, available.length > 0 ? available[0].batchNo : '');
    const preparation = stock.preparations.find((p) => p.id === preparationId);
    if (preparation?.safetyPeriod && !watch('safetyPeriod')) setValue('safetyPeriod', preparation.safetyPeriod);
  };

  const onSubmit = (v: CompleteValues) =>
    run(async () => {
      const materials: JobMaterial[] = v.materials.map((m) => {
        const preparation = stock.preparations.find((p) => p.id === m.preparationId)!;
        return {
          id: m.id,
          preparationId: m.preparationId,
          name: preparation.name,
          permitNo: preparation.permitNo,
          activeSubstance: preparation.activeSubstance,
          batchNo: m.batchNo.trim(),
          qtyMilli: parseQty(m.qty)!,
          unit: UNITS[preparation.unit],
        };
      });
      const stationChecks: JobStationCheck[] = stationRows.flatMap((row, index) => {
        const { state, notes } = v.stationChecks[index];
        return state ? [{ ...row, state: state as StationState, notes: notes.trim() }] : [];
      });
      await jobs.update(job.id, {
        status: 'wykonane',
        completedOn: v.completedOn,
        materials,
        stationChecks,
        safetyPeriod: v.safetyPeriod.trim(),
        recommendations: v.recommendations.trim(),
        warrantyUntil: dateOrNull(v.warrantyUntil),
        followUpDate: dateOrNull(v.followUpDate),
        // Zmiana daty kolejnej wizyty znów włącza przypomnienie.
        followUpDone: v.followUpDate === job.followUpDate ? job.followUpDone : false,
        signerName: v.signerName.trim(),
        signatureDataUrl: signature,
      });
      toast('Zapisano protokół');
      navigate(`/zlecenia/${job.id}`, { replace: true });
    });

  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <fieldset>
        <legend>Wykonanie</legend>
        <Field label="Data wykonania" error={errors.completedOn?.message}>
          <input type="date" {...register('completedOn')} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Użyte preparaty</legend>
        {stock.preparations.length === 0 && (
          <p className="field-hint">
            Nie masz preparatów w bazie. <Link className="link" to="/preparaty/nowy">Dodaj preparat</Link>
          </p>
        )}
        {fields.map((field, index) => {
          const current = materialValues[index];
          const preparation = stock.preparations.find((p) => p.id === current?.preparationId);
          const batches = balancesFor(current?.preparationId ?? '');
          const batch = batches.find((b) => b.batchNo === current?.batchNo);
          const lineErrors = errors.materials?.[index];
          return (
            <div className="line-card" key={field.key}>
              <Field label="Preparat" error={lineErrors?.preparationId?.message}>
                <select value={current?.preparationId ?? ''} onChange={(e) => selectPreparation(index, e.target.value)}>
                  <option value="">Wybierz preparat</option>
                  {stock.preparations.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
              <div className="form-row">
                <Field label="Partia" hint={batch && preparation ? `Na stanie: ${formatQty(batch.qtyMilli)} ${UNITS[preparation.unit]}` : undefined}>
                  <input {...register(`materials.${index}.batchNo`)} list={`batches-${index}`} autoComplete="off" />
                  <datalist id={`batches-${index}`}>
                    {batches.map((b) => <option key={b.batchNo} value={b.batchNo} />)}
                  </datalist>
                </Field>
                <Field label={`Ilość${preparation ? ` (${UNITS[preparation.unit]})` : ''}`} error={lineErrors?.qty?.message}>
                  <input {...register(`materials.${index}.qty`)} inputMode="decimal" autoComplete="off" />
                </Field>
              </div>
              <button type="button" className="link link-danger" onClick={() => remove(index)}>Usuń preparat</button>
            </div>
          );
        })}
        <button
          type="button"
          className="btn btn-block"
          disabled={stock.preparations.length === 0}
          onClick={() => append({ id: newId(), preparationId: '', batchNo: '', qty: '' })}
        >
          <Icon name="plus" /> Dodaj preparat
        </button>
      </fieldset>

      {stationRows.length > 0 && (
        <fieldset>
          <legend>Przegląd stacji deratyzacyjnych</legend>
          <p className="field-hint">Do protokołu trafią stacje z wybranym stanem.</p>
          {stationRows.map((row, index) => (
            <div className="line-card" key={row.stationId}>
              <div>
                <strong>Stacja nr {row.number}</strong>
                <div className="field-hint">{[row.type, row.location].filter(Boolean).join(' · ')}</div>
              </div>
              <Field label="Stan" error={errors.stationChecks?.[index]?.state?.message}>
                <select {...register(`stationChecks.${index}.state`)} aria-label={`Stan stacji nr ${row.number}`}>
                  <option value="">Nie sprawdzono</option>
                  {Object.entries(STATION_STATES).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Uwagi">
                <input {...register(`stationChecks.${index}.notes`)} aria-label={`Uwagi do stacji nr ${row.number}`} autoComplete="off" />
              </Field>
            </div>
          ))}
        </fieldset>
      )}

      <fieldset>
        <legend>Zalecenia dla klienta</legend>
        <Field label="Okres karencji / prewencji">
          <input {...register('safetyPeriod')} autoComplete="off" />
        </Field>
        <Field label="Zalecenia">
          <textarea {...register('recommendations')} rows={3} />
        </Field>
      </fieldset>

      <fieldset>
        <legend>Gwarancja i kolejna wizyta</legend>
        <Field label="Gwarancja do" error={errors.warrantyUntil?.message}>
          <input type="date" {...register('warrantyUntil')} />
        </Field>
        <QuickMonths from={completedOn || todayWarsaw()} name="warrantyUntil" setValue={setValue} />
        <Field label="Kolejna wizyta" error={errors.followUpDate?.message} hint="Na 30 dni przed tą datą przypomni o tym pulpit.">
          <input type="date" {...register('followUpDate')} />
        </Field>
        <QuickMonths from={completedOn || todayWarsaw()} name="followUpDate" setValue={setValue} />
      </fieldset>

      <fieldset>
        <legend>Podpis klienta</legend>
        <Field label="Imię i nazwisko">
          <input {...register('signerName')} autoComplete="off" />
        </Field>
        <SignaturePad value={signature} onChange={setSignature} />
      </fieldset>

      <button type="submit" className="btn btn-primary btn-block" disabled={formState.isSubmitting}>
        Zapisz protokół
      </button>
    </form>
  );
}

export function JobCompletePage() {
  const { id = '' } = useParams();
  const data = useLiveQuery(async () => {
    const job = await jobs.get(id);
    if (!job || job.deletedAt) return null;
    return {
      job,
      client: await clients.get(job.clientId),
      site: job.siteId ? await sites.get(job.siteId) : undefined,
    };
  }, [id]);
  if (data === undefined) return <Loading />;
  if (data === null) return <NotFound back="/zlecenia" />;
  return (
    <Page title="Protokół" back={`/zlecenia/${id}`}>
      <JobCompleteForm key={data.job.id} job={data.job} client={data.client} site={data.site} />
    </Page>
  );
}
