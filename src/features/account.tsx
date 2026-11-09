import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createSnapshot } from '../data/backup';
import { pendingCount } from '../data/changes';
import { db } from '../data/db';
import { COMPANY_NAME, getDataKey, getSyncState, ownedBy, saveProfile, setDataKey, setSyncState } from '../data/settings';
import { checkServerConnection, isSyncConfigured } from '../data/sync/config';
import { createDataKey, CryptoError, INVITE_LENGTH, inviteProof, MIN_PASSPHRASE, unwrapDataKey } from '../data/sync/crypto';
import type { Account } from '../data/sync/engine';
import { getSyncStatus, loadServer, subscribeSyncStatus, syncInBackground } from '../data/sync/runner';
import type { Branch, InvitePreview, Member, Membership } from '../data/sync/supabase';
import { formatPln, periodOf } from '../data/reports';
import { orders, visits } from '../data/repo';
import { useContactActions } from './common';
import type { SyncState } from '../data/types';
import { formatInstant, todayWarsaw } from '../lib/dates';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Empty, Field, Group, Info, Loading, Page, Row, Sheet } from '../ui/kit';

import { RegionSwitcher } from './regions';

const supabaseApi = () => import('../data/sync/supabase');
const engineApi = () => import('../data/sync/engine');

export function useSyncRunning(): boolean {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus).running;
}

/**
 * Ekran logowania przed użyciem aplikacji: bez konta firmy nie widać zleceń ani menu. Po zalogowaniu i połączeniu
 * z firmą (kod, hasło szyfrowania, zgoda admina) urządzenie zostaje zalogowane na stałe.
 */
export function LoginGate() {
  return (
    <Page title="Zaloguj się">
      <p className="field-hint">Aplikacja Pogromców Insektów działa po zalogowaniu do konta firmy.</p>
      <Connect />
    </Page>
  );
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
  | { kind: 'org'; userId: string; email: string; name: string }
  | { kind: 'admin' };

const MIN_PASSWORD = 12;

function Connect() {
  const { run } = useFeedback();
  const [step, setStep] = useState<Step>({ kind: 'checking' });

  useEffect(() => {
    void (async () => {
      const api = await supabaseApi();
      const user = await api.currentUser().catch(() => null);
      setStep(user ? { kind: 'org', ...user } : { kind: 'admin' });
    })();
  }, []);

  if (step.kind === 'checking') return <Loading />;

  if (step.kind === 'admin') {
    return (
      <>
        <AdminDataForm onOwnAccount={() => setStep({ kind: 'signin' })} />
        <ConnectionCheck />
      </>
    );
  }

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
      <>
      <PasswordForm
        signup={signup}
        onSwitch={() => setStep({ kind: signup ? 'signin' : 'admin' })}
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
      {!signup && <ForgotPassword />}
      <ConnectionCheck />
      </>
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
        {props.signup ? 'Mam już konto, zaloguj' : 'Nie mam konta: mam login, hasło i kod od admina'}
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

/**
 * „Nie pamiętam hasła” na ekranie logowania: link na e-mail konta. Link otwiera w aplikacji ekran nowego hasła;
 * konto admina z ustawionymi pytaniami pomocniczymi odpowiada na nie przed ustawieniem hasła.
 */
/** Test połączenia z serwerem na ekranie logowania, z podpowiedzią, co zrobić przy blokadzie. */
function ConnectionCheck() {
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    const r = await checkServerConnection();
    setBusy(false);
    setResult(
      r.ok
        ? `Serwer odpowiada (${r.ms} ms). Połączenie działa.`
        : navigator.onLine === false
          ? 'Brak internetu na tym urządzeniu.'
          : `Telefon nie łączy się z serwerem: ${r.error}. Spróbuj przez Wi-Fi zamiast danych komórkowych, wyłącz bloker reklam w Safari (Ustawienia → Safari → Rozszerzenia) i filtr operatora (np. CyberTarcza w Orange, „Bezpieczny Internet” w Play, „Ochrona” w T-Mobile), potem sprawdź ponownie.`,
    );
  };
  return (
    <div className="connection-check">
      <button type="button" className="link" disabled={busy} onClick={() => void check()}>
        {busy ? 'Sprawdzam połączenie…' : 'Sprawdź połączenie z serwerem'}
      </button>
      {result && <p className="field-hint">{result}</p>}
    </div>
  );
}

function ForgotPassword() {
  const { run, toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());
  if (!open) {
    return (
      <button type="button" className="link" onClick={() => setOpen(true)}>
        Nie pamiętam hasła
      </button>
    );
  }
  return (
    <form
      className="form card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid) return;
        setBusy(true);
        await run(async () => {
          await (await supabaseApi()).requestPasswordReset(email.trim(), `${window.location.origin}${window.location.pathname}`);
          toast(`Wysłano link na ${email.trim()}. Otwórz go na tym urządzeniu.`);
          setOpen(false);
        });
        setBusy(false);
      }}
    >
      <p className="field-hint">Wyślemy link do ustawienia nowego hasła. Otwórz go na tym urządzeniu. Sprawdź też folder spam.</p>
      <Field label="Adres e-mail konta">
        <input type="email" inputMode="email" autoCapitalize="none" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={!valid || busy}>
        {busy ? 'Wysyłam…' : 'Wyślij link'}
      </button>
      <button type="button" className="link" onClick={() => setOpen(false)}>
        Anuluj
      </button>
    </form>
  );
}

