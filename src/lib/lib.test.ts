import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';
import {
  addDays,
  addMinutes,
  addMonths,
  formatDate,
  formatDateLong,
  formatInstant,
  formatMonth,
  formatTerm,
  isValidDate,
  nowWarsaw,
  shiftMonth,
  todayWarsaw,
} from './dates';
import { formatMoney, formatQty, lineNet, moneyToInput, parseMoney, parseQty, vatAmount } from './money';
import { isValidNip, matchesSearch } from './validators';

const nbsp = (s: string) => s.replace(/[  ]/g, ' ');

describe('kwoty', () => {
  it('wpisane kwoty zamienia na grosze', () => {
    expect(parseMoney('1 234,50')).toBe(123450);
    expect(parseMoney('1234.5')).toBe(123450);
    expect(parseMoney('0,07')).toBe(7);
    expect(parseMoney('150')).toBe(15000);
    expect(parseMoney('19,99 zł')).toBe(1999);
  });

  it('odrzuca niepoprawne kwoty', () => {
    for (const bad of ['', 'abc', '-5', '1,234', '1,2,3']) expect(parseMoney(bad)).toBeNull();
  });

  it('nie gubi groszy na liczbach zmiennoprzecinkowych', () => {
    expect(parseMoney('1,15')).toBe(115);
    expect(parseMoney('4,35')).toBe(435);
    expect(parseMoney('1,10')! + parseMoney('2,20')!).toBe(330);
  });

  it('formatuje po polsku', () => {
    expect(nbsp(formatMoney(123450))).toBe('1 234,50 zł');
    expect(moneyToInput(123450)).toBe('1234,50');
    expect(moneyToInput(5)).toBe('0,05');
  });

  it('liczy wartość pozycji i VAT', () => {
    expect(lineNet(1500, 1999)).toBe(2999);
    expect(lineNet(1000, 15000)).toBe(15000);
    expect(vatAmount(10000, 23)).toBe(2300);
    expect(vatAmount(10000, null)).toBe(0);
  });

  it('obsługuje ilości w tysięcznych', () => {
    expect(parseQty('0,5')).toBe(500);
    expect(parseQty('1,255')).toBe(1255);
    expect(parseQty('1,2555')).toBeNull();
    expect(formatQty(1255)).toBe('1,255');
  });
});

describe('daty', () => {
  it('czas warszawski uwzględnia czas letni i zimowy', () => {
    expect(nowWarsaw(new Date('2026-07-01T10:00:00Z'))).toBe('2026-07-01T12:00');
    expect(nowWarsaw(new Date('2026-01-15T10:00:00Z'))).toBe('2026-01-15T11:00');
    expect(formatInstant('2026-07-01T10:00:00Z').replace(/\s/g, ' ')).toContain('12:00');
  });

  it('dzień w Warszawie zmienia się według Warszawy, nie UTC', () => {
    expect(todayWarsaw(new Date('2026-11-04T23:30:00Z'))).toBe('2026-11-05');
  });

  it('wyświetla w polskim formacie', () => {
    expect(formatDate('2026-11-04')).toBe('04.11.2026');
    expect(formatTerm('2026-11-04T09:30')).toBe('04.11.2026, 09:30');
    expect(formatTerm(null)).toBe('Bez terminu');
    expect(formatDateLong('2026-11-04')).toBe('środa, 4 listopada');
    expect(formatMonth('2026-11')).toBe('listopad 2026');
  });

  it('arytmetyka dat działa przez przełom miesiąca i zmianę czasu', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(addMinutes('2026-03-29T01:30', 60)).toBe('2026-03-29T02:30');
    expect(addMinutes('2026-11-04T23:30', 60)).toBe('2026-11-05T00:30');
  });

  it('sprawdza poprawność daty', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('04.11.2026')).toBe(false);
  });
});

describe('walidacja i wyszukiwanie', () => {
  it('sprawdza sumę kontrolną NIP', () => {
    expect(isValidNip('526-000-12-46')).toBe(true);
    expect(isValidNip('5260001247')).toBe(false);
    expect(isValidNip('123')).toBe(false);
  });

  it('szuka bez polskich znaków i wielkości liter', () => {
    expect(matchesSearch('lodz', 'Łódź, ul. Piotrkowska')).toBe(true);
    expect(matchesSearch('ZAKŁAD piotrk', 'Zakład', 'ul. Piotrkowska')).toBe(true);
    expect(matchesSearch('gdansk', 'Łódź')).toBe(false);
  });
});

describe('CSV', () => {
  it('jest czytelny dla polskiego Excela', () => {
    const csv = toCsv(['Nazwa', 'Uwagi'], [['Firma; "Alfa"', '=SUM(A1)']]);
    expect(csv.startsWith('﻿Nazwa;Uwagi\r\n')).toBe(true);
    expect(csv).toContain('"Firma; ""Alfa""";\'=SUM(A1)');
  });
});
