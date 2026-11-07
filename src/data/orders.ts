// Zlecenia i zabiegi Pogromców Insektów. Operacje wielotabelowe działają w transakcjach.
import { todayWarsaw } from '../lib/dates';
import { newId } from '../lib/ids';
import { db, writeTransaction } from './db';
import { DomainError } from './domain';
import { attachments, orders, visits, trips, type NewRecord } from './repo';
import { getAppSettings, getProfile, nextOrderNumber, ownedBy } from './settings';
import type { Interview, Order, PayMethod, Trip, Visit } from './types';

export { orders, visits, trips };

export const EMPTY_INTERVIEW: Interview = {
  since: '',
  what: '',
  where: '',
  bites: '',
  seen: '',
  selfTreatment: '',
  other: '',
};

export type OrderDraft = Omit<NewRecord<Order>, 'number' | 'ownerId' | 'ownerName' | 'closed'>;

export interface PlannedVisit {
  start: string | null;
  durationMin: number;
}

function newVisit(orderId: string, seq: number, plan: PlannedVisit, technician: { id: string | null; name: string }): NewRecord<Visit> {
  return {
    orderId,
    seq,
    start: plan.start,
    durationMin: plan.durationMin,
    status: 'zaplanowany',
    technicianId: technician.id,
    technicianName: technician.name,
    startedAt: null,
    finishedAt: null,
    doneOn: null,
    payMethod: null,
    amount: null,
    interview: { ...EMPTY_INTERVIEW },
    treatments: [],
    places: [],
    findings: '',
    problems: '',
    recommendations: [],
    bonus: 0,
    notes: '',
  };
}

/**
 * Zakłada zlecenie z pierwszym zabiegiem. Drugi zabieg powstaje od razu, gdy termin został umówiony
 * przy przyjęciu zlecenia. Gdy umawia go technik, powstanie przy zakończeniu pierwszego.
 */
export async function createOrder(
  draft: OrderDraft,
  first: PlannedVisit,
  second: PlannedVisit | null,
): Promise<{ order: Order; visits: Visit[] }> {
  const profile = await getProfile();
  const technician = { id: profile.userId, name: profile.name };
  return writeTransaction([db.orders, db.visits, db.meta], async () => {
    const order = await orders.create({
      ...draft,
      number: await nextOrderNumber(),
      ownerId: technician.id,
      ownerName: technician.name,
      closed: false,
    });
    const created = [await visits.create(newVisit(order.id, 1, first, technician))];
    if (second) created.push(await visits.create(newVisit(order.id, 2, second, technician)));
    return { order, visits: created };
  });
}

export async function orderVisits(orderId: string): Promise<Visit[]> {
  return (await visits.where('orderId', orderId)).sort((a, b) => a.seq - b.seq);
}

/** Zabieg rozlicza technik, który go rozpoczął, także gdy zlecenie przyjął ktoś inny z oddziału. */
export async function startVisit(id: string): Promise<void> {
  const profile = await getProfile();
  await visits.update(id, {
    status: 'w_trakcie',
    startedAt: new Date().toISOString(),
    technicianId: profile.userId,
    technicianName: profile.name,
  });
}

export type NextVisit =
  | { mode: 'brak' }
  | { mode: 'technik' }
  | { mode: 'umowiony'; start: string; durationMin: number };

export interface FinishInput {
  payMethod: PayMethod | null;
  amount: number | null;
  treatments: string[];
  places: string[];
  findings: string;
  problems: string;
  recommendations: string[];
  next: NextVisit;
}

/**
 * Zamyka zabieg i umawia kolejny. Technik, który sam umawia trzeci zabieg, dostaje premię
 * doliczaną do zabiegu, podczas którego go umówił.
 */
export async function finishVisit(id: string, input: FinishInput): Promise<{ next: Visit | null }> {
  const settings = await getAppSettings();
  const profile = await getProfile();
  return writeTransaction([db.orders, db.visits], async () => {
    const visit = await visits.get(id);
    if (!visit || visit.deletedAt) throw new DomainError('Nie znaleziono zabiegu.');
    const all = await orderVisits(visit.orderId);
    const later = all.find((v) => v.seq === visit.seq + 1 && v.status !== 'odwolany');

    let next: Visit | null = later ?? null;
    let bonus = 0;
    if (input.next.mode === 'umowiony') {
      if (later) {
        await visits.update(later.id, { start: input.next.start, durationMin: input.next.durationMin });
        next = { ...later, start: input.next.start };
      } else {
        next = await visits.create(
          newVisit(visit.orderId, visit.seq + 1, input.next, { id: profile.userId, name: profile.name }),
        );
      }
      if (visit.seq + 1 === 3) bonus = settings.thirdVisitBonus;
    } else if (input.next.mode === 'technik' && !later) {
      next = await visits.create(
        newVisit(visit.orderId, visit.seq + 1, { start: null, durationMin: visit.durationMin }, { id: profile.userId, name: profile.name }),
      );
    }

    await visits.update(id, {
      status: 'wykonany',
      startedAt: visit.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      doneOn: visit.doneOn ?? todayWarsaw(),
      payMethod: input.payMethod,
      amount: input.amount,
      treatments: input.treatments,
      places: input.places,
      findings: input.findings,
      problems: input.problems,
      recommendations: input.recommendations,
      bonus,
    });
    if (input.next.mode === 'brak' && !later) await orders.update(visit.orderId, { closed: true });
    return { next };
  });
}

/** Usuwa zlecenie do kosza razem z zabiegami i zdjęciami. */
export async function deleteOrder(id: string): Promise<void> {
  await writeTransaction([db.orders, db.visits, db.attachments], async () => {
    const at = new Date().toISOString();
    for (const visit of await visits.where('orderId', id)) {
      for (const photo of await attachments.where('jobId', visit.id)) await attachments.softDelete(photo.id, at);
      await visits.softDelete(visit.id, at);
    }
    await orders.softDelete(id, at);
  });
}

/** Licznik po ostatnim przejeździe: podpowiedź stanu licznika na początek kolejnego. */
export async function lastOdometer(ownerId: string | null): Promise<number | null> {
  const all = (await trips.all()).filter((t) => ownedBy(t.ownerId, ownerId, true));
  if (all.length === 0) return null;
  return all.reduce((max, t) => Math.max(max, t.odometerEnd), 0);
}

export function tripKm(trip: Pick<Trip, 'odometerStart' | 'odometerEnd'>): number {
  return Math.max(0, trip.odometerEnd - trip.odometerStart);
}

export { newId };
