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
