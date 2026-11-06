import { zodResolver } from '@hookform/resolvers/zod';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { jobTotals, paidForJob } from '../data/calc';
import {
  addStation,
  byStationNumber,
  deleteClient,
  deleteSite,
  deleteStation,
  nextStationNumber,
  restoreRecord,
  restoreStation,
  updateStation,
} from '../data/domain';
import { clients, jobs, payments, sites } from '../data/repo';
import type { BaitStation, Client, ClientKind, Site } from '../data/types';
import { CLIENT_KINDS, joinAddress, OBJECT_TYPES, STATION_TYPES } from '../lib/labels';
import { formatMoney } from '../lib/money';
import { matchesSearch } from '../lib/validators';
import { useFeedback } from '../ui/feedback';
import { emailText, nipText, postalText, required } from '../ui/forms';
import { Icon } from '../ui/icons';
import { AddLink, Empty, Field, Group, Info, Loading, NotFound, Page, Row, Search, Sheet, Stat } from '../ui/kit';
import { JobRow } from './job-row';

// ---------- Formularze ----------

const clientSchema = z.object({
  kind: z.enum(['firma', 'osoba', 'wspolnota', 'instytucja']),
  name: required('Podaj nazwę lub imię i nazwisko'),
  contactPerson: z.string(),
  phone: z.string(),
  email: emailText,
  nip: nipText,
  street: z.string(),
  postalCode: postalText,
  city: z.string(),
  notes: z.string(),
});
type ClientValues = z.infer<typeof clientSchema>;

