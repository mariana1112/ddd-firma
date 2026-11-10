// Zlecenia i zabiegi Pogromców Insektów. Operacje wielotabelowe działają w transakcjach.
import { METHOD_LABEL } from './methods';
import { todayWarsaw } from '../lib/dates';
import type { VisitTerms } from './visit-terms';
import { newId } from '../lib/ids';
import { db, writeTransaction } from './db';
import { DomainError } from './domain';
import { normalizePlate, tripKm } from './mileage';
import { attachments, orders, visits, trips, type NewRecord } from './repo';
import { getAppSettings, getProfile, getRegion, nextOrderNumber, ownedBy } from './settings';
import { EMPTY_INTERVIEW } from './interview';
import type { Order, PayMethod, Visit } from './types';

export { orders, visits, trips };
export { EMPTY_INTERVIEW, normalizeInterview } from './interview';

export type OrderDraft = Omit<NewRecord<Order>, 'number' | 'prefix' | 'ownerId' | 'ownerName' | 'closed' | 'archived'>;

export interface PlannedVisit {
  start: string | null;
  durationMin: number;
  /** Co pryskamy i za ile. Brak: zabieg bez własnych ustaleń (widełki zlecenia, całe mieszkanie). */
  terms?: VisitTerms;
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
    ...(plan.terms ? { scope: { ...plan.terms.scope }, priceMin: plan.terms.priceMin, priceMax: plan.terms.priceMax } : {}),
  };
}

/** Pola zabiegu z ustaleń, do zapisu przy zmianie terminu. */
function termsPatch(terms: VisitTerms | undefined): Partial<Visit> {
  return terms ? { scope: { ...terms.scope }, priceMin: terms.priceMin, priceMax: terms.priceMax } : {};
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
  const { prefix } = await getRegion();
  return writeTransaction([db.orders, db.visits, db.meta], async () => {
    const order = await orders.create({
      ...draft,
      number: await nextOrderNumber(),
      prefix,
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
  const visit = await visits.get(id);
  // Kolejny zabieg (II, III…) zaczyna się tylko po umówieniu terminu z klientem.
  if (visit && visit.seq > 1 && !visit.start) throw new DomainError('Najpierw umów termin tego zabiegu z klientem.');
  const order = visit ? await orders.get(visit.orderId) : undefined;
  // „Wykonane” zaczyna od metod wybranych przy zleceniu; technik odznacza, czego nie zrobił.
  const treatments = visit && visit.treatments.length === 0 && order?.methods?.length ? order.methods.map((m) => METHOD_LABEL[m]) : undefined;
  await visits.update(id, {
    status: 'w_trakcie',
    startedAt: new Date().toISOString(),
    technicianId: profile.userId,
    technicianName: profile.name,
    ...(treatments ? { treatments } : {}),
  });
}

export type NextVisit =
  | { mode: 'brak' }
  | { mode: 'technik'; terms?: VisitTerms }
  | { mode: 'umowiony'; start: string; durationMin: number; terms?: VisitTerms };

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
        await visits.update(later.id, { start: input.next.start, durationMin: input.next.durationMin, ...termsPatch(input.next.terms) });
        next = { ...later, start: input.next.start, ...termsPatch(input.next.terms) };
      } else {
        next = await visits.create(
          newVisit(visit.orderId, visit.seq + 1, input.next, { id: profile.userId, name: profile.name }),
        );
      }
      if (visit.seq + 1 === 3) bonus = settings.thirdVisitBonus;
    } else if (input.next.mode === 'technik' && later && input.next.terms) {
      await visits.update(later.id, termsPatch(input.next.terms));
    } else if (input.next.mode === 'technik' && !later) {
      next = await visits.create(
        newVisit(visit.orderId, visit.seq + 1, { start: null, durationMin: visit.durationMin, terms: input.next.terms }, { id: profile.userId, name: profile.name }),
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

/**
 * Umawia kolejny zabieg z poziomu zlecenia. Zabieg bez terminu, który już czeka, dostaje termin; w przeciwnym razie
 * powstaje następny numer zabiegu. Zakończone zlecenie wraca do otwartych. Premia za trzeci zabieg nalicza się tylko
 * przy zakończeniu zabiegu, więc tutaj jej nie ma.
 */
export async function scheduleNextVisit(orderId: string, plan: PlannedVisit): Promise<Visit> {
  const profile = await getProfile();
  return writeTransaction([db.orders, db.visits], async () => {
    const order = await orders.get(orderId);
    if (!order || order.deletedAt) throw new DomainError('Nie znaleziono zlecenia.');
    const all = (await orderVisits(orderId)).filter((v) => v.status !== 'odwolany');
    const waiting = all.find((v) => v.status === 'zaplanowany' && !v.start);
    if (waiting) {
      await visits.update(waiting.id, { start: plan.start, durationMin: plan.durationMin, ...termsPatch(plan.terms) });
      return { ...waiting, start: plan.start, durationMin: plan.durationMin, ...termsPatch(plan.terms) };
    }
    const seq = Math.max(0, ...(await orderVisits(orderId)).map((v) => v.seq)) + 1;
    const last = all[all.length - 1];
    const created = await visits.create(
      newVisit(orderId, seq, { ...plan, durationMin: plan.durationMin || last?.durationMin || 60 }, { id: profile.userId, name: profile.name }),
    );
    if (order.closed) await orders.update(orderId, { closed: false });
    return created;
  });
}

/**
 * Odwołuje zabieg. Gdy w zleceniu nie zostaje żaden zabieg do zrobienia ani wykonany, całe zlecenie trafia
 * do archiwum (odwołane w całości).
 */
export async function cancelVisit(id: string): Promise<{ archived: boolean }> {
  return writeTransaction([db.orders, db.visits], async () => {
    const visit = await visits.get(id);
    if (!visit || visit.deletedAt) throw new DomainError('Nie znaleziono zabiegu.');
    await visits.update(id, { status: 'odwolany' });
    const rest = (await orderVisits(visit.orderId)).filter((v) => v.id !== id && v.status !== 'odwolany');
    if (rest.length === 0) {
      await orders.update(visit.orderId, { archived: true, closed: true });
      return { archived: true };
    }
    return { archived: false };
  });
}

/** Odwołuje zlecenie: zabiegi do zrobienia zostają odwołane, a zlecenie trafia do archiwum. Wykonane zostają. */
export async function archiveOrder(id: string): Promise<void> {
  await writeTransaction([db.orders, db.visits], async () => {
    for (const v of await orderVisits(id)) {
      if (v.status === 'zaplanowany' || v.status === 'w_trakcie') await visits.update(v.id, { status: 'odwolany' });
    }
    await orders.update(id, { archived: true, closed: true });
  });
}

/** Przywraca zlecenie z archiwum. Odwołane zabiegi zostają odwołane; kolejny umawia się „Umów kolejny zabieg”. */
export async function restoreOrder(id: string): Promise<void> {
  await orders.update(id, { archived: false, closed: false });
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

/**
 * Licznik po ostatnim przejeździe: podpowiedź stanu licznika na początek kolejnego. Przy ustawionym
 * aucie liczy się ostatni przejazd tym autem, także innego kierowcy z oddziału.
 */
export async function lastOdometer(ownerId: string | null, vehicle = ''): Promise<number | null> {
  const plate = normalizePlate(vehicle);
  const all = (await trips.all()).filter((t) => (plate ? normalizePlate(t.vehicle) === plate : ownedBy(t.ownerId, ownerId, true)));
  if (all.length === 0) return null;
  return all.reduce((max, t) => Math.max(max, t.odometerEnd), 0);
}

export { tripKm };

export { newId };
