import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { normalizePrefix, orderCode, PREFIX_MAX, roman, visitCode } from '../data/codes';
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
import { RECORD_TABLES, recordTable, type RecordTableName } from '../data/db';
import { emptyTrash, restoreRecord } from '../data/domain';
import { orders, visits } from '../data/repo';
import {
  getAppSettings,
  getCompany,
  saveCompany,
  getLastBackupAt,
  getProfile,
  getRegion,
  getSyncState,
  ownedBy,
  localOrderCounter,
  saveAppSettings,
  saveProfile,
  saveRegion,
  setOrderCounter,
  type AppSettings,
} from '../data/settings';
import type { CompanySettings } from '../data/types';
import { isValidNip } from '../lib/validators';
import { isSyncConfigured } from '../data/sync/config';
import { BUILDINGS, INVOICES, orderAddress, PAY_NAMES, pestName } from '../data/texts';
import type { BaseRecord } from '../data/types';
import { csvBlob, csvMoney } from '../lib/csv';
import { formatDate, formatInstant } from '../lib/dates';
import { moneyToInput, parseMoney } from '../lib/money';
import { APP_BUILT, APP_VERSION, checkForUpdates } from '../lib/updates';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Empty, Field, Group, Info, Loading, Page, Row, Sheet } from '../ui/kit';

// ---------- Więcej ----------

export function MorePage() {
  const lastBackup = useLiveQuery(() => getLastBackupAt());
  const sync = useLiveQuery(async () => (await getSyncState()) ?? null);
  return (
    <Page title="Więcej">
      <Group title="Praca">
        <Row to="/koszty" icon="receipt" title="Koszty" sub="Autostrady, parkingi i inne wydatki z dnia" />
        <Row to="/kilometry" icon="car" title="Kilometry" sub="Przejazdy służbowe i prywatne, wydruk" />
        <Row to="/raporty" icon="chart" title="Raporty" sub="Dzień, tydzień, miesiąc, rozliczenie gotówki" />
        {sync && <Row to="/oddzialy" icon="building" title="Oddziały" sub="Technicy i zlecenia oddziałów" />}
      </Group>
      <Group title="Aplikacja">
        <Row to="/ustawienia" icon="gear" title="Ustawienia" sub="Imię, premia, zalecenia, treść SMS" />
        {isSyncConfigured && (
          <Row
            to="/konto"
            icon="users"
            title="Konto i synchronizacja"
            sub={sync ? `${sync.email}, ostatnio ${sync.lastSyncAt ? formatInstant(sync.lastSyncAt) : 'jeszcze nie'}` : 'Wyłączona'}
          />
        )}
        <Row
          to="/kopie"
          icon="database"
          title="Kopie zapasowe"
          sub={lastBackup ? `Ostatnia: ${formatInstant(lastBackup)}` : 'Nie zrobiono jeszcze kopii'}
        />
        <Row to="/kosz" icon="trash" title="Kosz" />
      </Group>
      <UpdatesGroup />
      <p className="about">
        {sync
          ? 'Dane są na tym urządzeniu i w zaszyfrowanej kopii na serwerze firmy. Aplikacja działa bez internetu.'
          : 'Wszystkie dane są zapisane wyłącznie na tym urządzeniu. Aplikacja działa bez internetu.'}
      </p>
    </Page>
  );
}

/** Wersja aplikacji, ręczne sprawdzenie aktualizacji i jak zainstalować aplikację na telefonie lub komputerze. */
function UpdatesGroup() {
  const { toast } = useFeedback();
  const [checking, setChecking] = useState(false);
  const built = APP_BUILT ? formatInstant(APP_BUILT) : '';
  const check = async () => {
    setChecking(true);
    const result = await checkForUpdates();
    setChecking(false);
    toast(
      result === 'nowa'
        ? 'Pobrano nową wersję. Dotknij „Odśwież” na dole ekranu.'
        : result === 'aktualna'
          ? 'Masz najnowszą wersję.'
          : result === 'offline'
            ? 'Brak internetu. Sprawdzę, gdy wróci połączenie.'
            : 'Ta przeglądarka nie obsługuje aktualizacji w tle. Zainstaluj aplikację.',
    );
  };
  return (
    <Group title="Aktualizacje">
      <Info label="Wersja">{built ? `${APP_VERSION}, z ${built}` : APP_VERSION}</Info>
      <div className="group-pad">
        <p className="field-hint">
          Zainstalowana aplikacja sama pobiera nowe wersje z GitHuba, bez ponownej instalacji i bez utraty danych. Sprawdza je przy
          uruchomieniu, co 15 minut i po powrocie do aplikacji. Gdy nowa wersja jest gotowa, na dole ekranu pojawia się „Odśwież”.
        </p>
        <p className="field-hint">
          Instalacja: na iPhonie w Safari „Udostępnij” → „Do ekranu początkowego”; na Androidzie w Chrome menu ⋮ → „Zainstaluj aplikację”;
          na komputerze w Chrome lub Edge ikona instalacji na końcu paska adresu.
        </p>
        <button type="button" className="btn btn-block" disabled={checking} onClick={() => void check()}>
          <Icon name="refresh" /> {checking ? 'Sprawdzam…' : 'Sprawdź aktualizacje'}
        </button>
      </div>
    </Group>
  );
}

