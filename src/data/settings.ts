import { newId } from '../lib/ids';
import { logChange } from './changes';
import { db, writeTransaction } from './db';
import { setOwnBranch } from './scope';
import type { CompanySettings, NumberBlock, SyncState } from './types';

/** Jedna firma, więc nazwa jest stała. */
export const COMPANY_NAME = 'Pogromcy Insektów';

export const DEFAULT_COMPANY: CompanySettings = {
  name: COMPANY_NAME,
  owner: '',
  nip: '',
  regon: '',
  street: '',
  postalCode: '',
  city: '',
  phone: '',
  email: '',
  bankAccount: '',
  logoDataUrl: null,
  vatPayer: true,
  defaultVatRate: 23,
  offerValidityDays: 30,
  protocolFooter: '',
};

/** Klucze meta wspólne dla wszystkich urządzeń firmy. */
export const SYNCED_META_KEYS = ['company', 'app', 'regions'];

/** Klucze opisujące to jedno urządzenie. Nie trafiają do kopii zapasowej ani na serwer. */
export function isDeviceMetaKey(key: string): boolean {
  return (
    key === 'sync' ||
    key === 'deviceId' ||
    key === 'dataKey' ||
    key === 'profile' ||
    key === 'vehicle' ||
    key === 'adminSecrets' ||
    key === 'myApp' ||
    key.startsWith('geo:') ||
    key.startsWith('numbers:') ||
    key.startsWith('counter:offline:')
  );
}

async function setMeta(key: string, value: unknown): Promise<void> {
  await writeTransaction([db.meta], async () => {
    const row = { key, value, updatedAt: new Date().toISOString() };
    await db.meta.put(row);
    if (SYNCED_META_KEYS.includes(key)) await logChange('meta', key, 'put', row);
  });
}

async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}

export async function getCompany(): Promise<CompanySettings> {
  return { ...DEFAULT_COMPANY, ...(await getMeta<Partial<CompanySettings>>('company')) };
}

export async function saveCompany(company: CompanySettings): Promise<void> {
  await setMeta('company', company);
}

export async function getLastBackupAt(): Promise<string | null> {
  return (await getMeta<string>('lastBackupAt')) ?? null;
}

export async function markBackupDone(at = new Date().toISOString()): Promise<void> {
  await setMeta('lastBackupAt', at);
}

export async function getSyncState(): Promise<SyncState | null> {
  return (await getMeta<SyncState>('sync')) ?? null;
}

export async function setSyncState(state: SyncState | null): Promise<void> {
  setOwnBranch(state);
  if (state) await db.meta.put({ key: 'sync', value: state, updatedAt: new Date().toISOString() });
  else await db.meta.delete('sync');
}

/** Klucz danych firmy. Nieeksportowalny CryptoKey: skrypt może nim szyfrować, ale nie może go odczytać. */
export async function getDataKey(): Promise<CryptoKey | null> {
  return (await getMeta<CryptoKey>('dataKey')) ?? null;
}

export async function setDataKey(key: CryptoKey | null): Promise<void> {
  if (key) await db.meta.put({ key: 'dataKey', value: key, updatedAt: new Date().toISOString() });
  else await db.meta.delete('dataKey');
}

export async function getDeviceId(): Promise<string> {
  const existing = await getMeta<string>('deviceId');
  if (existing) return existing;
  const id = newId();
  await db.meta.put({ key: 'deviceId', value: id, updatedAt: new Date().toISOString() });
  return id;
}

export const numberBlocksKey = (year: string) => `numbers:job:${year}`;

const formatNumber = (year: string, n: number) => `Z/${year}/${String(n).padStart(4, '0')}`;

/** Najwyższy numer nadany na tym urządzeniu w danym roku z lokalnego licznika. */
export async function localJobCounter(year: string): Promise<number> {
  return (await getMeta<number>(`counter:job:${year}`)) ?? 0;
}

/**
 * Kolejny numer w roczniku, np. Z/2026/0007. Licznik nigdy się nie cofa, także po usunięciu.
 * Przy synchronizacji numery pochodzą z puli zarezerwowanej na serwerze, więc dwa urządzenia
 * nie nadadzą tego samego numeru. Gdy pula się skończy bez internetu, numer dostaje znacznik
 * urządzenia, np. Z/2026/7F3A-0001. Jest wtedy dłuższy, ale nadal unikalny.
 */
