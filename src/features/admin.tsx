import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { clearRecoveryLink, takeLinkInfo, takeRecoveryLink, tokenUser } from '../lib/auth-link';
import { syncInBackground } from '../data/sync/runner';
import { normalizePrefix, PREFIX_MAX } from '../data/codes';
import { companyText, regionRanking, regionData, type RegionRef } from '../data/company';
import { buildReport, formatPln, periodOf, shiftPeriod, type Period, type PeriodKind } from '../data/reports';
import { expenses, orders, trips, visits } from '../data/repo';
import { getOwnBranch, setViewScope } from '../data/scope';
import { COMPANY_NAME, getDataKey, getRegions, getSyncState, saveRegions, setSyncState, type RegionInfo } from '../data/settings';
import { enterRegion, RegionSwitcher } from './regions';
import type { SyncState } from '../data/types';
import { todayWarsaw } from '../lib/dates';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Empty, Field, Group, Info, Loading, Page, Row, ScopeBannerContext, Sheet, Stat } from '../ui/kit';
import { useContactActions } from './common';

const supabaseApi = () => import('../data/sync/supabase');

// ---------- Blokada panelu ----------

/** Panel odblokowany na 15 minut od ostatniego użycia; po zamknięciu aplikacji znowu prosi o hasło. */
const UNLOCK_MS = 15 * 60 * 1000;
let unlockedUntil = 0;

function isUnlocked(): boolean {
  return Date.now() < unlockedUntil;
}

function touchUnlock(): void {
  if (isUnlocked()) unlockedUntil = Date.now() + UNLOCK_MS;
}

export const RECOVERY_QUESTIONS = ['Ulubiona gra', 'Nazwisko panieńskie matki', 'Imię pierwszego psa'] as const;

/** Adres, na który aplikacja wraca z linków w e-mailach. */
const appUrl = () => `${window.location.origin}${window.location.pathname}`;

/** Login admina tego urządzenia: e-mail zapisany przy połączeniu albo aktualny z sesji (po zmianie adresu). */
async function accountEmails(state: SyncState): Promise<string[]> {
  const current = await (await supabaseApi()).currentUser().catch(() => null);
  return [state.email, current?.userId === state.userId ? current.email : ''].filter(Boolean).map((e) => e.toLowerCase());
}

/** Trzy odpowiedzi na pytania pomocnicze. Wielkość liter i nadmiarowe spacje nie mają znaczenia. */
function QuestionsForm(props: { submitLabel: string; hint?: string; onSubmit: (answers: [string, string, string]) => Promise<unknown> }) {
  const [answers, setAnswers] = useState<[string, string, string]>(['', '', '']);
  const [busy, setBusy] = useState(false);
  const ready = answers.every((a) => a.trim().length >= 2);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        try {
          await props.onSubmit(answers);
        } finally {
          setBusy(false);
        }
      }}
    >
      {props.hint && <p className="field-hint">{props.hint}</p>}
      {RECOVERY_QUESTIONS.map((q, i) => (
        <Field key={q} label={q}>
          <input
            value={answers[i]}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)) as [string, string, string])}
          />
        </Field>
      ))}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !ready}>
        {busy ? 'Sprawdzam…' : props.submitLabel}
      </button>
    </form>
  );
}

/** Po potwierdzeniu pytaniami pobieramy dane od nowa: w czasie blokady urządzenie widziało tylko swój region. */
async function refetchAfterRecovery(): Promise<void> {
  const latest = await getSyncState();
  if (latest) await setSyncState({ ...latest, regionsTagged: false });
  void syncInBackground().catch(() => undefined);
}

