// Zlecenia i zabiegi Pogromców Insektów. Operacje wielotabelowe działają w transakcjach.
import { METHOD_LABEL, orderMethods } from './methods';
import { startToSave, dayInWarsaw } from './texts';
import { todayWarsaw } from '../lib/dates';
import type { VisitTerms } from './visit-terms';
import { newId } from '../lib/ids';
import { db, writeTransaction } from './db';
import { DomainError } from './domain';
import { normalizePlate, tripKm } from './mileage';
import { attachments, expenses, orders, visits, trips, type NewRecord } from './repo';
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

/** Kto i kiedy umówił termin zabiegu z klientem. */
function booking(person: { id: string | null; name: string }): Pick<Visit, 'bookedById' | 'bookedByName' | 'bookedAt'> {
  return { bookedById: person.id, bookedByName: person.name, bookedAt: new Date().toISOString() };
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
    ...(plan.start ? booking(technician) : {}),
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
  const treatments = visit && visit.treatments.length === 0 && order && orderMethods(order).length ? orderMethods(order).map((m) => METHOD_LABEL[m]) : undefined;
  await visits.update(id, {
    status: 'w_trakcie',
    startedAt: new Date().toISOString(),
    technicianId: profile.userId,
    technicianName: profile.name,
    ...(treatments ? { treatments } : {}),
  });
}

/**
 * Domyślny dzień wykonania przy kończeniu zabiegu: zabieg rozpoczęty albo umówiony na wcześniejszy dzień i zamykany
 * dopiero później liczy się do raportu tamtego dnia; w innym razie dzisiaj.
 */
export function defaultDoneOn(visit: Pick<Visit, 'startedAt' | 'start'>, today: string): string {
  const started = visit.startedAt ? dayInWarsaw(visit.startedAt) : '';
  if (started && started < today) return started;
  const planned = visit.start?.slice(0, 10) ?? '';
  if (planned && planned < today) return planned;
  return today;
}

/**
 * Wycofanie rozpoczętego zabiegu („Usuń wszystko”): zabieg wraca do „umówiony”, a wpisane dane (wykonane prace,
 * miejsca, wywiad, zalecenia, płatność) i zdjęcia (do kosza) znikają. Termin zostaje.
 */
export async function revertStartedVisit(id: string): Promise<void> {
  await writeTransaction([db.visits, db.attachments], async () => {
    const visit = await visits.get(id);
    if (!visit || visit.status !== 'w_trakcie') throw new DomainError('Ten zabieg nie jest w trakcie.');
    const at = new Date().toISOString();
    for (const photo of await attachments.where('jobId', id)) await attachments.softDelete(photo.id, at);
    await visits.update(id, {
      status: 'zaplanowany',
      startedAt: null,
      treatments: [],
      places: [],
      sealing: [],
      findings: '',
      problems: '',
      recommendations: [],
      payMethod: null,
      amount: null,
      interview: { ...EMPTY_INTERVIEW },
    });
  });
}

export type NextVisit =
  | { mode: 'brak' }
  | { mode: 'technik'; terms?: VisitTerms }
  | { mode: 'umowiony'; start: string; durationMin: number; terms?: VisitTerms };

export interface FinishInput {
  /** Dzień wykonania (raport tego dnia). Puste: dzisiaj. */
  doneOn?: string;
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
        await visits.update(later.id, { start: input.next.start, durationMin: input.next.durationMin, ...termsPatch(input.next.terms), ...booking({ id: profile.userId, name: profile.name }) });
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

