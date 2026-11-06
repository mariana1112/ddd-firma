import type { ClientKind, JobStatus, PaymentMethod, PreparationUnit, ServiceCategory, StationState, VatRate } from '../data/types';

export const CLIENT_KINDS: Record<ClientKind, string> = {
  firma: 'Firma',
  osoba: 'Osoba prywatna',
  wspolnota: 'Wspólnota / spółdzielnia',
  instytucja: 'Instytucja',
};

export const CATEGORIES: Record<ServiceCategory, string> = {
  dezynsekcja: 'Dezynsekcja',
  dezynfekcja: 'Dezynfekcja',
  deratyzacja: 'Deratyzacja',
  inne: 'Inne',
};

export const STATUSES: Record<JobStatus, string> = {
  wycena: 'Wycena',
  zaplanowane: 'Zaplanowane',
  wykonane: 'Wykonane',
  anulowane: 'Anulowane',
};

export const STATUS_TONES: Record<JobStatus, 'info' | 'primary' | 'ok' | 'muted'> = {
  wycena: 'info',
  zaplanowane: 'primary',
  wykonane: 'ok',
  anulowane: 'muted',
};

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  gotowka: 'Gotówka',
  przelew: 'Przelew',
  karta: 'Karta',
  blik: 'BLIK',
};

export const UNITS: Record<PreparationUnit, string> = { l: 'l', kg: 'kg', szt: 'szt.' };

export const OBJECT_TYPES = [
  'Mieszkanie',
  'Dom',
  'Klatka schodowa / piwnice',
  'Restauracja / gastronomia',
  'Sklep',
  'Biuro',
  'Hotel',
  'Magazyn',
  'Zakład produkcyjny',
  'Szkoła / przedszkole',
  'Obiekt medyczny',
  'Gospodarstwo rolne',
];

export const PESTS = [
  'Karaczany',
  'Pluskwy',
  'Mrówki',
  'Pchły',
  'Muchy',
  'Komary',
  'Osy / szerszenie',
  'Kleszcze',
  'Rybiki',
  'Mole',
  'Myszy',
  'Szczury',
];

export const METHODS = ['Oprysk', 'Zamgławianie', 'Żel', 'Trutki w stacjach', 'Pułapki', 'Fumigacja', 'Ozonowanie'];

export const STATION_TYPES = [
  'Stacja zewnętrzna',
  'Stacja wewnętrzna',
  'Stacja kanałowa',
  'Stacja monitorująca',
  'Pułapka zatrzaskowa',
  'Pułapka żywołowna',
];

export const STATION_STATES: Record<StationState, string> = {
  'bez-sladow': 'Bez śladów',
  'slady-zerowania': 'Ślady żerowania',
  'wymiana-trutki': 'Wymiana trutki',
  uszkodzona: 'Uszkodzona',
  brak: 'Brak',
};

export const STATION_STATE_TONES: Record<StationState, 'ok' | 'warn' | 'info' | 'danger'> = {
  'bez-sladow': 'ok',
  'slady-zerowania': 'warn',
  'wymiana-trutki': 'info',
  uszkodzona: 'danger',
  brak: 'danger',
};

export const EXPENSE_CATEGORIES = [
  'Preparaty',
  'Paliwo',
  'Sprzęt',
  'Odzież i środki ochrony',
  'Ubezpieczenie',
  'Szkolenia',
  'Księgowość',
  'Telefon i internet',
  'Składki i podatki',
  'Inne',
];

export const VAT_RATES: Array<{ value: string; label: string }> = [
  { value: '23', label: '23%' },
  { value: '8', label: '8%' },
  { value: '5', label: '5%' },
  { value: '0', label: '0%' },
  { value: 'zw', label: 'zw.' },
];

export function vatToInput(rate: VatRate): string {
  return rate === null ? 'zw' : String(rate);
}

export function vatFromInput(value: string): VatRate {
  return value === 'zw' ? null : Number(value);
}

export function vatLabel(rate: VatRate): string {
  return rate === null ? 'zw.' : `${rate}%`;
}

export function joinAddress(street: string, postalCode: string, city: string): string {
  return [street, [postalCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}
