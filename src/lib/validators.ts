/** Sprawdza sumę kontrolną NIP. Akceptuje zapis z myślnikami i spacjami. */
export function isValidNip(input: string): boolean {
  const digits = input.replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(digits)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  return sum % 11 === Number(digits[9]);
}

export function normalizeForSearch(text: string): string {
  return text
    .toLocaleLowerCase('pl-PL')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Szukanie bez wielkości liter i polskich znaków; każde słowo musi się gdzieś znaleźć. */
export function matchesSearch(query: string, ...fields: Array<string | null | undefined>): boolean {
  const haystack = normalizeForSearch(fields.filter(Boolean).join(' '));
  return normalizeForSearch(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * Numer telefonu w trakcie wpisywania, w grupach po trzy cyfry: „500 600 700”, „+48 500 600 700”.
 * Zostają tylko cyfry i „+” na początku, więc wklejony numer z myślnikami też się porządkuje.
 */
export function formatPhoneInput(value: string): string {
  const plus = value.trim().startsWith('+');
  let digits = value.replace(/\D/g, '').slice(0, 15);
  let prefix = '';
  if (plus) {
    // Kierunkowy kraju: dla Polski 48, inne zostają jako 2 cyfry po „+”.
    prefix = `+${digits.slice(0, 2)}`;
    digits = digits.slice(2);
  }
  const groups = digits.match(/.{1,3}/g) ?? [];
  return [prefix, ...groups].filter(Boolean).join(' ');
}

/** Kod pocztowy w trakcie wpisywania: same cyfry, myślnik po dwóch („00-000”). */
export function formatPostalInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 5);
  return digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
}
