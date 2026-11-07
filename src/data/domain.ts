// Operacje obejmujące kilka tabel. Każda działa w transakcji, więc zapis jest kompletny albo żaden.
import { logChange } from './changes';
import { db, RECORD_TABLES, writeTransaction, type RecordTableName } from './db';
import { todayWarsaw } from '../lib/dates';
import { attachments, clients, expenses, jobs, newId, orders, payments, preparations, services, sites, stockMovements, trips, visits, type NewRecord } from './repo';
import { getSyncState, nextJobNumber } from './settings';
import type { Attachment, BaitStation, BaseRecord, Expense, Job, JobStationCheck, Payment, Site, StationState, StockMovement, Visit } from './types';

export class DomainError extends Error {}

export type JobDraft = Omit<
  NewRecord<Job>,
  | 'number'
  | 'materials'
  | 'stationChecks'
  | 'completedOn'
  | 'recommendations'
  | 'safetyPeriod'
  | 'warrantyUntil'
  | 'followUpDate'
  | 'followUpDone'
  | 'invoiceNo'
  | 'signerName'
  | 'signatureDataUrl'
>;

export async function createJob(draft: JobDraft): Promise<Job> {
  return writeTransaction([db.jobs, db.meta], async () => {
    const year = (draft.start ?? todayWarsaw()).slice(0, 4);
    return jobs.create({
      ...draft,
      number: await nextJobNumber(year),
      materials: [],
      stationChecks: [],
      completedOn: null,
      recommendations: '',
      safetyPeriod: '',
      warrantyUntil: null,
      followUpDate: null,
      followUpDone: false,
      invoiceNo: '',
      signerName: '',
      signatureDataUrl: null,
    });
  });
}

/** Przegląd dotyczy stacji konkretnego obiektu, więc zmiana obiektu zlecenia go unieważnia. */
export async function updateJob(id: string, draft: JobDraft): Promise<void> {
  await writeTransaction([db.jobs], async () => {
    const job = await jobs.get(id);
    if (!job) throw new DomainError('Nie znaleziono zlecenia.');
    await jobs.update(id, job.siteId === draft.siteId ? draft : { ...draft, stationChecks: [] });
  });
}

/** Tworzy kolejną wizytę na podstawie wykonanej i zamyka przypomnienie o niej. */
export async function planFollowUp(sourceId: string, start: string): Promise<Job> {
  return writeTransaction([db.jobs, db.meta], async () => {
    const source = await jobs.get(sourceId);
    if (!source) throw new DomainError('Nie znaleziono zlecenia.');
    const next = await createJob({
      clientId: source.clientId,
      siteId: source.siteId,
      status: 'zaplanowane',
      start,
      durationMin: source.durationMin,
      category: source.category,
      title: source.title,
      pest: source.pest,
      method: source.method,
      scope: source.scope,
      notes: '',
      lines: source.lines.map((line) => ({ ...line, id: newId() })),
    });
    await jobs.update(sourceId, { followUpDone: true });
    return next;
  });
}

export async function deleteClient(id: string): Promise<void> {
  await writeTransaction([db.clients, db.sites, db.jobs], async () => {
    const related = await jobs.where('clientId', id);
    if (related.length > 0) {
      throw new DomainError(`Liczba zleceń tego klienta: ${related.length}. Najpierw je usuń albo zostaw klienta w bazie.`);
    }
    const at = new Date().toISOString();
    for (const site of await sites.where('clientId', id)) await sites.softDelete(site.id, at);
    await clients.softDelete(id, at);
  });
}

export async function deleteSite(id: string): Promise<void> {
  await writeTransaction([db.sites, db.jobs], async () => {
    const related = await jobs.where('siteId', id);
    if (related.length > 0) {
      throw new DomainError(`Liczba zleceń w tym obiekcie: ${related.length}. Obiektu nie można usunąć.`);
    }
    await sites.softDelete(id);
  });
}

// ---------- Stacje deratyzacyjne ----------

export type StationInput = Pick<BaitStation, 'number' | 'type' | 'location'>;