export async function nextJobNumber(year: string): Promise<string> {
  return db.transaction('rw', db.meta, async () => {
    const sync = await getMeta<SyncState>('sync');
    if (sync) {
      const blocks = (await getMeta<NumberBlock[]>(numberBlocksKey(year))) ?? [];
      const block = blocks.find((b) => b.next <= b.end);
      if (block) {
        const number = block.next;
        block.next += 1;
        await db.meta.put({ key: numberBlocksKey(year), value: blocks, updatedAt: new Date().toISOString() });
        return formatNumber(year, number);
      }
      const deviceTag = ((await getMeta<string>('deviceId')) ?? 'XXXX').slice(0, 4).toUpperCase();
      const key = `counter:offline:${year}`;
      const next = ((await getMeta<number>(key)) ?? 0) + 1;
      await db.meta.put({ key, value: next, updatedAt: new Date().toISOString() });
      return `Z/${year}/${deviceTag}-${String(next).padStart(4, '0')}`;
    }
    const key = `counter:job:${year}`;
    const next = (await localJobCounter(year)) + 1;
    await db.meta.put({ key, value: next, updatedAt: new Date().toISOString() });
    return formatNumber(year, next);
  });
}

// ---------- Ustawienia pracy technika ----------

/** Ustawienia wspólne dla firmy: rozliczenie, premie i szablony wiadomości. */
export interface AppSettings {
  bossName: string;
  /** Premia za samodzielne umówienie trzeciego zabiegu, w groszach. */
  thirdVisitBonus: number;
  vatRate: number;
  treatments: string[];
  places: string[];
  recommendations: string[];
  reminderTemplate: string;
  finishGreeting: string;
  /** Początek SMS-a po zabiegu (podsumowanie i zalecenia). */
  summaryIntro: string;
  /** Numer do raportów z obserwacji i kontaktu w SMS-ie po zabiegu. */
  reportPhone: string;
  /** Strona firmy pod podpisem. */
  website: string;
  /** „Spóźnię się”: wstawki {minuty}, {godzina}, {adres}, {podpis}. */
  lateTemplate: string;
  /** „Czy mogę przyjechać wcześniej?”: wstawki {nowa_godzina}, {godzina}, {minuty}, {adres}, {podpis}. */
  earlyTemplate: string;
  /** Wiersz obserwacji w podsumowaniu: wstawka {numer}. */
  observationTemplate: string;
  /** Kontakt na końcu podsumowania: wstawka {numer}. */
  contactTemplate: string;
  /** Pożegnanie przed podpisem technika. */
  closing: string;
}

export const DEFAULT_APP: AppSettings = {
  bossName: 'Piotrka',
  thirdVisitBonus: 5000,
  vatRate: 23,
  treatments: ['Oprysk ciśnieniowy', 'Żel', 'Zamgławianie', 'Opylanie', 'Pułapki lepowe', 'Stacje deratyzacyjne'],
  places: ['listwy', 'kratka wentylacyjna', 'łóżka', 'materace', 'kuchnia', 'łazienka', 'szafki', 'za lodówką', 'piwnica', 'pralka'],
  // Tylko zalecenia spoza firmowych tekstów metod (opuszczenie lokalu, wietrzenie, podłogi, pranie są przy metodach).
  recommendations: [
    'Akwarium przykryć i wyłączyć napowietrzanie na czas zabiegu.',
    'Chować żywność w szczelnych pojemnikach i nie zostawiać resztek.',
    'Uszczelnić szczeliny i otwory przy rurach.',
    'Zgłosić obecność owadów przed kolejnym zabiegiem.',
  ],
  reminderTemplate:
    'Dzień dobry, przypominamy o zabiegu {data} o {godzina}, adres: {adres}. Prosimy o potwierdzenie, że termin jest aktualny. Pogromcy Insektów',
  finishGreeting: 'Dzień dobry, dziękujemy za skorzystanie z usług Pogromców Insektów.',
  summaryIntro: 'Dzień dobry,\nPoniżej przesyłam skrócony opis zabiegu oraz najważniejsze zalecenia pozabiegowe.',
  reportPhone: '666 741 317',
  website: 'http://www.pogromcy-insektow.pl',
  lateTemplate: 'Dzień dobry, przepraszam, spóźnię się około {minuty} minut na zabieg o {godzina} ({adres}). Pozdrawiam, {podpis}',
  earlyTemplate: 'Dzień dobry, czy mogę przyjechać na zabieg wcześniej, około {nowa_godzina} zamiast {godzina} ({adres})? Proszę o odpowiedź. Pozdrawiam, {podpis}',
  observationTemplate: 'Obserwacja: wysyłaj SMS z raportem raz na 2 dni pod numer {numer}.',
  contactTemplate: 'W razie pytań lub ponownego pojawienia się insektów po 10-14 dniach, prosimy o kontakt pod numerem {numer} (lub bezpośrednio na ten numer).',
  closing: 'Pozdrawiam,',
};

