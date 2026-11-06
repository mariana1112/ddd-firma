import { zodResolver } from '@hookform/resolvers/zod';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  exportBackup,
  listSnapshots,
  parseBackup,
  restoreBackup,
  restoreSnapshot,
  type BackupFile,
  type BackupSummary,
  type RestoreMode,
} from '../data/backup';
import { jobTotals, paidForJob } from '../data/calc';
import { RECORD_TABLES, recordTable, type RecordTableName } from '../data/db';
import { emptyTrash, restoreRecord } from '../data/domain';
import { clients, jobs, payments, sites } from '../data/repo';
import { getCompany, getLastBackupAt, getSyncState, saveCompany } from '../data/settings';
import { isSyncConfigured } from '../data/sync/config';
import type { BaseRecord, CompanySettings } from '../data/types';
import { csvBlob, csvMoney } from '../lib/csv';
import { formatDate, formatInstant, formatTerm } from '../lib/dates';
import { imageToPngDataUrl } from '../lib/images';
import { CLIENT_KINDS, joinAddress, STATUSES } from '../lib/labels';
import { useFeedback } from '../ui/feedback';
import { emailText, nipText, postalText, required } from '../ui/forms';
import { Icon } from '../ui/icons';
import { Badge, Empty, Field, Group, Info, Loading, Page, Row, Sheet } from '../ui/kit';

// ---------- Więcej ----------

export function MorePage() {
  const lastBackup = useLiveQuery(() => getLastBackupAt());
  const sync = useLiveQuery(async () => (await getSyncState()) ?? null);
  return (
    <Page title="Więcej">
      <Group title="Firma">
        <Row to="/finanse" icon="wallet" title="Finanse" sub="Wpływy, koszty, należności" />
        <Row to="/preparaty" icon="flask" title="Preparaty" sub="Stan, partie, terminy ważności" />
        <Row to="/ewidencja" icon="book" title="Ewidencja zużycia" sub="Zestawienie do kontroli" />
        <Row to="/cennik" icon="tag" title="Cennik usług" />
      </Group>
      <Group title="Aplikacja">
        <Row to="/ustawienia" icon="gear" title="Dane firmy" sub="Na protokoły i oferty" />
        <Row
          to="/kopie"
          icon="database"
          title="Kopie zapasowe"
          sub={lastBackup ? `Ostatnia: ${formatInstant(lastBackup)}` : 'Nie zrobiono jeszcze kopii'}
        />
        <Row to="/kosz" icon="trash" title="Kosz" />
        {isSyncConfigured && (
          <Row
            to="/konto"
            icon="users"
            title="Konto i synchronizacja"
            sub={sync ? `${sync.email}, ostatnio ${sync.lastSyncAt ? formatInstant(sync.lastSyncAt) : "jeszcze nie"}` : "Wyłączona"}
          />
        )}
      </Group>
      <p className="about">
        {sync
          ? "Dane są na tym urządzeniu i w kopii na serwerze firmy. Aplikacja działa bez internetu, a zmiany wysyła, gdy jest połączenie."
          : "Wszystkie dane są zapisane wyłącznie na tym urządzeniu. Aplikacja działa bez internetu i nie wysyła danych nigdzie."}
      </p>
    </Page>
  );
}

// ---------- Dane firmy ----------

const companySchema = z.object({
  name: required('Podaj nazwę firmy'),
  owner: z.string(),
  nip: nipText,
  regon: z.string(),
  street: z.string(),
  postalCode: postalText,
  city: z.string(),
  phone: z.string(),
  email: emailText,
  bankAccount: z.string(),
  vatPayer: z.boolean(),
  defaultVatRate: z.string(),
  offerValidityDays: z.string().refine((v) => Number(v) > 0, 'Podaj liczbę dni'),
  protocolFooter: z.string(),
});
type CompanyValues = z.infer<typeof companySchema>;