const sameNumber = (a: string, b: string) => a.trim().toLocaleLowerCase('pl') === b.trim().toLocaleLowerCase('pl');

/** Kolejność jak na planie stacji: 2 przed 10. */
export function byStationNumber(a: { number: string }, b: { number: string }): number {
  return a.number.localeCompare(b.number, 'pl', { numeric: true });
}

/** Podpowiedź numeru nowej stacji: kolejny po najwyższym numerze czysto liczbowym. */
export function nextStationNumber(stations: BaitStation[]): string {
  const numbers = stations.filter((s) => !s.deletedAt && /^\d+$/.test(s.number)).map((s) => Number(s.number));
  return String(Math.max(0, ...numbers) + 1);
}

function assertNumberFree(site: Site, number: string, exceptId?: string) {
  if (site.stations.some((s) => !s.deletedAt && s.id !== exceptId && sameNumber(s.number, number))) {
    throw new DomainError(`Stacja nr ${number.trim()} już jest w tym obiekcie.`);
  }
}

/** Odczyt i zapis listy w jednej transakcji, żeby równoległa zmiana nie nadpisała innej stacji. */
async function changeStations<T>(siteId: string, change: (site: Site) => { stations: BaitStation[]; result: T }): Promise<T> {
  return writeTransaction([db.sites], async () => {
    const site = await sites.get(siteId);
    if (!site || site.deletedAt) throw new DomainError('Nie znaleziono obiektu.');
    const { stations, result } = change(site);
    await sites.update(siteId, { stations });
    return result;
  });
}

const cleanStation = (input: StationInput): StationInput => ({
  number: input.number.trim(),
  type: input.type.trim(),
  location: input.location.trim(),
});

export function addStation(siteId: string, input: StationInput): Promise<BaitStation> {
  return changeStations(siteId, (site) => {
    assertNumberFree(site, input.number);
    const station: BaitStation = { ...cleanStation(input), id: newId(), deletedAt: null };
    return { stations: [...site.stations, station], result: station };
  });
}

export function updateStation(siteId: string, stationId: string, input: StationInput): Promise<void> {
  return changeStations(siteId, (site) => {
    assertNumberFree(site, input.number, stationId);
    return {
      stations: site.stations.map((s) => (s.id === stationId ? { ...s, ...cleanStation(input) } : s)),
      result: undefined,
    };
  });
}

export function deleteStation(siteId: string, stationId: string): Promise<void> {
  const at = new Date().toISOString();
  return changeStations(siteId, (site) => ({
    stations: site.stations.map((s) => (s.id === stationId ? { ...s, deletedAt: at } : s)),
    result: undefined,
  }));
}

export function restoreStation(siteId: string, stationId: string): Promise<void> {
  return changeStations(siteId, (site) => {
    const station = site.stations.find((s) => s.id === stationId);
    if (station) assertNumberFree(site, station.number, stationId);
    return {
      stations: site.stations.map((s) => (s.id === stationId ? { ...s, deletedAt: null } : s)),
      result: undefined,
    };
  });
}

export type StationReviewRow = Omit<JobStationCheck, 'state'> & { state: StationState | '' };

/**
 * Wiersze formularza przeglądu: zapisane już wpisy zachowują swoją kopię danych, także gdy stację
 * później zmieniono lub usunięto, a pozostałe stacje obiektu startują jako niesprawdzone.
 */
export function stationReviewRows(site: Site | undefined, checks: JobStationCheck[]): StationReviewRow[] {
  const checked = new Set(checks.map((c) => c.stationId));
  const unchecked: StationReviewRow[] = (site?.stations ?? [])
    .filter((s) => !s.deletedAt && !checked.has(s.id))
    .map((s) => ({ stationId: s.id, number: s.number, type: s.type, location: s.location, state: '', notes: '' }));
  return [...checks, ...unchecked].sort(byStationNumber);
}