export function ClientForm(props: { client?: Client; onSaved: (client: Client) => void; compact?: boolean }) {
  const { run } = useFeedback();
  const c = props.client;
  const { register, handleSubmit, watch, formState } = useForm<ClientValues>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      kind: c?.kind ?? 'firma',
      name: c?.name ?? '',
      contactPerson: c?.contactPerson ?? '',
      phone: c?.phone ?? '',
      email: c?.email ?? '',
      nip: c?.nip ?? '',
      street: c?.street ?? '',
      postalCode: c?.postalCode ?? '',
      city: c?.city ?? '',
      notes: c?.notes ?? '',
    },
  });
  const { errors } = formState;
  const kind = watch('kind');

  const onSubmit = (values: ClientValues) =>
    run(async () => {
      if (c) {
        await clients.update(c.id, values);
        props.onSaved({ ...c, ...values });
      } else {
        props.onSaved(await clients.create(values));
      }
    });

  return (
    <form className="form" onSubmit={(e) => { e.stopPropagation(); void handleSubmit(onSubmit)(e); }} noValidate>
      <Field label="Rodzaj klienta">
        <select {...register('kind')}>
          {Object.entries(CLIENT_KINDS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>
      <Field label={kind === 'osoba' ? 'Imię i nazwisko' : 'Nazwa'} error={errors.name?.message}>
        <input {...register('name')} autoComplete="off" />
      </Field>
      <Field label="Telefon">
        <input {...register('phone')} type="tel" inputMode="tel" autoComplete="off" />
      </Field>
      {kind !== 'osoba' && (
        <Field label="Osoba kontaktowa">
          <input {...register('contactPerson')} autoComplete="off" />
        </Field>
      )}
      {!props.compact && (
        <Field label="E-mail" error={errors.email?.message}>
          <input {...register('email')} type="email" inputMode="email" autoCapitalize="none" autoComplete="off" />
        </Field>
      )}
      {kind !== 'osoba' && (
        <Field label="NIP" error={errors.nip?.message}>
          <input {...register('nip')} inputMode="numeric" autoComplete="off" />
        </Field>
      )}
      <Field label="Ulica i numer">
        <input {...register('street')} autoComplete="off" />
      </Field>
      <div className="form-row form-row-postal">
        <Field label="Kod" error={errors.postalCode?.message}>
          <input {...register('postalCode')} inputMode="numeric" placeholder="00-000" autoComplete="off" />
        </Field>
        <Field label="Miejscowość">
          <input {...register('city')} autoComplete="off" />
        </Field>
      </div>
      {!props.compact && (
        <Field label="Notatki">
          <textarea {...register('notes')} rows={3} />
        </Field>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={formState.isSubmitting}>
        Zapisz klienta
      </button>
    </form>
  );
}

const siteSchema = z.object({
  name: required('Podaj nazwę obiektu'),
  objectType: z.string(),
  street: z.string(),
  postalCode: postalText,
  city: z.string(),
  area: z.string().refine((v) => v.trim() === '' || /^\d+([.,]\d+)?$/.test(v.trim()), 'Podaj liczbę, np. 120'),
  accessNotes: z.string(),
});
type SiteValues = z.infer<typeof siteSchema>;

export function SiteForm(props: { clientId: string; site?: Site; onSaved: (site: Site) => void }) {
  const { run } = useFeedback();
  const s = props.site;
  const { register, handleSubmit, formState } = useForm<SiteValues>({
    resolver: zodResolver(siteSchema),
    defaultValues: {
      name: s?.name ?? '',
      objectType: s?.objectType ?? '',
      street: s?.street ?? '',
      postalCode: s?.postalCode ?? '',
      city: s?.city ?? '',
      area: s?.areaM2 != null ? String(s.areaM2).replace('.', ',') : '',
      accessNotes: s?.accessNotes ?? '',
    },
  });
  const { errors } = formState;

  const onSubmit = ({ area, ...rest }: SiteValues) =>
    run(async () => {
      const values = {
        ...rest,
        clientId: props.clientId,
        areaM2: area.trim() ? Number(area.trim().replace(',', '.')) : null,
      };
      if (s) {
        await sites.update(s.id, values);
        props.onSaved({ ...s, ...values });
      } else {
        props.onSaved(await sites.create({ ...values, stations: [] }));
      }
    });

  return (
    <form className="form" onSubmit={(e) => { e.stopPropagation(); void handleSubmit(onSubmit)(e); }} noValidate>
      <Field label="Nazwa obiektu" error={errors.name?.message} hint="Np. Restauracja Rynek, Magazyn nr 2">
        <input {...register('name')} autoComplete="off" />
      </Field>
      <Field label="Rodzaj obiektu">
        <input {...register('objectType')} list="object-types" autoComplete="off" />
        <datalist id="object-types">
          {OBJECT_TYPES.map((t) => <option key={t} value={t} />)}
        </datalist>
      </Field>
      <Field label="Ulica i numer">
        <input {...register('street')} autoComplete="off" />
      </Field>
      <div className="form-row form-row-postal">
        <Field label="Kod" error={errors.postalCode?.message}>
          <input {...register('postalCode')} inputMode="numeric" placeholder="00-000" autoComplete="off" />
        </Field>
        <Field label="Miejscowość">
          <input {...register('city')} autoComplete="off" />
        </Field>
      </div>
      <Field label="Powierzchnia (m²)" error={errors.area?.message}>
        <input {...register('area')} inputMode="decimal" autoComplete="off" />
      </Field>
      <Field label="Dostęp i uwagi" hint="Kod do bramy, klucze, osoba na miejscu">
        <textarea {...register('accessNotes')} rows={2} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={formState.isSubmitting}>
        Zapisz obiekt
      </button>
    </form>
  );
}

const stationSchema = z.object({
  number: required('Podaj numer stacji'),
  type: z.string(),
  location: z.string(),
});
type StationValues = z.infer<typeof stationSchema>;

function StationForm(props: { site: Site; station?: BaitStation; onDone: () => void; onDelete?: () => void }) {
  const { run, toast } = useFeedback();
  const { site, station } = props;
  const { register, handleSubmit, formState } = useForm<StationValues>({
    resolver: zodResolver(stationSchema),
    defaultValues: {
      number: station?.number ?? nextStationNumber(site.stations),
      type: station?.type ?? '',
      location: station?.location ?? '',
    },
  });
  const { errors } = formState;

  const onSubmit = (values: StationValues) =>
    run(async () => {
      if (station) {
        await updateStation(site.id, station.id, values);
        toast('Zapisano zmiany');
      } else {
        await addStation(site.id, values);
        toast(`Dodano stację nr ${values.number}`);
      }
      props.onDone();
    });

  return (
    <form className="form" onSubmit={(e) => { e.stopPropagation(); void handleSubmit(onSubmit)(e); }} noValidate>
      <Field label="Numer" error={errors.number?.message}>
        <input {...register('number')} autoComplete="off" />
      </Field>
      <Field label="Typ">
        <input {...register('type')} list="station-types" autoComplete="off" />
        <datalist id="station-types">
          {STATION_TYPES.map((t) => <option key={t} value={t} />)}
        </datalist>
      </Field>
      <Field label="Miejsce" hint="Np. Magazyn, ściana północna">
        <input {...register('location')} autoComplete="off" />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={formState.isSubmitting}>
        Zapisz stację
      </button>
      {props.onDelete && (
        <button type="button" className="btn btn-danger-quiet btn-block" onClick={props.onDelete}>
          <Icon name="trash" /> Usuń stację
        </button>
      )}
    </form>
  );
}

function StationsGroup({ site }: { site: Site }) {
  const { run, toast } = useFeedback();
  const [sheet, setSheet] = useState<BaitStation | 'new' | null>(null);
  const active = site.stations.filter((s) => !s.deletedAt).sort(byStationNumber);
  const removed = site.stations.filter((s) => s.deletedAt).sort(byStationNumber);
  const description = (s: BaitStation) => [s.type, s.location].filter(Boolean).join(' · ');

  const remove = (station: BaitStation) => {
    setSheet(null);
    void run(async () => {
      await deleteStation(site.id, station.id);
      toast(`Usunięto stację nr ${station.number}`, {
        action: { label: 'Cofnij', onClick: () => void run(() => restoreStation(site.id, station.id)) },
      });
    });
  };

  return (
    <>
      <Group
        title={`Stacje deratyzacyjne (${active.length})`}
        action={<button type="button" className="link" onClick={() => setSheet('new')}>Dodaj</button>}
      >
        {active.length === 0 && <Empty title="Brak stacji w tym obiekcie" />}
        {active.map((s) => (
          <Row key={s.id} onClick={() => setSheet(s)} title={`Stacja nr ${s.number}`} sub={description(s)} />
        ))}
      </Group>
      {removed.length > 0 && (
        <Group title="Usunięte stacje">
          {removed.map((s) => (
            <div className="row" key={s.id}>
              <span className="row-main">
                <span className="row-title">Stacja nr {s.number}</span>
                <span className="row-sub">{description(s)}</span>
              </span>
              <button type="button" className="link" onClick={() => void run(() => restoreStation(site.id, s.id))}>
                Przywróć
              </button>
            </div>
          ))}
        </Group>
      )}
      <Sheet open={sheet !== null} title={sheet === 'new' ? 'Nowa stacja' : 'Edycja stacji'} onClose={() => setSheet(null)}>
        {sheet !== null && (
          <StationForm
            key={sheet === 'new' ? 'new' : sheet.id}
            site={site}
            station={sheet === 'new' ? undefined : sheet}
            onDone={() => setSheet(null)}
            onDelete={sheet === 'new' ? undefined : () => remove(sheet)}
          />
        )}
      </Sheet>
    </>
  );
}

// ---------- Ekrany ----------

export function ClientsPage() {
  const rows = useLiveQuery(() => clients.all());
  const siteRows = useLiveQuery(() => sites.all());
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!rows) return [];
    const sitesOf = new Map<string, Site[]>();
    for (const s of siteRows ?? []) sitesOf.set(s.clientId, [...(sitesOf.get(s.clientId) ?? []), s]);
    return rows
      .filter((c) =>
        matchesSearch(
          query,
          c.name,
          c.contactPerson,
          c.phone,
          c.nip,
          c.street,
          c.city,
          ...(sitesOf.get(c.id) ?? []).flatMap((s) => [s.name, s.street, s.city]),
        ),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  }, [rows, siteRows, query]);

  return (
    <Page title="Klienci" actions={<AddLink to="/klienci/nowy" label="Nowy klient" />}>
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty icon="users" title="Nie masz jeszcze klientów">
          <Link className="btn btn-primary" to="/klienci/nowy">Dodaj klienta</Link>
        </Empty>
      ) : (
        <>
          <Search value={query} onChange={setQuery} placeholder="Szukaj: nazwa, telefon, adres" />
          <Group>
            {filtered.length === 0 && <Empty title="Nic nie znaleziono" />}
            {filtered.map((c) => (
              <Row
                key={c.id}
                to={`/klienci/${c.id}`}
                title={c.name}
                sub={[c.phone, joinAddress(c.street, '', c.city)].filter(Boolean).join(' · ')}
              />
            ))}
          </Group>
        </>
      )}
    </Page>
  );
}