/** Domyślne treści SMS (przycisk „Przywróć domyślne treści SMS” w Ustawieniach). */
export const DEFAULT_SMS: Pick<AppSettings, 'reminderTemplate' | 'lateTemplate' | 'earlyTemplate' | 'summaryIntro' | 'observationTemplate' | 'contactTemplate' | 'closing'> = {
  reminderTemplate: DEFAULT_APP.reminderTemplate,
  lateTemplate: DEFAULT_APP.lateTemplate,
  earlyTemplate: DEFAULT_APP.earlyTemplate,
  summaryIntro: DEFAULT_APP.summaryIntro,
  observationTemplate: DEFAULT_APP.observationTemplate,
  contactTemplate: DEFAULT_APP.contactTemplate,
  closing: DEFAULT_APP.closing,
};

/**
 * Ustawienia, które każda osoba ustawia sobie sama (na swoim telefonie): treści SMS, zalecenia, rodzaje zabiegu,
 * miejsca, numer do raportów i strona. Wspólne dla firmy zostają: imię szefa, premia, VAT.
 */
export const PERSONAL_KEYS = [
  'recommendations',
  'treatments',
  'places',
  'reminderTemplate',
  'lateTemplate',
  'earlyTemplate',
  'summaryIntro',
  'observationTemplate',
  'contactTemplate',
  'closing',
  'reportPhone',
  'website',
  'finishGreeting',
] as const satisfies ReadonlyArray<keyof AppSettings>;

export type PersonalSettings = Pick<AppSettings, (typeof PERSONAL_KEYS)[number]>;

/** Ustawienia firmy z nałożonymi ustawieniami osobistymi tej osoby. */
/**
 * Zalecenia z pierwszych wersji, które powtarzały firmowe teksty metod albo im przeczyły (np. 14 dni bez mycia
 * podłóg wobec tygodnia, 4 godziny wobec 4-5 godz.). Znikają też z zapisanych list.
 */
export const OBSOLETE_RECOMMENDATIONS = [
  'Nie myć podłóg ani listew przez 14 dni.',
  'Wywietrzyć mieszkanie przez 2 godziny po powrocie.',
  'Nie przebywać w mieszkaniu przez 4 godziny od zabiegu.',
  'Zwierzęta i dzieci poza mieszkaniem w trakcie zabiegu i 4 godziny po nim.',
  'Pościel wyprać w 60°C i wysuszyć w suszarce.',
  'Nie odkurzać miejsc, w których jest żel.',
];

export async function getAppSettings(): Promise<AppSettings> {
  const merged = { ...DEFAULT_APP, ...(await getMeta<Partial<AppSettings>>('app')), ...(await getMeta<Partial<PersonalSettings>>('myApp')) };
  return { ...merged, recommendations: merged.recommendations.filter((r) => !OBSOLETE_RECOMMENDATIONS.includes(r)) };
}

/** Wspólne ustawienia firmy (zmienia admin); osobiste pola zapisują się osobno. */
export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const company: Partial<AppSettings> = { ...settings };
  for (const key of PERSONAL_KEYS) delete company[key];
  await setMeta('app', { ...(await getMeta<Partial<AppSettings>>('app')), ...company });
}

/** Ustawienia osobiste tej osoby (tylko na tym telefonie). */
export async function savePersonalSettings(settings: PersonalSettings): Promise<void> {
  const personal = Object.fromEntries(PERSONAL_KEYS.map((key) => [key, settings[key]]));
  await db.meta.put({ key: 'myApp', value: personal, updatedAt: new Date().toISOString() });
}

/** Kim jest użytkownik tego urządzenia. Przy synchronizacji imię pochodzi z konta. */
export interface Profile {
  name: string;
  userId: string | null;
}

export async function getProfile(): Promise<Profile> {
  const saved = await getMeta<Partial<Profile>>('profile');
  // Urządzenie zalogowane przed dodaniem profilu ma imię i identyfikator tylko w stanie synchronizacji.
  const sync = await getSyncState();
  return {
    name: saved?.name || sync?.displayName || '',
    userId: saved?.userId ?? sync?.userId ?? null,
  };
}

/** Rekord bez właściciela powstał na tym urządzeniu przed zalogowaniem, więc należy do jego użytkownika. */
export function ownedBy(ownerId: string | null | undefined, userId: string | null, self: boolean): boolean {
  if (!userId) return true;
  return ownerId === userId || (self && !ownerId);
}

export async function saveProfile(profile: Profile): Promise<void> {
  await db.meta.put({ key: 'profile', value: profile, updatedAt: new Date().toISOString() });
}

/** Auto, którym jeździ użytkownik tego urządzenia. Ustawia się raz i obowiązuje do zmiany. */
export interface VehicleSettings {
  plate: string;
  /** Imię i nazwisko do kolumny „osoba kierująca pojazdem”. Puste: imię z profilu. */
  driver: string;
}

export async function getVehicle(): Promise<VehicleSettings> {
  return { plate: '', driver: '', ...(await getMeta<Partial<VehicleSettings>>('vehicle')) };
}

