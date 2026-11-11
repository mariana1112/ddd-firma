import { useLiveQuery } from 'dexie-react-hooks';
import { DomainError } from '../data/domain';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { createSnapshot } from '../data/backup';
import { pendingCount } from '../data/changes';
import { db } from '../data/db';
import { getDataKey, getSyncState, ownedBy, saveProfile, setDataKey, setSyncState } from '../data/settings';
import { checkServerConnection, isSyncConfigured } from '../data/sync/config';
import { CODE_LENGTH, createDataKey, formatSignupCode, MIN_PASSPHRASE, parseSignupCode, unwrapDataKey } from '../data/sync/crypto';
import type { Account } from '../data/sync/engine';
import { ACCOUNT_REMOVED_KEY, getSyncStatus, loadServer, subscribeSyncStatus, syncInBackground } from '../data/sync/runner';
import type { Branch, Member, Membership } from '../data/sync/supabase';
import { formatPln, periodOf } from '../data/reports';
import { orders, visits } from '../data/repo';
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
 * Ekran logowania przed użyciem aplikacji: bez konta firmy nie widać zleceń ani menu. Konto zakłada się własnym
 * e-mailem i hasłem z kodem od admina; potem urządzenie zostaje zalogowane na stałe.
 */
export function LoginGate() {
  const [removedAt] = useState(() => {
    try {
      return localStorage.getItem(ACCOUNT_REMOVED_KEY);
    } catch {
      return null;
    }
  });
  return (
    <Page title="Logowanie">
      {removedAt && (
        <p className="notice notice-warn">
          <Icon name="alert" />
          <span>Admin usunął Twoje konto. Wylogowano Cię, a dane firmy zostały usunięte z tego telefonu.</span>
        </p>
      )}
      <Connect />
    </Page>
  );
}

/**
 * Sesja logowania zniknęła (np. konto usunięte albo hasło zmienione na innym telefonie): aplikacja jest zablokowana,
 * dopóki ta osoba nie zaloguje się ponownie. Bez tego usunięte konto miałoby dalej wgląd do starych zleceń.
 */
export function SessionLock({ state }: { state: SyncState }) {
  const { confirm, run, toast } = useFeedback();
  const wipe = async () => {
    const ok = await confirm({
      title: 'Usunąć dane z telefonu?',
      message: 'Zlecenia, zdjęcia i ustawienia firmy znikną z tego telefonu. Niewysłane zmiany przepadną. Potem zalogujesz się od nowa.',
      confirmLabel: 'Usuń dane',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await (await supabaseApi()).signOut().catch(() => undefined);
      await (await engineApi()).disableSync({ wipe: true });
      toast('Dane usunięte z telefonu');
    });
  };
  return (
    <Page title="Zaloguj się ponownie">
      <Relogin state={state} />
      <p className="field-hint">Dopóki nie zalogujesz się ponownie, zlecenia firmy na tym telefonie są niedostępne.</p>
      <button type="button" className="btn btn-danger-quiet btn-block" onClick={() => void wipe()}>
        <Icon name="trash" /> Usuń dane firmy z tego telefonu
      </button>
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
  | { kind: 'register' }
  | { kind: 'org'; userId: string; email: string; name: string; code?: string };

const MIN_PASSWORD = 12;

/** Logowanie albo zakładanie konta. Dwie zakładki, nic więcej. */
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

  if (step.kind === 'signin' || step.kind === 'register') {
    const register = step.kind === 'register';
    return (
      <>
        <div className="segmented" role="group">
          <button type="button" className={register ? '' : 'active'} onClick={() => setStep({ kind: 'signin' })}>
            Zaloguj się
          </button>
          <button type="button" className={register ? 'active' : ''} onClick={() => setStep({ kind: 'register' })}>
            Załóż konto
          </button>
        </div>
        {register ? (
          <RegisterForm onSignedIn={(user, code) => setStep({ kind: 'org', ...user, code })} />
        ) : (
          <>
            <SignInForm
              onRegister={() => setStep({ kind: 'register' })}
              submit={(email, password) =>
                run(async () => {
                  const api = await supabaseApi();
                  setStep({ kind: 'org', ...(await api.signIn(email, password)) });
                })
              }
            />
            <ForgotPassword />
          </>
        )}
        <ConnectionCheck />
      </>
    );
  }

  return (
    <ChooseOrg
      userId={step.userId}
      email={step.email}
      name={step.name}
      initialCode={step.code}
      onSignedOut={() => setStep({ kind: 'signin' })}
    />
  );
}

function SignInForm(props: { submit: (email: string, password: string) => Promise<unknown>; onRegister: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = /^\S+@\S+\.\S+$/.test(email.trim()) && password.length > 0;
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        await props.submit(email.trim(), password);
        setBusy(false);
      }}
    >
      <Field label="E-mail">
        <input type="email" name="email" inputMode="email" autoCapitalize="none" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Hasło">
        <input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={!ready || busy}>
        {busy ? 'Chwileczkę…' : 'Zaloguj'}
      </button>
      <button type="button" className="link" onClick={props.onRegister}>
        Nie mam konta, mam kod od admina
      </button>
    </form>
  );
}

