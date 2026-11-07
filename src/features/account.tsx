import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createSnapshot } from '../data/backup';
import { pendingCount } from '../data/changes';
import { db } from '../data/db';
import { COMPANY_NAME, getDataKey, getSyncState, ownedBy, saveProfile, setDataKey, setSyncState } from '../data/settings';
import { isSyncConfigured } from '../data/sync/config';
import { createDataKey, MIN_PASSPHRASE, unwrapDataKey } from '../data/sync/crypto';
import type { Account } from '../data/sync/engine';
import { getSyncStatus, loadServer, subscribeSyncStatus, syncInBackground } from '../data/sync/runner';
import type { Branch, Member, Membership } from '../data/sync/supabase';
import { formatPln, periodOf } from '../data/reports';
import { orders, visits } from '../data/repo';
import { useContactActions } from './common';
import type { SyncState } from '../data/types';
import { formatInstant, todayWarsaw } from '../lib/dates';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Empty, Field, Group, Info, Loading, Page, Row, Sheet } from '../ui/kit';

const supabaseApi = () => import('../data/sync/supabase');
const engineApi = () => import('../data/sync/engine');

export function useSyncRunning(): boolean {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus).running;
}

export function AccountPage() {
  const state = useLiveQuery(async () => (await getSyncState()) ?? null);

  return (
    <Page title="Konto i synchronizacja" back="/wiecej">
      {!isSyncConfigured ? (
        <Empty icon="database" title="Synchronizacja nie jest skonfigurowana">
          <p>Ta wersja aplikacji działa tylko na tym urządzeniu. Konfigurację serwera opisuje README.</p>
        </Empty>
      ) : state === undefined ? (
        <Loading />
      ) : state ? (
        <SyncStatus state={state} />
      ) : (
        <Connect />
      )}
    </Page>
  );
}

// ---------- Włączanie ----------

type Step =
  | { kind: 'checking' }
  | { kind: 'signin' }
  | { kind: 'signup' }
  | { kind: 'confirm'; email: string }
  | { kind: 'org'; userId: string; email: string; name: string };

const MIN_PASSWORD = 12;

function Connect() {
  const { run } = useFeedback();
  const [step, setStep] = useState<Step>({ kind: 'checking' });

  useEffect(() => {
    void (async () => {
      const api = await supabaseApi();
      const user = await api.currentUser().catch(() => null);
      setStep(user ? { kind: 'org', ...user } : { kind: 'signin' });
    })();
  }, []);

  if (step.kind === 'checking') return <Loading />;

  if (step.kind === 'confirm') {
    return (
      <div className="form">
        <div className="notice notice-info">
          <Icon name="mail" />
          <span>
            Wysłaliśmy wiadomość na adres <strong>{step.email}</strong>. Kliknij w niej link potwierdzający. Otworzy się w
            przeglądarce i to w porządku. Potem wróć tutaj i zaloguj się hasłem. Sprawdź też folder spam.
          </span>
        </div>
        <button type="button" className="btn btn-primary btn-block" onClick={() => setStep({ kind: 'signin' })}>
          Potwierdziłem adres, zaloguj
        </button>
      </div>
    );
  }

  if (step.kind === 'signin' || step.kind === 'signup') {
    const signup = step.kind === 'signup';
    return (
      <PasswordForm
        signup={signup}
        onSwitch={() => setStep({ kind: signup ? 'signin' : 'signup' })}
        submit={(email, password, name) =>
          run(async () => {
            const api = await supabaseApi();
            if (signup && (await api.signUp(email, password, name)) === 'confirm') {
              setStep({ kind: 'confirm', email });
              return;
            }
            setStep({ kind: 'org', ...(await api.signIn(email, password)) });
          })
        }
      />
    );
  }

  return <ChooseOrg userId={step.userId} email={step.email} name={step.name} onSignedOut={() => setStep({ kind: 'signin' })} />;
}

