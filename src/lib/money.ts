// Kwoty trzymamy jako całkowite grosze PLN, a ilości jako całkowite tysięczne jednostki.
// Dzięki temu sumy nie gubią groszy na błędach zmiennoprzecinkowych.

// useGrouping: domyślnie polski format nie rozdziela tysięcy w liczbach czterocyfrowych.
const plnFormatter = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', useGrouping: 'always' });

export function formatMoney(grosze: number): string {
  return plnFormatter.format(grosze / 100);
}

/** Tekst do pola formularza, np. 123450 -> "1234,50". */
export function moneyToInput(grosze: number): string {
  return (grosze / 100).toFixed(2).replace('.', ',');
}

function parseDecimal(input: string, maxFraction: number): number | null {
  const clean = input.replace(/[\s ]/g, '').replace(/zł$/i, '').replace(',', '.');
  if (!new RegExp(`^\\d+(\\.\\d{0,${maxFraction}})?$`).test(clean)) return null;
  const [whole, fraction = ''] = clean.split('.');
  const scale = 10 ** maxFraction;
  const value = Number(whole) * scale + Number(fraction.padEnd(maxFraction, '0'));
  return Number.isSafeInteger(value) ? value : null;
}

/** "1 234,5" -> 123450. Zwraca null, gdy tekst nie jest poprawną kwotą nieujemną. */
export function parseMoney(input: string): number | null {
  return parseDecimal(input, 2);
}

/** "0,5" -> 500 (tysięczne jednostki). Zwraca null, gdy tekst jest niepoprawny. */
export function parseQty(input: string): number | null {
  return parseDecimal(input, 3);
}

const qtyFormatter = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 });

export function formatQty(milli: number): string {
  return qtyFormatter.format(milli / 1000);
}

/** Tekst do pola formularza, bez separatora tysięcy. */
export function qtyToInput(milli: number): string {
  return String(milli / 1000).replace('.', ',');
}

/** Wartość pozycji: ilość w tysięcznych razy cena w groszach, z zaokrągleniem do grosza. */
export function lineNet(qtyMilli: number, unitPriceNet: number): number {
  return Math.round((qtyMilli * unitPriceNet) / 1000);
}

export function vatAmount(net: number, vatRate: number | null): number {
  return vatRate === null ? 0 : Math.round((net * vatRate) / 100);
}
