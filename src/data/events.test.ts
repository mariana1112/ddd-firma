import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { buildBackup } from './backup';
import { calendarEvents, createEvent, deleteEvent, eventErrors, eventOnDay, listEvents, updateEvent, type EventDraft } from './events';
import { services } from './repo';
import { saveProfile } from './settings';

const draft = (over: Partial<EventDraft> = {}): EventDraft => ({
  type: 'serwis',
  name: 'Serwis auta',
  date: '2026-11-20',
  endDate: '2026-11-20',
  allDay: false,
  start: '14:00',
  end: '15:30',
  note: 'Wymiana oleju',
  ...over,
});

beforeEach(async () => {
  await db.delete();
  await db.open();
  await saveProfile({ name: 'Maurycy', userId: 'u1' });
});

describe('wydarzenia w kalendarzu (wolne, serwis…)', () => {
  it('zapisuje, zmienia i usuwa wydarzenie; trafia do dziennika zmian (synchronizacja)', async () => {
    const e = await createEvent(draft());
    expect(e.kind).toBe('wydarzenie');
    expect(e.ownerId).toBe('u1');
    expect(e.ownerName).toBe('Maurycy');
    expect((await listEvents()).map((x) => x.name)).toEqual(['Serwis auta']);
    expect(await db.changes.where('[tbl+recordId]').equals(['services', e.id]).count()).toBeGreaterThan(0);

    await updateEvent(e.id, draft({ type: 'wolne', name: 'Wolne', allDay: true, endDate: '2026-11-22' }));
    const changed = (await calendarEvents.get(e.id))!;
    expect(changed.allDay).toBe(true);
    expect(changed.start).toBeNull();
    expect(eventOnDay(changed, '2026-11-21')).toBe(true);
    expect(eventOnDay(changed, '2026-11-23')).toBe(false);

    await deleteEvent(e.id);
    expect(await listEvents()).toEqual([]);
  });

  it('nie miesza się z dawnymi pozycjami cennika w tej samej tabeli', async () => {
    await services.create({ name: 'Stara usługa', category: 'inne', unit: 'szt', priceNet: 10000, vatRate: 23 } as never);
    await createEvent(draft({ name: 'Szkolenie BHP', type: 'szkolenie' }));
    expect((await listEvents()).map((x) => x.name)).toEqual(['Szkolenie BHP']);
  });

  it('sprawdza tytuł, dni i godziny', () => {
    expect(eventErrors(draft())).toEqual([]);
    expect(eventErrors(draft({ name: ' ' }))).toContain('Wpisz, co to za wydarzenie');
    expect(eventErrors(draft({ endDate: '2026-11-19' }))).toContain('Koniec nie może być przed początkiem');
    expect(eventErrors(draft({ end: '13:00' }))).toContain('Godzina końca musi być po godzinie początku');
    expect(eventErrors(draft({ allDay: true, start: '', end: '' }))).toEqual([]);
  });

  it('wydarzenie przechodzi przez kopię zapasową', async () => {
    await createEvent(draft());
    const backup = await buildBackup({ includePhotos: false });
    expect(JSON.stringify(backup)).toContain('Serwis auta');
  });
});

describe('wolne i urlop blokują terminy', () => {
  it('cały dzień wolnego/urlopu blokuje dzień, serwis z godzinami zajmuje te godziny; cudze nie blokują', async () => {
    const { dayOff, eventBusy } = await import('./events');
    const off = await createEvent(draft({ type: 'urlop', name: 'Urlop', allDay: true, date: '2026-11-20', endDate: '2026-11-21' }));
    const service = await createEvent(draft());
    const all = await listEvents();
    expect(dayOff(all, '2026-11-21', 'u1')?.id).toBe(off.id);
    expect(dayOff(all, '2026-11-22', 'u1')).toBeUndefined();
    expect(dayOff(all, '2026-11-20', 'ktos-inny')).toBeUndefined();
    expect(eventBusy(all, '2026-11-20', 'u1')).toEqual([{ start: '2026-11-20T14:00', durationMin: 90, label: 'Serwis auta' }]);
    expect(eventBusy(all, '2026-11-20', 'ktos-inny')).toEqual([]);
    await deleteEvent(service.id);
    expect(eventBusy(await listEvents(), '2026-11-20', 'u1')).toEqual([]);
  });
});