function PasswordForm(props: {
  signup: boolean;
  submit: (email: string, password: string, name: string) => Promise<unknown>;
  onSwitch: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const tooShort = props.signup && password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = props.signup && repeat.length > 0 && repeat !== password;
  const ready =
    validEmail &&
    password.length > 0 &&
    (!props.signup || (password.length >= MIN_PASSWORD && repeat === password && name.trim().length > 0));

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await props.submit(email.trim(), password, name.trim());
        setBusy(false);
      }}
    >
      <div className="notice notice-info">
        <Icon name="database" />
        <span>
          Konto łączy Twoje urządzenia i oddział firmy. Dane na serwerze w UE są zaszyfrowane, a aplikacja dalej działa bez
          internetu i wysyła zmiany, gdy pojawi się połączenie.
        </span>
      </div>
      {props.signup && (
        <Field label="Imię" hint="Pojawi się w raportach, w danych dla centrali i na liście techników oddziału.">
          <input value={name} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      <Field label="Adres e-mail">
        <input
          type="email"
          name="email"
          inputMode="email"
          autoCapitalize="none"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field
        label="Hasło"
        error={tooShort ? `Hasło musi mieć co najmniej ${MIN_PASSWORD} znaków` : undefined}
        hint={props.signup ? 'Co najmniej 12 znaków. iPhone może zaproponować silne hasło i zapamiętać je w pęku kluczy.' : undefined}
      >
        <input
          type="password"
          name="password"
          autoComplete={props.signup ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      {props.signup && (
        <Field label="Powtórz hasło" error={mismatch ? 'Hasła się różnią' : undefined}>
          <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        </Field>
      )}
      <button type="submit" className="btn btn-primary btn-block" disabled={!ready || busy}>
        {busy ? 'Chwileczkę…' : props.signup ? 'Załóż konto' : 'Zaloguj'}
      </button>
      <button type="button" className="link" onClick={props.onSwitch}>
        {props.signup ? 'Mam już konto, zaloguj' : 'Nie mam konta, załóż je'}
      </button>
    </form>
  );
}

// ---------- Hasło szyfrowania ----------

/** Pola nowego hasła szyfrowania z potwierdzeniem, że użytkownik rozumie skutki jego utraty. */
function NewPassphrase(props: { onReady: (passphrase: string | null) => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [understood, setUnderstood] = useState(false);
  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE;
  const mismatch = repeat.length > 0 && repeat !== passphrase;
  const ready = passphrase.length >= MIN_PASSPHRASE && repeat === passphrase && understood;
  const { onReady } = props;

  useEffect(() => {
    onReady(ready ? passphrase : null);
  }, [ready, passphrase, onReady]);

  return (
    <>
      <div className="notice notice-info">
        <Icon name="database" />
        <span>
          <strong>Hasło szyfrowania</strong> chroni dane na serwerze. Serwer dostaje tylko zaszyfrowane dane i nie zna tego
          hasła, więc bez niego nikt ich nie odczyta, także Supabase. To inne hasło niż hasło logowania. Wpiszesz je raz na
          każdym nowym urządzeniu.
        </span>
      </div>
      <Field
        label="Hasło szyfrowania"
        error={tooShort ? `Co najmniej ${MIN_PASSPHRASE} znaków` : undefined}
        hint="Najlepiej kilka słów, np. zdanie, które łatwo zapamiętać, a trudno zgadnąć."
      >
        <input type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </Field>
      <Field label="Powtórz hasło szyfrowania" error={mismatch ? 'Hasła się różnią' : undefined}>
        <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
        Rozumiem, że bez tego hasła nie da się odczytać danych z serwera. Zapiszę je w bezpiecznym miejscu.
      </label>
    </>
  );
}

function UnlockForm(props: { busyLabel: string; onUnlock: (passphrase: string) => Promise<unknown> }) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await props.onUnlock(passphrase);
        setBusy(false);
      }}
    >
      <p className="sheet-text">Dane firmy na serwerze są zaszyfrowane. Wpisz hasło szyfrowania ustawione przy zakładaniu firmy.</p>
      <Field label="Hasło szyfrowania">
        <input type="password" autoComplete="current-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={!passphrase || busy}>
        {busy ? props.busyLabel : 'Odblokuj'}
      </button>
    </form>
  );
}