/** Logowanie do panelu: login (e-mail konta admina) i hasło, sprawdzane na serwerze. */
function AdminLogin(props: { state: SyncState; onUnlocked: () => void }) {
  const { run, toast } = useFeedback();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'login' | 'reset' | 'questions'>('login');

  const checkEmail = async () => {
    // Inny e-mail podmieniłby konto zalogowane na urządzeniu, więc sprawdzamy go przed wysłaniem czegokolwiek.
    if (!(await accountEmails(props.state)).includes(email.trim().toLowerCase())) {
      toast('To nie jest login admina tego urządzenia.', { tone: 'error' });
      return false;
    }
    return true;
  };

  const submit = () =>
    run(async () => {
      if (!(await checkEmail())) return;
      setBusy(true);
      try {
        const api = await supabaseApi();
        const user = await api.signIn(email.trim(), password);
        if (user.userId !== props.state.userId) throw new Error('Nieprawidłowe konto.');
        setPassword('');
        // Po prośbie o reset hasła uprawnienia admina czekają na odpowiedzi na pytania pomocnicze.
        const status = await api.recoveryStatus();
        if (status.pending) {
          setMode('questions');
          return;
        }
        unlockedUntil = Date.now() + UNLOCK_MS;
        props.onUnlocked();
      } finally {
        setBusy(false);
      }
    });

  const sendReset = () =>
    run(async () => {
      if (!(await checkEmail())) return;
      setBusy(true);
      try {
        await (await supabaseApi()).requestPasswordReset(email.trim(), appUrl());
        toast(`Wysłano link na ${email.trim()}. Otwórz go na tym urządzeniu.`);
        setMode('login');
      } finally {
        setBusy(false);
      }
    });

  if (mode === 'questions') {
    return (
      <div className="card">
        <QuestionsForm
          submitLabel="Potwierdź i wejdź"
          hint="Od ostatniego logowania ktoś prosił o reset hasła tego konta. Uprawnienia admina wrócą po odpowiedzi na pytania pomocnicze."
          onSubmit={(answers) =>
            run(async () => {
              const result = await (await supabaseApi()).verifyRecoveryAnswers(answers);
              if (result === 'ok' || result === 'brak') {
                if (result === 'ok') await refetchAfterRecovery();
                unlockedUntil = Date.now() + UNLOCK_MS;
                props.onUnlocked();
              } else {
                toast(result === 'blokada' ? 'Za dużo błędnych odpowiedzi. Spróbuj za godzinę.' : 'Odpowiedzi się nie zgadzają.', { tone: 'error' });
              }
            })
          }
        />
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <form
        className="form card"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim()) void sendReset();
        }}
      >
        <p className="field-hint">
          Wyślemy link do ustawienia nowego hasła na e-mail admina. Po otwarciu linku aplikacja zapyta też o odpowiedzi na pytania
          pomocnicze.
        </p>
        <Field label="Login (e-mail)">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !email.trim()}>
          {busy ? 'Wysyłam…' : 'Wyślij link'}
        </button>
        <button type="button" className="link" onClick={() => setMode('login')}>
          Wróć do logowania
        </button>
      </form>
    );
  }

  return (
    <form
      className="form card"
      onSubmit={(e) => {
        e.preventDefault();
        if (email.trim() && password) void submit();
      }}
    >
      <p className="field-hint">Panel admina jest chroniony. Podaj login (e-mail konta admina) i hasło. Wymaga internetu.</p>
      <Field label="Login (e-mail)">
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Hasło">
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !email.trim() || !password}>
        {busy ? 'Sprawdzam…' : 'Wejdź do panelu'}
      </button>
      <button type="button" className="link" onClick={() => setMode('reset')}>
        Nie pamiętam hasła
      </button>
    </form>
  );
}

/** Wspólna bramka: tylko konto admina (szef) z synchronizacją, po podaniu loginu i hasła. */
function useAdminGate(): { state: SyncState | null | undefined; unlocked: boolean; unlock: () => void } {
  const state = useLiveQuery(async () => (await getSyncState()) ?? null);
  const [, setTick] = useState(0);
  return { state, unlocked: isUnlocked(), unlock: () => setTick((t) => t + 1) };
}

function NotAdmin() {
  return (
    <Page title="Panel admina" back="/wiecej">
      <Empty icon="users" title="Panel admina jest dostępny tylko na koncie admina firmy">
        <p className="field-hint">Konta techników są przypisane do swojego regionu i nie widzą innych regionów.</p>
      </Empty>
    </Page>
  );
}

// ---------- Regiony ----------

