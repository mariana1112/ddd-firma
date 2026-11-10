// Każdy rekord ma UUID, znaczniki czasu i miękkie usuwanie. Wystarczy to do kosza i scalania
// kopii zapasowych, a w przyszłości także do synchronizacji, bez zmiany modelu danych.
export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /**
   * Region (oddział), do którego rekord należy na serwerze. Ustawia go synchronizacja przy pobraniu;
   * pole nie jest wysyłane z urządzenia. Brak: rekord jeszcze niewysłany albo urządzenie bez synchronizacji.
   */
  branchId?: string | null;
}

export type ClientKind = 'firma' | 'osoba' | 'wspolnota' | 'instytucja';

export interface Client extends BaseRecord {
  kind: ClientKind;
  name: string;
  contactPerson: string;
  nip: string;
  phone: string;
  email: string;
  street: string;
  postalCode: string;
  city: string;
  notes: string;
}

/** Stacja żyje w rekordzie obiektu. Usunięta zostaje na liście z deletedAt, aż do opróżnienia kosza. */
export interface BaitStation {
  id: string;
  /** Tekst, bo w planach stacji spotyka się też numery typu "Z-12". */
  number: string;
  type: string;
  location: string;
  deletedAt: string | null;
}

export interface Site extends BaseRecord {
  clientId: string;
  name: string;
  objectType: string;
  street: string;
  postalCode: string;
  city: string;
  areaM2: number | null;
  accessNotes: string;
  stations: BaitStation[];
}

export type ServiceCategory = 'dezynsekcja' | 'dezynfekcja' | 'deratyzacja' | 'inne';

/** Stawka VAT w procentach; null oznacza "zw." lub sprzedawcę bez VAT. */
export type VatRate = number | null;

export interface Service extends BaseRecord {
  name: string;
  category: ServiceCategory;
  unit: string;
  priceNet: number;
  vatRate: VatRate;
}

export type JobStatus = 'wycena' | 'zaplanowane' | 'wykonane' | 'anulowane';

/** Pozycje i materiały są kopią wartości z chwili zlecenia, więc zmiana cennika nie zmienia historii. */
export interface JobLine {
  id: string;
  name: string;
  unit: string;
  qtyMilli: number;
  unitPriceNet: number;
  vatRate: VatRate;
}

export interface JobMaterial {
  id: string;
  preparationId: string;
  name: string;
  permitNo: string;
  activeSubstance: string;
  batchNo: string;
  qtyMilli: number;
  unit: string;
}

export type StationState = 'bez-sladow' | 'slady-zerowania' | 'wymiana-trutki' | 'uszkodzona' | 'brak';

/** Kopia danych stacji z chwili przeglądu, więc zmiana w obiekcie nie zmienia wystawionego protokołu. */
export interface JobStationCheck {
  stationId: string;
  number: string;
  type: string;
  location: string;
  state: StationState;
  notes: string;
}

export interface Job extends BaseRecord {
  number: string;
  clientId: string;
  siteId: string | null;
  status: JobStatus;
  /** Termin w Europe/Warsaw, null dla wyceny bez daty. */
  start: string | null;
  durationMin: number;
  category: ServiceCategory;
  title: string;
  pest: string;
  method: string;
  scope: string;
  notes: string;
  lines: JobLine[];
  materials: JobMaterial[];
  /** Tylko sprawdzone stacje. Brak wpisu znaczy "nie sprawdzono", a nie "bez śladów". */
  stationChecks: JobStationCheck[];
  completedOn: string | null;
  recommendations: string;
  safetyPeriod: string;
  warrantyUntil: string | null;
  followUpDate: string | null;
  followUpDone: boolean;
  invoiceNo: string;
  signerName: string;
  signatureDataUrl: string | null;
}

export type PreparationUnit = 'l' | 'kg' | 'szt';

export interface Preparation extends BaseRecord {
  name: string;
  activeSubstance: string;
  permitNo: string;
  unit: PreparationUnit;
  minStockMilli: number;
  targetPests: string;
  dosage: string;
  safetyPeriod: string;
}

export type MovementType = 'zakup' | 'korekta';

export interface StockMovement extends BaseRecord {
  preparationId: string;
  type: MovementType;
  date: string;
  /** Ze znakiem: korekta może być ujemna. Zużycie wynika ze zleceń wykonanych. */
  qtyMilli: number;
  batchNo: string;
  expiryDate: string | null;
  cost: number;
  supplier: string;
  note: string;
  expenseId: string | null;
}

export type PaymentMethod = 'gotowka' | 'przelew' | 'karta' | 'blik';

export interface Payment extends BaseRecord {
  jobId: string;
  date: string;
  amount: number;
  method: PaymentMethod;
  note: string;
}

export interface Expense extends BaseRecord {
  date: string;
  category: string;
  amount: number;
  description: string;
  docNo: string;
  movementId: string | null;
  /** Technik, który poniósł koszt. Brak w danych sprzed wersji 5 i w trybie bez konta. */
  ownerId?: string | null;
}