    const finishedAt = new Date().toISOString();
    await visits.update(id, {
      status: 'wykonany',
      startedAt: startToSave(visit.startedAt, finishedAt),
      finishedAt,
      doneOn: input.doneOn || visit.doneOn || todayWarsaw(),
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
      const booked = booking({ id: profile.userId, name: profile.name });
      await visits.update(waiting.id, { start: plan.start, durationMin: plan.durationMin, ...termsPatch(plan.terms), ...booked });
      return { ...waiting, start: plan.start, durationMin: plan.durationMin, ...termsPatch(plan.terms), ...booked };
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
    // Do zrobienia zostaje tylko zabieg w trakcie albo z umówionym terminem. Pusty „jeszcze nieumówiony” zabieg
    // (np. II po zabiegu I) nie trzyma zlecenia poza archiwum: odwołujemy go razem z tym zabiegiem.
    const pending = rest.filter((v) => v.status === 'w_trakcie' || (v.status === 'zaplanowany' && v.start));
    if (pending.length === 0) {
      for (const v of rest) if (v.status === 'zaplanowany') await visits.update(v.id, { status: 'odwolany' });
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

/**
 * Przed usunięciem regionu: jego zlecenia trafiają do archiwum (folder „Usunięty region: …”, poza raportami),
 * niezrobione zabiegi są odwoływane, a koszty i przejazdy regionu trafiają do kosza (można je przywrócić).
 */
export async function archiveRegionData(branchId: string, regionName: string): Promise<{ orders: number; expenses: number; trips: number }> {
  const note = `Usunięty region: ${regionName}`;
  const regionOrders = (await orders.allRegions()).filter((o) => o.branchId === branchId);
  const allVisits = await visits.allRegions();
  await writeTransaction([db.orders, db.visits], async () => {
    for (const order of regionOrders) {
      for (const v of allVisits.filter((x) => x.orderId === order.id)) {
        if (v.status === 'zaplanowany' || v.status === 'w_trakcie') await visits.update(v.id, { status: 'odwolany' });
      }
      await orders.update(order.id, { archived: true, closed: true, archivedNote: note, regionDeleted: true });
    }
  });
  const at = new Date().toISOString();
  const regionExpenses = (await expenses.allRegions()).filter((e) => e.branchId === branchId);
  const regionTrips = (await trips.allRegions()).filter((t) => t.branchId === branchId);
  for (const e of regionExpenses) await expenses.softDelete(e.id, at);
  for (const t of regionTrips) await trips.softDelete(t.id, at);
  return { orders: regionOrders.length, expenses: regionExpenses.length, trips: regionTrips.length };
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
  const list = await trips.all();
  let all = list.filter((t) => (plate ? normalizePlate(t.vehicle) === plate : ownedBy(t.ownerId, ownerId, true)));
  // Przejazdy zapisane przed ustawieniem auta nie mają numeru: wtedy liczy się własny ostatni przejazd bez auta.
  if (all.length === 0 && plate) all = list.filter((t) => !normalizePlate(t.vehicle) && ownedBy(t.ownerId, ownerId, true));
  if (all.length === 0) return null;
  return all.reduce((max, t) => Math.max(max, t.odometerEnd), 0);
}

export { tripKm };

export { newId };

/** Technik prosi o usunięcie zlecenia: admin zatwierdza albo odrzuca w powiadomieniach. */
export async function requestOrderDeletion(id: string, reason: string): Promise<void> {
  const profile = await getProfile();
  await orders.update(id, {
    deleteRequest: { byId: profile.userId, byName: profile.name, at: new Date().toISOString(), reason: reason.trim(), status: 'czeka' },
  });
}

/** Wycofanie własnej prośby o usunięcie. */
export async function cancelOrderDeletionRequest(id: string): Promise<void> {
  await orders.update(id, { deleteRequest: null });
}

/** Decyzja admina: zatwierdzenie usuwa zlecenie do kosza, odrzucenie zostawia je z informacją dla technika. */
export async function decideOrderDeletion(id: string, approve: boolean): Promise<void> {
  const order = await orders.get(id);
  if (!order?.deleteRequest) return;
  const profile = await getProfile();
  await orders.update(id, {
    deleteRequest: { ...order.deleteRequest, status: approve ? 'zatwierdzone' : 'odrzucone', decidedBy: profile.name || 'Admin', decidedAt: new Date().toISOString() },
  });
  if (approve) await deleteOrder(id);
}