/** Regiony z serwera (oddziały) połączone z prefiksami ze wspólnych ustawień firmy. */
function useRegions(state: SyncState | null | undefined) {
  const { run, toast } = useFeedback();
  const saved = useLiveQuery(() => getRegions());
  const [server, setServer] = useState<Array<{ id: string; name: string }> | null>(null);
  const [members, setMembers] = useState<Record<string, number>>({});

  const load = async () => {
    if (!state?.orgId) return;
    const api = await supabaseApi();
    const [branches, people, access] = await Promise.all([
      api.listBranches(state.orgId),
      api.listMembers(state.orgId),
      api.listMemberBranches(state.orgId),
    ]);
    setServer(branches);
    // Konta z dostępem do regionu (jeden e-mail może być w kilku regionach); bez migracji: aktywny region konta.
    const approved = new Set(people.filter((m) => m.approved).map((m) => m.userId));
    const pairs = access.length ? access : people.filter((m) => m.branchId).map((m) => ({ userId: m.userId, branchId: m.branchId! }));
    const count: Record<string, number> = {};
    for (const { userId, branchId } of pairs) if (approved.has(userId)) count[branchId] = (count[branchId] ?? 0) + 1;
    setMembers(count);
  };

  useEffect(() => {
    // Bez internetu zostają regiony zapisane w ustawieniach firmy.
    void load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.orgId]);

  const regions: RegionRef[] = useMemo(() => {
    const info = saved ?? {};
    const list = server ?? Object.entries(info).map(([id, r]) => ({ id, name: r.name }));
    return list.map((b) => ({ id: b.id, name: b.name || info[b.id]?.name || 'Region', prefix: info[b.id]?.prefix ?? '' }));
  }, [saved, server]);

  const savePrefix = (id: string, name: string, prefix: string) =>
    run(async () => {
      const all = await getRegions();
      const taken = Object.entries(all).find(([other, r]) => other !== id && prefix && r.prefix === prefix);
      if (taken) {
        toast(`Prefiks ${prefix} ma już region ${taken[1].name}.`, { tone: 'error' });
        return;
      }
      await saveRegions({ ...all, [id]: { name, prefix } });
      toast(prefix ? `Region ${name}: prefiks ${prefix}` : `Region ${name}: bez prefiksu`);
    });

  /** Nowy kod weryfikacyjny do regionu (jednorazowy, ważny 14 dni). Wymaga klucza firmy na tym urządzeniu. */
  const newCode = async (branchId: string): Promise<string> => {
    if (!state?.orgId) throw new Error('Brak konta firmy.');
    const key = await getDataKey();
    if (!key) throw new Error('Brak klucza firmy na tym urządzeniu. Odblokuj synchronizację w Koncie.');
    return (await supabaseApi()).createInvite(state.orgId, branchId, key);
  };

  /** Tworzy region: nazwa i prefiks w panelu, region na serwerze i kod do dołączenia. */
  const createRegion = async (name: string, prefix: string): Promise<{ id: string; name: string; code: string }> => {
    if (!state?.orgId) throw new Error('Brak konta firmy.');
    const all = await getRegions();
    const taken = Object.entries(all).find(([, r]) => prefix && r.prefix === prefix);
    if (taken) throw new Error(`Prefiks ${prefix} ma już region ${taken[1].name}.`);
    const id = await (await supabaseApi()).createBranch(state.orgId, name);
    await saveRegions({ ...(await getRegions()), [id]: { name, prefix } });
    const code = await newCode(id);
    await load();
    return { id, name, code };
  };

  const deleteRegion = (id: string) =>
    run(async () => {
      await (await supabaseApi()).deleteBranch(id);
      const all = await getRegions();
      delete all[id];
      await saveRegions(all);
      await load();
      // Aktywny region tego urządzenia mógł zniknąć.
      const latest = await getSyncState();
      if (latest?.branchId === id) await setSyncState({ ...latest, branchId: null, branchName: '', regionsTagged: false });
      toast('Region usunięty');
    });

  // Nazwy regionów z serwera trafiają też do ustawień firmy, żeby urządzenia znały je bez internetu.
  useEffect(() => {
    if (!server || !saved) return;
    const missing = server.filter((b) => saved[b.id]?.name !== b.name);
    if (missing.length === 0) return;
    const next: Record<string, RegionInfo> = { ...saved };
    for (const b of missing) next[b.id] = { name: b.name, prefix: saved[b.id]?.prefix ?? '' };
    void saveRegions(next);
  }, [server, saved]);

  return { regions, members, loaded: saved !== undefined, online: server !== null, savePrefix, createRegion, newCode, deleteRegion };
}

