import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { dayPurpose, dayRoute, dayVisits, fillGap, finishDay, getDayStart, odometerGaps, startDay } from './day-trip';
import { db } from './db';
import { buildReport, periodOf } from './reports';
import { trips } from './repo';
import type { Order, Trip, Visit } from './types';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

const order = (id: string, number: number, city: string) => ({ id, number, prefix: '', city }) as unknown as Order;
const visit = (id: string, orderId: string, seq: number, start: string, extra: Partial<Visit> = {}) =>
  ({ id, orderId, seq, start, status: 'zaplanowany', technicianId: 'me', deletedAt: null, startedAt: null, doneOn: null, ...extra }) as unknown as Visit;

describe('kilometrówka „Dzień w trasie”', () => {
  const orders = new Map([
    ['o1', order('o1', 4, 'Gdynia')],
    ['o2', order('o2', 5, 'Sopot')],
    ['o3', order('o3', 6, 'Gdańsk')],
  ]);
  const list = [
    visit('v3', 'o3', 1, '2026-11-12T16:00'),
    visit('v1', 'o1', 1, '2026-11-12T09:00', { status: 'wykonany', doneOn: '2026-11-12' }),
    visit('v2', 'o2', 2, '2026-11-12T13:00'),
    visit('vx', 'o2', 3, '2026-11-12T15:00', { status: 'odwolany' }),
    visit('vy', 'o2', 1, '2026-11-12T11:00', { technicianId: 'ktos-inny' }),
    visit('vz', 'o1', 2, '2026-11-13T09:00'),
  ];

  it('trasa i cel dnia z zabiegów technika, po kolei; „Gdańsk – Gdańsk” to jeden Gdańsk', () => {
    const day = dayVisits(list, '2026-11-12', 'me');
    expect(day.map((v) => v.id)).toEqual(['v1', 'v2', 'v3']);
    expect(dayRoute('gdansk', day, orders)).toEqual(['Gdańsk', 'Gdynia', 'Sopot', 'Gdańsk']);
    expect(dayRoute('Gdańsk', day, orders, ['Pruszcz Gdański'])).toEqual(['Gdańsk', 'Gdynia', 'Sopot', 'Gdańsk', 'Pruszcz Gdański', 'Gdańsk']);
    expect(dayPurpose(day, orders)).toBe('Zabiegi 0004/I, 0005/II, 0006/I');
    expect(dayRoute('Gdańsk', [visit('a', 'o3', 1, '2026-11-12T10:00')], orders)).toEqual(['Gdańsk']);
  });

  it('rano „Jadę”, wieczorem jeden licznik: jeden przejazd służbowy z prywatnym odcinkiem do wglądu', async () => {
    const start = { date: '2026-11-12', odometer: 120035, vehicle: 'GD 12345', from: 'Gdańsk', startedAt: '2026-11-12T07:40' };
    await startDay(start);
    expect(await getDayStart()).toMatchObject({ odometer: 120035 });
    await expect(finishDay({ start, odometerEnd: 120000, route: ['Gdańsk'], purpose: '', privateKm: 0, ownerId: 'me', driver: 'Maurycy', timeTo: '' })).rejects.toThrow();
    const trip = await finishDay({
      start,
      odometerEnd: 120122,
      route: ['Gdańsk', 'Gdynia', 'Sopot', 'Gdańsk'],
      purpose: 'Zabiegi 0004/I, 0005/II',
      privateKm: 12,
      ownerId: 'me',
      driver: 'Maurycy Kowalski',
      timeTo: '17:30',
    });
    expect(trip).toMatchObject({ kind: 'sluzbowy', from: 'Gdańsk', via: 'Gdynia, Sopot', to: 'Gdańsk', odometerStart: 120035, odometerEnd: 120122, privateKm: 12 });
    expect(await getDayStart()).toBeNull();
    // Raport: 87 km do VAT, w tym 12 prywatnych.
    const report = buildReport(periodOf('dzien', '2026-11-12'), { visits: [], orders: [], expenses: [], trips: [trip] });
    expect(report.km).toEqual({ sluzbowy: 87, prywatny: 12 });
  });

  it('luka w liczniku między przejazdami jest wykryta i można ją dopisać', async () => {
    const base = { ownerId: 'me', kind: 'sluzbowy', timeFrom: '08:00', timeTo: '', from: 'Gdańsk', via: '', to: 'Gdańsk', purpose: '', vehicle: 'GD 12345' } as const;
    await trips.create({ ...base, date: '2026-11-13', odometerStart: 120410, odometerEnd: 120500 } as Omit<Trip, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>);
    await trips.create({ ...base, date: '2026-11-14', odometerStart: 120512, odometerEnd: 120600 } as Omit<Trip, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>);
    const gaps = odometerGaps(await trips.all());
    expect(gaps).toEqual([{ vehicle: 'GD12345', date: '2026-11-14', from: 120500, to: 120512, km: 12 }]);
    await fillGap(gaps[0], 'Gdańsk', 'me', 'Maurycy');
    expect(odometerGaps(await trips.all())).toEqual([]);
  });
});