export async function saveVehicle(vehicle: VehicleSettings): Promise<void> {
  await db.meta.put({ key: 'vehicle', value: vehicle, updatedAt: new Date().toISOString() });
}

/** Region technika na tym urządzeniu. Prefiks trafia do kodu każdego nowego zlecenia, np. LDZ-0042. */
export interface RegionSettings {
  prefix: string;
}

/**
 * Prefiks dla nowych zleceń. Przy synchronizacji pochodzi z regionu (oddziału) konta, ustawianego przez admina
 * w panelu; bez synchronizacji albo gdy admin go nie ustawił, z ustawień tego urządzenia.
 */
export async function getRegion(): Promise<RegionSettings & { locked: boolean; name: string }> {
  const device = { prefix: '', ...(await getMeta<Partial<RegionSettings>>('region')) };
  const sync = await getSyncState();
  if (sync?.branchId) {
    const region = (await getRegions())[sync.branchId];
    if (region?.prefix) return { prefix: region.prefix, locked: true, name: region.name || sync.branchName || '' };
    return { prefix: device.prefix, locked: false, name: sync.branchName ?? '' };
  }
  return { prefix: device.prefix, locked: false, name: '' };
}

/** Ustawienia regionu (oddziału) wspólne dla całej firmy: nazwa i prefiks kodów zleceń. Zmienia je tylko admin. */
export interface RegionInfo {
  name: string;
  prefix: string;
}

export async function getRegions(): Promise<Record<string, RegionInfo>> {
  return (await getMeta<Record<string, RegionInfo>>('regions')) ?? {};
}

export async function saveRegions(regions: Record<string, RegionInfo>): Promise<void> {
  await setMeta('regions', regions);
}

/**
 * Ustawia listę regionów firmy dokładnie na tę z serwera (zachowując prefiksy): nowe nazwy dochodzą, a usunięte
 * regiony znikają całkowicie (czat, filtry, powitanie). Zwraca true, gdy coś się zmieniło.
 */
export async function matchRegionsToServer(server: Array<{ id: string; name: string }>): Promise<boolean> {
  const saved = await getRegions();
  const onServer = new Set(server.map((b) => b.id));
  const changed = server.some((b) => saved[b.id]?.name !== b.name) || Object.keys(saved).some((id) => !onServer.has(id));
  if (!changed) return false;
  const next: Record<string, RegionInfo> = {};
  for (const b of server) next[b.id] = { name: b.name, prefix: saved[b.id]?.prefix ?? '' };
  await saveRegions(next);
  return true;
}

export async function saveRegion(region: RegionSettings): Promise<void> {
  await db.meta.put({ key: 'region', value: region, updatedAt: new Date().toISOString() });
}

/** Numer telefonu technika na tym urządzeniu, do wizytówki. Nie synchronizowany: każdy telefon ma swój. */
export async function getMyPhone(): Promise<string> {
  return (await getMeta<string>('myPhone')) ?? '';
}

export async function saveMyPhone(phone: string): Promise<void> {
  await db.meta.put({ key: 'myPhone', value: phone.trim(), updatedAt: new Date().toISOString() });
}

export const ORDER_NUMBERS_KEY = 'numbers:order';

/** Numer, od którego zaczyna się numeracja, np. żeby kontynuować dotychczasową (#210). */
export async function localOrderCounter(): Promise<number> {
  return (await getMeta<number>('counter:order')) ?? 0;
}

export async function setOrderCounter(last: number): Promise<void> {
  await db.meta.put({ key: 'counter:order', value: last, updatedAt: new Date().toISOString() });
}

/**
 * Kolejny numer zlecenia. Przy synchronizacji pochodzi z puli zarezerwowanej na serwerze, więc
 * urządzenia nie nadają tych samych numerów. Gdy pula wyczerpie się bez internetu, numer jest
 * kolejnym po najwyższym znanym. Rzadki duplikat nie psuje danych, bo numer służy do wyszukiwania.
 */
export async function nextOrderNumber(): Promise<number> {
  return db.transaction('rw', db.meta, async () => {
    const counter = await localOrderCounter();
    if (await getMeta<SyncState>('sync')) {
      const blocks = (await getMeta<NumberBlock[]>(ORDER_NUMBERS_KEY)) ?? [];
      const block = blocks.find((b) => b.next <= b.end);
      if (block) {
        const number = block.next;
        block.next += 1;
        await db.meta.put({ key: ORDER_NUMBERS_KEY, value: blocks, updatedAt: new Date().toISOString() });
        await db.meta.put({ key: 'counter:order', value: Math.max(counter, number), updatedAt: new Date().toISOString() });
        return number;
      }
    }
    const next = counter + 1;
    await db.meta.put({ key: 'counter:order', value: next, updatedAt: new Date().toISOString() });
    return next;
  });
}