/** Pole kodu weryfikacyjnego: litery i cyfry, same układają się w grupy po 4 (ABCD-EFGH-JKMN-PQRS). */
function CodeField(props: { value: string; onChange: (value: string) => void; label?: string; hint?: string }) {
  const filled = props.value.replace(/[^0-9A-Z]/g, '').length;
  return (
    <Field
      label={props.label ?? 'Kod od admina'}
      hint={props.hint ?? '16 znaków. Wielkość liter i myślniki nie mają znaczenia.'}
      error={filled > CODE_LENGTH ? `Kod ma ${CODE_LENGTH} znaków` : undefined}
    >
      <input
        value={props.value}
        autoCapitalize="characters"
        autoComplete="one-time-code"
        autoCorrect="off"
        spellCheck={false}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        onChange={(e) => props.onChange(formatSignupCode(e.target.value))}
      />
    </Field>
  );
}

const codeComplete = (code: string) => parseSignupCode(code) !== null;

/**
 * Zakładanie konta: imię, własny e-mail i hasło oraz kod od admina. Bez ważnego kodu serwer konta nie założy.
 * Po założeniu urządzenie od razu dołącza do regionu z kodu: bez czekania na zgodę i bez hasła firmy.
 */
function RegisterForm(props: { onSignedIn: (user: { userId: string; email: string; name: string }, code: string) => void }) {
  const { run, toast } = useFeedback();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = repeat.length > 0 && repeat !== password;
  const ready = name.trim().length > 0 && validEmail && password.length >= MIN_PASSWORD && repeat === password && codeComplete(code);

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ready) return;
        setBusy(true);
        await run(async () => {
          const api = await supabaseApi();
          try {
            const { key, orgId, user } = await api.registerWithCode({ name, email, password, code });
            const m = (await api.myMemberships()).find((x) => x.orgId === orgId);
            if (!m) throw new DomainError('Nie udało się dołączyć do firmy. Wpisz kod ponownie.');
            await startEncryptedSync(key, membershipAccount(m, { ...user, name: name.trim() }));
            toast('Konto założone. Witaj!');
          } catch (error) {
            // Konto mogło już powstać (np. zerwane połączenie przy dołączaniu): dokończenie na następnym ekranie.
            const user = await api.currentUser().catch(() => null);
            if (user) props.onSignedIn({ ...user, name: user.name || name.trim() }, code);
            throw error;
          }
        });
        setBusy(false);
      }}
    >
      <Field label="Imię i nazwisko">
        <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Twój e-mail">
        <input type="email" name="email" inputMode="email" autoCapitalize="none" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Hasło" error={tooShort ? `Co najmniej ${MIN_PASSWORD} znaków` : undefined} hint="Co najmniej 12 znaków.">
        <input type="password" name="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Field label="Powtórz hasło" error={mismatch ? 'Hasła się różnią' : undefined}>
        <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </Field>
      <CodeField value={code} onChange={setCode} />
      <button type="submit" className="btn btn-primary btn-block" disabled={!ready || busy}>
        {busy ? 'Zakładam konto…' : 'Załóż konto'}
      </button>
      <p className="field-hint">Bez kodu od admina konta nie da się założyć. Kod przypisuje do regionu, działa raz i jest ważny 14 dni.</p>
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
 * „Nie pamiętam hasła” na ekranie logowania: link na e-mail konta. Link otwiera w aplikacji ekran nowego hasła.
 */
/**
 * Zmiana hasła szyfrowania przez admina na urządzeniu, które ma klucz. Nowe hasło wpisuje admin; aplikacja wysyła
 * wszystkie dane ponownie, zaszyfrowane nowym kluczem. Inne urządzenia trzeba potem odblokować nowym hasłem.
 */
