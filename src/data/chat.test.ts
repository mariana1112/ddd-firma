import { describe, expect, it } from 'vitest';
import { chatPeople, insertMention, mentionQuery, mentionsIn, splitMentions } from './chat';
import { buildNotifications } from './notifications';
import type { Message } from './types';

const msg = (over: Partial<Message>): Message =>
  ({ id: 'm1', channel: 'firma', authorId: 'a', authorName: 'Ania', text: '', createdAt: '2026-11-11T10:00:00.000Z', updatedAt: '', deletedAt: null, ...over }) as Message;

describe('oznaczanie osób na czacie', () => {
  it('lista osób: konta firmy i autorzy wiadomości, bez mnie, alfabetycznie', () => {
    const people = chatPeople([msg({ authorId: 'k', authorName: 'Księgowa Ola' }), msg({ authorId: 'me', authorName: 'Maurycy' })], [{ id: 'p', name: 'Piotrek' }, { id: 'x', name: ' ' }], 'me');
    expect(people).toEqual([
      { id: 'k', name: 'Księgowa Ola' },
      { id: 'p', name: 'Piotrek' },
    ]);
  });

  it('„@” podpowiada osoby, wybór wstawia „@Imię ” w miejsce wpisanego fragmentu', () => {
    expect(mentionQuery('Cześć @Pio')).toBe('Pio');
    expect(mentionQuery('mail@firma')).toBeNull();
    expect(mentionQuery('Cześć')).toBeNull();
    expect(insertMention('Cześć @Pio', { id: 'p', name: 'Piotrek' })).toBe('Cześć @Piotrek ');
    expect(insertMention('Cześć', { id: 'p', name: 'Piotrek' })).toBe('Cześć @Piotrek ');
    expect(insertMention('', { id: 'p', name: 'Piotrek' })).toBe('@Piotrek ');
  });

  it('oznaczeni to tylko ci, których „@Imię” zostało w tekście; tekst dzieli się na oznaczenia', () => {
    const picked = [
      { id: 'p', name: 'Piotrek' },
      { id: 'o', name: 'Ola Nowak' },
    ];
    expect(mentionsIn('@Ola Nowak faktura gotowa?', picked)).toEqual(['o']);
    expect(splitMentions('@Ola Nowak faktura?', ['Ola Nowak', 'Ola'])).toEqual([
      { text: '@Ola Nowak', mention: true },
      { text: ' faktura?', mention: false },
    ]);
  });

  it('oznaczona osoba dostaje powiadomienie, dopóki nie przeczyta kanału', () => {
    const base = { orders: [], deletedOrders: [], visits: [], channels: [{ id: 'firma', label: 'Cała firma' }], owner: false, today: '2026-11-11' };
    const messages = [msg({ text: '@Piotrek zadzwoń', mentions: ['p'] })];
    const list = buildNotifications({ ...base, messages, me: 'p', read: {} });
    expect(list.find((n) => n.kind === 'oznaczenie')).toMatchObject({ title: 'Ania oznacza Cię: Cała firma', text: '@Piotrek zadzwoń' });
    expect(buildNotifications({ ...base, messages, me: 'p', read: { firma: '2026-11-11T11:00:00.000Z' } }).some((n) => n.kind === 'oznaczenie')).toBe(false);
    expect(buildNotifications({ ...base, messages, me: 'q', read: {} }).some((n) => n.kind === 'oznaczenie')).toBe(false);
  });
});
