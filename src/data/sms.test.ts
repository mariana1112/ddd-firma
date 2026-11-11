import { describe, expect, it } from 'vitest';
import { DEFAULT_APP } from './settings';
import { earlierSms, lateSms, remindersDue } from './sms';
import type { Order, Visit } from './types';

const order = { street: 'Długa', houseNo: '5', flatNo: '', building: 'dom', city: 'Gdańsk', phones: [{ number: '500 600 700', label: '' }] } as unknown as Order;

describe('wiadomości SMS', () => {
  it('spóźnienie i prośba o wcześniejszy przyjazd z godziną zabiegu', () => {
    const visit = { start: '2026-11-11T10:00', seq: 1 };
    expect(lateSms(order, visit, 15, 'Maurycy', DEFAULT_APP)).toBe('Dzień dobry, przepraszam, spóźnię się około 15 minut na zabieg o 10:00 (Długa 5, Gdańsk). Pozdrawiam, Maurycy, Pogromcy Insektów');
    expect(earlierSms(order, visit, 30, '', DEFAULT_APP)).toContain('około 09:30 zamiast 10:00');
    // Własny szablon z Ustawień
    expect(lateSms(order, visit, 20, 'Ola', { lateTemplate: 'Będę {minuty} min później. {podpis}' })).toBe('Będę 20 min później. Ola, Pogromcy Insektów');
    // Pełne imię i nazwisko jest w raportach; w SMS-ie podpis samym imieniem.
    expect(lateSms(order, visit, 20, 'Ola Nowak', { lateTemplate: '{podpis}' })).toBe('Ola, Pogromcy Insektów');
  });

  it('przypomnienia: tylko jutrzejsze, umówione, niewysłane i z telefonem', () => {
    const v = (patch: Partial<Visit>) => ({ status: 'zaplanowany', start: '2026-11-11T10:00', remindedAt: null, ...patch }) as Visit;
    const list = [
      { visit: v({}), order },
      { visit: v({ remindedAt: '2026-11-10T18:00:00Z' }), order },
      { visit: v({ start: '2026-11-12T10:00' }), order },
      { visit: v({ status: 'odwolany' }), order },
      { visit: v({}), order: { ...order, phones: [] } as Order },
    ];
    expect(remindersDue(list, '2026-11-11')).toHaveLength(1);
  });
});