function CompanyForm({ company }: { company: CompanySettings }) {
  const { run, toast } = useFeedback();
  const [logo, setLogo] = useState(company.logoDataUrl);
  const { register, handleSubmit, watch, formState } = useForm<CompanyValues>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      ...company,
      defaultVatRate: String(company.defaultVatRate),
      offerValidityDays: String(company.offerValidityDays),
    },
  });
  const { errors } = formState;
  const vatPayer = watch('vatPayer');

  const onSubmit = (v: CompanyValues) =>
    run(async () => {
      await saveCompany({
        ...v,
        logoDataUrl: logo,
        defaultVatRate: Number(v.defaultVatRate),
        offerValidityDays: Number(v.offerValidityDays),
      });
      toast('Zapisano dane firmy');
    });

  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)} noValidate>
      <fieldset>
        <legend>Dane na dokumentach</legend>
        <Field label="Nazwa firmy" error={errors.name?.message}>
          <input {...register('name')} autoComplete="off" />
        </Field>
        <Field label="Właściciel / osoba wykonująca">
          <input {...register('owner')} autoComplete="off" />
        </Field>
        <div className="form-row">
          <Field label="NIP" error={errors.nip?.message}>
            <input {...register('nip')} inputMode="numeric" autoComplete="off" />
          </Field>
          <Field label="REGON">
            <input {...register('regon')} inputMode="numeric" autoComplete="off" />
          </Field>
        </div>
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
        <div className="form-row">
          <Field label="Telefon">
            <input {...register('phone')} type="tel" inputMode="tel" autoComplete="off" />
          </Field>
          <Field label="E-mail" error={errors.email?.message}>
            <input {...register('email')} type="email" inputMode="email" autoCapitalize="none" autoComplete="off" />
          </Field>
        </div>
        <Field label="Numer konta">
          <input {...register('bankAccount')} inputMode="numeric" autoComplete="off" />
        </Field>
        <div className="field">
          <span className="field-label">Logo</span>
          {logo && <img className="logo-preview" src={logo} alt="Logo firmy" />}
          <div className="inline-actions">
            <label className="btn btn-file">
              {logo ? 'Zmień logo' : 'Wybierz logo'}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void run(async () => setLogo(await imageToPngDataUrl(file)));
                }}
              />
            </label>
            {logo && (
              <button type="button" className="link link-danger" onClick={() => setLogo(null)}>Usuń logo</button>
            )}
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Rozliczenia</legend>
        <label className="check">
          <input type="checkbox" {...register('vatPayer')} />
          Jestem płatnikiem VAT
        </label>
        <div className="form-row">
          {vatPayer && (
            <Field label="Domyślna stawka VAT">
              <select {...register('defaultVatRate')}>
                <option value="23">23%</option>
                <option value="8">8%</option>
                <option value="5">5%</option>
                <option value="0">0%</option>
              </select>
            </Field>
          )}
          <Field label="Ważność oferty (dni)" error={errors.offerValidityDays?.message}>
            <input {...register('offerValidityDays')} inputMode="numeric" autoComplete="off" />
          </Field>
        </div>
        <Field label="Stopka dokumentów">
          <textarea {...register('protocolFooter')} rows={2} />
        </Field>
      </fieldset>

      <button type="submit" className="btn btn-primary btn-block" disabled={formState.isSubmitting}>
        Zapisz dane firmy
      </button>
    </form>
  );
}

export function SettingsPage() {
  const company = useLiveQuery(() => getCompany());
  const [loaded, setLoaded] = useState<CompanySettings>();
  // Formularz startuje z jednego odczytu, żeby zapis nie resetował pól w trakcie edycji.
  useEffect(() => {
    if (company && !loaded) setLoaded(company);
  }, [company, loaded]);
  return (
    <Page title="Dane firmy" back="/wiecej">
      {loaded ? <CompanyForm company={loaded} /> : <Loading />}
    </Page>
  );
}