function PrefixEditor(props: {
  region: RegionRef;
  members: number;
  active: boolean;
  onSave: (prefix: string) => void;
  onCode: () => void;
  onDelete: () => void;
}) {
  const [prefix, setPrefix] = useState(props.region.prefix);
  useEffect(() => setPrefix(props.region.prefix), [props.region.prefix]);
  return (
    <div className="region-edit">
      <div className="region-edit-name">
        <strong>
          {props.region.name} {props.active && <Badge tone="ok">Twój aktywny</Badge>}
        </strong>
        <span className="row-sub">Konta: {props.members}</span>
        <span className="region-actions">
          <button type="button" className="link" onClick={props.onCode}>
            Nowy kod
          </button>
          <button type="button" className="link link-danger" onClick={props.onDelete}>
            Usuń region
          </button>
        </span>
      </div>
      <input
        className="input-short"
        value={prefix}
        maxLength={PREFIX_MAX}
        placeholder="Prefiks"
        aria-label={`Prefiks regionu ${props.region.name}`}
        autoCapitalize="characters"
        onChange={(e) => setPrefix(normalizePrefix(e.target.value))}
      />
      <button type="button" className="btn btn-sm" disabled={prefix === props.region.prefix} onClick={() => props.onSave(prefix)}>
        Zapisz
      </button>
    </div>
  );
}

/** Dane do dołączenia do regionu: login, hasło, kod weryfikacyjny. */
function JoinDetails(props: { regionName: string; code: string; onEnter?: () => void; onClose: () => void }) {
  const { share } = useContactActions();
  const text = [
    `Dołączenie do aplikacji ${COMPANY_NAME}, region ${props.regionName}.`,
    '1. Otwórz https://mariana1112.github.io/ddd-firma/ (na iPhonie w Safari) i dodaj do ekranu początkowego.',
    '2. Login: załóż konto swoim e-mailem i hasłem albo zaloguj się istniejącym (jeden e-mail może być w kilku regionach).',
    `3. Kod weryfikacyjny: ${props.code} (jednorazowy, ważny 14 dni).`,
    '4. Hasło firmy podam osobiście.',
  ].join('\n');
  return (
    <div className="form">
      <Group>
        <Info label="Login">E-mail osoby z regionu: zakłada konto przy pierwszym logowaniu albo loguje się istniejącym</Info>
        <Info label="Hasło">Hasło firmy (szyfrowania): przekaż osobiście, nigdy razem z kodem</Info>
        <Info label="Kod weryfikacyjny">
          <strong className="invite-code">{props.code}</strong>
        </Info>
        <Info label="Ważność">Jednorazowy, 14 dni; po 5 złych hasłach przestaje działać</Info>
      </Group>
      <button type="button" className="btn btn-primary btn-block" onClick={() => void share(text, `Region ${props.regionName}`)}>
        <Icon name="share" /> Wyślij instrukcję i kod (bez hasła)
      </button>
      {props.onEnter && (
        <button type="button" className="btn btn-block" onClick={props.onEnter}>
          <Icon name="building" /> Wejdź do tego regionu na tym telefonie
        </button>
      )}
      <button type="button" className="btn btn-block" onClick={props.onClose}>
        Gotowe
      </button>
    </div>
  );
}

function NewRegionForm(props: { disabled: boolean; onCreate: (name: string, prefix: string) => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form group-pad"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        try {
          await props.onCreate(name.trim(), prefix);
          setName('');
          setPrefix('');
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-row">
        <Field label="Nowy region">
          <input value={name} placeholder="Np. Pomorskie" onChange={(e) => setName(e.target.value)} disabled={props.disabled} />
        </Field>
        <Field label="Prefiks">
          <input
            className="input-short"
            value={prefix}
            maxLength={PREFIX_MAX}
            placeholder="GDA"
            autoCapitalize="characters"
            onChange={(e) => setPrefix(normalizePrefix(e.target.value))}
            disabled={props.disabled}
          />
        </Field>
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || props.disabled || !name.trim()}>
        <Icon name="plus" /> {busy ? 'Tworzę…' : 'Utwórz region i dane do dołączenia'}
      </button>
    </form>
  );
}

// ---------- Strona główna panelu ----------

const regionLabel = (r: RegionRef) => (r.prefix ? `${r.name} (${r.prefix})` : r.name);

const periodName = (p: Period) => {
  const d = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
  return `${d(p.from)} – ${d(p.to)}`;
};