/** Zapisuje klucz na urządzeniu i wysyła wszystkie dane na serwer, już zaszyfrowane. */
async function startEncryptedSync(key: CryptoKey, account: Account) {
  await setDataKey(key);
  await createSnapshot('Przed włączeniem synchronizacji');
  const [{ enableSync }, server] = await Promise.all([engineApi(), loadServer()]);
  await enableSync(server, account);
}

function membershipAccount(m: Membership, user: { userId: string; email: string; name: string }): Account {
  return {
    orgId: m.orgId,
    orgName: m.orgName,
    userId: user.userId,
    email: user.email,
    role: m.role,
    displayName: m.displayName || user.name,
    branchId: m.branchId,
    branchName: m.branchName,
  };
}

function ChooseOrg(props: { userId: string; email: string; name: string; onSignedOut: () => void }) {
  const { run, toast } = useFeedback();
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState('');
  const [name, setName] = useState(props.name);
  const [orgName, setOrgName] = useState(COMPANY_NAME);
  const [branch, setBranch] = useState('');
  const [newPassphrase, setNewPassphrase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const local = useLiveQuery(async () => ({ orders: await db.orders.count(), trips: await db.trips.count() }));
  const user = { userId: props.userId, email: props.email, name: name.trim() || props.name };

  const load = () =>
    run(async () => {
      setMemberships(await (await supabaseApi()).myMemberships());
    });

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    await run(action);
    setBusy(false);
  };

  if (!memberships) return <Loading />;
  const hasLocal = Boolean(local && local.orders + local.trips > 0);
  const membership = memberships[0];

  const createOrgAndSync = () =>
    withBusy(async () => {
      const { key, wrapped } = await createDataKey(newPassphrase!);
      const api = await supabaseApi();
      await api.createOrg(orgName.trim(), wrapped, name.trim(), branch.trim());
      const [created] = await api.myMemberships();
      await startEncryptedSync(key, membershipAccount(created, user));
      toast('Firma utworzona, synchronizacja z szyfrowaniem włączona');
    });

  const join = () =>
    withBusy(async () => {
      await (await supabaseApi()).joinWithInvite(code, name.trim());
      toast('Dołączono do firmy. Wpisz hasło szyfrowania od szefa.');
      await load();
    });

  const setKeyAndSync = (m: Membership) =>
    withBusy(async () => {
      const { key, wrapped } = await createDataKey(newPassphrase!);
      await (await supabaseApi()).setOrgKey(m.orgId, wrapped);
      await startEncryptedSync(key, membershipAccount(m, user));
      toast('Szyfrowanie włączone');
    });

  const unlockAndSync = (m: Membership, passphrase: string) =>
    run(async () => {
      const key = await unwrapDataKey(passphrase, m.dataKey!);
      await startEncryptedSync(key, membershipAccount(m, user));
      toast('Urządzenie połączone z firmą');
    });

  return (
    <div className="form">
      <Group>
        <Info label="Konto">{props.email}</Info>
        {membership && <Info label="Firma">{membership.orgName}</Info>}
        {membership?.branchName && <Info label="Oddział">{membership.branchName}</Info>}
      </Group>
      {hasLocal && (
        <div className="notice notice-warn">
          <Icon name="alert" />
          <span>
            Na tym urządzeniu są dane: zlecenia {local?.orders}, przejazdy {local?.trips}. Zostaną zaszyfrowane, wysłane na serwer
            i dołączone do Twojego oddziału. Przed włączeniem powstanie migawka do przywrócenia.
          </span>
        </div>
      )}
      {membership?.dataKey ? (
        <UnlockForm busyLabel="Łączę…" onUnlock={(passphrase) => unlockAndSync(membership, passphrase)} />
      ) : membership ? (
        <>
          <NewPassphrase onReady={setNewPassphrase} />
          <button type="button" className="btn btn-primary btn-block" disabled={busy || !newPassphrase} onClick={() => void setKeyAndSync(membership)}>
            {busy ? 'Włączam…' : 'Ustaw hasło i połącz urządzenie'}
          </button>
        </>
      ) : (
        <>
          <div className="segmented" role="group">
            <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
              Mam kod od szefa
            </button>
            <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
              Zakładam firmę
            </button>
          </div>
          <Field label="Twoje imię">
            <input value={name} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
          </Field>
          {mode === 'join' ? (
            <>
              <Field label="Kod zaproszenia" hint="Szef tworzy go w aplikacji: Więcej → Oddziały. Kod przypisuje Cię do oddziału.">
                <input value={code} autoCapitalize="characters" autoComplete="off" onChange={(e) => setCode(e.target.value.toUpperCase())} />
              </Field>
              <button type="button" className="btn btn-primary btn-block" disabled={busy || !name.trim() || code.trim().length < 6} onClick={() => void join()}>
                {busy ? 'Dołączam…' : 'Dołącz do firmy'}
              </button>
            </>
          ) : (
            <>
              <Field label="Nazwa firmy">
                <input value={orgName} onChange={(e) => setOrgName(e.target.value)} autoComplete="organization" />
              </Field>
              <Field label="Twój oddział" hint="Np. Gdańsk. Kolejne oddziały dodasz później.">
                <input value={branch} onChange={(e) => setBranch(e.target.value)} />
              </Field>
              <NewPassphrase onReady={setNewPassphrase} />
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={busy || !orgName.trim() || !name.trim() || !branch.trim() || !newPassphrase}
                onClick={() => void createOrgAndSync()}
              >
                {busy ? 'Włączam…' : 'Utwórz firmę i włącz synchronizację'}
              </button>
            </>
          )}
        </>
      )}
      <button
        type="button"
        className="link"
        onClick={() =>
          void run(async () => {
            await (await supabaseApi()).signOut();
            props.onSignedOut();
          })
        }
      >
        Zaloguj na inne konto
      </button>
    </div>
  );
}