function ChangePassphrase() {
  const { confirm, run, toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [repeat, setRepeat] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const ready = pass.length >= MIN_PASSPHRASE && pass === repeat && !step;
  if (!open) {
    return (
      <button type="button" className="btn btn-block" onClick={() => setOpen(true)}>
        Zmień hasło szyfrowania
      </button>
    );
  }
  const submit = async () => {
    const ok = await confirm({
      title: 'Zmienić hasło szyfrowania?',
      message:
        'Aplikacja pobierze wszystkie dane, utworzy nowy klucz i wyśle wszystko ponownie, zaszyfrowane nowym hasłem. Nie zamykaj aplikacji do końca. Inne telefony i komputery trzeba potem odblokować nowym hasłem, a niewykorzystane kody dołączenia przestaną działać.',
      confirmLabel: 'Zmień hasło',
    });
    if (!ok) return;
    await run(async () => {
      try {
        const [{ rotateDataKey }, server, api, secretsApi] = await Promise.all([engineApi(), loadServer(), supabaseApi(), import('../data/admin-secrets')]);
        const saved = await secretsApi.getAdminSecrets();
        const { photosMissing } = await rotateDataKey(server, pass, api.replaceOrgKey, setStep);
        // Zapamiętane hasła trzeba zaszyfrować nowym kluczem; zapamiętane hasło szyfrowania to teraz nowe hasło.
        if (saved.panel) await secretsApi.saveAdminSecret('panel', saved.panel);
        if (saved.company) await secretsApi.saveAdminSecret('company', pass);
        setPass('');
        setRepeat('');
        setOpen(false);
        toast(photosMissing ? `Hasło zmienione. Zdjęć niedostępnych na serwerze: ${photosMissing}.` : 'Hasło szyfrowania zmienione. Zapamiętaj je.');
      } finally {
        setStep(null);
      }
    });
  };
  return (
    <div className="form card">
      <p className="field-hint">
        Nowe hasło firmy do odblokowania danych na nowych urządzeniach. Co najmniej {MIN_PASSPHRASE} znaków. Zapisz je w bezpiecznym miejscu:
        bez niego nowe urządzenie nie odczyta danych.
      </p>
      <Field label="Nowe hasło szyfrowania">
        <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} disabled={Boolean(step)} />
      </Field>
      <Field label="Powtórz hasło" error={repeat && repeat !== pass ? 'Hasła się różnią' : undefined}>
        <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} disabled={Boolean(step)} />
      </Field>
      {step && <p className="notice notice-info">{step}</p>}
      <button type="button" className="btn btn-primary btn-block" disabled={!ready} onClick={() => void submit()}>
        {step ? 'Zmieniam…' : 'Zmień hasło szyfrowania'}
      </button>
      {!step && (
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Anuluj
        </button>
      )}
    </div>
  );
}

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

/**
 * Zalogowane konto bez firmy na tym urządzeniu: kod od admina (nowe konto, nowy telefon) albo hasło firmy.
 * Stare kody (bez klucza) nadal czekają na zgodę admina.
 */
function ChooseOrg(props: { userId: string; email: string; name: string; initialCode?: string; onSignedOut: () => void }) {
  const { run, toast } = useFeedback();
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [code, setCode] = useState(props.initialCode ?? '');
  const [name, setName] = useState(props.name);
  const [newPassphrase, setNewPassphrase] = useState<string | null>(null);
  const [showPassphrase, setShowPassphrase] = useState(false);
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

  const pending = memberships?.[0] && !memberships[0].approved;
  // Czekając na zgodę admina (stary kod), aplikacja sama sprawdza co 15 sekund.
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

  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true);
    await run(action);
    setBusy(false);
  };

  if (!memberships) return <Loading />;
  const hasLocal = Boolean(local && local.orders + local.trips > 0);
  const membership = memberships[0];

  /** Kod od admina: nowe konto dołącza do regionu, istniejące dostaje klucz firmy na tym telefonie. */
  const redeem = () =>
    withBusy(async () => {
      const api = await supabaseApi();
      const { key, orgId } = await api.redeemSignupCode(code, name);
      const m = (await api.myMemberships()).find((x) => x.orgId === orgId);
      if (!m) throw new DomainError('Nie udało się dołączyć do firmy. Poproś admina o nowy kod.');
      await startEncryptedSync(key, membershipAccount(m, user));
      toast('Gotowe. Telefon połączony z firmą.');
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

  const codeForm = (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (codeComplete(code)) void redeem();
      }}
    >
      {!membership && (
        <Field label="Imię i nazwisko">
          <input value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      <CodeField
        value={code}
        onChange={setCode}
        hint={membership ? 'Nowy telefon? Poproś admina o kod (panel admina → Kody). Działa raz, 14 dni.' : undefined}
      />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !codeComplete(code) || (!membership && !name.trim())}>
        {busy ? 'Łączę…' : 'Połącz kodem'}
      </button>
    </form>
  );

  return (
    <div className="form">
      <Group>
        <Info label="Konto">{props.email}</Info>
        {membership?.orgName && <Info label="Firma">{membership.orgName}</Info>}
        {membership?.branchName && <Info label="Region">{membership.branchName}</Info>}
      </Group>
      {hasLocal && (
        <div className="notice notice-warn">
          <Icon name="alert" />
          <span>
            Na tym urządzeniu są dane: zlecenia {local?.orders}, przejazdy {local?.trips}. Zostaną zaszyfrowane, wysłane na serwer
            i dołączone do Twojego regionu. Przed połączeniem powstanie migawka do przywrócenia.
          </span>
        </div>
      )}
      {membership && !membership.approved ? (
        <div className="form">
          <div className="notice notice-info">
            <Icon name="users" />
            <span>Admin musi jeszcze zatwierdzić Twoje konto. Ten ekran sprawdza to sam co 15 sekund.</span>
          </div>
          <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void withBusy(async () => setMemberships(await (await supabaseApi()).myMemberships()))}>
            {busy ? 'Sprawdzam…' : 'Sprawdź teraz'}
          </button>
        </div>
      ) : membership?.dataKey ? (
        <>
          <p className="field-hint">To konto jest w firmie, ale ten telefon nie ma jeszcze klucza firmy. Wpisz kod od admina.</p>
          {codeForm}
          {membership.role === 'owner' || showPassphrase ? (
            <UnlockForm busyLabel="Łączę…" onUnlock={(passphrase) => unlockAndSync(membership, passphrase)} />
          ) : (
            <button type="button" className="link" onClick={() => setShowPassphrase(true)}>
              Znam hasło firmy
            </button>
          )}
        </>
      ) : membership ? (
        <>
          <NewPassphrase onReady={setNewPassphrase} />
          <button type="button" className="btn btn-primary btn-block" disabled={busy || !newPassphrase} onClick={() => void setKeyAndSync(membership)}>
            {busy ? 'Włączam…' : 'Ustaw hasło i połącz urządzenie'}
          </button>
        </>
      ) : (
        <>
          <p className="field-hint">Wpisz kod od admina, żeby dołączyć do regionu.</p>
          {codeForm}
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

/** Nowe urządzenie: kod od admina przenosi klucz firmy (bez hasła firmy). */
function DeviceCodeForm({ onKey }: { onKey: (key: CryptoKey) => Promise<unknown> }) {
  const { run } = useFeedback();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!codeComplete(code)) return;
        setBusy(true);
        await run(async () => onKey((await (await supabaseApi()).redeemSignupCode(code)).key));
        setBusy(false);
      }}
    >
      <CodeField value={code} onChange={setCode} hint="Nowy telefon? Poproś admina o kod (panel admina → Kody)." />
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !codeComplete(code)}>
        {busy ? 'Sprawdzam…' : 'Połącz kodem'}
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

