import type { Order, PestCategory, TreatmentMethod } from './types';

/**
 * Co robimy w zleceniu: wybierane zawsze przy tworzeniu zlecenia. Od metody zależą zalecenia dla klienta,
 * a przy ULV i zamgławianiu wszędzie widać uwagę o opuszczeniu lokalu i sprzątaniu.
 */
export const METHODS: Array<[TreatmentMethod, string]> = [
  ['oprysk', 'Oprysk ciśnieniowy'],
  ['ulv', 'ULV'],
  ['zamglawianie', 'Zamgławianie'],
  ['zelowanie', 'Żelowanie'],
  ['odplywy', 'Zalanie odpływów'],
];

/** Metody, przy których klient opuszcza lokal i potem sprząta: ULV i zamgławianie. */
export const FOGGING: TreatmentMethod[] = ['ulv', 'zamglawianie'];

export const hasFogging = (methods: TreatmentMethod[]) => methods.some((m) => FOGGING.includes(m));

export const METHOD_LABEL = Object.fromEntries(METHODS) as Record<TreatmentMethod, string>;

/** Nazwy zabiegów z wcześniejszych wersji, które oznaczają tę samą metodę. */
const ALIASES: Record<string, TreatmentMethod> = {
  'żel': 'zelowanie',
  'żelowanie': 'zelowanie',
  'zamgławianie': 'zamglawianie',
  'zamglawianie': 'zamglawianie',
  'zamgławianie ulv': 'ulv',
  'ulv': 'ulv',
  'oprysk ciśnieniowy': 'oprysk',
  'oprysk': 'oprysk',
  'zalanie odpływów': 'odplywy',
};

/** Metoda z nazwy zabiegu zaznaczonej przy wykonaniu („Żel” → żelowanie). */
export function methodOf(treatment: string): TreatmentMethod | null {
  return ALIASES[treatment.trim().toLowerCase()] ?? null;
}

/** Metody zlecenia; zlecenia sprzed tej opcji nie mają żadnej. */
export const orderMethods = (order: Pick<Order, 'methods'>): TreatmentMethod[] => order.methods ?? [];

/** Wykonane metody: z zaznaczonych zabiegów, a gdy żadna nie pasuje, metody zlecenia. */
export function doneMethods(treatments: string[], order: Pick<Order, 'methods'>): TreatmentMethod[] {
  const found = [...new Set(treatments.map(methodOf).filter((m): m is TreatmentMethod => m !== null))];
  return found.length ? found : orderMethods(order);
}

/** Uwaga przy ULV i zamgławianiu: widoczna przy zleceniu, zabiegu, w przypomnieniu i w zaleceniach. */
export const ULV_NOTICE =
  'ULV / zamgławianie: na czas zabiegu i co najmniej 4 godziny po nim w lokalu nie może być ludzi ani zwierząt. Przed zabiegiem schować żywność i naczynia, po powrocie wywietrzyć lokal i posprzątać (umyć blaty, stoły i podłogi).';

/** Zalecenia z wzoru firmy (podsumowanie po zabiegu). */
const LEAVE = 'Opuszczenie lokalu: na 4-5 godz. (dzieci, osoby starsze i zwierzęta: 6-8 godz).';
const AIRING = 'Wietrzenie: po powrocie od razu otwórz wszystkie okna i opuść lokal na kolejne 1-2h.';
const CLEANING = 'Sprzątanie: w maseczce i rękawiczkach umyj wodą z detergentem blaty, stoły, klamki, włączniki. Łóżka i fotele przetrzyj wilgotną szmatką.';
const FLOORS = 'Podłogi: przez tydzień nie odkurzaj ani nie myj podłóg w odległości 20-30 cm od ścian i łóżek. (Przy małych dzieciach lub zwierzętach umyj całą podłogę).';
const LAUNDRY = 'Pranie: pościel i ubrania wypierz w min. 60°C (przez min. 1h) lub zgodnie z metką.';

const FOGGING_RECOMMENDATIONS = [LEAVE, AIRING, CLEANING, FLOORS];

/** Zalecenia dla każdej metody. Zalecenia ULV i zamgławiania są obowiązkowe: nie da się ich odznaczyć. */
export const METHOD_RECOMMENDATIONS: Record<TreatmentMethod, string[]> = {
  zamglawianie: FOGGING_RECOMMENDATIONS,
  ulv: FOGGING_RECOMMENDATIONS,
  oprysk: [LEAVE, AIRING, FLOORS],
  zelowanie: [
    'Nie odkurzać ani nie myć miejsc, w których jest żel.',
    'Nie używać sprayów owadobójczych, bo odstraszają owady od żelu.',
    'Chować żywność w szczelnych pojemnikach i nie zostawiać resztek.',
  ],
  odplywy: [
    'Nie używać odpływów (zlew, umywalka, prysznic, wanna) przez 2 godziny po zabiegu.',
    'Nie wlewać do odpływów środków czyszczących przez 3 dni.',
    'Na noc zatykać odpływy korkiem.',
  ],
};

const PEST_RECOMMENDATIONS: Partial<Record<PestCategory, string[]>> = {
  pluskwy: [LAUNDRY],
};

/** Obserwacja z raportem jest zawsze w podsumowaniu (osobny wiersz), więc nie trzeba jej zaznaczać. */
const ALWAYS: string[] = [];

/** Zabiegi spoza metod zlecenia, zawsze do zaznaczenia przy wykonaniu. */
export const EXTRA_TREATMENTS = ['Parowanie gorącą parą'];

/** Co można zaznaczyć w „Czy trzeba uszczelnić?”. */
export const SEALING_OPTIONS = ['kratki wentylacyjne/piony', 'szczeliny i dziury w podłodze', 'szczeliny i dziury w ścianie', 'listwy przypodłogowe'];

/** Zalecenia dla wykonanych metod i szkodnika, bez powtórzeń; obowiązkowe to zalecenia ULV i zamgławiania. */
export function recommendationsFor(methods: TreatmentMethod[], pest: PestCategory): { list: string[]; required: string[] } {
  const required = hasFogging(methods) ? FOGGING_RECOMMENDATIONS : [];
  const list = [...new Set([...required, ...methods.flatMap((m) => METHOD_RECOMMENDATIONS[m]), ...(PEST_RECOMMENDATIONS[pest] ?? []), ...ALWAYS])];
  return { list, required };
}

/** Czy dokument z oznaczenia jest już zrobiony przez księgową. */
export function tagDone(order: Pick<Order, 'invoiceDone' | 'protocolDone'>, tag: string): boolean {
  return tag === 'prot' ? Boolean(order.protocolDone) : Boolean(order.invoiceDone);
}

/** Krótkie oznaczenia dokumentów na liście i w szukaniu: „fv23” (faktura VAT), „fv” (imienna), „prot”. */
export function documentTags(order: Pick<Order, 'invoice' | 'protocol'>): string[] {
  const tags: string[] = [];
  if (order.invoice === 'vat') tags.push('fv23');
  if (order.invoice === 'imienna') tags.push('fv');
  if (order.protocol) tags.push('prot');
  return tags;
}