/**
 * Urządzenie, które synchronizowało się przed włączeniem szyfrowania: trzeba odblokować firmę
 * hasłem albo, gdy firma jeszcze go nie ma, ustawić je.
 */
function KeyMissing({ state }: { state: SyncState }) {
  const { run, toast } = useFeedback();
  const [membership, setMembership] = useState<Membership | null | undefined>(undefined);
  const [newPassphrase, setNewPassphrase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const account: Account = {
    orgId: state.orgId,
    orgName: state.orgName,
    userId: state.userId,
    email: state.email,
    role: state.role,
    displayName: state.displayName,
    branchId: state.branchId,
    branchName: state.branchName,
  };

  useEffect(() => {
    void run(async () => {
      const all = await (await supabaseApi()).myMemberships();
      setMembership(all.find((m) => m.orgId === state.orgId) ?? null);
    });
  }, [run, state.orgId]);

  if (membership === undefined) return <Loading />;
  if (membership === null) {
    return <Empty icon="alert" title="To konto nie należy już do tej firmy. Wyloguj się poniżej." />;
  }
  if (membership.dataKey) {
    const wrapped = membership.dataKey;
    return (
      <UnlockForm
        busyLabel="Odblokowuję…"
        onUnlock={(passphrase) =>
          run(async () => {
            await startEncryptedSync(await unwrapDataKey(passphrase, wrapped), account);
            toast('Synchronizacja odblokowana');
          })
        }
      />
    );
  }
  return (
    <div className="form">
      <NewPassphrase onReady={setNewPassphrase} />
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={busy || !newPassphrase}
        onClick={async () => {
          setBusy(true);
          await run(async () => {
            const { key, wrapped } = await createDataKey(newPassphrase!);
            await (await supabaseApi()).setOrgKey(state.orgId, wrapped);
            await startEncryptedSync(key, account);
            toast('Szyfrowanie włączone. Dane wysłano ponownie w postaci zaszyfrowanej.');
          });
          setBusy(false);
        }}
      >
        {busy ? 'Szyfruję…' : 'Ustaw hasło szyfrowania'}
      </button>
    </div>
  );
}

// ---------- Stan ----------

function SyncStatus({ state }: { state: SyncState }) {
  const { confirm, run, toast } = useFeedback();
  const hasKey = useLiveQuery(async () => Boolean(await getDataKey()));
  const running = useSyncRunning();
  const pending = useLiveQuery(() => pendingCount()) ?? 0;
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [name, setName] = useState('');

  // Rola, oddział i imię mogą się zmienić na serwerze, np. gdy szef przeniesie technika.
  useEffect(() => {
    void (async () => {
      try {
        const m = (await (await supabaseApi()).myMemberships()).find((x) => x.orgId === state.orgId);
        const latest = await getSyncState();
        if (!m || !latest) return;
        await setSyncState({ ...latest, role: m.role, displayName: m.displayName, branchId: m.branchId, branchName: m.branchName });
        await saveProfile({ name: m.displayName, userId: latest.userId });
      } catch {
        // Bez internetu zostają dane zapisane przy ostatnim połączeniu.
      }
    })();
  }, [state.orgId]);

  const saveName = () =>
    run(async () => {
      await (await supabaseApi()).updateMyProfile(state.orgId, name.trim());
      const latest = await getSyncState();
      if (latest) await setSyncState({ ...latest, displayName: name.trim() });
      await saveProfile({ name: name.trim(), userId: state.userId });
      toast('Zapisano imię');
    });

  const syncNow = () =>
    run(async () => {
      await syncInBackground();
      toast('Zsynchronizowano');
    });

  const signOut = async (wipe: boolean) => {
    if (wipe && pending > 0) {
      const ok = await confirm({
        title: 'Usunąć niewysłane zmiany?',
        message: `Liczba zmian, które nie dotarły na serwer: ${pending}. Po usunięciu danych przepadną.`,
        confirmLabel: 'Usuń mimo to',
        danger: true,
      });
      if (!ok) return;
    }
    setSignOutOpen(false);
    await run(async () => {
      const [{ disableSync }, api] = await Promise.all([engineApi(), supabaseApi()]);
      await api.signOut();
      await disableSync({ wipe });
      toast(wipe ? 'Wylogowano i usunięto dane z urządzenia' : 'Wylogowano. Dane zostały na urządzeniu.');
    });
  };

  return (
    <>
      {hasKey === false ? (
        <>
          <Group>
            <Info label="Konto">{state.email}</Info>
            <Info label="Firma">{state.orgName}</Info>
          </Group>
          <KeyMissing state={state} />
        </>
      ) : (
        <>
          {state.lastError && (
            <div className="notice notice-warn">
              <Icon name="alert" />
              <span>{state.lastError}</span>
            </div>
          )}
          <Group>
            <Info label="Konto">{state.email}</Info>
            <Info label="Firma">{state.orgName}</Info>
            {state.displayName && <Info label="Imię">{state.displayName}</Info>}
            {state.branchName && (
              <Info label="Oddział">
                {state.branchName}
                {state.role === 'owner' ? ' · szef' : ''}
              </Info>
            )}
            <Info label="Ostatnio">{running ? 'Synchronizuję…' : state.lastSyncAt ? formatInstant(state.lastSyncAt) : 'Jeszcze nie'}</Info>
            <Info label="Do wysłania">
              {pending === 0 ? <Badge tone="ok">Wszystko wysłane</Badge> : <Badge tone="warn">Zmiany: {pending}</Badge>}
            </Info>
            <Info label="Szyfrowanie">
              <Badge tone="ok">Włączone</Badge>
            </Info>
          </Group>
          {!state.displayName && (
            <div className="form card">
              <Field label="Twoje imię" hint="Pojawi się w raportach i na liście techników oddziału.">
                <input value={name} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
              </Field>
              <button type="button" className="btn btn-primary btn-block" disabled={!name.trim()} onClick={() => void saveName()}>
                Zapisz imię
              </button>
            </div>
          )}
          <button type="button" className="btn btn-primary btn-block" disabled={running} onClick={() => void syncNow()}>
            {running ? 'Synchronizuję…' : 'Synchronizuj teraz'}
          </button>
          <p className="field-hint">
            Synchronizacja działa sama, gdy aplikacja jest otwarta: po starcie, po każdej zmianie i co minutę. iPhone nie pozwala
            jej działać w tle. Dane wychodzą z urządzenia wyłącznie zaszyfrowane.
          </p>
        </>
      )}
      <button type="button" className="btn btn-block" onClick={() => setSignOutOpen(true)}>
        Wyloguj
      </button>

      <Sheet open={signOutOpen} title="Wylogowanie" onClose={() => setSignOutOpen(false)}>
        <p className="sheet-text">
          {pending > 0
            ? `Liczba zmian, które jeszcze nie dotarły na serwer: ${pending}. Wyślą się po ponownym zalogowaniu.`
            : 'Wszystkie zmiany są na serwerze.'}
        </p>
        <div className="btn-stack">
          <button type="button" className="btn" onClick={() => void signOut(false)}>
            Wyloguj, zostaw dane na urządzeniu
          </button>
          <button type="button" className="btn btn-danger-quiet" onClick={() => void signOut(true)}>
            Wyloguj i usuń dane z urządzenia
          </button>
        </div>
      </Sheet>
    </>
  );
}

/** Krótki stan na pulpit: tylko gdy coś wymaga uwagi. */
export function SyncNotice() {
  const state = useLiveQuery(async () => (await getSyncState()) ?? null);
  if (!isSyncConfigured || !state?.lastError) return null;
  return (
    <a href="#/konto" className="notice notice-warn">
      <Icon name="alert" />
      <span>
        <strong>Synchronizacja wstrzymana.</strong> {state.lastError}
      </span>
    </a>
  );
}

// ---------- Oddziały ----------

interface BranchView {
  branches: Branch[];
  members: Member[];
}

/** Technicy oddziałów z ich zleceniami i obrotem. Szef widzi wszystkie oddziały, technik swój. */
export function BranchesPage() {
  const { run, toast } = useFeedback();
  const { share } = useContactActions();
  const state = useLiveQuery(async () => (await getSyncState()) ?? null);
  const local = useLiveQuery(async () => ({ orders: await orders.all(), visits: await visits.all() }));
  const [view, setView] = useState<BranchView | null>(null);
  const [newBranch, setNewBranch] = useState('');
  const [invite, setInvite] = useState<{ code: string; branch: string } | null>(null);
  const orgId = state?.orgId;

  const load = async () => {
    if (!orgId) return;
    const api = await supabaseApi();
    setView({ branches: await api.listBranches(orgId), members: await api.listMembers(orgId) });
  };

  useEffect(() => {
    void run(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  if (state === undefined || !local) return <Loading />;
  if (!state) {
    return (
      <Page title="Oddziały" back="/wiecej">
        <Empty icon="building" title="Oddziały działają po zalogowaniu do konta firmy">
          <a className="btn btn-primary" href="#/konto">
            Konto i synchronizacja
          </a>
        </Empty>
      </Page>
    );
  }

  const owner = state.role === 'owner';
  const week = periodOf('tydzien', todayWarsaw());

  const inviteText = (code: string, branch: string) =>
    [
      `Zaproszenie do aplikacji ${COMPANY_NAME} (oddział ${branch}).`,
      '1. Otwórz https://mariana1112.github.io/ddd-firma/ w Safari i dodaj do ekranu początkowego.',
      '2. Więcej → Konto i synchronizacja → Nie mam konta, załóż je.',
      `3. Wybierz „Mam kod od szefa” i wpisz: ${code}`,
    ].join('\n');

  return (
    <Page title="Oddziały" back="/wiecej">
      {!view ? (
        <Loading />
      ) : (
        <>
          {view.branches.map((branch) => {
            const members = view.members.filter((m) => m.branchId === branch.id);
            return (
              <Group
                key={branch.id}
                title={`${branch.name} (${members.length})`}
                action={
                  owner ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() =>
                        void run(async () =>
                          setInvite({ code: await (await supabaseApi()).createInvite(state.orgId, branch.id), branch: branch.name }),
                        )
                      }
                    >
                      Zaproś technika
                    </button>
                  ) : undefined
                }
              >
                {members.length === 0 && <Empty title="Brak techników w tym oddziale" />}
                {members.map((m) => {
                  const mine = (id: string | null | undefined) => ownedBy(id, m.userId, m.userId === state.userId);
                  const own = local.orders.filter((o) => mine(o.ownerId));
                  const done = local.visits.filter(
                    (v) => mine(v.technicianId) && v.status === 'wykonany' && v.doneOn !== null && v.doneOn >= week.from && v.doneOn <= week.to,
                  );
                  const turnover = done.reduce((sum, v) => sum + (v.amount ?? 0), 0);
                  const active = local.visits.filter((v) => mine(v.technicianId) && v.status === 'zaplanowany').length;
                  return (
                    <div key={m.userId} className="member">
                      <Row
                        to={`/raporty?technik=${m.userId}&imie=${encodeURIComponent(m.displayName || 'technik')}`}
                        icon="users"
                        title={`${m.displayName || 'Bez imienia'}${m.userId === state.userId ? ' (Ty)' : ''}${m.role === 'owner' ? ' · szef' : ''}`}
                        sub={`Zlecenia: ${own.length} · do zrobienia: ${active} · tydzień: ${formatPln(turnover)}`}
                      />
                      {owner && view.branches.length > 1 && (
                        <label className="member-move">
                          <span>Oddział</span>
                          <select
                            value={m.branchId ?? ''}
                            onChange={(e) =>
                              void run(async () => {
                                await (await supabaseApi()).setMemberBranch(state.orgId, m.userId, e.target.value);
                                await load();
                                toast('Przeniesiono technika. Jego dotychczasowe zlecenia zostają w starym oddziale.');
                              })
                            }
                          >
                            {view.branches.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  );
                })}
              </Group>
            );
          })}

          {owner && (
            <form
              className="form card"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await (await supabaseApi()).createBranch(state.orgId, newBranch.trim());
                  setNewBranch('');
                  await load();
                  toast('Dodano oddział');
                });
              }}
            >
              <Field label="Nowy oddział">
                <input value={newBranch} placeholder="Np. Gdynia" onChange={(e) => setNewBranch(e.target.value)} />
              </Field>
              <button type="submit" className="btn btn-block" disabled={!newBranch.trim()}>
                <Icon name="plus" /> Dodaj oddział
              </button>
            </form>
          )}
          {!owner && <p className="field-hint">Widzisz swój oddział. Wszystkie oddziały widzi szef.</p>}
        </>
      )}

      <Sheet open={Boolean(invite)} title="Kod zaproszenia" onClose={() => setInvite(null)}>
        {invite && (
          <>
            <p className="invite-code">{invite.code}</p>
            <p className="sheet-text">
              Kod przypisuje do oddziału {invite.branch}, działa raz i jest ważny 14 dni. Hasło szyfrowania przekaż technikowi
              osobno, najlepiej osobiście.
            </p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => void share(inviteText(invite.code, invite.branch), 'Zaproszenie')}>
              <Icon name="share" /> Wyślij zaproszenie
            </button>
          </>
        )}
      </Sheet>
    </Page>
  );
}