/**
 * Pierwsze logowanie danymi od admina: login, hasło tymczasowe i kod regionu. Konto od razu należy do firmy
 * i regionu z kodu; przed pracą aplikacja wymaga ustawienia własnego e-maila i hasła.
 */
function AdminDataForm({ onOwnAccount }: { onOwnAccount: () => void }) {
  const { run } = useFeedback();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = login.trim().length >= 6 && password.length >= 12 && code.trim().length >= INVITE_LENGTH;
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        await run(async () => {
          const api = await supabaseApi();
          const { key, orgId, user } = await api.signInWithAdminData(login, password, code);
          const m = (await api.myMemberships()).find((x) => x.orgId === orgId);
          if (!m) throw new Error('Nie udało się dołączyć do firmy. Poproś admina o nowe dane.');
          await startEncryptedSync(key, membershipAccount(m, user));
          const latest = await getSyncState();
          if (latest) await setSyncState({ ...latest, temp: true });
        });
        setBusy(false);
      }}
    >
      <div className="notice notice-info">
        <Icon name="users" />
        <span>Konto zakłada admin. Wpisz login, hasło i kod regionu, które od niego dostałeś. Potem ustawisz własny e-mail i hasło.</span>
      </div>
      <Field label="Login">
        <input value={login} autoCapitalize="none" autoComplete="username" spellCheck={false} placeholder="np. gda-k7m2p4" onChange={(e) => setLogin(e.target.value)} />
      </Field>
      <Field label="Hasło">
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Kod regionu">
        <input value={code} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="np. ABCD2345EF" onChange={(e) => setCode(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={!ready || busy}>
        {busy ? 'Łączę…' : 'Zaloguj'}
      </button>
      <button type="button" className="link" onClick={onOwnAccount}>
        Mam już własny e-mail i hasło
      </button>
    </form>
  );
}