// ---------- Zlecenia Pogromców Insektów (schemat 5) ----------

export type BuildingType = 'dom' | 'blizniak' | 'blok';
export type PestCategory = 'karaluchy' | 'chrzaszczowate' | 'pluskwy' | 'gryzonie' | 'inne';
export type InvoiceType = 'brak' | 'imienna' | 'vat';
export type PayMethod = 'gotowka' | 'blik' | 'przelew';
/** Rola konta w firmie: admin (szef), technik albo księgowa. */
export type Role = 'owner' | 'technik' | 'ksiegowosc';
/** Co robimy w zleceniu: oprysk ciśnieniowy, ULV, zamgławianie, żelowanie, zalanie odpływów. */
export type TreatmentMethod = 'oprysk' | 'ulv' | 'zamglawianie' | 'zelowanie' | 'odplywy';

export interface Phone {
  number: string;
  /** Np. "tata", "tutaj dzwonić". Pusty dla numeru głównego. */
  label: string;
}

/** Zlecenie: klient, adres i problem. Kolejne zabiegi (wizyty) są osobnymi rekordami Visit. */
export interface Order extends BaseRecord {
  /** Numer zlecenia, niepowtarzalny w całej firmie; w kodzie jako cztery cyfry, np. LDZ-0210. */
  number: number;
  /** Prefiks regionu nadany przy przyjęciu zlecenia, np. „LDZ”. Brak w zleceniach sprzed prefiksów. */
  prefix?: string;
  ownerId: string | null;
  ownerName: string;
  building: BuildingType;
  street: string;
  houseNo: string;
  flatNo: string;
  floor: string;
  staircase: string;
  postalCode: string;
  city: string;
  access: string;
  pest: PestCategory;
  pestOther: string;
  description: string;
  areaM2: number | null;
  /** Widełki cenowe netto w groszach. */
  priceMin: number | null;
  priceMax: number | null;
  invoice: InvoiceType;
  clientName: string;
  email: string;
  nip: string;
  invoiceAddress: string;
  phones: Phone[];
  /** Kod pink: trudny klient lub problematyczne mieszkanie. */
  pink: boolean;
  pinkNote: string;
  closed: boolean;
  /** Zlecenie odwołane i przeniesione do archiwum: znika z list roboczych, można je przywrócić. */
  archived?: boolean;
  /**
   * Link do miejsca z Google Maps wklejony przy adresie (np. maps.app.goo.gl/…). Nawigacja Google otwiera dokładnie
   * to miejsce, a gdy link zawiera współrzędne, dostają je też inne mapy.
   */
  mapsLink?: string;
  /** Co robimy (wybierane przy tworzeniu). Brak w zleceniach sprzed tej opcji. */
  methods?: TreatmentMethod[];
  /** Klient chce protokół z zabiegu (zaznacza technik albo przyjmujący zlecenie). */
  protocol?: boolean;
  /** Księgowość: faktura wystawiona i jej numer. */
  invoiceDone?: boolean;
  invoiceNumber?: string;
  /** Księgowość: protokół przygotowany. */
  protocolDone?: boolean;
  /** Uwagi księgowej do zlecenia. */
  accountingNote?: string;
  /** Kiedy księgowa zamknęła zlecenie (wszystko zrobione); brak: do zrobienia. */
  accountingClosedAt?: string | null;
}

export type VisitStatus = 'zaplanowany' | 'w_trakcie' | 'wykonany' | 'odwolany';

/** Wywiad na wzór SAMPLE: co, gdzie, od kiedy, objawy i wcześniejsze działania klienta. */
/** Odpowiedź tak/nie; pusta, gdy technik jeszcze nie zapytał. */
export type YesNo = '' | 'tak' | 'nie';

/**
 * Wywiad z klientem. Zabiegi sprzed tej postaci miały osobne pola tekstowe since, what i where;
 * normalizeInterview w data/orders.ts przenosi je do opisu sytuacji.
 */
export interface Interview {
  /** Jeden opis sytuacji: co się dzieje, gdzie, od kiedy. */
  situation: string;
  bites: YesNo;
  seen: YesNo;
  /** Ile owadów widziano, gdy seen = 'tak', np. „kilka”, „ok. 20”. */
  seenCount: string;
  selfTreatment: YesNo;
  other: string;
}

/** Zabieg w ramach zlecenia: pierwszy, drugi, trzeci. */
export interface Visit extends BaseRecord {
  orderId: string;
  seq: number;
  /** Termin w Europe/Warsaw albo null, gdy technik umawia się sam z klientem. */
  start: string | null;
  durationMin: number;
  status: VisitStatus;
  technicianId: string | null;
  technicianName: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Dzień rozliczenia: data wykonania w Europe/Warsaw. */
  doneOn: string | null;
  payMethod: PayMethod | null;
  /** Kwota pobrana od klienta, w groszach. */
  amount: number | null;
  interview: Interview;
  treatments: string[];
  places: string[];
  findings: string;
  problems: string;
  recommendations: string[];
  /** Premia technika za ten zabieg, np. za samodzielne umówienie trzeciej wizyty. */
  bonus: number;
  notes: string;
  /** Co pryskamy przy tym zabiegu. Brak w zabiegach sprzed tej opcji: całe mieszkanie. */
  scope?: VisitScope;
  /**
   * Cena ustalona na ten zabieg, w groszach (netto przy fakturze VAT), od–do albo jedna kwota.
   * Brak (undefined) w zabiegach sprzed tej opcji: obowiązują widełki zlecenia.
   */
  priceMin?: number | null;
  priceMax?: number | null;
}

