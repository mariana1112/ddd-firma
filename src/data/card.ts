import type { CompanySettings } from './types';

/** Cyfry numeru konta (NRB, 26 cyfr), bez spacji i „PL”. */
export function accountDigits(value: string): string {
  return value.replace(/\D/g, '').slice(0, 26);
}

/** „51 2490 0005 0000 4500 3807 9526”: dwie cyfry kontrolne i grupy po cztery. */
export function formatAccount(value: string): string {
  const d = accountDigits(value);
  if (d.length <= 2) return d;
  return [d.slice(0, 2), ...(d.slice(2).match(/.{1,4}/g) ?? [])].join(' ');
}

/** Poprawny polski numer konta (NRB): 26 cyfr i suma kontrolna IBAN (mod 97). */
export function isValidAccount(value: string): boolean {
  const d = accountDigits(value);
  if (d.length !== 26) return false;
  // IBAN: numer bez cyfr kontrolnych + „PL” (25 21) + cyfry kontrolne, reszta z dzielenia przez 97 równa 1.
  const rearranged = `${d.slice(2)}2521${d.slice(0, 2)}`;
  let rest = 0;
  for (const ch of rearranged) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}

/** „888 266 73 76”. */
export function formatNip(value: string): string {
  const d = value.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 8)} ${d.slice(8)}` : value.trim();
}

export interface CardData {
  company: Pick<CompanySettings, 'name' | 'taxpayerName' | 'nip' | 'bankAccount' | 'blikPhone'>;
  /** Imię technika i jego numer na tym urządzeniu. */
  name: string;
  phone: string;
}

/** Dane do przelewu w jednym tekście, np. do SMS-a klientowi. */
export function transferText(c: CardData['company']): string {
  return [
    `Odbiorca: ${c.taxpayerName?.trim() || c.name}`,
    c.nip.trim() && `NIP: ${formatNip(c.nip)}`,
    `Numer konta: ${formatAccount(c.bankAccount)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Cała wizytówka do udostępnienia klientowi. */
export function cardText(d: CardData): string {
  const lines = [d.company.name];
  if (d.name.trim() || d.phone.trim()) lines.push([d.name.trim(), d.phone.trim() && `tel. ${d.phone.trim()}`].filter(Boolean).join(', '));
  if (d.company.bankAccount.trim()) lines.push('', 'Dane do przelewu:', transferText(d.company));
  if (d.company.blikPhone?.trim()) lines.push('', `BLIK na telefon: ${d.company.blikPhone.trim()}`);
  return lines.join('\n');
}
