import { describe, expect, it } from 'vitest';
import { cardText, formatAccount, formatNip, isValidAccount, transferText } from './card';

describe('wizytówka', () => {
  const company = { name: 'Pogromcy Insektów', taxpayerName: 'P.H.U. OLI-TRANS Ilona Wasiljew', nip: '8882667376', bankAccount: '51249000050000450038079526', blikPhone: '+48 505 724 090' };

  it('numer konta w grupach i z sumą kontrolną, NIP z odstępami', () => {
    expect(formatAccount('51249000050000450038079526')).toBe('51 2490 0005 0000 4500 3807 9526');
    expect(formatAccount('51 2490')).toBe('51 2490');
    expect(isValidAccount('51 2490 0005 0000 4500 3807 9526')).toBe(true);
    expect(isValidAccount('52 2490 0005 0000 4500 3807 9526')).toBe(false);
    expect(isValidAccount('51 2490')).toBe(false);
    expect(formatNip('8882667376')).toBe('888 266 73 76');
  });

  it('tekst do przelewu i cała wizytówka', () => {
    expect(transferText(company).split('\n')).toEqual([
      'Odbiorca: P.H.U. OLI-TRANS Ilona Wasiljew',
      'NIP: 888 266 73 76',
      'Numer konta: 51 2490 0005 0000 4500 3807 9526',
    ]);
    const text = cardText({ company, name: 'Maurycy', phone: '500 600 700' }).split('\n');
    expect(text[0]).toBe('Pogromcy Insektów');
    expect(text[1]).toBe('Maurycy, tel. 500 600 700');
    expect(text).toContain('Dane do przelewu:');
    expect(text.at(-1)).toBe('BLIK na telefon: +48 505 724 090');
  });
});
