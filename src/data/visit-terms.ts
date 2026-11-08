import type { Order, Visit, VisitScope } from './types';

/** Ustalenia na zabieg: co pryskamy i za ile. */
export interface VisitTerms {
  scope: VisitScope;
  priceMin: number | null;
  priceMax: number | null;
}

export const SCOPE_KINDS: Array<[VisitScope['kind'], string]> = [
  ['calosc', 'Całe mieszkanie'],
  ['pokoj', 'Pokój'],
  ['inne', 'Inne'],
];

export const DEFAULT_SCOPE: VisitScope = { kind: 'calosc', note: '' };

/** „Całe mieszkanie”, „Pokój: sypialnia”, „Inne: piwnica i garaż”. */
export function scopeText(scope: VisitScope | undefined): string {
  const s = scope ?? DEFAULT_SCOPE;
  const label = SCOPE_KINDS.find(([k]) => k === s.kind)?.[1] ?? 'Całe mieszkanie';
  const note = s.note.trim();
  if (s.kind === 'calosc') return note ? `${label} (${note})` : label;
  return note ? `${label}: ${note}` : label;
}

/** Cena zabiegu: własna, a w zabiegach sprzed tej opcji widełki zlecenia. */
export function visitPrice(visit: Pick<Visit, 'priceMin' | 'priceMax'> | undefined, order: Pick<Order, 'priceMin' | 'priceMax'>) {
  if (visit && (visit.priceMin !== undefined || visit.priceMax !== undefined)) {
    return { priceMin: visit.priceMin ?? null, priceMax: visit.priceMax ?? null };
  }
  return { priceMin: order.priceMin, priceMax: order.priceMax };
}

/**
 * Propozycja ustaleń na kolejny zabieg: zakres i cena z ostatniego zabiegu (bez odwołanych), a gdy go nie ma,
 * całe mieszkanie i widełki zlecenia. Wszystko do zmiany przed zapisem.
 */
export function proposeTerms(list: Visit[], order: Pick<Order, 'priceMin' | 'priceMax'>): VisitTerms {
  const last = [...list].filter((v) => v.status !== 'odwolany').sort((a, b) => b.seq - a.seq)[0];
  return { scope: { ...(last?.scope ?? DEFAULT_SCOPE) }, ...visitPrice(last, order) };
}
