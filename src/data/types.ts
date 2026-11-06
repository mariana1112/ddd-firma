// Każdy rekord ma UUID, znaczniki czasu i miękkie usuwanie. Wystarczy to do kosza i scalania
// kopii zapasowych, a w przyszłości także do synchronizacji, bez zmiany modelu danych.
export interface BaseRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
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
}

export interface Attachment extends BaseRecord {
  jobId: string;
  name: string;
  mime: string;
  blob: Blob;
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
