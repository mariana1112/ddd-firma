import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { clearRecoveryLink, takeLinkInfo, takeRecoveryLink, tokenUser } from '../lib/auth-link';
import { syncInBackground } from '../data/sync/runner';
import { normalizePrefix, PREFIX_MAX, roman, visitCode } from '../data/codes';
import { companyText, regionRanking, regionData, type RegionRef } from '../data/company';
import { buildReport, formatPln, periodOf, shiftPeriod, type Period, type PeriodKind } from '../data/reports';
import { expenses, orders, trips, visits } from '../data/repo';
import { getOwnBranch, setViewScope } from '../data/scope';
import { COMPANY_NAME, getDataKey, getRegions, getSyncState, saveRegions, setSyncState, type RegionInfo } from '../data/settings';
import { enterRegion } from './regions';
import type { SyncState } from '../data/types';
import { formatDate, formatTerm, todayWarsaw } from '../lib/dates';
import { orderAddress } from '../data/texts';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Empty, Field, Group, Info, Loading, Page, Row, ScopeBannerContext, Sheet, Stat } from '../ui/kit';
import { useContactActions } from './common';

import { getAdminSecrets, saveAdminSecret, type AdminSecrets } from '../data/admin-secrets';
import { unwrapDataKey } from '../data/sync/crypto';

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
  const [email, setEmail] = useState(props.state.email ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  useEffect(() => {
    void getAdminSecrets().then((saved) => {
      if (saved.panel) {
        setPassword(saved.panel);
        setRemember(true);
      }
    });
  }, []);
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
        await saveAdminSecret('panel', remember ? password : '').catch(() => undefined);
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
      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Zapamiętaj hasło na tym telefonie
      </label>
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

  /** Tworzy region: nazwa i prefiks w panelu, region na serwerze. Kod dla ludzi generuje sekcja „Kody”. */
  const createRegion = async (name: string, prefix: string): Promise<{ id: string; name: string }> => {
    if (!state?.orgId) throw new Error('Brak konta firmy.');
    const all = await getRegions();
    const taken = Object.entries(all).find(([, r]) => prefix && r.prefix === prefix);
    if (taken) throw new Error(`Prefiks ${prefix} ma już region ${taken[1].name}.`);
    const id = await (await supabaseApi()).createBranch(state.orgId, name);
    await saveRegions({ ...(await getRegions()), [id]: { name, prefix } });
    await load();
    return { id, name };
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

  return { regions, members, loaded: saved !== undefined, online: server !== null, savePrefix, createRegion, deleteRegion };
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
        <Icon name="plus" /> {busy ? 'Tworzę…' : 'Utwórz region'}
      </button>
    </form>
  );
}

// ---------- Zarejestrowane konta ----------

type MemberRow = {
  userId: string;
  displayName: string;
  email: string;
  role: 'owner' | 'technik';
  branchId: string | null;
  approved: boolean;
  suspended?: boolean;
};

/**
 * Wszystkie konta firmy: kto czeka na zgodę, kto pracuje, kto jest zawieszony. Admin przyjmuje, zawiesza (konto zostaje,
 * ale nie widzi danych), przywraca i usuwa konta. Siebie zawiesić ani usunąć nie można.
 */