// ---------- Kopie zapasowe ----------

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const SUMMARY_LABELS: Array<[keyof BackupSummary['counts'], string]> = [
  ['clients', 'Klienci'],
  ['sites', 'Obiekty'],
  ['jobs', 'Zlecenia'],
  ['preparations', 'Preparaty'],
  ['services', 'Usługi w cenniku'],
  ['payments', 'Wpłaty'],
  ['expenses', 'Koszty'],
  ['attachments', 'Zdjęcia'],
];

export function BackupPage() {
  const { confirm, deliverFile, run, toast } = useFeedback();
  const [includePhotos, setIncludePhotos] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ backup: BackupFile; summary: BackupSummary; filename: string } | null>(null);
  const [storage, setStorage] = useState<{ persisted: boolean | null; usage: number | null; quota: number | null } | null>(null);

  const lastBackup = useLiveQuery(() => getLastBackupAt());
  const snapshots = useLiveQuery(() => listSnapshots());
  // Przy synchronizacji zastąpienie danych zaraz nadpisałby serwer, więc dostępne jest tylko scalanie.
  const synced = Boolean(useLiveQuery(async () => (await getSyncState()) ?? null));

  useEffect(() => {
    void (async () => {
      const [persisted, estimate] = await Promise.all([
        navigator.storage?.persisted?.() ?? null,
        navigator.storage?.estimate?.() ?? null,
      ]);
      setStorage({ persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null });
    })();
  }, []);

  const doExport = async () => {
    setBusy('export');
    await run(async () => {
      const { blob, filename } = await exportBackup({ includePhotos });
      deliverFile(blob, filename);
    });
    setBusy(null);
  };

  const pickFile = async (file: File) => {
    setBusy('parse');
    await run(async () => {
      const { backup, summary } = await parseBackup(await file.text());
      setPending({ backup, summary, filename: file.name });
    });
    setBusy(null);
  };

  const doRestore = async (mode: RestoreMode) => {
    if (!pending) return;
    if (mode === 'replace') {
      const ok = await confirm({
        title: 'Zastąpić dane kopią?',
        message: 'Rekordy, których nie ma w kopii, znikną z urządzenia. Stan sprzed operacji zostanie zapisany jako migawka.',
        confirmLabel: 'Zastąp dane',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy('restore');
    await run(async () => {
      await restoreBackup(pending.backup, mode);
      setPending(null);
      toast(mode === 'merge' ? 'Scalono dane z kopii' : 'Przywrócono dane z kopii');
    });
    setBusy(null);
  };

  const doRestoreSnapshot = async (id: string, createdAt: string) => {
    const ok = await confirm({
      title: 'Wrócić do migawki?',
      message: `Dane wrócą do stanu z ${formatInstant(createdAt)}. Obecny stan też zostanie zapisany jako migawka.`,
      confirmLabel: 'Przywróć',
      danger: true,
    });
    if (!ok) return;
    setBusy('restore');
    await run(async () => {
      await restoreSnapshot(id);
      toast('Przywrócono migawkę');
    });
    setBusy(null);
  };

  const exportClientsCsv = () =>
    run(async () => {
      const rows = (await clients.all()).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
      deliverFile(
        csvBlob(
          ['Nazwa', 'Rodzaj', 'Kontakt', 'Telefon', 'E-mail', 'NIP', 'Adres', 'Notatki'],
          rows.map((c) => [c.name, CLIENT_KINDS[c.kind], c.contactPerson, c.phone, c.email, c.nip, joinAddress(c.street, c.postalCode, c.city), c.notes]),
        ),
        'klienci.csv',
      );
    });

  const exportJobsCsv = () =>
    run(async () => {
      const [jobRows, clientRows, siteRows, paymentRows] = await Promise.all([jobs.all(), clients.all(), sites.all(), payments.all()]);
      const clientById = new Map(clientRows.map((c) => [c.id, c]));
      const siteById = new Map(siteRows.map((s) => [s.id, s]));
      const sorted = jobRows.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
      deliverFile(
        csvBlob(
          ['Numer', 'Status', 'Termin', 'Wykonano', 'Klient', 'Obiekt', 'Usługa', 'Szkodnik', 'Brutto PLN', 'Wpłacono PLN', 'Faktura'],
          sorted.map((j) => [
            j.number,
            STATUSES[j.status],
            j.start ? formatTerm(j.start) : '',
            j.completedOn ? formatDate(j.completedOn) : '',
            clientById.get(j.clientId)?.name ?? '',
            j.siteId ? (siteById.get(j.siteId)?.name ?? '') : '',
            j.title,
            j.pest,
            csvMoney(jobTotals(j.lines).gross),
            csvMoney(paidForJob(j.id, paymentRows)),
            j.invoiceNo,
          ]),
        ),
        'zlecenia.csv',
      );
    });

  return (
    <Page title="Kopie zapasowe" back="/wiecej">
      <div className="notice notice-info">
        <Icon name="database" />
        <span>
          Dane są tylko na tym urządzeniu. Utrata telefonu lub usunięcie aplikacji oznacza utratę danych, dlatego regularnie
          zapisuj kopię, np. w iCloud Drive.
        </span>
      </div>

      <Group title="Utwórz kopię" plain>
        <p className="field-hint">Ostatnia kopia: {lastBackup ? formatInstant(lastBackup) : 'jeszcze nie zrobiono'}</p>
        <label className="check">
          <input type="checkbox" checked={includePhotos} onChange={(e) => setIncludePhotos(e.target.checked)} />
          Dołącz zdjęcia (większy plik)
        </label>
        <button type="button" className="btn btn-primary btn-block" disabled={busy !== null} onClick={() => void doExport()}>
          <Icon name="file" /> {busy === 'export' ? 'Tworzę kopię…' : 'Utwórz kopię zapasową'}
        </button>
      </Group>

      <Group title="Przywróć z pliku" plain>
        <label className="btn btn-block btn-file">
          {busy === 'parse' ? 'Sprawdzam plik…' : 'Wybierz plik kopii (.json)'}
          <input
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void pickFile(file);
            }}
          />
        </label>
      </Group>

      <Group title="Migawki na urządzeniu">
        {snapshots && snapshots.length === 0 && (
          <Empty title="Brak migawek. Powstają automatycznie przed każdym przywróceniem." />
        )}
        {synced && snapshots && snapshots.length > 0 && (
          <p className="field-hint group-hint">Przy włączonej synchronizacji migawki służą tylko do odczytu. Dane z serwera nadpisałyby przywrócony stan.</p>
        )}
        {snapshots?.map((s) => (
          <Row
            key={s.id}
            onClick={synced ? undefined : () => void doRestoreSnapshot(s.id, s.createdAt)}
            title={formatInstant(s.createdAt)}
            sub={`${s.reason} · ${formatBytes(s.sizeBytes)}`}
          />
        ))}
      </Group>

      <Group title="Eksport do arkusza">
        <Row onClick={() => void exportClientsCsv()} icon="users" title="Klienci (CSV)" />
        <Row onClick={() => void exportJobsCsv()} icon="clipboard" title="Zlecenia (CSV)" />
      </Group>

      <Group title="Pamięć urządzenia">
        <Info label="Trwały zapis">
          {storage?.persisted === null || storage === null ? (
            'Nieznany'
          ) : storage.persisted ? (
            <Badge tone="ok">Włączony</Badge>
          ) : (
            <Badge tone="warn">Niepotwierdzony</Badge>
          )}
        </Info>
        {storage?.usage != null && <Info label="Zajęte">{formatBytes(storage.usage)}</Info>}
      </Group>
      {storage?.persisted === false && (
        <p className="field-hint">
          Na iPhonie zainstaluj aplikację przez „Do ekranu początkowego”. Tak zainstalowana aplikacja nie jest objęta automatycznym czyszczeniem danych witryn.
        </p>
      )}

      <Sheet open={Boolean(pending)} title="Sprawdzono plik kopii" onClose={() => setPending(null)}>
        {pending && (
          <>
            <p className="sheet-text break">{pending.filename}</p>
            <div className="group-body sheet-summary">
              <Info label="Utworzono">{formatInstant(pending.summary.exportedAt)}</Info>
              {SUMMARY_LABELS.map(([key, label]) => (
                <Info key={key} label={label}>{pending.summary.counts[key]}</Info>
              ))}
            </div>
            {!pending.summary.includesPhotos && <p className="field-hint">Ta kopia nie zawiera zdjęć. Zdjęcia z urządzenia zostaną bez zmian.</p>}
            <div className="btn-stack">
              <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void doRestore('merge')}>
                Scal z obecnymi danymi
              </button>
              <p className="field-hint">Dodaje brakujące rekordy. Nie nadpisuje nowszych.</p>
              {synced ? (
                <p className="field-hint">Przy włączonej synchronizacji kopię można tylko scalić.</p>
              ) : (
                <>
                  <button type="button" className="btn btn-danger-quiet" disabled={busy !== null} onClick={() => void doRestore('replace')}>
                    Zastąp obecne dane
                  </button>
                  <p className="field-hint">Ustawia dane dokładnie na stan z kopii.</p>
                </>
              )}
            </div>
          </>
        )}
      </Sheet>
    </Page>
  );
}