export function ClientNewPage() {
  const navigate = useNavigate();
  const { toast } = useFeedback();
  return (
    <Page title="Nowy klient" back="/klienci">
      <ClientForm
        onSaved={(c) => {
          toast('Zapisano klienta');
          navigate(`/klienci/${c.id}`, { replace: true });
        }}
      />
    </Page>
  );
}

export function ClientEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const client = useLiveQuery(() => clients.get(id).then((c) => c ?? null), [id]);
  if (client === undefined) return <Loading />;
  if (client === null) return <NotFound back="/klienci" />;
  return (
    <Page title="Edycja klienta" back={`/klienci/${id}`}>
      <ClientForm
        key={client.id}
        client={client}
        onSaved={() => {
          toast('Zapisano zmiany');
          navigate(`/klienci/${id}`, { replace: true });
        }}
      />
    </Page>
  );
}

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { confirm, run, toast } = useFeedback();
  const data = useLiveQuery(async () => {
    const client = await clients.get(id);
    if (!client || client.deletedAt) return null;
    const jobRows = await jobs.where('clientId', id);
    const paymentRows = await payments.all();
    return { client, siteRows: await sites.where('clientId', id), jobRows, paymentRows };
  }, [id]);

  if (data === undefined) return <Loading />;
  if (data === null) return <NotFound back="/klienci" />;

  const { client, siteRows, jobRows, paymentRows } = data;
  const siteById = new Map(siteRows.map((s) => [s.id, s]));
  const sorted = [...jobRows].sort((a, b) => (b.start ?? b.createdAt).localeCompare(a.start ?? a.createdAt));
  const done = jobRows.filter((j) => j.status === 'wykonane');
  const revenue = done.reduce((sum, j) => sum + jobTotals(j.lines).gross, 0);
  const due = done.reduce((sum, j) => sum + jobTotals(j.lines).gross - paidForJob(j.id, paymentRows), 0);
  const address = joinAddress(client.street, client.postalCode, client.city);

  const remove = async () => {
    const ok = await confirm({
      title: 'Usunąć klienta?',
      message: `${client.name} trafi do kosza razem ze swoimi obiektami.`,
      confirmLabel: 'Usuń',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await deleteClient(id);
      navigate('/klienci', { replace: true });
      toast('Klient jest w koszu', {
        action: { label: 'Cofnij', onClick: () => void run(() => restoreRecord('clients', id)) },
      });
    });
  };

  return (
    <Page
      title={client.name}
      back="/klienci"
      actions={
        <Link className="icon-btn" to={`/klienci/${id}/edycja`} aria-label="Edytuj klienta">
          <Icon name="edit" />
        </Link>
      }
    >
      <div className="quick-actions">
        {client.phone && (
          <a className="btn" href={`tel:${client.phone.replace(/\s/g, '')}`}>
            <Icon name="phone" /> Zadzwoń
          </a>
        )}
        {client.email && (
          <a className="btn" href={`mailto:${client.email}`}>
            <Icon name="mail" /> E-mail
          </a>
        )}
        <Link className="btn btn-primary" to={`/zlecenia/nowe?klient=${id}`}>
          <Icon name="plus" /> Zlecenie
        </Link>
      </div>

      <Group>
        <Info label="Rodzaj">{CLIENT_KINDS[client.kind as ClientKind]}</Info>
        {client.phone && <Info label="Telefon">{client.phone}</Info>}
        {client.contactPerson && <Info label="Kontakt">{client.contactPerson}</Info>}
        {client.email && <Info label="E-mail">{client.email}</Info>}
        {client.nip && <Info label="NIP">{client.nip}</Info>}
        {address && <Info label="Adres">{address}</Info>}
        {client.notes && <Info label="Notatki">{client.notes}</Info>}
      </Group>

      {done.length > 0 && (
        <div className="stats">
          <Stat label="Wartość wykonanych" value={formatMoney(revenue)} />
          <Stat label="Do zapłaty" value={formatMoney(due)} tone={due > 0 ? 'warn' : undefined} />
        </div>
      )}

      <Group
        title="Obiekty"
        action={<Link className="link" to={`/klienci/${id}/obiekty/nowy`}>Dodaj</Link>}
      >
        {siteRows.length === 0 && <Empty title="Brak obiektów. Zlecenia użyją adresu klienta." />}
        {siteRows.map((s) => {
          const stationCount = s.stations.filter((st) => !st.deletedAt).length;
          return (
            <Row
              key={s.id}
              to={`/obiekty/${s.id}/edycja`}
              title={s.name}
              sub={[s.objectType, joinAddress(s.street, s.postalCode, s.city), stationCount > 0 && `Stacje: ${stationCount}`]
                .filter(Boolean)
                .join(' · ')}
            />
          );
        })}
      </Group>

      <Group title={`Zlecenia (${jobRows.length})`}>
        {sorted.length === 0 && <Empty title="Brak zleceń" />}
        {sorted.map((job) => (
          <JobRow key={job.id} job={job} site={job.siteId ? siteById.get(job.siteId) : undefined} />
        ))}
      </Group>

      <button type="button" className="btn btn-danger-quiet btn-block" onClick={remove}>
        <Icon name="trash" /> Usuń klienta
      </button>
    </Page>
  );
}