/**
 * Ponowne logowanie, gdy sesja na urządzeniu wygasła (np. po zmianie hasła na innym telefonie). Tylko to samo konto:
 * dane i klucz firmy zostają na urządzeniu, synchronizacja rusza od razu.
 */
function Relogin({ state }: { state: SyncState }) {
  const { run, toast } = useFeedback();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!password) return;
        setBusy(true);
        await run(async () => {
          const api = await supabaseApi();
          const user = await api.signIn(state.email, password);
          if (user.userId !== state.userId) {
            await api.signOut();
            throw new DomainError('To inne konto niż konto tego urządzenia.');
          }
          setPassword('');
          const latest = await getSyncState();
          if (latest) await setSyncState({ ...latest, lastError: null });
          await syncInBackground();
          toast('Zalogowano ponownie, synchronizacja działa');
        });
        setBusy(false);
      }}
    >
      <div className="notice notice-warn">
        <Icon name="alert" />
        <span>Sesja logowania na tym urządzeniu wygasła. Wpisz hasło do konta {state.email}, żeby dalej synchronizować.</span>
      </div>
      <Field label="Hasło">
        <input type="password" name="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <button type="submit" className="btn btn-primary btn-block" disabled={!password || busy}>
        {busy ? 'Loguję…' : 'Zaloguj ponownie'}
      </button>
    </form>
  );
}

function SyncStatus({ state }: { state: SyncState }) {
  const [sessionLost, setSessionLost] = useState(false);
  useEffect(() => {
    void supabaseApi()
      .then((api) => api.hasSession())
      .then((ok) => setSessionLost(!ok))
      .catch(() => undefined);
  }, [state.lastError]);
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
      {sessionLost && <Relogin state={state} />}
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
          {state.lastError && !sessionLost && (
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
          {/* Technik zmienia region na ekranie „Region” (Więcej), tu zostaje tylko konto i synchronizacja. */}
          {state.role === 'owner' && <RegionSwitcher state={state} />}
          {state.role === 'owner' && <ChangePassphrase />}
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
  const state = useLiveQuery(async () => (await getSyncState()) ?? null);
  const local = useLiveQuery(async () => ({ orders: await orders.all(), visits: await visits.all() }));
  const [view, setView] = useState<BranchView | null>(null);
  const [newBranch, setNewBranch] = useState('');
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
              <p className="field-hint member-hint">Zatwierdzaj tylko osoby, które znasz.</p>
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
                    <a className="link" href="#/admin">
                      Kod dla technika
                    </a>
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

    </Page>
  );
}