// ---------- Kosz ----------

const TRASH_LABELS: Record<RecordTableName, string> = {
  clients: 'Klient',
  sites: 'Obiekt',
  services: 'Usługa',
  jobs: 'Zlecenie',
  preparations: 'Preparat',
  stockMovements: 'Ruch magazynowy',
  payments: 'Wpłata',
  expenses: 'Koszt',
  attachments: 'Zdjęcie',
};

function trashTitle(table: RecordTableName, row: BaseRecord): string {
  const r = row as unknown as Record<string, unknown>;
  switch (table) {
    case 'jobs':
      return `${r.number} ${r.title}`;
    case 'payments':
      return `${(Number(r.amount) / 100).toFixed(2).replace('.', ',')} zł, ${formatDate(r.date as string)}`;
    case 'expenses':
      return `${r.category}, ${(Number(r.amount) / 100).toFixed(2).replace('.', ',')} zł`;
    case 'stockMovements':
      return `${r.type === 'zakup' ? 'Zakup' : 'Korekta'}, ${formatDate(r.date as string)}`;
    default:
      return String(r.name ?? '');
  }
}

export function TrashPage() {
  const { confirm, run, toast } = useFeedback();
  const items = useLiveQuery(async () => {
    const result: Array<{ table: RecordTableName; row: BaseRecord }> = [];
    for (const table of RECORD_TABLES) {
      const rows = await recordTable(table).toArray();
      for (const row of rows) if (row.deletedAt) result.push({ table, row });
    }
    return result.sort((a, b) => b.row.deletedAt!.localeCompare(a.row.deletedAt!));
  });

  const empty = async () => {
    const ok = await confirm({
      title: 'Opróżnić kosz?',
      message: 'Rekordy z kosza znikną na stałe. Pozostaną tylko w wcześniej utworzonych kopiach zapasowych.',
      confirmLabel: 'Opróżnij kosz',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      const removed = await emptyTrash();
      toast(`Usunięto na stałe: ${removed}`);
    });
  };

  return (
    <Page title="Kosz" back="/wiecej">
      {!items ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty icon="trash" title="Kosz jest pusty" />
      ) : (
        <>
          <Group>
            {items.map(({ table, row }) => (
              <div className="row" key={`${table}-${row.id}`}>
                <span className="row-main">
                  <span className="row-title">{trashTitle(table, row)}</span>
                  <span className="row-sub">{TRASH_LABELS[table]} · usunięto {formatInstant(row.deletedAt)}</span>
                </span>
                <button type="button" className="link" onClick={() => void run(() => restoreRecord(table, row.id))}>
                  Przywróć
                </button>
              </div>
            ))}
          </Group>
          <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => void empty()}>
            <Icon name="trash" /> Opróżnij kosz
          </button>
        </>
      )}
    </Page>
  );
}