// ---------- Ustawienia ----------

function ListEditor(props: { label: string; items: string[]; onChange: (items: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="field">
      <span className="field-label">{props.label}</span>
      <div className="list-editor">
        {props.items.map((item, i) => (
          <div key={`${item}-${i}`} className="list-editor-row">
            <span>{item}</span>
            <button type="button" className="icon-btn" aria-label={`Usuń: ${item}`} onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}>
              <Icon name="close" size={18} />
            </button>
          </div>
        ))}
      </div>
      <div className="inline-add">
        <input value={draft} placeholder={props.placeholder} onChange={(e) => setDraft(e.target.value)} />
        <button
          type="button"
          className="btn btn-sm"
          disabled={!draft.trim()}
          onClick={() => {
            props.onChange([...props.items, draft.trim()]);
            setDraft('');
          }}
        >
          Dodaj
        </button>
      </div>
    </div>
  );
}

/** 1 zlecenie nie ma, 3 zlecenia nie mają, 5 zleceń nie ma. */
function ordersWithout(n: number): string {
  if (n === 1) return 'zlecenie nie ma';
  const few = n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14);
  return few ? 'zlecenia nie mają' : 'zleceń nie ma';
}

function SettingsForm(props: {
  settings: AppSettings;
  company: CompanySettings;
  name: string;
  synced: boolean;
  readOnly: boolean;
  counter: number;
  prefix: string;
}) {
  const { confirm, run, toast } = useFeedback();
  const [prefix, setPrefix] = useState(props.prefix);
  const [s, setS] = useState(props.settings);
  const [company, setCompany] = useState(props.company);
  const setC = (patch: Partial<CompanySettings>) => setCompany((prev) => ({ ...prev, ...patch }));
  const nipError = company.nip.trim() && !isValidNip(company.nip) ? 'NIP jest niepoprawny' : undefined;
  const [name, setName] = useState(props.name);
  const [bonus, setBonus] = useState(moneyToInput(props.settings.thirdVisitBonus));
  const [next, setNext] = useState(String(props.counter + 1));
  const set = (patch: Partial<AppSettings>) => setS((prev) => ({ ...prev, ...patch }));
  const bonusValue = parseMoney(bonus);
  const nextValue = Number(next);
  const valid = bonusValue !== null && Number.isInteger(nextValue) && nextValue > 0 && s.vatRate >= 0 && !nipError;

  const save = () =>
    run(async () => {
      await saveRegion({ prefix });
      if (prefix) await offerPrefixForOldOrders(prefix);
      if (props.readOnly) {
        toast('Zapisano prefiks regionu');
        return;
      }
      if (!props.synced) await saveProfile({ ...(await getProfile()), name: name.trim() });
      await saveAppSettings({ ...s, bossName: s.bossName.trim(), thirdVisitBonus: bonusValue! });
      await saveCompany({
        ...company,
        taxpayerName: (company.taxpayerName ?? '').trim(),
        nip: company.nip.trim(),
        street: company.street.trim(),
        postalCode: company.postalCode.trim(),
        city: company.city.trim(),
      });
      if (nextValue - 1 > props.counter) await setOrderCounter(nextValue - 1);
      toast('Zapisano ustawienia');
    });

  /** Zlecenia przyjęte przed ustawieniem prefiksu dostają go za zgodą, tylko własne. */
  const offerPrefixForOldOrders = async (value: string) => {
    const userId = (await getProfile()).userId;
    const old = (await orders.all()).filter((o) => !o.prefix && ownedBy(o.ownerId, userId, true));
    if (old.length === 0) return;
    const ok = await confirm({
      title: `Nadać prefiks ${value} wcześniejszym zleceniom?`,
      message: `${old.length} ${ordersWithout(old.length)} prefiksu, np. ${orderCode(old[0])}. Po zmianie: ${orderCode({ ...old[0], prefix: value })}. Numery zostają te same.`,
      confirmLabel: 'Nadaj prefiks',
    });
    if (!ok) return;
    for (const o of old) await orders.update(o.id, { prefix: value });
  };

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save();
      }}
    >
      <fieldset>
        <legend>Region i kody zleceń</legend>
        <Field
          label="Prefiks regionu"
          hint={`Litery, do ${PREFIX_MAX} znaków, np. LDZ. Nowe zlecenia dostaną kod ${orderCode({ number: props.counter + 1, prefix })}, a ich zabiegi ${visitCode({ number: props.counter + 1, prefix }, 1)}, ${visitCode({ number: props.counter + 1, prefix }, 2)} itd. Ustawienie tego urządzenia.`}
        >
          <input value={prefix} maxLength={PREFIX_MAX} autoCapitalize="characters" placeholder="Np. LDZ" onChange={(e) => setPrefix(normalizePrefix(e.target.value))} />
        </Field>
      </fieldset>

      {props.readOnly && <p className="notice notice-info">Pozostałe ustawienia firmy zmienia szef. Zmiany docierają tu przy synchronizacji.</p>}
      <fieldset disabled={props.readOnly}>
        <legend>Rozliczenie</legend>
        <Field label="Twoje imię" hint={props.synced ? 'Przy synchronizacji imię pochodzi z konta.' : 'Pojawia się w raportach i danych dla centrali.'}>
          <input value={name} disabled={props.synced} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
        </Field>
        <Field label="Gotówkę rozliczam z (dopełniacz)" hint="W raporcie: „Wynik gotówka dla Piotrka”.">
          <input value={s.bossName} onChange={(e) => set({ bossName: e.target.value })} />
        </Field>
        <div className="form-row">
          <Field label="Premia za 3. zabieg (zł)" error={bonusValue === null ? 'Podaj kwotę' : undefined}>
            <input inputMode="decimal" value={bonus} onChange={(e) => setBonus(e.target.value)} />
          </Field>
          <Field label="VAT (%)">
            <input inputMode="numeric" value={String(s.vatRate)} onChange={(e) => set({ vatRate: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          </Field>
        </div>
        <Field label="Następny numer zlecenia" hint={`Ostatni nadany: ${orderCode({ number: props.counter, prefix })}. Numer można tylko podnieść; numery nie powtarzają się w całej firmie.`}>
          <input inputMode="numeric" value={next} onChange={(e) => setNext(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </fieldset>

      <fieldset disabled={props.readOnly}>
        <legend>Dane firmy do kilometrówki</legend>
        <p className="field-hint">Nagłówek „Dane podatnika” w ewidencji przebiegu pojazdu dla celów VAT.</p>
        <Field label="Nazwa podatnika" hint="Np. P.H.U. Nazwa Imię Nazwisko. Gdy puste, na wydruku jest Pogromcy Insektów.">
          <input value={company.taxpayerName ?? ''} autoComplete="organization" onChange={(e) => setC({ taxpayerName: e.target.value })} />
        </Field>
        <Field label="Adres (ulica i numer)">
          <input value={company.street} autoComplete="street-address" onChange={(e) => setC({ street: e.target.value })} />
        </Field>
        <div className="form-row">
          <Field label="Kod pocztowy">
            <input value={company.postalCode} inputMode="numeric" autoComplete="postal-code" onChange={(e) => setC({ postalCode: e.target.value })} />
          </Field>
          <Field label="Miejscowość">
            <input value={company.city} autoComplete="address-level2" onChange={(e) => setC({ city: e.target.value })} />
          </Field>
        </div>
        <Field label="NIP" error={nipError}>
          <input value={company.nip} inputMode="numeric" onChange={(e) => setC({ nip: e.target.value })} />
        </Field>
      </fieldset>

      <fieldset disabled={props.readOnly}>
        <legend>Zabieg</legend>
        <ListEditor label="Zalecenia dla klienta" items={s.recommendations} placeholder="Nowe zalecenie" onChange={(recommendations) => set({ recommendations })} />
        <ListEditor label="Rodzaje zabiegu" items={s.treatments} placeholder="Np. Oprysk ciśnieniowy" onChange={(treatments) => set({ treatments })} />
        <ListEditor label="Miejsca" items={s.places} placeholder="Np. listwy" onChange={(places) => set({ places })} />
      </fieldset>

      <fieldset disabled={props.readOnly}>
        <legend>Wiadomości SMS</legend>
        <Field label="Przypomnienie o terminie" hint="Wstawki: {data}, {godzina}, {adres}, {numer}.">
          <textarea rows={4} value={s.reminderTemplate} onChange={(e) => set({ reminderTemplate: e.target.value })} />
        </Field>
        <Field label="Początek wiadomości po zabiegu">
          <textarea rows={2} value={s.finishGreeting} onChange={(e) => set({ finishGreeting: e.target.value })} />
        </Field>
      </fieldset>

      <button type="submit" className="btn btn-primary btn-block" disabled={!props.readOnly && !valid}>
        {props.readOnly ? 'Zapisz prefiks' : 'Zapisz ustawienia'}
      </button>
    </form>
  );
}

export function SettingsPage() {
  const [loaded, setLoaded] = useState<{
    settings: AppSettings;
    company: CompanySettings;
    name: string;
    synced: boolean;
    readOnly: boolean;
    counter: number;
    prefix: string;
  }>();
  // Formularz startuje z jednego odczytu, żeby synchronizacja nie resetowała pól w trakcie edycji.
  useEffect(() => {
    void (async () => {
      const sync = await getSyncState();
      setLoaded({
        settings: await getAppSettings(),
        company: await getCompany(),
        name: (await getProfile()).name,
        synced: Boolean(sync),
        // Ustawienia firmy na serwerze zmienia tylko szef, więc technik ich nie edytuje.
        readOnly: Boolean(sync && sync.role && sync.role !== 'owner'),
        counter: await localOrderCounter(),
        prefix: (await getRegion()).prefix,
      });
    })();
  }, []);
  return (
    <Page title="Ustawienia" back="/wiecej">
      {loaded ? <SettingsForm {...loaded} /> : <Loading />}
    </Page>
  );
}

// ---------- Kopie zapasowe ----------

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

const SUMMARY_LABELS: Array<[keyof BackupSummary['counts'], string]> = [
  ['orders', 'Zlecenia'],
  ['visits', 'Zabiegi'],
  ['trips', 'Przejazdy'],
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

  const exportOrdersCsv = () =>
    run(async () => {
      const [orderRows, visitRows] = await Promise.all([orders.all(), visits.all()]);
      const orderById = new Map(orderRows.map((o) => [o.id, o]));
      const rows = visitRows
        .filter((v) => orderById.has(v.orderId))
        .sort((x, y) => (x.doneOn ?? x.start ?? '').localeCompare(y.doneOn ?? y.start ?? ''));
      deliverFile(
        csvBlob(
          ['Kod zlecenia', 'Kod zabiegu', 'Numer', 'Zabieg', 'Termin', 'Wykonano', 'Technik', 'Klient', 'Telefon', 'Adres', 'Budynek', 'Szkodnik', 'Faktura', 'Forma płatności', 'Kwota PLN', 'Premia PLN', 'Kod pink'],
          rows.map((v) => {
            const o = orderById.get(v.orderId)!;
            return [
              orderCode(o),
              visitCode(o, v.seq),
              o.number,
              v.seq,
              v.start ? formatDate(v.start) : '',
              v.doneOn ? formatDate(v.doneOn) : '',
              v.technicianName,
              o.clientName,
              o.phones[0]?.number ?? '',
              orderAddress(o),
              BUILDINGS[o.building],
              pestName(o),
              INVOICES[o.invoice],
              v.payMethod ? PAY_NAMES[v.payMethod] : '',
              v.amount !== null ? csvMoney(v.amount) : '',
              csvMoney(v.bonus),
              o.pink ? 'tak' : '',
            ];
          }),
        ),
        'zlecenia.csv',
      );
    });

  return (
    <Page title="Kopie zapasowe" back="/wiecej">
      <div className="notice notice-info">
        <Icon name="database" />
        <span>
          {synced
            ? 'Dane są też w zaszyfrowanej kopii na serwerze. Własna kopia chroni przed pomyłkowym usunięciem i utratą hasła szyfrowania.'
            : 'Dane są tylko na tym urządzeniu. Utrata telefonu lub usunięcie aplikacji oznacza utratę danych, dlatego regularnie zapisuj kopię, np. w iCloud Drive.'}
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
        <Row onClick={() => void exportOrdersCsv()} icon="clipboard" title="Zlecenia i zabiegi (CSV)" />
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
  orders: 'Zlecenie',
  visits: 'Zabieg',
  trips: 'Przejazd',
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
    case 'orders':
      return `${orderCode(r as unknown as { number: number; prefix?: string })} ${r.clientName}`;
    case 'visits':
      return `Zabieg ${roman(Number(r.seq))}${r.doneOn ? `, ${formatDate(r.doneOn as string)}` : ''}`;
    case 'trips':
      return `${r.from} → ${r.to}, ${formatDate(r.date as string)}`;
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
