import { z } from 'zod';
import { isValidDate } from '../lib/dates';
import { parseMoney, parseQty } from '../lib/money';
import { isValidNip } from '../lib/validators';

// Pola formularzy to teksty; na typy danych zamieniamy je dopiero przy zapisie.
export const required = (message = 'To pole jest wymagane') => z.string().trim().min(1, message);

export const moneyText = z.string().refine((v) => parseMoney(v) !== null, 'Podaj kwotę, np. 150,00');
export const positiveMoneyText = z.string().refine((v) => (parseMoney(v) ?? 0) > 0, 'Podaj kwotę większą od zera');
export const optionalMoneyText = z.string().refine((v) => v.trim() === '' || parseMoney(v) !== null, 'Podaj kwotę, np. 150,00');

export const qtyText = z.string().refine((v) => (parseQty(v) ?? 0) > 0, 'Podaj ilość większą od zera');
export const optionalQtyText = z.string().refine((v) => v.trim() === '' || parseQty(v) !== null, 'Podaj ilość, np. 0,5');

export const dateText = z.string().refine(isValidDate, 'Podaj datę');
export const optionalDateText = z.string().refine((v) => v === '' || isValidDate(v), 'Podaj poprawną datę');

export const nipText = z.string().refine((v) => v.trim() === '' || isValidNip(v), 'NIP jest niepoprawny');
export const emailText = z.string().trim().refine((v) => v === '' || /^\S+@\S+\.\S+$/.test(v), 'Adres e-mail jest niepoprawny');
export const postalText = z.string().trim().refine((v) => v === '' || /^\d{2}-\d{3}$/.test(v), 'Kod w formacie 00-000');

export function dateOrNull(value: string): string | null {
  return value === '' ? null : value;
}