/** Konto z loginem tymczasowym: przed pracą własne imię, e-mail i hasło. */
export function ClaimAccountPage({ state }: { state: SyncState }) {
  const { run, toast } = useFeedback();
  const [name, setName] = useState(state.displayName ?? '');
  const [email, setEmail] = useState('');
  const [email2, setEmail2] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const ready =
    name.trim().length > 0 && validEmail && email.trim().toLowerCase() === email2.trim().toLowerCase() && password.length >= MIN_PASSWORD && password === password2;
  return (
    <Page title="Ustaw własne dane">
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          setBusy(true);
          await run(async () => {
            const api = await supabaseApi();
            await api.claimAccount(email.trim(), password);
            await api.updateMyProfile(state.orgId, name.trim());
            const latest = (await getSyncState()) ?? state;
            await setSyncState({ ...latest, email: email.trim().toLowerCase(), displayName: name.trim(), temp: false });
            await saveProfile({ name: name.trim(), userId: latest.userId });
            toast('Gotowe. Od teraz logujesz się swoim e-mailem i hasłem.');
          });
          setBusy(false);
        }}
      >
        <p className="field-hint">
          Login i hasło od admina są tymczasowe. Ustaw swoje dane: od teraz będziesz logować się własnym e-mailem i hasłem, także na
          innych urządzeniach.
        </p>
        <Field label="Imię i nazwisko" hint="Pojawi się w raportach i na liście techników regionu.">
          <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Twój e-mail">
          <input type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Powtórz e-mail" error={email2 && email.trim().toLowerCase() !== email2.trim().toLowerCase() ? 'Adresy się różnią' : undefined}>
          <input type="email" inputMode="email" autoCapitalize="none" autoComplete="off" value={email2} onChange={(e) => setEmail2(e.target.value)} />
        </Field>
        <Field label="Nowe hasło" error={password && password.length < MIN_PASSWORD ? `Co najmniej ${MIN_PASSWORD} znaków` : undefined}>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Powtórz hasło" error={password2 && password2 !== password ? 'Hasła się różnią' : undefined}>
          <input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary btn-block" disabled={!ready || busy}>
          {busy ? 'Zapisuję…' : 'Zapisz i zacznij pracę'}
        </button>
      </form>
    </Page>
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
  // Dołączanie: kod, potem hasło od szefa. Klucz zostaje w pamięci do zgody szefa.
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [joinPassphrase, setJoinPassphrase] = useState('');
  const [joinedKey, setJoinedKey] = useState<CryptoKey | null>(null);
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

  const pending = memberships?.[0] && !memberships[0].approved;
  // Czekając na zgodę szefa, aplikacja sama sprawdza co 15 sekund.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          setMemberships(await (await supabaseApi()).myMemberships());
        } catch {
          // Brak internetu: kolejna próba za chwilę.
        }
      })();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [pending]);

  // Po zgodzie szefa urządzenie łączy się kluczem odwiniętym przy dołączaniu, bez ponownego hasła.
  const approvedNow = memberships?.[0]?.approved && memberships[0].dataKey ? memberships[0] : null;
  useEffect(() => {
    if (!approvedNow || !joinedKey) return;
    setJoinedKey(null);
    void run(async () => {
      await startEncryptedSync(joinedKey, membershipAccount(approvedNow, user));
      toast('Szef zatwierdził konto. Urządzenie połączone z firmą.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvedNow, joinedKey]);

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

  const checkCode = () =>
    withBusy(async () => {
      setPreview(await (await supabaseApi()).invitePreview(code.trim()));
    });

  const join = () =>
    withBusy(async () => {
      if (!preview?.dataKey) throw new CryptoError('Firma nie ma jeszcze hasła szyfrowania. Poproś szefa o nowy kod.');
      const key = await unwrapDataKey(joinPassphrase, preview.dataKey);
      const api = await supabaseApi();
      const orgId = await api.joinWithInvite(code.trim(), name.trim(), await inviteProof(key, code.trim()));
      if (!orgId) throw new CryptoError('Hasło nie pasuje do tego zaproszenia. Po 5 próbach kod przestaje działać.');
      setJoinedKey(key);
      setJoinPassphrase('');
      toast('Prośba wysłana. Czekaj na zgodę szefa.');
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
        {membership?.orgName && <Info label="Firma">{membership.orgName}</Info>}
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
      {membership && !membership.approved ? (
        <div className="form">
          <p className="steps">Krok 3 z 3 · Zgoda szefa</p>
          <div className="notice notice-info">
            <Icon name="users" />
            <span>
              Kod i hasło są poprawne. Szef musi teraz zatwierdzić Twoje konto w aplikacji (Więcej → Oddziały). Do tego czasu nie
              widzisz danych firmy. Ten ekran sprawdza to sam co 15 sekund.
            </span>
          </div>
          <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void withBusy(async () => setMemberships(await (await supabaseApi()).myMemberships()))}>
            {busy ? 'Sprawdzam…' : 'Sprawdź teraz'}
          </button>
        </div>
      ) : membership?.dataKey ? (
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
          {mode === 'join' && !preview ? (
            <>
              <p className="steps">Krok 1 z 3 · Kod zaproszenia</p>
              <Field label="Kod zaproszenia" hint="Szef tworzy go w aplikacji: Więcej → Oddziały. Kod przypisuje Cię do oddziału.">
                <input
                  value={code}
                  autoCapitalize="characters"
                  autoComplete="off"
                  maxLength={INVITE_LENGTH + 4}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
                />
              </Field>
              <button
                type="button"
                className="btn btn-primary btn-block"
                disabled={busy || !name.trim() || code.trim().length !== INVITE_LENGTH}
                onClick={() => void checkCode()}
              >
                {busy ? 'Sprawdzam…' : 'Dalej'}
              </button>
            </>
          ) : mode === 'join' && preview ? (
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                void join();
              }}
            >
              <p className="steps">Krok 2 z 3 · Hasło od szefa</p>
              <Group>
                <Info label="Firma">{preview.orgName}</Info>
                <Info label="Oddział">{preview.branchName}</Info>
              </Group>
              <Field label="Hasło szyfrowania firmy" hint="Szef przekazuje je osobiście. Hasło nie jest wysyłane na serwer: urządzenie sprawdza je samo.">
                <input type="password" autoComplete="off" value={joinPassphrase} onChange={(e) => setJoinPassphrase(e.target.value)} />
              </Field>
              <button type="submit" className="btn btn-primary btn-block" disabled={busy || !joinPassphrase}>
                {busy ? 'Sprawdzam hasło…' : 'Wyślij prośbę o dołączenie'}
              </button>
              <button
                type="button"
                className="link"
                onClick={() => {
                  setPreview(null);
                  setJoinPassphrase('');
                }}
              >
                Inny kod
              </button>
            </form>
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
/** Nowe urządzenie osoby z kontem od admina: hasło i kod od admina przenoszą klucz firmy. */
function DeviceCodeForm({ onKey }: { onKey: (key: CryptoKey) => Promise<unknown> }) {
  const { run } = useFeedback();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form card"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await run(async () => onKey(await (await supabaseApi()).redeemDeviceCode(password, code)));
        setBusy(false);
      }}
    >
      <p className="field-hint">Masz hasło i kod od admina na nowe urządzenie? Wpisz je tutaj. Hasło firmy nie jest wtedy potrzebne.</p>
      <Field label="Hasło od admina">
        <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Kod">
        <input value={code} autoCapitalize="characters" autoComplete="off" onChange={(e) => setCode(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || password.length < 12 || code.trim().length < INVITE_LENGTH}>
        {busy ? 'Sprawdzam…' : 'Odblokuj kodem od admina'}
      </button>
    </form>
  );
}

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
      <>
        <DeviceCodeForm
          onKey={(key) =>
            run(async () => {
              await startEncryptedSync(key, account);
              toast('Synchronizacja odblokowana');
            })
          }
        />
        <UnlockForm
          busyLabel="Odblokowuję…"
          onUnlock={(passphrase) =>
            run(async () => {
              await startEncryptedSync(await unwrapDataKey(passphrase, wrapped), account);
              toast('Synchronizacja odblokowana');
            })
          }
        />
      </>
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
              <Info label="Region">
                {state.branchName}
                {state.role === 'owner' ? ' · admin' : ''}
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
          <RegionSwitcher state={state} />
          <button type="button" className="btn btn-primary btn-block" disabled={running} onClick={() => void syncNow()}>
            {running ? 'Synchronizuję…' : 'Synchronizuj teraz'}
          </button>
          <p className="field-hint">
            Synchronizacja działa sama, gdy aplikacja jest otwarta: po starcie, po każdej zmianie i co minutę. iPhone nie pozwala
            jej działać w tle. Dane wychodzą z urządzenia wyłącznie zaszyfrowane.
          </p>
        </>
      )}
      {/* Urządzenie technika jest na stałe przypisane do regionu: po każdym uruchomieniu wchodzi od razu do niego.
          Wylogowanie zostaje adminowi, a technikowi tylko wtedy, gdy urządzenie nie ma klucza (np. usunięty z firmy). */}
      {state.role === 'owner' || hasKey === false ? (
        <button type="button" className="btn btn-block" onClick={() => setSignOutOpen(true)}>
          Wyloguj
        </button>
      ) : (
        <p className="field-hint">
          To urządzenie jest na stałe zalogowane do regionu {state.branchName || 'konta'}. Przy każdym uruchomieniu aplikacja
          wchodzi od razu do tego regionu, bez logowania. Przenieść konto do innego regionu albo odłączyć je może admin.
        </p>
      )}

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
  const { confirm, run, toast } = useFeedback();
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
      <Page title="Regiony i technicy" back="/admin">
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
      `3. Wybierz „Mam kod od szefa” i wpisz kod: ${code}`,
      '4. Wpisz hasło szyfrowania firmy, które podam Ci osobiście.',
      '5. Poczekaj, aż zatwierdzę Twoje konto.',
    ].join('\n');

  return (
    <Page title="Regiony i technicy" back="/admin">
      {!view ? (
        <Loading />
      ) : (
        <>
          {owner && view.members.some((m) => !m.approved) && (
            <Group title="Czekają na Twoją zgodę">
              {view.members
                .filter((m) => !m.approved)
                .map((m) => (
                  <div key={m.userId} className="member">
                    <Row
                      icon="users"
                      title={m.displayName || 'Bez imienia'}
                      sub={`${m.email || 'bez adresu e-mail'} · oddział ${view.branches.find((b) => b.id === m.branchId)?.name ?? '—'}`}
                    />
                    <div className="member-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() =>
                          void run(async () => {
                            await (await supabaseApi()).approveMember(state.orgId, m.userId);
                            await load();
                            toast(`Zatwierdzono: ${m.displayName || m.email}`);
                          })
                        }
                      >
                        Zatwierdź
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger-quiet"
                        onClick={() =>
                          void run(async () => {
                            await (await supabaseApi()).removeMember(state.orgId, m.userId);
                            await load();
                            toast('Odrzucono prośbę');
                          })
                        }
                      >
                        Odrzuć
                      </button>
                    </div>
                  </div>
                ))}
              <p className="field-hint member-hint">Zatwierdzaj tylko osoby, które znasz i którym przekazałeś kod oraz hasło.</p>
            </Group>
          )}

          {view.branches.map((branch) => {
            const members = view.members.filter((m) => m.approved && m.branchId === branch.id);
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
                        void run(async () => {
                          const key = await getDataKey();
                          if (!key) throw new CryptoError('Najpierw odblokuj szyfrowanie na tym urządzeniu: Więcej → Konto.');
                          setInvite({ code: await (await supabaseApi()).createInvite(state.orgId, branch.id, key), branch: branch.name });
                        })
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
                      {owner && m.role !== 'owner' && (
                        <button
                          type="button"
                          className="link member-remove"
                          onClick={() =>
                            void (async () => {
                              const ok = await confirm({
                                title: `Usunąć ${m.displayName || 'technika'} z firmy?`,
                                message: 'Konto straci dostęp do danych firmy przy następnej synchronizacji. Jego zlecenia i przejazdy zostają.',
                                confirmLabel: 'Usuń z firmy',
                                danger: true,
                              });
                              if (!ok) return;
                              await run(async () => {
                                await (await supabaseApi()).removeMember(state.orgId, m.userId);
                                await load();
                                toast('Usunięto z firmy');
                              });
                            })()
                          }
                        >
                          Usuń z firmy
                        </button>
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
              Kod przypisuje do oddziału {invite.branch}, działa raz i jest ważny 14 dni. Sam kod nie wystarczy: technik musi
              wpisać też hasło szyfrowania, które przekazujesz osobiście, nigdy razem z kodem. Potem jego prośba pojawi się tutaj
              i musisz ją zatwierdzić.
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
