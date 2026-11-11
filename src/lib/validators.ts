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

/** Polski numer komórkowy i stacjonarny ma 9 cyfr po kierunkowym +48. */
export const PL_DIGITS = 9;

/**
 * Numer telefonu zawsze z kierunkowym: wpisane „500600700” to „+48 500 600 700”, a „0048…” i „48…” (11 cyfr) też
 * dostają „+48”. Polski numer ma najwyżej 9 cyfr po +48, więc dłuższego nie da się wpisać. Numer zagraniczny
 * (np. „+44 …”) zostaje z własnym kierunkowym, w sumie do 15 cyfr. Zostają tylko cyfry i „+”, więc wklejony numer
 * z myślnikami też się porządkuje.
 */
export function formatPhoneInput(value: string): string {
  const raw = value.trim();
  let digits = raw.replace(/\D/g, '');
  let plus = raw.startsWith('+');
  if (!plus && digits.startsWith('00')) {
    digits = digits.slice(2);
    plus = true;
  }
  let country = '48';
  let national: string;
  if (plus) {
    // Kierunkowy w trakcie wpisywania („+”, „+4”): zostaje, żeby dało się wpisać też numer zagraniczny.
    if (digits.length < 2) return `+${digits}`;
    country = digits.slice(0, 2);
    national = digits.slice(2);
  } else if (digits.length > PL_DIGITS && digits.startsWith('48')) {
    national = digits.slice(2);
  } else {
    national = digits;
  }
  national = national.slice(0, country === '48' ? PL_DIGITS : 13);
  if (!national) return plus ? `+${country}` : '';
  return [`+${country}`, ...(national.match(/.{1,3}/g) ?? [])].join(' ');
}

/** Błąd numeru telefonu do pokazania przy polu albo undefined, gdy numer jest pusty albo poprawny. */
export function phoneError(value: string): string | undefined {
  const formatted = formatPhoneInput(value);
  const digits = formatted.replace(/\D/g, '');
  if (!digits) return undefined;
  if (formatted.startsWith('+48')) {
    return digits.length - 2 === PL_DIGITS ? undefined : `Numer musi mieć ${PL_DIGITS} cyfr po +48 (np. +48 500 600 700)`;
  }
  return digits.length >= 8 && digits.length <= 15 ? undefined : 'Numer zagraniczny jest za krótki albo za długi';
}

/** Numer do kalendarza, SMS-a i dzwonienia: zawsze z +48 (także numery zapisane wcześniej bez kierunkowego). */
export function withCountryCode(phone: string): string {
  return phone.trim() ? formatPhoneInput(phone) : '';
}

/** Kod pocztowy w trakcie wpisywania: same cyfry, myślnik po dwóch („00-000”). */
export function formatPostalInput(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 5);
  return digits.length > 2 ? `${digits.slice(0, 2)}-${digits.slice(2)}` : digits;
}