export function AdminPage() {
  const gate = useAdminGate();
  const { share } = useContactActions();
  const [params, setParams] = useSearchParams();
  const region = params.get('region') ?? 'all';
  const [kind, setKind] = useState<PeriodKind>('tydzien');
  const [period, setPeriod] = useState<Period>(() => periodOf('tydzien', todayWarsaw()));
  const [joinInfo, setJoinInfo] = useState<{ id: string; name: string; code: string } | null>(null);
  const { confirm, run, toast } = useFeedback();
  const regionsApi = useRegions(gate.state);
  // Dane całej firmy, bez filtra regionu z ekranów technika.
  const data = useLiveQuery(async () => ({
    visits: await visits.allRegions(),
    orders: await orders.allRegions(),
    expenses: await expenses.allRegions(),
    trips: await trips.allRegions(),
  }));

  useEffect(() => touchUnlock());

  if (gate.state === undefined) return <Loading />;
  if (!gate.state || gate.state.role !== 'owner') return <NotAdmin />;
  if (!gate.unlocked) {
    return (
      <Page title="Panel admina" back="/wiecej">
        <AdminLogin state={gate.state} onUnlocked={gate.unlock} />
      </Page>
    );
  }
  if (!data || !regionsApi.loaded) return <Loading />;

  const own = getOwnBranch();
  const ranking = regionRanking(period, data, regionsApi.regions, own);
  const total = buildReport(period, data);
  const selected = regionsApi.regions.find((r) => r.id === region);
  const report = selected ? buildReport(period, regionData(data, selected.id, own)) : total;
  const setRegion = (id: string) => setParams(id === 'all' ? {} : { region: id }, { replace: true });
  const scoped = (path: string) => `/admin/${path}${region === 'all' ? '' : `?region=${region}`}`;
  const changeKind = (k: PeriodKind) => {
    setKind(k);
    setPeriod(periodOf(k, todayWarsaw()));
  };

  return (
    <Page title="Panel admina" back="/wiecej">
      <div className="chips" role="group" aria-label="Region">
        <button type="button" className={region === 'all' ? 'chip active' : 'chip'} aria-pressed={region === 'all'} onClick={() => setRegion('all')}>
          Cała firma
        </button>
        {regionsApi.regions.map((r) => (
          <button key={r.id} type="button" className={region === r.id ? 'chip active' : 'chip'} aria-pressed={region === r.id} onClick={() => setRegion(r.id)}>
            {regionLabel(r)}
          </button>
        ))}
      </div>

      <div className="chips" role="group" aria-label="Okres">
        {(
          [
            ['tydzien', 'Tydzień'],
            ['miesiac', 'Miesiąc'],
          ] as Array<[PeriodKind, string]>
        ).map(([k, label]) => (
          <button key={k} type="button" className={kind === k ? 'chip active' : 'chip'} aria-pressed={kind === k} onClick={() => changeKind(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="month-nav">
        <button type="button" className="icon-btn" aria-label="Poprzedni okres" onClick={() => setPeriod(shiftPeriod(period, -1))}>
          <Icon name="left" />
        </button>
        <strong>{periodName(period)}</strong>
        <button type="button" className="icon-btn" aria-label="Następny okres" onClick={() => setPeriod(shiftPeriod(period, 1))}>
          <Icon name="chevron" />
        </button>
      </div>

      <div className="stats">
        <Stat label="Obrót" value={formatPln(report.turnover)} />
        <Stat label="Zabiegi" value={String(report.visits.length)} />
        <Stat label="Koszty z premiami" value={formatPln(report.costs + report.bonus)} />
        <Stat label="Wynik gotówka" value={formatPln(report.cashForBoss)} tone={report.cashForBoss < 0 ? 'danger' : 'ok'} />
        <Stat label="Km służbowo" value={`${report.km.sluzbowy} km`} />
        <Stat label="Km prywatnie" value={`${report.km.prywatny} km`} />
      </div>

      {region === 'all' && (
        <Group
          title="Ranking regionów (obrót)"
          action={
            <button type="button" className="link" onClick={() => void share(companyText(total, ranking), 'Podsumowanie firmy')}>
              Wyślij podsumowanie
            </button>
          }
        >
          {ranking.length === 0 && <Empty title="Brak regionów" />}
          {ranking.map((r, i) => (
            <Row
              key={r.id || 'bez'}
              onClick={r.id ? () => setRegion(r.id) : undefined}
              lead={<span className={`rank rank-${Math.min(i + 1, 4)}`}>{i + 1}</span>}
              title={regionLabel(r)}
              sub={`Zabiegi: ${r.visits} · koszty ${formatPln(r.report.costs + r.report.bonus)} · ${r.report.km.sluzbowy + r.report.km.prywatny} km`}
              meta={`Wynik gotówka ${formatPln(r.report.cashForBoss)}`}
              trailing={<strong className="num">{formatPln(r.report.turnover)}</strong>}
            />
          ))}
        </Group>
      )}

      <Group title={selected ? `Region ${regionLabel(selected)}` : 'Cała firma'}>
        <Row to={scoped('zlecenia')} icon="clipboard" title="Zlecenia" sub="Lista, wyszukiwanie, szczegóły" />
        <Row to={scoped('kalendarz')} icon="calendar" title="Kalendarz" sub="Zabiegi wszystkich techników" />
        <Row to={scoped('raporty')} icon="chart" title="Raporty" sub="Dzień, tydzień, miesiąc w formacie technika, PDF" />
        <Row to={scoped('kilometry')} icon="car" title="Kilometrówka" sub="Przejazdy i wydruk ewidencji" />
        <Row to={scoped('koszty')} icon="receipt" title="Koszty" sub="Koszty techników z regionu" />
      </Group>

      <Group title="Regiony i prefiksy">
        {!regionsApi.online && <p className="field-hint group-pad">Bez internetu: lista z ostatniego połączenia, dodawanie regionów niedostępne.</p>}
        {regionsApi.regions.length === 0 && <p className="field-hint group-pad">Nie ma jeszcze żadnego regionu.</p>}
        {regionsApi.regions.map((r) => (
          <PrefixEditor
            key={r.id}
            region={r}
            members={regionsApi.members[r.id] ?? 0}
            active={gate.state?.branchId === r.id}
            onSave={(prefix) => void regionsApi.savePrefix(r.id, r.name, prefix)}
            onCode={() => void run(async () => setJoinInfo({ id: r.id, name: r.name, code: await regionsApi.newCode(r.id) }))}
            onDelete={async () => {
              const ok = await confirm({
                title: `Usunąć region ${r.name}?`,
                message:
                  'Konta stracą dostęp do tego regionu, a kody do niego przestaną działać. Zlecenia regionu zostaną bez regionu i będzie je widział tylko admin.',
                confirmLabel: 'Usuń region',
                danger: true,
              });
              if (ok) await regionsApi.deleteRegion(r.id);
            }}
          />
        ))}
        <NewRegionForm
          disabled={!regionsApi.online}
          onCreate={(name, prefix) => run(async () => setJoinInfo(await regionsApi.createRegion(name, prefix)))}
        />
        <Row to="/oddzialy" icon="users" title="Technicy i zaproszenia" sub="Zatwierdzanie, przenoszenie między regionami, kody dołączenia" />
      </Group>

      {gate.state && <RegionSwitcher state={gate.state} />}

      <Sheet open={Boolean(joinInfo)} title={joinInfo ? `Region ${joinInfo.name}: dane do dołączenia` : ''} onClose={() => setJoinInfo(null)}>
        {joinInfo && (
          <JoinDetails
            regionName={joinInfo.name}
            code={joinInfo.code}
            onClose={() => setJoinInfo(null)}
            onEnter={
              gate.state?.branchId === joinInfo.id
                ? undefined
                : () =>
                    void run(async () => {
                      await enterRegion(gate.state!, joinInfo);
                      setJoinInfo(null);
                      toast(`Jesteś w regionie ${joinInfo.name}`);
                    })
            }
          />
        )}
      </Sheet>

      <Group title="Firma">
        <Row to="/ustawienia" icon="gear" title="Ustawienia firmy" sub="Premia, zalecenia, SMS, dane do kilometrówki" />
        <Row to="/admin/bezpieczenstwo" icon="gear" title="Login, hasło i pytania pomocnicze" sub="Zmiana danych logowania do panelu i odzyskiwania" />
        <Row to="/konto" icon="users" title="Konto admina" sub="Synchronizacja i wylogowanie" />
      </Group>
    </Page>
  );
}

// ---------- Ekrany technika w zakresie panelu ----------

let scopeToken = 0;

/**
 * Pokazuje zwykły ekran (zlecenia, kalendarz, raporty…) dla regionu wybranego w panelu albo całej firmy.
 * Zakres list ustawia się na czas wyświetlania; po wyjściu ekrany wracają do własnego regionu.
 */
export function AdminScoped({ children }: { children: ReactNode }) {
  const gate = useAdminGate();
  const [params] = useSearchParams();
  const region = params.get('region') ?? 'all';
  const regions = useLiveQuery(() => getRegions());
  const [token] = useState(() => ++scopeToken);
  setViewScope(region);
  useEffect(() => {
    touchUnlock();
    return () => {
      if (scopeToken === token) setViewScope(null);
    };
  }, [token]);

  if (gate.state === undefined || regions === undefined) return <Loading />;
  if (!gate.state || gate.state.role !== 'owner') return <NotAdmin />;
  if (!gate.unlocked) return <Navigate to="/admin" replace />;
  const name = region === 'all' ? 'Cała firma' : regions[region] ? regionLabel({ id: region, ...regions[region] }) : 'Region';
  const banner = (
    <Link className="scope-banner" to={region === 'all' ? '/admin' : `/admin?region=${region}`}>
      <Icon name="back" size={16} /> Panel admina · {name}
    </Link>
  );
  return (
    <ScopeBannerContext.Provider value={banner}>
      <Fragment key={region}>{children}</Fragment>
    </ScopeBannerContext.Provider>
  );
}

// ---------- Bezpieczeństwo konta admina ----------

/** Zmiana loginu (e-mail), hasła i odpowiedzi na pytania pomocnicze. Dostępne po odblokowaniu panelu. */
export function AdminSecurityPage() {
  const gate = useAdminGate();
  const { run, toast } = useFeedback();
  const [info] = useState(() => takeLinkInfo());
  const [status, setStatus] = useState<{ configured: boolean } | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    touchUnlock();
    void supabaseApi()
      .then((api) => api.recoveryStatus())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (gate.state === undefined) return <Loading />;
  if (!gate.state || gate.state.role !== 'owner') return <NotAdmin />;
  if (!gate.unlocked) return <Navigate to="/admin" replace />;
  const state = gate.state;
  const passwordError =
    next && next.length < 12 ? 'Co najmniej 12 znaków' : next && next === current ? 'Nowe hasło musi być inne niż obecne' : undefined;
  const repeatError = repeat && repeat !== next ? 'Hasła się różnią' : undefined;

  return (
    <Page title="Login i hasło" back="/admin">
      {info && <p className="notice notice-info">{info}</p>}
      <Group title="Login">
        <Info label="E-mail">{state.email}</Info>
      </Group>
      <form
        className="form card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^\S+@\S+\.\S+$/.test(newEmail.trim())) return;
          void run(async () => {
            await (await supabaseApi()).changeEmail(newEmail.trim(), appUrl());
            setNewEmail('');
            toast('Wysłano link potwierdzający. Login zmieni się po kliknięciu linku.');
          });
        }}
      >
        <Field label="Nowy login (e-mail)" hint="Serwer wyśle link potwierdzający; do tego czasu działa dotychczasowy adres.">
          <input type="email" autoComplete="off" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-block" disabled={!/^\S+@\S+\.\S+$/.test(newEmail.trim())}>
          Zmień login
        </button>
      </form>

      <form
        className="form card"
        onSubmit={(e) => {
          e.preventDefault();
          if (!current || !next || passwordError || repeatError || repeat !== next) return;
          setBusy(true);
          void run(async () => {
            await (await supabaseApi()).changePassword(state.email, current, next);
            setCurrent('');
            setNext('');
            setRepeat('');
            toast('Hasło zmienione.');
          }).finally(() => setBusy(false));
        }}
      >
        <Field label="Obecne hasło">
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Nowe hasło" error={passwordError}>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Powtórz nowe hasło" error={repeatError}>
          <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || !current || !next || Boolean(passwordError) || repeat !== next}>
          {busy ? 'Zmieniam…' : 'Zmień hasło'}
        </button>
      </form>

      <Group title={`Pytania pomocnicze${status ? (status.configured ? ' · ustawione' : ' · nieustawione') : ''}`} plain>
        <div className="card">
          <QuestionsForm
            submitLabel={status?.configured ? 'Zmień odpowiedzi' : 'Zapisz odpowiedzi'}
            hint="Używane przy odzyskiwaniu hasła, razem z linkiem z e-maila. Na serwerze zapisują się tylko zaszyfrowane skróty; wielkość liter nie ma znaczenia."
            onSubmit={(answers) =>
              run(async () => {
                const api = await supabaseApi();
                await api.setRecoveryAnswers(answers);
                setStatus(await api.recoveryStatus());
                toast('Zapisano odpowiedzi na pytania pomocnicze.');
              })
            }
          />
        </div>
      </Group>
    </Page>
  );
}

// ---------- Odzyskiwanie hasła z linku ----------

/**
 * Ekran z linku „Nie pamiętam hasła”: najpierw pytania pomocnicze (sprawdzane na serwerze), potem nowe hasło.
 * Działa tylko dla konta zalogowanego na tym urządzeniu albo na urządzeniu bez konta firmowego.
 */
export function AdminRecoveryPage() {
  const navigate = useNavigate();
  const { run, toast } = useFeedback();
  const [link] = useState(() => takeRecoveryLink());
  const [step, setStep] = useState<'start' | 'questions' | 'password' | 'error'>('start');
  const [message, setMessage] = useState('');
  const [noQuestions, setNoQuestions] = useState(false);
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!link || link.error || !link.accessToken || !link.refreshToken) {
        setMessage(link?.error ?? 'Brak ważnego linku. Poproś o nowy na ekranie logowania panelu admina.');
        setStep('error');
        return;
      }
      const owner = tokenUser(link.accessToken);
      const device = await getSyncState();
      if (device && owner && device.userId !== owner.userId) {
        clearRecoveryLink();
        setMessage('Link dotyczy innego konta niż zalogowane na tym urządzeniu. Otwórz go na urządzeniu admina.');
        setStep('error');
        return;
      }
      try {
        const api = await supabaseApi();
        await api.startRecoverySession(link.accessToken, link.refreshToken);
        const status = await api.recoveryStatus();
        setNoQuestions(!status.configured);
        setStep(status.configured ? 'questions' : 'password');
      } catch (error) {
        clearRecoveryLink();
        setMessage(error instanceof Error ? error.message : 'Link wygasł albo był już użyty. Poproś o nowy.');
        setStep('error');
      }
    })();
  }, [link]);

  const passwordError = next && next.length < 12 ? 'Co najmniej 12 znaków' : undefined;

  return (
    <Page title="Nowe hasło admina" back="/admin">
      {step === 'start' && <Loading />}
      {step === 'error' && (
        <Empty icon="alert" title={message}>
          <Link className="btn btn-primary" to="/admin">
            Panel admina
          </Link>
        </Empty>
      )}
      {step === 'questions' && (
        <div className="card">
          <QuestionsForm
            submitLabel="Dalej"
            hint="Krok 1 z 2: odpowiedz na pytania pomocnicze."
            onSubmit={(answers) =>
              run(async () => {
                const result = await (await supabaseApi()).verifyRecoveryAnswers(answers);
                if (result === 'ok' || result === 'brak') setStep('password');
                else toast(result === 'blokada' ? 'Za dużo błędnych odpowiedzi. Spróbuj za godzinę.' : 'Odpowiedzi się nie zgadzają.', { tone: 'error' });
              })
            }
          />
        </div>
      )}
      {step === 'password' && (
        <form
          className="form card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!next || passwordError || repeat !== next) return;
            setBusy(true);
            void run(async () => {
              await (await supabaseApi()).setNewPassword(next);
              clearRecoveryLink();
              await refetchAfterRecovery();
              unlockedUntil = Date.now() + UNLOCK_MS;
              toast('Ustawiono nowe hasło.');
              navigate('/admin', { replace: true });
            }).finally(() => setBusy(false));
          }}
        >
          <p className="field-hint">
            {noQuestions
              ? 'Pytania pomocnicze nie są ustawione. Ustaw nowe hasło, a potem pytania w panelu: Login, hasło i pytania pomocnicze.'
              : 'Krok 2 z 2: ustaw nowe hasło.'}
          </p>
          <Field label="Nowe hasło" error={passwordError}>
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="Powtórz nowe hasło" error={repeat && repeat !== next ? 'Hasła się różnią' : undefined}>
            <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !next || Boolean(passwordError) || repeat !== next}>
            {busy ? 'Zapisuję…' : 'Ustaw nowe hasło'}
          </button>
        </form>
      )}
    </Page>
  );
}