export async function deletePreparation(id: string): Promise<void> {
  await writeTransaction([db.preparations, db.jobs, db.stockMovements, db.expenses], async () => {
    const all = await jobs.all();
    const used = all.some((j) => j.materials.some((m) => m.preparationId === id));
    if (used) throw new DomainError('Preparat jest użyty w zleceniach, więc musi zostać w ewidencji.');
    const at = new Date().toISOString();
    for (const m of await stockMovements.where('preparationId', id)) {
      if (m.expenseId) await expenses.softDelete(m.expenseId, at);
      await stockMovements.softDelete(m.id, at);
    }
    await preparations.softDelete(id, at);
  });
}

export interface PurchaseInput {
  preparationId: string;
  preparationName: string;
  date: string;
  qtyMilli: number;
  batchNo: string;
  expiryDate: string | null;
  cost: number;
  supplier: string;
  note: string;
}

/** Zakup z podanym kosztem od razu trafia też do kosztów firmy. */
export async function addPurchase(input: PurchaseInput): Promise<StockMovement> {
  return writeTransaction([db.stockMovements, db.expenses], async () => {
    const movementId = newId();
    let expenseId: string | null = null;
    if (input.cost > 0) {
      const expense = await expenses.create({
        date: input.date,
        category: 'Preparaty',
        amount: input.cost,
        description: `Zakup: ${input.preparationName}${input.batchNo ? `, partia ${input.batchNo}` : ''}`,
        docNo: '',
        movementId,
      });
      expenseId = expense.id;
    }
    return stockMovements.create(
      {
        preparationId: input.preparationId,
        type: 'zakup',
        date: input.date,
        qtyMilli: input.qtyMilli,
        batchNo: input.batchNo,
        expiryDate: input.expiryDate,
        cost: input.cost,
        supplier: input.supplier,
        note: input.note,
        expenseId,
      },
      movementId,
    );
  });
}

/** Usuwa ruch magazynowy razem z kosztem, który z niego powstał. */
export async function deleteMovement(id: string): Promise<void> {
  await writeTransaction([db.stockMovements, db.expenses], async () => {
    const movement = await stockMovements.get(id);
    const at = new Date().toISOString();
    if (movement?.expenseId) await expenses.softDelete(movement.expenseId, at);
    await stockMovements.softDelete(id, at);
  });
}

/** Koszt powstały z zakupu usuwa się razem z ruchem magazynowym, żeby stan i koszty się zgadzały. */
export async function deleteExpense(id: string): Promise<void> {
  const expense = await expenses.get(id);
  if (expense?.movementId) {
    await deleteMovement(expense.movementId);
  } else {
    await expenses.softDelete(id);
  }
}

export async function deleteJob(id: string): Promise<void> {
  await writeTransaction([db.jobs, db.payments, db.attachments], async () => {
    const related = await payments.where('jobId', id);
    if (related.length > 0) throw new DomainError('Zlecenie ma zapisane wpłaty. Najpierw je usuń.');
    const at = new Date().toISOString();
    for (const a of await attachments.where('jobId', id)) await attachments.softDelete(a.id, at);
    await jobs.softDelete(id, at);
  });
}

/**
 * Przywraca rekord z kosza. Wraca też to, co usunięto razem z nim, oraz rekordy nadrzędne,
 * bo inaczej zlecenie mogłoby wskazywać na nieistniejącego klienta.
 */