function MembersSection(props: { state: SyncState; regions: RegionRef[]; regionId?: string }) {
  const { confirm, run, toast } = useFeedback();
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [access, setAccess] = useState<Array<{ userId: string; branchId: string }>>([]);

  const load = async () => {
    const api = await supabaseApi();
    const [list, pairs] = await Promise.all([api.listMembers(props.state.orgId), api.listMemberBranches(props.state.orgId)]);
    setMembers(list);
    setAccess(pairs);
  };

  useEffect(() => {
    void load().catch(() => setMembers(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.state.orgId]);

  const regionNames = (m: MemberRow) => {
    const ids = new Set([...access.filter((a) => a.userId === m.userId).map((a) => a.branchId), ...(m.branchId ? [m.branchId] : [])]);
    const names = props.regions.filter((r) => ids.has(r.id)).map((r) => r.name);
    return names.length ? names.join(', ') : 'bez regionu';
  };
  const label = (m: MemberRow) => m.displayName || m.email || 'Bez nazwy';
  const temp = (m: MemberRow) => m.email.endsWith('@konta.pogromcy.invalid');

  const act = (fn: () => Promise<void>, done: string) =>
    run(async () => {
      await fn();
      await load();
      toast(done);
    });

  const remove = async (m: MemberRow) => {
    const ok = await confirm({
      title: `Usunąć konto ${label(m)}?`,
      message: 'Konto zostanie usunięte z firmy i z logowania. Zlecenia i raporty tej osoby zostają. Tego nie da się cofnąć; do ponownej pracy trzeba utworzyć nowe konto.',
      confirmLabel: 'Usuń konto',
      danger: true,
    });
    if (ok) await act(async () => (await supabaseApi()).deleteAccount(props.state.orgId, m.userId), 'Konto usunięte');
  };

  const suspend = async (m: MemberRow, on: boolean) => {
    if (on) {
      const ok = await confirm({
        title: `Zawiesić konto ${label(m)}?`,
        message: 'Konto zostaje w firmie, ale do czasu przywrócenia nie zobaczy ani nie zapisze żadnych danych.',
        confirmLabel: 'Zawieś',
        danger: true,
      });
      if (!ok) return;
    }
    await act(async () => (await supabaseApi()).suspendMember(props.state.orgId, m.userId, on), on ? 'Konto zawieszone' : 'Konto przywrócone');
  };

  const inRegion = (m: MemberRow) =>
    !props.regionId || m.branchId === props.regionId || access.some((a) => a.userId === m.userId && a.branchId === props.regionId);
  const toggleAdmin = async (m: MemberRow) => {
    const give = m.role !== 'owner';
    const ok = await confirm({
      title: give ? `Dać ${label(m)} uprawnienia admina?` : `Odebrać ${label(m)} uprawnienia admina?`,
      message: give
        ? 'Admin widzi wszystkie regiony, wchodzi do panelu admina, zarządza kontami i generuje kody. Do panelu loguje się swoim e-mailem i hasłem.'
        : 'Konto zostanie technikiem w swoim regionie i straci dostęp do panelu admina.',
      confirmLabel: give ? 'Daj admina' : 'Odbierz admina',
      danger: !give,
    });
    if (ok) await act(async () => (await supabaseApi()).setMemberRole(props.state.orgId, m.userId, give ? 'owner' : 'technik'), give ? 'Konto jest teraz adminem' : 'Konto jest teraz technikiem');
  };

  const sorted = [...(members ?? [])].filter(inRegion).sort(
    (a, b) => Number(a.approved) - Number(b.approved) || Number(Boolean(b.suspended)) - Number(Boolean(a.suspended)) || label(a).localeCompare(label(b), 'pl'),
  );

  return (
    <Group title={`${props.regionId ? 'Konta w regionie' : 'Wszystkie konta'}${members ? ` (${sorted.length})` : ''}`}>
      {members === null && <p className="field-hint group-pad">Lista kont wymaga internetu.</p>}
      {members && sorted.length === 0 && <p className="field-hint group-pad">Nikogo tu jeszcze nie ma. Wygeneruj kod poniżej.</p>}
      {sorted.map((m) => {
        const self = m.userId === props.state.userId;
        return (
          <div key={m.userId} className="member-row">
            <div className="member-main">
              <strong>
                {m.approved ? <Link to={`/admin/technik/${m.userId}?imie=${encodeURIComponent(label(m))}`}>{label(m)}</Link> : label(m)}
                {self ? ' (Ty)' : ''}
              </strong>
              <span className="row-sub">
                {temp(m) ? 'login tymczasowy, jeszcze bez własnego e-maila' : m.email} · {regionNames(m)}
              </span>
              <span className="member-badges">
                {m.role === 'owner' ? <Badge tone="primary">Admin</Badge> : <Badge tone="muted">Technik</Badge>}
                {!m.approved ? <Badge tone="warn">Czeka na zgodę</Badge> : m.suspended ? <Badge tone="danger">Zawieszone</Badge> : <Badge tone="ok">Aktywne</Badge>}
              </span>
            </div>
            {!self && (
              <div className="member-actions">
                {!m.approved && (
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => void act(async () => (await supabaseApi()).approveMember(props.state.orgId, m.userId), 'Konto przyjęte')}>
                    Przyjmij
                  </button>
                )}
                {m.approved && (
                  <Link className="btn btn-sm" to={`/admin/technik/${m.userId}?imie=${encodeURIComponent(label(m))}`}>
                    Podgląd
                  </Link>
                )}
                {m.approved && !m.suspended && (
                  <button type="button" className="btn btn-sm" onClick={() => void toggleAdmin(m)}>
                    {m.role === 'owner' ? 'Odbierz admina' : 'Daj admina'}
                  </button>
                )}
                {m.approved && (
                  <button type="button" className="btn btn-sm" onClick={() => void suspend(m, !m.suspended)}>
                    {m.suspended ? 'Przywróć' : 'Zawieś'}
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-danger-quiet" onClick={() => void remove(m)}>
                  {m.approved ? 'Usuń' : 'Odrzuć'}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </Group>
  );
}

// ---------- Kody weryfikacyjne ----------

const APP_URL = 'https://mariana1112.github.io/ddd-firma/';
const ADMIN_TARGET = 'admin';

type CodeResult = { title: string; code: string; text: string };

/** Kod gotowy do wysłania: duży, z przyciskami „Wyślij” i „Kopiuj”. Drugi raz go nie zobaczysz. */
function CodeDetails(props: { result: CodeResult; onClose: () => void }) {
  const { copy, share } = useContactActions();
  return (
    <div className="form">
      <p className="invite-code">{props.result.code}</p>
      <p className="sheet-text">Jednorazowy, ważny 14 dni. Po zamknięciu tego okna kodu nie da się wyświetlić ponownie.</p>
      <button type="button" className="btn btn-primary btn-block" onClick={() => void share(props.result.text, props.result.title)}>
        <Icon name="share" /> Wyślij kod z instrukcją
      </button>
      <button type="button" className="btn btn-block" onClick={() => void copy(props.result.code)}>
        <Icon name="copy" /> Kopiuj kod
      </button>
      <button type="button" className="btn btn-block" onClick={props.onClose}>
        Gotowe
      </button>
    </div>
  );
}

/** Hasło firmy w pamięci tylko do zamknięcia aplikacji, żeby nie wpisywać go przy każdym kodzie. */
/**
 * Admin generuje tylko kod przypisany do regionu (albo kod admina). Osoba sama zakłada konto swoim e-mailem i hasłem
 * i wpisuje kod; ten sam kod działa też na nowym telefonie osoby, która już ma konto. Kod niesie klucz szyfrowania
 * firmy, więc telefon admina musi raz poznać hasło szyfrowania; potem pamięta je (zaszyfrowane, tylko na tym
 * telefonie) i zalogowany admin generuje kody jednym przyciskiem.
 */
function CodesSection(props: { state: SyncState; regions: RegionRef[]; fixedRegion?: RegionRef }) {
  const { run } = useFeedback();
  const [target, setTarget] = useState(props.fixedRegion?.id ?? '');
  const [companyPassword, setCompanyPassword] = useState('');
  // Hasło szyfrowania zapamiętane na tym telefonie: undefined = jeszcze sprawdzam, null = brak.
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CodeResult | null>(null);

  useEffect(() => {
    void getAdminSecrets()
      .then((secrets) => setSaved(secrets.company ?? null))
      .catch(() => setSaved(null));
  }, []);

  const region = props.regions.find((r) => r.id === target);
  const ready = (target === ADMIN_TARGET || Boolean(region)) && (Boolean(saved) || companyPassword.length >= 12);

  const generate = () =>
    run(async () => {
      setBusy(true);
      try {
        const api = await supabaseApi();
        const orgWrapped = (await api.myMemberships()).find((m) => m.orgId === props.state.orgId)?.dataKey;
        const deviceKey = await getDataKey();
        if (!orgWrapped || !deviceKey) throw new Error('Brak klucza firmy na tym urządzeniu. Odblokuj synchronizację w Koncie.');
        const admin = target === ADMIN_TARGET;
        const password = saved || companyPassword;
        let code: string;
        try {
          code = await api.issueSignupCode({
            orgId: props.state.orgId,
            branchId: admin ? null : target,
            role: admin ? 'owner' : 'technik',
            companyPassword: password,
            orgWrapped,
            deviceKey,
          });
        } catch (error) {
          if (saved && /hasło firmy/i.test(error instanceof Error ? error.message : '')) {
            // Zapamiętane hasło jest stare (np. po zmianie hasła szyfrowania na innym urządzeniu).
            await saveAdminSecret('company', '');
            setSaved(null);
            throw new Error('Zapamiętane hasło szyfrowania jest nieaktualne. Wpisz je raz ponownie.');
          }
          throw error;
        }
        if (!saved) {
          await saveAdminSecret('company', password);
          setSaved(password);
          setCompanyPassword('');
        }
        const where = admin ? 'admin (wszystkie regiony)' : `region ${region?.name ?? ''}`;
        setResult({
          title: `Kod: ${where}`,
          code,
          text: [
            `${COMPANY_NAME}: kod do aplikacji (${where}).`,
            `1. Otwórz ${APP_URL} (iPhone: Safari → Udostępnij → Do ekranu początkowego).`,
            '2. Nie masz konta: „Załóż konto”, wpisz imię, swój e-mail, hasło i kod.',
            '   Masz konto: zaloguj się i wpisz kod.',
            `Kod: ${code}`,
            'Działa raz, ważny 14 dni.',
          ].join('\n'),
        });
        if (!props.fixedRegion) setTarget('');
      } finally {
        setBusy(false);
      }
    });

  return (
    <Group title={props.fixedRegion ? 'Kod dla nowej osoby w regionie' : 'Kody dla nowych osób'}>
      <div className="form group-pad" id="kody">
        <p className="field-hint">Osoba sama zakłada konto swoim e-mailem i hasłem i wpisuje kod. Bez kodu konta nie założy.</p>
        {!props.fixedRegion && (
        <Field label="Region">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Wybierz</option>
            {props.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {regionLabel(r)}
              </option>
            ))}
            <option value={ADMIN_TARGET}>Admin (wszystkie regiony)</option>
          </select>
        </Field>
        )}
        {saved === null && (
          <Field
            label="Hasło szyfrowania firmy (tylko pierwszy raz)"
            hint="Telefon zapamięta je i więcej nie zapyta. Nie trafia na serwer. To nie jest hasło do panelu."
          >
            {/* Pole tekstowe z kropkami: iPhone nie wpisuje tu wtedy sam hasła do panelu. */}
            <input
              className="input-secret"
              type="text"
              name="haslo-szyfrowania-firmy"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={companyPassword}
              onChange={(e) => setCompanyPassword(e.target.value)}
              onInput={(e) => setCompanyPassword((e.target as HTMLInputElement).value)}
            />
          </Field>
        )}
        <button type="button" className="btn btn-primary btn-block" disabled={!ready || busy} onClick={() => void generate()}>
          <Icon name="plus" /> {busy ? 'Generuję…' : 'Wygeneruj kod'}
        </button>
      </div>
      <Sheet open={Boolean(result)} title={result?.title ?? ''} onClose={() => setResult(null)}>
        {result && <CodeDetails result={result} onClose={() => setResult(null)} />}
      </Sheet>
    </Group>
  );
}

// ---------- Hasła zapamiętane na tym telefonie ----------

/** Jedno zapamiętane hasło: ukryte kropkami, „Pokaż”, „Kopiuj”, zmiana i usunięcie. */
function SecretRow(props: { label: string; value: string | undefined; verify: (value: string) => Promise<void>; onSave: (value: string) => Promise<unknown> }) {
  const { copy } = useContactActions();
  const { run } = useFeedback();
  const [shown, setShown] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="form group-pad">
      <Info label={props.label}>
        {props.value ? <span className="invite-code">{shown ? props.value : '••••••••••••'}</span> : 'Nie zapamiętane'}
      </Info>
      {props.value && !editing && (
        <div className="quick-actions">
          <button type="button" className="btn btn-sm" onClick={() => setShown(!shown)}>
            {shown ? 'Ukryj' : 'Pokaż'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void copy(props.value!)}>
            <Icon name="copy" /> Kopiuj
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
            Zmień
          </button>
          <button type="button" className="btn btn-sm btn-danger-quiet" onClick={() => void run(() => props.onSave(''))}>
            Usuń
          </button>
        </div>
      )}
      {(!props.value || editing) && (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft) return;
            setBusy(true);
            void run(async () => {
              try {
                await props.verify(draft);
                await props.onSave(draft);
                setDraft('');
                setEditing(false);
              } finally {
                setBusy(false);
              }
            });
          }}
        >
          <Field label={`Wpisz ${props.label.toLowerCase()}`}>
            <input className="input-secret" type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-block" disabled={!draft || busy}>
            {busy ? 'Sprawdzam…' : 'Sprawdź i zapamiętaj'}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Hasła admina zapamiętane na tym telefonie, do podejrzenia w panelu. Zaszyfrowane kluczem firmy z tego urządzenia,
 * nigdy nie trafiają na serwer. Zapamiętane hasło do panelu wpisuje się samo przy logowaniu do panelu.
 */
function SavedPasswordsSection(props: { state: SyncState }) {
  const { toast } = useFeedback();
  const [version, setVersion] = useState(0);
  const secrets = useLiveQuery(() => getAdminSecrets(), [version]);
  const save = (kind: keyof AdminSecrets) => async (value: string) => {
    await saveAdminSecret(kind, value);
    setVersion((v) => v + 1);
    toast(value ? 'Zapamiętano na tym telefonie' : 'Usunięto z tego telefonu');
  };
  return (
    <Group title="Hasła zapamiętane na tym telefonie">
      <p className="field-hint group-pad">
        Tylko na tym telefonie, zaszyfrowane; nie trafiają na serwer. Chroni je blokada telefonu: kto zna kod telefonu, wejdzie
        do panelu i zobaczy hasła.
      </p>
      <SecretRow
        label="Hasło do panelu"
        value={secrets?.panel}
        verify={async (value) => {
          const user = await (await supabaseApi()).signIn(props.state.email, value);
          if (user.userId !== props.state.userId) throw new Error('Nieprawidłowe konto.');
        }}
        onSave={save('panel')}
      />
      <SecretRow
        label="Hasło szyfrowania"
        value={secrets?.company}
        verify={async (value) => {
          const wrapped = (await (await supabaseApi()).myMemberships()).find((m) => m.orgId === props.state.orgId)?.dataKey;
          if (!wrapped) throw new Error('Firma nie ma hasła szyfrowania.');
          await unwrapDataKey(value, wrapped).catch(() => {
            throw new Error('To nie jest hasło szyfrowania firmy.');
          });
        }}
        onSave={save('company')}
      />
    </Group>
  );
}

// ---------- Strona główna panelu ----------

const regionLabel = (r: RegionRef) => (r.prefix ? `${r.name} (${r.prefix})` : r.name);

const periodName = (p: Period) => {
  const d = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
  return `${d(p.from)} – ${d(p.to)}`;
};

/** Ustawienia jednego regionu: prefiks, wejście na tym telefonie, usunięcie. */
function RegionSettings(props: {
  region: RegionRef;
  active: boolean;
  onSavePrefix: (prefix: string) => void;
  onEnter: () => void;
  onDelete: () => void;
}) {
  const [prefix, setPrefix] = useState(props.region.prefix);
  useEffect(() => setPrefix(props.region.prefix), [props.region.prefix]);
  return (
    <Group title="Ustawienia regionu">
      <form
        className="form group-pad"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSavePrefix(prefix);
        }}
      >
        <Field label="Prefiks numerów zleceń" hint={`Np. ${prefix || 'GDA'}-0042. Litery, do ${PREFIX_MAX} znaków.`}>
          <input
            value={prefix}
            maxLength={PREFIX_MAX}
            placeholder="GDA"
            autoCapitalize="characters"
            onChange={(e) => setPrefix(normalizePrefix(e.target.value))}
          />
        </Field>
        <button type="submit" className="btn btn-block" disabled={prefix === props.region.prefix}>
          Zapisz prefiks
        </button>
      </form>
      {props.active ? (
        <p className="field-hint group-pad">Ten telefon pracuje w tym regionie.</p>
      ) : (
        <Row icon="building" title="Pracuj w tym regionie na tym telefonie" sub="Zlecenia, kalendarz i raporty pokażą ten region" onClick={props.onEnter} />
      )}
      <Row icon="close" title="Usuń region" sub="Zlecenia zostaną bez regionu, widoczne tylko dla admina" onClick={props.onDelete} />
    </Group>
  );
}

export function AdminPage() {
  const gate = useAdminGate();
  const { share } = useContactActions();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const region = params.get('region') ?? 'all';
  const [kind, setKind] = useState<PeriodKind>('tydzien');
  const [period, setPeriod] = useState<Period>(() => periodOf('tydzien', todayWarsaw()));
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

  const state = gate.state;
  const own = getOwnBranch();
  const ranking = regionRanking(period, data, regionsApi.regions, own);
  const total = buildReport(period, data);
  const selected = regionsApi.regions.find((r) => r.id === region);
  const report = selected ? buildReport(period, regionData(data, selected.id, own)) : total;
  // Wejście do regionu dodaje krok w historii, więc „wstecz” wraca do listy regionów.
  const openRegion = (id: string) => navigate(`/admin?region=${id}`);
  const scoped = (path: string) => `/admin/${path}${selected ? `?region=${selected.id}` : ''}`;
  const changeKind = (k: PeriodKind) => {
    setKind(k);
    setPeriod(periodOf(k, todayWarsaw()));
  };

  const periodBlock = (
    <>
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
    </>
  );

  const screens = (
    <Group title={selected ? 'Praca w regionie' : 'Cała firma'}>
      <Row to={scoped('zlecenia')} icon="clipboard" title="Zlecenia" sub="Lista, wyszukiwanie, szczegóły" />
      <Row to={scoped('kalendarz')} icon="calendar" title="Kalendarz" sub="Zabiegi wszystkich techników" />
      <Row to={scoped('raporty')} icon="chart" title="Raporty" sub="Dzień, tydzień, miesiąc, PDF" />
      <Row to={scoped('kilometry')} icon="car" title="Kilometrówka" sub="Przejazdy i wydruk ewidencji" />
      <Row to={scoped('koszty')} icon="receipt" title="Koszty" sub={selected ? 'Koszty techników z regionu' : 'Koszty wszystkich techników'} />
    </Group>
  );

  // ---------- Jeden region: wszystko o nim w jednym miejscu ----------
  if (selected) {
    return (
      <Page title={`Region ${regionLabel(selected)}`} back="/admin">
        <button type="button" className="btn btn-block" onClick={() => navigate('/admin')}>
          <Icon name="back" /> Wszystkie regiony
        </button>
        {periodBlock}
        {screens}
        <MembersSection state={state} regions={regionsApi.regions} regionId={selected.id} />
        <CodesSection state={state} regions={regionsApi.regions} fixedRegion={selected} />
        <RegionSettings
          region={selected}
          active={state.branchId === selected.id}
          onSavePrefix={(prefix) => void regionsApi.savePrefix(selected.id, selected.name, prefix)}
          onEnter={() =>
            void run(async () => {
              await enterRegion(state, selected);
              toast(`Ten telefon pracuje teraz w regionie ${selected.name}`);
            })
          }
          onDelete={async () => {
            const ok = await confirm({
              title: `Usunąć region ${selected.name}?`,
              message:
                'Konta stracą dostęp do tego regionu, a kody do niego przestaną działać. Zlecenia regionu zostaną bez regionu i będzie je widział tylko admin.',
              confirmLabel: 'Usuń region',
              danger: true,
            });
            if (!ok) return;
            await regionsApi.deleteRegion(selected.id);
            navigate('/admin', { replace: true });
          }}
        />
      </Page>
    );
  }

  // ---------- Cała firma: lista regionów ----------
  return (
    <Page title="Panel admina" back="/wiecej">
      {periodBlock}

      <Group
        title="Regiony"
        action={
          ranking.length > 0 ? (
            <button type="button" className="link" onClick={() => void share(companyText(total, ranking), 'Podsumowanie firmy')}>
              Wyślij podsumowanie
            </button>
          ) : undefined
        }
      >
        {!regionsApi.online && <p className="field-hint group-pad">Bez internetu: lista z ostatniego połączenia, dodawanie regionów niedostępne.</p>}
        {ranking.length === 0 && <Empty title="Nie ma jeszcze żadnego regionu" />}
        {ranking.map((r, i) => (
          <Row
            key={r.id || 'bez'}
            onClick={r.id ? () => openRegion(r.id) : undefined}
            lead={<span className={`rank rank-${Math.min(i + 1, 4)}`}>{i + 1}</span>}
            title={
              <>
                {regionLabel(r)} {state.branchId === r.id && <Badge tone="ok">Ten telefon</Badge>}
              </>
            }
            sub={`Konta: ${regionsApi.members[r.id] ?? 0} · zabiegi: ${r.visits} · wynik gotówka ${formatPln(r.report.cashForBoss)}`}
            trailing={<strong className="num">{formatPln(r.report.turnover)}</strong>}
          />
        ))}
        <NewRegionForm
          disabled={!regionsApi.online}
          onCreate={(name, prefix) =>
            run(async () => {
              const created = await regionsApi.createRegion(name, prefix);
              toast(`Region ${created.name} utworzony. Wygeneruj w nim kod dla nowej osoby.`);
              openRegion(created.id);
            })
          }
        />
      </Group>

      {screens}

      <MembersSection state={state} regions={regionsApi.regions} />

      <CodesSection state={state} regions={regionsApi.regions} />

      <SavedPasswordsSection state={state} />

      <Group title="Firma">
        <Row to="/ustawienia" icon="gear" title="Ustawienia firmy" sub="Premia, zalecenia, SMS, dane do kilometrówki" />
        <Row to="/admin/bezpieczenstwo" icon="gear" title="Login, hasło i pytania pomocnicze" sub="Zmiana danych logowania do panelu i odzyskiwania" />
        <Row to="/konto" icon="users" title="Konto admina" sub="Synchronizacja i regiony tego telefonu" />
      </Group>
    </Page>
  );
}

// ---------- Podgląd technika ----------

/**
 * Co robi technik: zabiegi do zrobienia (umówione i bez terminu), ostatnio wykonane i wynik tygodnia. Dane z tego
 * telefonu admina (admin ma zlecenia wszystkich regionów), bez logowania na konto technika.
 */
export function AdminTechnicianPage() {
  const gate = useAdminGate();
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const name = params.get('imie') || 'Technik';
  const data = useLiveQuery(async () => {
    const list = (await visits.allRegions()).filter((v) => v.technicianId === id && !v.deletedAt);
    const byId = new Map((await orders.allRegions()).map((o) => [o.id, o]));
    return { list, byId };
  }, [id]);

  useEffect(() => touchUnlock());

  if (gate.state === undefined || !data) return <Loading />;
  if (!gate.state || gate.state.role !== 'owner') return <NotAdmin />;
  if (!gate.unlocked) return <Navigate to="/admin" replace />;

  const week = periodOf('tydzien', todayWarsaw());
  const todo = data.list
    .filter((v) => v.status === 'zaplanowany' || v.status === 'w_trakcie')
    .sort((a, b) => (a.start ?? '9999').localeCompare(b.start ?? '9999'));
  const done = data.list
    .filter((v) => v.status === 'wykonany')
    .sort((a, b) => (b.finishedAt ?? b.doneOn ?? '').localeCompare(a.finishedAt ?? a.doneOn ?? ''));
  const weekDone = done.filter((v) => v.doneOn && v.doneOn >= week.from && v.doneOn <= week.to);
  const turnover = weekDone.reduce((sum, v) => sum + (v.amount ?? 0), 0);

  const row = (v: (typeof data.list)[number]) => {
    const order = data.byId.get(v.orderId);
    return (
      <Row
        key={v.id}
        to={`/zabieg/${v.id}`}
        title={order ? `${visitCode(order, v.seq)} ${order.clientName}` : `Zabieg ${roman(v.seq)}`}
        sub={`${v.status === 'wykonany' ? `Wykonany ${formatDate(v.doneOn ?? v.start)}` : v.start ? formatTerm(v.start) : 'bez terminu'}${order ? ` · ${orderAddress(order)}` : ''}`}
        trailing={v.status === 'w_trakcie' ? <Badge tone="warn">W trakcie</Badge> : v.amount ? <span className="num">{formatPln(v.amount)}</span> : undefined}
      />
    );
  };

  return (
    <Page title={name} back="/admin">
      <div className="stats">
        <Stat label="Obrót w tym tygodniu" value={formatPln(turnover)} />
        <Stat label="Wykonane w tym tygodniu" value={String(weekDone.length)} />
        <Stat label="Do zrobienia" value={String(todo.length)} />
        <Stat label="Wykonane razem" value={String(done.length)} />
      </div>
      <Group title={`Do zrobienia (${todo.length})`}>
        {todo.length === 0 && <Empty title="Nic do zrobienia" />}
        {todo.map(row)}
      </Group>
      <Group title="Ostatnio wykonane">
        {done.length === 0 && <Empty title="Brak wykonanych zabiegów" />}
        {done.slice(0, 15).map(row)}
      </Group>
      <Group title="Więcej">
        <Row to={`/raporty?technik=${id}&imie=${encodeURIComponent(name)}`} icon="chart" title="Raport technika" sub="Dzień, tydzień, miesiąc, PDF" />
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
    <Page title="Nowe hasło" back="/">
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
              // Admin wraca do panelu; inne konta do aplikacji (urządzenie bez konta firmy pokaże logowanie do firmy).
              const device = await getSyncState();
              navigate(device?.role === 'owner' ? '/admin' : '/', { replace: true });
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
