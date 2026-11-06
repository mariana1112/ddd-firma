import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createSnapshot } from '../data/backup';
import { pendingCount } from '../data/changes';
import { db } from '../data/db';
import { getCompany, getDataKey, getSyncState, setDataKey } from '../data/settings';
import { isSyncConfigured } from '../data/sync/config';
import { createDataKey, MIN_PASSPHRASE, unwrapDataKey } from '../data/sync/crypto';
import type { Account } from '../data/sync/engine';
import { getSyncStatus, loadServer, subscribeSyncStatus, syncInBackground } from '../data/sync/runner';
import type { Membership } from '../data/sync/supabase';
import type { SyncState } from '../data/types';
import { formatInstant } from '../lib/dates';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Empty, Field, Group, Info, Loading, Page, Sheet } from '../ui/kit';

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
  | { kind: 'org'; userId: string; email: string };

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
        submit={(email, password) =>
          run(async () => {
            const api = await supabaseApi();
            if (signup && (await api.signUp(email, password)) === 'confirm') {
              setStep({ kind: 'confirm', email });
              return;
            }
            setStep({ kind: 'org', ...(await api.signIn(email, password)) });
          })
        }
      />
    );
  }

  return <ChooseOrg userId={step.userId} email={step.email} onSignedOut={() => setStep({ kind: 'signin' })} />;
}

function PasswordForm(props: {
  signup: boolean;
  submit: (email: string, password: string) => Promise<unknown>;
  onSwitch: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const tooShort = props.signup && password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = props.signup && repeat.length > 0 && repeat !== password;
  const ready = validEmail && password.length > 0 && (!props.signup || (password.length >= MIN_PASSWORD && repeat === password));

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await props.submit(email.trim(), password);
        setBusy(false);
      }}
    >
      <div className="notice notice-info">
        <Icon name="database" />
        <span>
          Synchronizacja trzyma kopię danych firmy na serwerze w UE i przenosi zmiany między Twoimi urządzeniami. Aplikacja
          dalej działa bez internetu, a zmiany wyśle, gdy pojawi się połączenie.
        </span>
      </div>
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

  useEffect(() => onReady(ready ? passphrase : null), [ready, passphrase, onReady]);

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

function ChooseOrg(props: { userId: string; email: string; onSignedOut: () => void }) {
  const { run, toast } = useFeedback();
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [orgName, setOrgName] = useState('');
  const [newPassphrase, setNewPassphrase] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const local = useLiveQuery(async () => ({ clients: await db.clients.count(), jobs: await db.jobs.count() }));

  useEffect(() => {
    void run(async () => {
      const api = await supabaseApi();
      setMemberships(await api.myMemberships());
      setOrgName((await getCompany()).name);
    });
  }, [run]);

  const account = (orgId: string, name: string): Account => ({ orgId, orgName: name, userId: props.userId, email: props.email });

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    await run(action);
    setBusy(false);
  };

  if (!memberships) return <Loading />;
  const hasLocal = Boolean(local && local.clients + local.jobs > 0);
  const membership = memberships[0];

  const createOrgAndSync = () =>
    withBusy(async () => {
      const { key, wrapped } = await createDataKey(newPassphrase!);
      const orgId = await (await supabaseApi()).createOrg(orgName.trim(), wrapped);
      await startEncryptedSync(key, account(orgId, orgName.trim()));
      toast('Synchronizacja z szyfrowaniem włączona');
    });

  const setKeyAndSync = (m: Membership) =>
    withBusy(async () => {
      const { key, wrapped } = await createDataKey(newPassphrase!);
      await (await supabaseApi()).setOrgKey(m.orgId, wrapped);
      await startEncryptedSync(key, account(m.orgId, m.orgName));
      toast('Szyfrowanie włączone');
    });

  const unlockAndSync = (m: Membership, passphrase: string) =>
    run(async () => {
      const key = await unwrapDataKey(passphrase, m.dataKey!);
      await startEncryptedSync(key, account(m.orgId, m.orgName));
      toast('Urządzenie połączone z firmą');
    });

  return (
    <div className="form">
      <Group>
        <Info label="Konto">{props.email}</Info>
        {membership && <Info label="Firma">{membership.orgName}</Info>}
      </Group>
      {hasLocal && (
        <div className="notice notice-warn">
          <Icon name="alert" />
          <span>
            Na tym urządzeniu są dane: klienci {local?.clients}, zlecenia {local?.jobs}. Zostaną zaszyfrowane, wysłane na serwer
            i połączone z danymi firmy. Przed włączeniem powstanie migawka do przywrócenia.
          </span>
        </div>
      )}
      {membership?.dataKey ? (
        <UnlockForm busyLabel="Łączę…" onUnlock={(passphrase) => unlockAndSync(membership, passphrase)} />
      ) : membership ? (
        <>
          <NewPassphrase onReady={setNewPassphrase} />
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy || !newPassphrase}
            onClick={() => void setKeyAndSync(membership)}
          >
            {busy ? 'Włączam…' : 'Ustaw hasło i połącz urządzenie'}
          </button>
        </>
      ) : (
        <>
          <Field label="Nazwa firmy">
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} autoComplete="organization" />
          </Field>
          <NewPassphrase onReady={setNewPassphrase} />
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy || !orgName.trim() || !newPassphrase}
            onClick={() => void createOrgAndSync()}
          >
            {busy ? 'Włączam…' : 'Utwórz firmę i włącz synchronizację'}
          </button>
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
  const account: Account = { orgId: state.orgId, orgName: state.orgName, userId: state.userId, email: state.email };

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
            <Info label="Ostatnio">{running ? 'Synchronizuję…' : state.lastSyncAt ? formatInstant(state.lastSyncAt) : 'Jeszcze nie'}</Info>
            <Info label="Do wysłania">
              {pending === 0 ? <Badge tone="ok">Wszystko wysłane</Badge> : <Badge tone="warn">Zmiany: {pending}</Badge>}
            </Info>
            <Info label="Szyfrowanie">
              <Badge tone="ok">Włączone</Badge>
            </Info>
          </Group>
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