export async function restoreRecord(name: RecordTableName, id: string): Promise<void> {
  const tables = [...RECORD_TABLES.map((t) => db.table(t))];
  await writeTransaction(tables, async () => {
    const restoreParent = async <T extends BaseRecord>(
      repo: { get(id: string): Promise<T | undefined>; restore(id: string): Promise<void> },
      parentId: string | null | undefined,
    ): Promise<T | undefined> => {
      if (!parentId) return undefined;
      const parent = await repo.get(parentId);
      if (parent?.deletedAt) await repo.restore(parentId);
      return parent;
    };

    const record = await db.table<BaseRecord, string>(name).get(id);
    if (!record?.deletedAt) return;
    const stamp = record.deletedAt;
    const restoreTogether = async <T extends BaseRecord>(
      rows: T[],
      repo: { restore(id: string): Promise<void> },
    ) => {
      for (const row of rows) if (row.deletedAt === stamp) await repo.restore(row.id);
    };

    switch (name) {
      case 'clients':
        await restoreTogether(await db.sites.where('clientId').equals(id).toArray(), sites);
        await clients.restore(id);
        break;
      case 'sites':
        await restoreParent(clients, (record as Site).clientId);
        await sites.restore(id);
        break;
      case 'jobs': {
        const job = record as Job;
        await restoreParent(clients, job.clientId);
        await restoreParent(sites, job.siteId);
        await restoreTogether(await db.attachments.where('jobId').equals(id).toArray(), attachments);
        await jobs.restore(id);
        break;
      }
      case 'preparations': {
        const movements = await db.stockMovements.where('preparationId').equals(id).toArray();
        for (const m of movements) {
          if (m.deletedAt === stamp && m.expenseId) await expenses.restore(m.expenseId);
        }
        await restoreTogether(movements, stockMovements);
        await preparations.restore(id);
        break;
      }
      case 'stockMovements': {
        const movement = record as StockMovement;
        await restoreParent(preparations, movement.preparationId);
        if (movement.expenseId) await expenses.restore(movement.expenseId);
        await stockMovements.restore(id);
        break;
      }
      case 'expenses': {
        const expense = record as Expense;
        if (expense.movementId) {
          const movement = await restoreParent(stockMovements, expense.movementId);
          if (movement) await restoreParent(preparations, movement.preparationId);
        }
        await expenses.restore(id);
        break;
      }
      case 'payments':
        await restoreJobChain((record as Payment).jobId);
        await payments.restore(id);
        break;
      case 'attachments':
        await restoreJobChain((record as Attachment).jobId);
        await attachments.restore(id);
        break;
      case 'services':
        await services.restore(id);
        break;
      case 'orders':
        await restoreTogether(await db.visits.where('orderId').equals(id).toArray(), visits);
        for (const visit of await db.visits.where('orderId').equals(id).toArray()) {
          await restoreTogether(await db.attachments.where('jobId').equals(visit.id).toArray(), attachments);
        }
        await orders.restore(id);
        break;
      case 'visits':
        await restoreParent(orders, (record as Visit).orderId);
        await visits.restore(id);
        break;
      case 'trips':
        await trips.restore(id);
        break;
    }

    async function restoreJobChain(jobId: string) {
      // Zdjęcie należy do zabiegu albo, w danych sprzed wersji 5, do dawnego zlecenia.
      const visit = await restoreParent(visits, jobId);
      if (visit) await restoreParent(orders, visit.orderId);
      const job = await restoreParent(jobs, jobId);
      if (job) {
        await restoreParent(clients, job.clientId);
        await restoreParent(sites, job.siteId);
      }
    }
  });
}

/** Przy synchronizacji trwałe usunięcie trafia też na serwer i na pozostałe urządzenia. */
export async function emptyTrash(): Promise<number> {
  const synced = Boolean(await getSyncState());
  const tables = RECORD_TABLES.map((t) => db.table<BaseRecord, string>(t));
  return writeTransaction(tables, async () => {
    let removed = 0;
    for (const site of await sites.all()) {
      const kept = site.stations.filter((s) => !s.deletedAt);
      if (kept.length < site.stations.length) {
        removed += site.stations.length - kept.length;
        await sites.update(site.id, { stations: kept });
      }
    }
    for (const [i, table] of tables.entries()) {
      const rows = (await table.toArray()).filter((r) => r.deletedAt);
      await table.bulkDelete(rows.map((r) => r.id));
      if (synced) {
        for (const row of rows) {
          // Ścieżka pliku pozwala usunąć zdjęcie także z magazynu na serwerze.
          const remotePath = (row as Partial<Attachment>).remotePath;
          await logChange(RECORD_TABLES[i], row.id, 'purge', remotePath ? { remotePath } : {});
        }
      }
      removed += rows.length;
    }
    return removed;
  });
}