export type ScopeKind = 'calosc' | 'pokoj' | 'inne';

/** Zakres zabiegu: całe mieszkanie, pokój (który) albo inne (opis). */
export interface VisitScope {
  kind: ScopeKind;
  /** Który pokój albo co dokładnie, np. „sypialnia”, „piwnica i garaż”. */
  note: string;
}

export type TripKind = 'sluzbowy' | 'prywatny';

/** Przejazd do kilometrówki. Licznik w pełnych kilometrach. */
export interface Trip extends BaseRecord {
  ownerId: string | null;
  date: string;
  kind: TripKind;
  timeFrom: string;
  timeTo: string;
  from: string;
  to: string;
  /** Miejscowości po drodze, np. „Kutno, Kłodawa”. Brak w przejazdach sprzed wersji z ewidencją VAT. */
  via?: string;
  purpose: string;
  /** Numer rejestracyjny auta ustawiony w chwili zapisu przejazdu. */
  vehicle?: string;
  /** Imię i nazwisko kierowcy w chwili zapisu przejazdu. */
  driver?: string;
  odometerStart: number;
  odometerEnd: number;
}

export interface Attachment extends BaseRecord {
  jobId: string;
  name: string;
  mime: string;
  /** null: zdjęcie zrobione na innym urządzeniu i jeszcze niepobrane z serwera. */
  blob: Blob | null;
  /** Ścieżka pliku na serwerze; null, dopóki zdjęcie nie zostało wysłane. */
  remotePath?: string | null;
}

/** Tabele, których zmiany trafiają na serwer. Z meta synchronizowane są tylko wybrane klucze. */
export type SyncTable =
  | 'clients'
  | 'sites'
  | 'services'
  | 'jobs'
  | 'preparations'
  | 'stockMovements'
  | 'payments'
  | 'expenses'
  | 'attachments'
  | 'orders'
  | 'visits'
  | 'trips'
  | 'meta';

/**
 * create, update, delete i restore zmieniają tylko podane pola. put niesie cały rekord i służy
 * do pierwszego wysłania danych oraz importu kopii. purge usuwa rekord na stałe.
 */
export type ChangeOp = 'create' | 'update' | 'delete' | 'restore' | 'put' | 'purge';

/** Wpis dziennika zmian, a zarazem kolejka wysyłki na serwer. */
export interface ChangeRow {
  seq?: number;
  id: string;
  tbl: SyncTable;
  recordId: string;
  op: ChangeOp;
  patch: Record<string, unknown>;
  at: string;
  /** 0: czeka na wysłanie, 1: przyjęty przez serwer. Liczba, bo IndexedDB nie indeksuje wartości logicznych. */
  pushed: 0 | 1;
}

export interface NumberBlock {
  next: number;
  end: number;
}

/** Stan synchronizacji tego urządzenia. Nigdy nie trafia na serwer ani do kopii zapasowej. */
export interface SyncState {
  orgId: string;
  orgName: string;
  userId: string;
  email: string;
  /** Najwyższy numer wersji rekordu pobrany z serwera. */
  cursor: number;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Rola w firmie: szef widzi wszystkie oddziały, technik swój, księgowa wszystkie (bez panelu admina). */
  role?: Role;
  displayName?: string;
  branchId?: string | null;
  branchName?: string;
  /** Rekordy na urządzeniu mają już znacznik regionu z serwera (jednorazowe pobranie od nowa po aktualizacji). */
  regionsTagged?: boolean;
  /** Konto z loginem tymczasowym od admina: przed pracą trzeba ustawić własny e-mail i hasło. */
  temp?: boolean;
}

export interface CompanySettings {
  name: string;
  owner: string;
  nip: string;
  regon: string;
  street: string;
  postalCode: string;
  city: string;
  phone: string;
  email: string;
  bankAccount: string;
  logoDataUrl: string | null;
  vatPayer: boolean;
  defaultVatRate: number;
  offerValidityDays: number;
  protocolFooter: string;
  /** Podatnik w nagłówku kilometrówki, np. „P.H.U. … Imię Nazwisko”. Puste: nazwa firmy. */
  taxpayerName?: string;
  /** Numer telefonu do płatności BLIK na telefon, np. „+48 505 724 090”. */
  blikPhone?: string;
}

export interface MetaRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface Snapshot {
  id: string;
  createdAt: string;
  reason: string;
  /** Pełna kopia zapasowa jako tekst JSON. */
  data: string;
}