export function SiteNewPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { toast } = useFeedback();
  return (
    <Page title="Nowy obiekt" back={`/klienci/${id}`}>
      <SiteForm
        clientId={id}
        onSaved={() => {
          toast('Zapisano obiekt');
          navigate(`/klienci/${id}`, { replace: true });
        }}
      />
      <p className="field-hint">Stacje deratyzacyjne dodasz po zapisaniu, w edycji obiektu.</p>
    </Page>
  );
}

export function SiteEditPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { confirm, run, toast } = useFeedback();
  const site = useLiveQuery(() => sites.get(id).then((s) => (s && !s.deletedAt ? s : null)), [id]);
  if (site === undefined) return <Loading />;
  if (site === null) return <NotFound back="/klienci" />;

  const remove = async () => {
    const ok = await confirm({
      title: 'Usunąć obiekt?',
      message: `${site.name} trafi do kosza.`,
      confirmLabel: 'Usuń',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await deleteSite(id);
      navigate(`/klienci/${site.clientId}`, { replace: true });
      toast('Obiekt jest w koszu', {
        action: { label: 'Cofnij', onClick: () => void run(() => restoreRecord('sites', id)) },
      });
    });
  };

  return (
    <Page title="Edycja obiektu" back={`/klienci/${site.clientId}`}>
      <SiteForm
        key={site.id}
        clientId={site.clientId}
        site={site}
        onSaved={() => {
          toast('Zapisano zmiany');
          navigate(`/klienci/${site.clientId}`, { replace: true });
        }}
      />
      <StationsGroup site={site} />
      <button type="button" className="btn btn-danger-quiet btn-block" onClick={remove}>
        <Icon name="trash" /> Usuń obiekt
      </button>
    </Page>
  );
}
