import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  backupFileName,
  BackupError,
  buildBackup,
  exportBackup,
  listSnapshots,
  parseBackup,
  restoreBackup,
  restoreSnapshot,
} from './backup';
import { batchBalances, followUpsDue, jobBalance, jobTotals, monthSummary, outstandingJobs, overdueJobs, stockAlerts, stockOf } from './calc';
import { db, SCHEMA_VERSION } from './db';
import {
  addPurchase,
  addStation,
  createJob,
  deleteClient,
  deleteExpense,
  deleteJob,
  deleteMovement,
  deletePreparation,
  deleteStation,
  DomainError,
  emptyTrash,
  nextStationNumber,
  planFollowUp,
  restoreRecord,
  restoreStation,
  stationReviewRows,
  updateJob,
  updateStation,
  type JobDraft,
} from './domain';
import { attachments, clients, expenses, jobs, newId, payments, preparations, sites, stockMovements } from './repo';
import { getCompany, getLastBackupAt, nextJobNumber, saveCompany } from './settings';
import type { Client, JobLine, JobStationCheck, Preparation, Site } from './types';

const clientData = (name = 'Bar Alfa'): Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> => ({
  kind: 'firma',
  name,
  contactPerson: '',
  nip: '',
  phone: '500600700',
  email: '',
  street: 'Długa 1',
  postalCode: '00-001',
  city: 'Warszawa',
  notes: '',
});

const preparationData: Omit<Preparation, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> = {
  name: 'Preparat A',
  activeSubstance: 'cypermetryna',
  permitNo: 'PL/123',
  unit: 'l',
  minStockMilli: 1000,
  targetPests: '',
  dosage: '',
  safetyPeriod: '',
};

const siteData = (clientId: string, name = 'Lokal'): Omit<Site, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> => ({
  clientId,
  name,
  objectType: '',
  street: '',
  postalCode: '',
  city: '',
  areaM2: null,
  accessNotes: '',
  stations: [],
});

const line = (qtyMilli: number, unitPriceNet: number, vatRate: number | null = 23): JobLine => ({
  id: newId(),
  name: 'Usługa',
  unit: 'szt',
  qtyMilli,
  unitPriceNet,
  vatRate,
});

const draft = (clientId: string, over: Partial<JobDraft> = {}): JobDraft => ({
  clientId,
  siteId: null,
  status: 'zaplanowane',
  start: '2026-11-10T09:00',
  durationMin: 60,
  category: 'dezynsekcja',
  title: 'Karaluchy',
  pest: 'karaczany',
  method: 'oprysk',
  scope: '',
  notes: '',
  lines: [line(1000, 10000)],
  ...over,
});

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('repozytorium', () => {
  it('nadaje znaczniki i miękko usuwa', async () => {
    const c = await clients.create(clientData());
    expect(c.id).toBeTruthy();
    expect(c.deletedAt).toBeNull();

    await clients.softDelete(c.id);
    expect(await clients.all()).toHaveLength(0);
    expect((await clients.get(c.id))?.deletedAt).toBeTruthy();

    await clients.restore(c.id);
    expect(await clients.all()).toHaveLength(1);
  });

  it('dane przetrwają ponowne otwarcie bazy', async () => {
    const c = await clients.create(clientData('Trwały'));
    db.close();
    await db.open();
    expect((await clients.get(c.id))?.name).toBe('Trwały');
  });
});

describe('zlecenia', () => {
  it('numeruje kolejno w roczniku z terminu', async () => {
    const c = await clients.create(clientData());
    const a = await createJob(draft(c.id));
    const b = await createJob(draft(c.id));
    const nextYear = await createJob(draft(c.id, { start: '2027-01-02T08:00' }));
    expect(a.number).toBe('Z/2026/0001');
    expect(b.number).toBe('Z/2026/0002');
    expect(nextYear.number).toBe('Z/2027/0001');
  });

  it('nie używa ponownie numeru po usunięciu', async () => {
    const c = await clients.create(clientData());
    const a = await createJob(draft(c.id));
    await deleteJob(a.id);
    expect((await createJob(draft(c.id))).number).toBe('Z/2026/0002');
  });

  it('liczy VAT od sumy w każdej stawce', () => {
    const totals = jobTotals([line(1000, 10000, 23), line(2000, 5000, 23), line(1000, 10000, 8), line(1000, 1000, null)]);
    expect(totals.net).toBe(31000);
    expect(totals.vat).toBe(4600 + 800);
    expect(totals.gross).toBe(36400);
    expect(totals.byRate).toHaveLength(3);
  });

  it('kolejna wizyta kopiuje zlecenie i zamyka przypomnienie', async () => {
    const c = await clients.create(clientData());
    const job = await createJob(draft(c.id));
    await jobs.update(job.id, { status: 'wykonane', followUpDate: '2027-02-10' });

    const today = '2027-01-20';
    expect(followUpsDue(await jobs.all(), today).map((j) => j.id)).toEqual([job.id]);

    const next = await planFollowUp(job.id, '2027-02-10T10:00');
    expect(next.number).toBe('Z/2027/0001');
    expect(next.status).toBe('zaplanowane');
    expect(next.lines[0].id).not.toBe(job.lines[0].id);
    expect(next.materials).toEqual([]);
    expect(followUpsDue(await jobs.all(), today)).toEqual([]);
  });

  it('wskazuje zaległe zlecenia', async () => {
    const c = await clients.create(clientData());
    await createJob(draft(c.id, { start: '2026-11-01T09:00' }));
    await createJob(draft(c.id, { start: '2026-11-05T09:00' }));
    expect(overdueJobs(await jobs.all(), '2026-11-04')).toHaveLength(1);
  });

  it('nie usuwa zlecenia z wpłatami, a bez nich usuwa razem ze zdjęciami', async () => {
    const c = await clients.create(clientData());
    const job = await createJob(draft(c.id));
    const pay = await payments.create({ jobId: job.id, date: '2026-11-10', amount: 100, method: 'gotowka', note: '' });
    await expect(deleteJob(job.id)).rejects.toBeInstanceOf(DomainError);

    await payments.softDelete(pay.id);
    const photo = await attachments.create({ jobId: job.id, name: 'a.jpg', mime: 'image/jpeg', blob: new Blob(['x']) });
    await deleteJob(job.id);
    expect((await attachments.get(photo.id))?.deletedAt).toBeTruthy();
  });
});

describe('powiązania', () => {
  it('klienta ze zleceniami nie można usunąć, a bez nich znika z obiektami', async () => {
    const c = await clients.create(clientData());
    const s = await sites.create(siteData(c.id));
    const job = await createJob(draft(c.id));
    await expect(deleteClient(c.id)).rejects.toBeInstanceOf(DomainError);

    await jobs.softDelete(job.id);
    await deleteClient(c.id);
    expect(await sites.all()).toHaveLength(0);
    expect((await sites.get(s.id))?.deletedAt).toBeTruthy();
  });
});

describe('stacje deratyzacyjne', () => {
  const station = (number: string, location = '') => ({ number, type: 'Stacja zewnętrzna', location });

  async function seedSite() {
    const c = await clients.create(clientData());
    return { c, site: await sites.create(siteData(c.id)) };
  }

  const reload = async (id: string) => (await sites.get(id))!;

  it('dodaje stacje i pilnuje niepowtarzalnego numeru w obiekcie', async () => {
    const { c, site } = await seedSite();
    const first = await addStation(site.id, station(' 1 ', ' Rampa '));
    expect(first).toMatchObject({ number: '1', location: 'Rampa', deletedAt: null });

    await expect(addStation(site.id, station('1'))).rejects.toBeInstanceOf(DomainError);
    await addStation(site.id, station('Z-1'));
    await expect(addStation(site.id, station('z-1'))).rejects.toBeInstanceOf(DomainError);
    await expect(updateStation(site.id, first.id, station('Z-1'))).rejects.toBeInstanceOf(DomainError);

    const other = await sites.create(siteData(c.id, 'Inny'));
    await expect(addStation(other.id, station('1'))).resolves.toBeTruthy();
  });

  it('usuwa miękko, a przywrócenie nie dopuszcza duplikatu numeru', async () => {
    const { site } = await seedSite();
    const old = await addStation(site.id, station('1'));
    await deleteStation(site.id, old.id);
    expect((await reload(site.id)).stations[0].deletedAt).toBeTruthy();

    const replacement = await addStation(site.id, station('1'));
    await expect(restoreStation(site.id, old.id)).rejects.toBeInstanceOf(DomainError);

    await deleteStation(site.id, replacement.id);
    await restoreStation(site.id, old.id);
    const active = (await reload(site.id)).stations.filter((s) => !s.deletedAt);
    expect(active.map((s) => s.id)).toEqual([old.id]);
  });

  it('edycja danych obiektu nie gubi stacji', async () => {
    const { site } = await seedSite();
    await addStation(site.id, station('1'));
    await sites.update(site.id, { name: 'Nowa nazwa' });
    expect((await reload(site.id)).stations).toHaveLength(1);
  });

  it('podpowiada kolejny numer', async () => {
    const { site } = await seedSite();
    expect(nextStationNumber((await reload(site.id)).stations)).toBe('1');
    await addStation(site.id, station('9'));
    await addStation(site.id, station('Z-20'));
    expect(nextStationNumber((await reload(site.id)).stations)).toBe('10');
  });

  it('nowe stacje są niesprawdzone, a zapisany przegląd zachowuje kopię danych', async () => {
    const { site } = await seedSite();
    const two = await addStation(site.id, station('2', 'Rampa'));
    const ten = await addStation(site.id, station('10'));
    const gone = await addStation(site.id, station('3', 'Stare miejsce'));
    const unused = await addStation(site.id, station('4'));
    const checks: JobStationCheck[] = [
      { stationId: two.id, number: '2', type: 'Stacja zewnętrzna', location: 'Rampa', state: 'brak', notes: 'Skradziona' },
      { stationId: gone.id, number: '3', type: 'Stacja zewnętrzna', location: 'Stare miejsce', state: 'bez-sladow', notes: '' },
    ];
    await updateStation(site.id, two.id, station('2', 'Nowe miejsce'));
    await deleteStation(site.id, gone.id);
    await deleteStation(site.id, unused.id);

    const rows = stationReviewRows(await reload(site.id), checks);
    expect(rows.map((r) => r.number)).toEqual(['2', '3', '10']);
    expect(rows[0]).toMatchObject({ location: 'Rampa', state: 'brak', notes: 'Skradziona' });
    expect(rows[1]).toMatchObject({ location: 'Stare miejsce', state: 'bez-sladow' });
    expect(rows[2]).toMatchObject({ stationId: ten.id, state: '', notes: '' });
    expect(stationReviewRows(undefined, [])).toEqual([]);
  });

  it('nowe zlecenie i kolejna wizyta nie dziedziczą przeglądu', async () => {
    const { c, site } = await seedSite();
    const job = await createJob(draft(c.id, { siteId: site.id }));
    expect(job.stationChecks).toEqual([]);
    const check: JobStationCheck = { stationId: 'x', number: '1', type: '', location: '', state: 'bez-sladow', notes: '' };
    await jobs.update(job.id, { status: 'wykonane', stationChecks: [check] });
    expect((await planFollowUp(job.id, '2027-02-10T10:00')).stationChecks).toEqual([]);
  });

  it('zmiana obiektu zlecenia usuwa przegląd, a inna edycja go zachowuje', async () => {
    const { c, site } = await seedSite();
    const other = await sites.create(siteData(c.id, 'Inny'));
    const values = draft(c.id, { siteId: site.id });
    const job = await createJob(values);
    const check: JobStationCheck = { stationId: 'x', number: '1', type: '', location: '', state: 'bez-sladow', notes: '' };
    await jobs.update(job.id, { stationChecks: [check] });

    await updateJob(job.id, { ...values, title: 'Nowy opis' });
    expect((await jobs.get(job.id))?.stationChecks).toEqual([check]);
    expect((await jobs.get(job.id))?.title).toBe('Nowy opis');

    await updateJob(job.id, { ...values, siteId: other.id });
    expect((await jobs.get(job.id))?.stationChecks).toEqual([]);
  });

  it('opróżnienie kosza usuwa na stałe także usunięte stacje', async () => {
    const { site } = await seedSite();
    const stays = await addStation(site.id, station('1'));
    const goes = await addStation(site.id, station('2'));
    await deleteStation(site.id, goes.id);
    expect(await emptyTrash()).toBe(1);
    expect((await reload(site.id)).stations.map((s) => s.id)).toEqual([stays.id]);
  });
});

describe('magazyn', () => {
  const material =(preparationId: string, batchNo: string, qtyMilli: number) => ({
    id: newId(),
    preparationId,
    name: 'Preparat A',
    permitNo: 'PL/123',
    activeSubstance: 'cypermetryna',
    batchNo,
    qtyMilli,
    unit: 'l',
  });

  const purchase = (preparationId: string, over = {}) =>
    addPurchase({
      preparationId,
      preparationName: 'Preparat A',
      date: '2026-11-01',
      qtyMilli: 5000,
      batchNo: 'B1',
      expiryDate: '2026-12-01',
      cost: 25000,
      supplier: 'Hurtownia',
      note: '',
      ...over,
    });

  it('stan to zakupy minus zużycie ze zleceń wykonanych', async () => {
    const p = await preparations.create(preparationData);
    await purchase(p.id);
    const c = await clients.create(clientData());
    const done = await createJob(draft(c.id));
    const planned = await createJob(draft(c.id));
    await jobs.update(done.id, { status: 'wykonane', materials: [material(p.id, 'B1', 1500)] });
    await jobs.update(planned.id, { materials: [material(p.id, 'B1', 9000)] });

    const [m, j] = [await stockMovements.all(), await jobs.all()];
    expect(stockOf(p.id, m, j)).toBe(3500);
    expect(batchBalances(p.id, m, j)).toEqual([{ batchNo: 'B1', expiryDate: '2026-12-01', qtyMilli: 3500 }]);
  });

  it('zakup z kosztem tworzy koszt, a usunięcie ruchu usuwa też koszt', async () => {
    const p = await preparations.create(preparationData);
    const m = await purchase(p.id);
    const [expense] = await expenses.all();
    expect(expense.amount).toBe(25000);
    expect(expense.movementId).toBe(m.id);

    await deleteMovement(m.id);
    expect(await expenses.all()).toHaveLength(0);
    expect(stockOf(p.id, await stockMovements.all(), [])).toBe(0);
  });

  it('zakup bez kosztu nie tworzy kosztu', async () => {
    const p = await preparations.create(preparationData);
    await purchase(p.id, { cost: 0 });
    expect(await expenses.all()).toHaveLength(0);
  });

  it('ostrzega o niskim stanie i terminach partii', async () => {
    const p = await preparations.create(preparationData);
    await purchase(p.id, { qtyMilli: 500, batchNo: 'B1', expiryDate: '2026-12-01' });
    const m = await stockMovements.all();
    const kinds = (today: string) => stockAlerts([p], m, [], today).map((a) => a.kind);
    expect(kinds('2026-08-01')).toEqual(['niski-stan']);
    expect(kinds('2026-11-04')).toEqual(['niski-stan', 'termin']);
    expect(kinds('2026-12-02')).toEqual(['niski-stan', 'przeterminowane']);
  });

  it('preparatu użytego w zleceniu nie można usunąć', async () => {
    const p = await preparations.create(preparationData);
    const c = await clients.create(clientData());
    const job = await createJob(draft(c.id));
    await jobs.update(job.id, { materials: [material(p.id, 'B1', 100)] });
    await expect(deletePreparation(p.id)).rejects.toBeInstanceOf(DomainError);
  });
});

describe('kosz', () => {
  it('przywrócenie klienta przywraca obiekty usunięte razem z nim, ale nie wcześniejsze', async () => {
    const c = await clients.create(clientData());
    const site = (name: string) => sites.create(siteData(c.id, name));
    const earlier = await site('Usunięty wcześniej');
    const together = await site('Usunięty z klientem');
    await sites.softDelete(earlier.id, '2020-01-01T00:00:00.000Z');

    await deleteClient(c.id);
    await restoreRecord('clients', c.id);

    expect((await clients.all()).map((x) => x.id)).toEqual([c.id]);
    expect((await sites.all()).map((x) => x.id)).toEqual([together.id]);
  });

  it('przywrócenie wpłaty przywraca zlecenie i klienta', async () => {
    const c = await clients.create(clientData());
    const job = await createJob(draft(c.id));
    const pay = await payments.create({ jobId: job.id, date: '2026-11-10', amount: 100, method: 'karta', note: '' });
    await payments.softDelete(pay.id);
    await deleteJob(job.id);
    await deleteClient(c.id);

    await restoreRecord('payments', pay.id);
    expect(await clients.all()).toHaveLength(1);
    expect(await jobs.all()).toHaveLength(1);
    expect(await payments.all()).toHaveLength(1);
  });

  it('usunięcie kosztu z zakupu cofa też zakup, a przywrócenie przywraca oba', async () => {
    const p = await preparations.create(preparationData);
    await addPurchase({
      preparationId: p.id,
      preparationName: p.name,
      date: '2026-11-01',
      qtyMilli: 1000,
      batchNo: 'B',
      expiryDate: null,
      cost: 500,
      supplier: '',
      note: '',
    });
    const [expense] = await expenses.all();
    await deleteExpense(expense.id);
    expect(await stockMovements.all()).toHaveLength(0);

    await restoreRecord('expenses', expense.id);
    expect(await expenses.all()).toHaveLength(1);
    expect(await stockMovements.all()).toHaveLength(1);
  });

  it('opróżnienie kosza usuwa tylko rekordy z kosza', async () => {
    const stays = await clients.create(clientData('Zostaje'));
    const goes = await clients.create(clientData('Do kosza'));
    await clients.softDelete(goes.id);
    expect(await emptyTrash()).toBe(1);
    expect(await db.clients.count()).toBe(1);
    expect(await clients.get(stays.id)).toBeTruthy();
  });
});

describe('finanse', () => {
  it('należność to brutto minus wpłaty, tylko dla wykonanych', async () => {
    const c = await clients.create(clientData());
    const done = await createJob(draft(c.id));
    await createJob(draft(c.id));
    await jobs.update(done.id, { status: 'wykonane' });
    await payments.create({ jobId: done.id, date: '2026-11-10', amount: 2300, method: 'blik', note: '' });

    const [j, p] = [await jobs.all(), await payments.all()];
    expect(jobBalance(j.find((x) => x.id === done.id)!, p)).toBe(10000);
    expect(outstandingJobs(j, p).map((o) => o.balance)).toEqual([10000]);
  });

  it('podsumowuje miesiąc po datach wpłat i kosztów', async () => {
    const pay = (date: string, amount: number) =>
      payments.create({ jobId: 'x', date, amount, method: 'przelew', note: '' });
    await pay('2026-11-01', 10000);
    await pay('2026-11-30', 5000);
    await pay('2026-12-01', 99900);
    await expenses.create({ date: '2026-11-15', category: 'Paliwo', amount: 4000, description: '', docNo: '', movementId: null });
    const s = monthSummary('2026-11', await payments.all(), await expenses.all());
    expect(s).toEqual({ income: 15000, costs: 4000, result: 11000 });
  });
});

describe('kopie zapasowe', () => {
  async function seed() {
    const c = await clients.create(clientData());
    const job = await createJob(draft(c.id));
    await attachments.create({
      jobId: job.id,
      name: 'zdjecie.jpg',
      mime: 'image/jpeg',
      blob: new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' }),
    });
    await saveCompany({ ...(await getCompany()), name: 'Moja firma' });
    return { c, job };
  }

  const textOf = async (includePhotos = true) => JSON.stringify(await buildBackup({ includePhotos }));

  it('przywraca wszystko po utracie bazy, także bajty zdjęć', async () => {
    const { c, job } = await seed();
    const { backup, summary } = await parseBackup(await textOf());
    expect(summary.counts.clients).toBe(1);
    expect(summary.counts.attachments).toBe(1);

    await db.delete();
    await db.open();
    await restoreBackup(backup, 'replace');

    expect((await clients.get(c.id))?.name).toBe('Bar Alfa');
    expect((await jobs.get(job.id))?.number).toBe('Z/2026/0001');
    expect((await getCompany()).name).toBe('Moja firma');
    const [photo] = await attachments.all();
    expect(Array.from(new Uint8Array(await photo.blob!.arrayBuffer()))).toEqual([1, 2, 3, 250]);
  });

  it('scalanie zostawia nowsze rekordy i dodaje brakujące', async () => {
    const { c } = await seed();
    const { backup } = await parseBackup(await textOf());
    await new Promise((r) => setTimeout(r, 5));
    await clients.update(c.id, { name: 'Nowsza nazwa' });
    const added = await clients.create(clientData('Dodany po kopii'));

    await restoreBackup(backup, 'merge');
    expect((await clients.get(c.id))?.name).toBe('Nowsza nazwa');
    expect(await clients.get(added.id)).toBeTruthy();
  });

  it('scalanie przywraca rekord brakujący w bazie', async () => {
    const { c } = await seed();
    const { backup } = await parseBackup(await textOf());
    await db.clients.delete(c.id);
    await restoreBackup(backup, 'merge');
    expect((await clients.get(c.id))?.name).toBe('Bar Alfa');
  });

  it('zastąpienie usuwa rekordy spoza kopii', async () => {
    await seed();
    const { backup } = await parseBackup(await textOf());
    const added = await clients.create(clientData('Spoza kopii'));
    await restoreBackup(backup, 'replace');
    expect(await clients.get(added.id)).toBeUndefined();
  });

  it('kopia bez zdjęć nie kasuje zdjęć z urządzenia', async () => {
    await seed();
    const { backup } = await parseBackup(await textOf(false));
    expect(backup.tables.attachments).toEqual([]);
    await restoreBackup(backup, 'replace');
    expect(await attachments.all()).toHaveLength(1);
  });

  it('licznik numerów nie cofa się po przywróceniu starszej kopii', async () => {
    const { c } = await seed();
    const { backup } = await parseBackup(await textOf());
    await new Promise((r) => setTimeout(r, 5));
    await createJob(draft(c.id));
    await restoreBackup(backup, 'replace');
    expect(await nextJobNumber('2026')).toBe('Z/2026/0003');
  });

  it('migawka sprzed przywrócenia pozwala cofnąć operację', async () => {
    const { c } = await seed();
    const { backup } = await parseBackup(await textOf());
    await clients.update(c.id, { name: 'Przed zastąpieniem' });
    await restoreBackup(backup, 'replace');
    expect((await clients.get(c.id))?.name).toBe('Bar Alfa');

    const [snapshot] = await listSnapshots();
    await restoreSnapshot(snapshot.id);
    expect((await clients.get(c.id))?.name).toBe('Przed zastąpieniem');
  });

  it('trzyma najwyżej trzy migawki', async () => {
    await seed();
    const { backup } = await parseBackup(await textOf());
    for (let i = 0; i < 5; i++) {
      await restoreBackup(backup, 'merge');
      await new Promise((r) => setTimeout(r, 2));
    }
    expect(await listSnapshots()).toHaveLength(3);
  });

  it('eksport zapisuje datę ostatniej kopii', async () => {
    await seed();
    expect(await getLastBackupAt()).toBeNull();
    const { blob, filename } = await exportBackup({ includePhotos: false });
    expect(await getLastBackupAt()).toBeTruthy();
    expect(blob.size).toBeGreaterThan(0);
    expect(filename).toMatch(/^ddd-firma-kopia-\d{8}-\d{4}\.json$/);
    expect(backupFileName('2026-11-04T09:30:00.000Z')).toBe('ddd-firma-kopia-20261104-1030.json');
  });

  it('przenosi stacje i przegląd w kopii bieżącej wersji', async () => {
    const { c, job } = await seed();
    const site = await sites.create(siteData(c.id));
    const station = await addStation(site.id, { number: '1', type: 'Stacja zewnętrzna', location: 'Rampa' });
    const check: JobStationCheck = { stationId: station.id, number: '1', type: station.type, location: station.location, state: 'uszkodzona', notes: 'Pęknięta' };
    await jobs.update(job.id, { siteId: site.id, stationChecks: [check] });

    const { backup } = await parseBackup(await textOf());
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    await db.delete();
    await db.open();
    await restoreBackup(backup, 'replace');

    expect((await sites.get(site.id))?.stations).toEqual([station]);
    expect((await jobs.get(job.id))?.stationChecks).toEqual([check]);
  });

  describe('kopie w wersji 1', () => {
    const stamp = '2026-10-01T08:00:00.000Z';
    const v1Tables = (stampedAt = stamp) => ({
      clients: [{ ...clientData('Klient z kopii'), id: 'c1', createdAt: stampedAt, updatedAt: stampedAt, deletedAt: null }],
      // Rekordy jak z aplikacji pierwszego etapu: bez stations i bez stationChecks.
      sites: [
        {
          id: 's1',
          clientId: 'c1',
          name: 'Stary obiekt',
          objectType: '',
          street: '',
          postalCode: '',
          city: '',
          areaM2: null,
          accessNotes: '',
          createdAt: stampedAt,
          updatedAt: stampedAt,
          deletedAt: null,
        },
      ],
      services: [],
      jobs: [
        {
          ...draft('c1', { siteId: 's1' }),
          id: 'j1',
          number: 'Z/2026/0001',
          materials: [],
          completedOn: null,
          recommendations: '',
          safetyPeriod: '',
          warrantyUntil: null,
          followUpDate: null,
          followUpDone: false,
          invoiceNo: '',
          signerName: '',
          signatureDataUrl: null,
          createdAt: stampedAt,
          updatedAt: stampedAt,
          deletedAt: null,
        },
      ],
      preparations: [],
      stockMovements: [],
      payments: [],
      expenses: [],
      attachments: [],
      meta: [{ key: 'counter:job:2026', value: 1, updatedAt: stampedAt }],
    });

    const sha = async (text: string) => {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
    };

    const v1File = async (tables: unknown = v1Tables()) =>
      JSON.stringify({
        format: 'ddd-firma-backup',
        schemaVersion: 1,
        exportedAt: stamp,
        includesPhotos: true,
        checksum: await sha(JSON.stringify(tables)),
        tables,
      });

    it('przywraca się i dostaje puste listy stacji oraz przeglądów', async () => {
      const { backup, summary } = await parseBackup(await v1File());
      expect(summary.counts).toMatchObject({ clients: 1, jobs: 1 });

      await restoreBackup(backup, 'replace');

      expect((await sites.get('s1'))?.stations).toEqual([]);
      const job = (await jobs.get('j1'))!;
      expect(job.stationChecks).toEqual([]);
      expect(job.number).toBe('Z/2026/0001');
      expect(await nextJobNumber('2026')).toBe('Z/2026/0002');
    });

    it('przywrócony obiekt przyjmuje nowe stacje', async () => {
      const { backup } = await parseBackup(await v1File());
      await restoreBackup(backup, 'replace');
      await addStation('s1', { number: '1', type: '', location: '' });
      expect((await sites.get('s1'))?.stations).toHaveLength(1);
    });

    it('sprawdza sumę kontrolną pliku takiego, jak zapisano', async () => {
      const parsed = JSON.parse(await v1File());
      parsed.tables.clients[0].name = 'Podmienione';
      await expect(parseBackup(JSON.stringify(parsed))).rejects.toThrow(/suma kontrolna/);
    });

    it('odrzuca niepoprawne rekordy', async () => {
      const tables = v1Tables() as unknown as { jobs: Array<{ lines: unknown }> };
      tables.jobs[0].lines = 'zepsute';
      await expect(parseBackup(await v1File(tables))).rejects.toThrow(/niepoprawne dane \(jobs/);
      await expect(parseBackup(await v1File({ sites: 'zepsute' }))).rejects.toBeInstanceOf(BackupError);
    });

    it('scalanie nowszej kopii nie kasuje stacji ani przeglądu z urządzenia', async () => {
      const first = await parseBackup(await v1File());
      await restoreBackup(first.backup, 'replace');
      const station = await addStation('s1', { number: '1', type: '', location: 'Rampa' });
      const check: JobStationCheck = { stationId: station.id, number: '1', type: '', location: 'Rampa', state: 'brak', notes: '' };
      await jobs.update('j1', { stationChecks: [check] });

      const later = new Date(Date.now() + 60_000).toISOString();
      const tables = v1Tables(later);
      tables.sites[0].name = 'Nazwa z nowszej kopii';
      const { backup } = await parseBackup(await v1File(tables));
      await restoreBackup(backup, 'merge');

      const site = (await sites.get('s1'))!;
      expect(site.name).toBe('Nazwa z nowszej kopii');
      expect(site.stations).toEqual([station]);
      expect((await jobs.get('j1'))?.stationChecks).toEqual([check]);
    });

    it('migawka zapisana przed aktualizacją aplikacji dalej działa', async () => {
      await db.snapshots.add({ id: 'stara', createdAt: stamp, reason: 'Przed aktualizacją', data: await v1File() });
      await restoreSnapshot('stara');
      expect((await sites.get('s1'))?.stations).toEqual([]);
      expect((await jobs.get('j1'))?.stationChecks).toEqual([]);
    });
  });

  describe('odrzuca złe pliki bez zmiany danych', () => {
    const rejects = async (text: string, message: RegExp) => {
      const error = await parseBackup(text).catch((e) => e);
      expect(error).toBeInstanceOf(BackupError);
      expect(error.message).toMatch(message);
    };

    it('nie-JSON', () => rejects('to nie json', /JSON/));
    it('obcy plik', () => rejects('{"a":1}', /nie jest plik/));

    it('nowsza wersja schematu', async () => {
      await seed();
      const parsed = JSON.parse(await textOf());
      parsed.schemaVersion = 999;
      await rejects(JSON.stringify(parsed), /nowszej wersji/);
    });

    it('uszkodzona treść', async () => {
      await seed();
      const parsed = JSON.parse(await textOf());
      parsed.tables.clients[0].name = 'Podmienione';
      await rejects(JSON.stringify(parsed), /suma kontrolna/);
    });

    it('niepoprawne rekordy', async () => {
      await seed();
      const parsed = JSON.parse(await textOf());
      parsed.checksum = null;
      parsed.tables.jobs[0].lines = 'zepsute';
      await rejects(JSON.stringify(parsed), /niepoprawne dane \(jobs/);
    });

    it('nieznany stan stacji i brak list w kopii bieżącej wersji', async () => {
      const { c, job } = await seed();
      await sites.create(siteData(c.id));
      const check: JobStationCheck = { stationId: 'x', number: '1', type: '', location: '', state: 'brak', notes: '' };
      await jobs.update(job.id, { stationChecks: [check] });
      const parsed = JSON.parse(await textOf());
      parsed.checksum = null;

      const badState = structuredClone(parsed);
      badState.tables.jobs[0].stationChecks[0].state = 'nieznany';
      await rejects(JSON.stringify(badState), /niepoprawne dane \(jobs/);

      const noStations = structuredClone(parsed);
      delete noStations.tables.sites[0].stations;
      await rejects(JSON.stringify(noStations), /niepoprawne dane \(sites/);
    });
  });
});

describe('migracja bazy', () => {
  // Zamrożony schemat wersji 1, taki jak na urządzeniach sprzed aktualizacji.
  const V1_STORES = {
    clients: 'id, name, updatedAt',
    sites: 'id, clientId, updatedAt',
    services: 'id, updatedAt',
    jobs: 'id, clientId, siteId, status, start, updatedAt',
    preparations: 'id, updatedAt',
    stockMovements: 'id, preparationId, date, updatedAt',
    payments: 'id, jobId, date, updatedAt',
    expenses: 'id, date, movementId, updatedAt',
    attachments: 'id, jobId, updatedAt',
    meta: 'key',
    snapshots: 'id, createdAt',
  };
  const stamps = { createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z', deletedAt: null };

  it('wersja bazy zgadza się z SCHEMA_VERSION', () => {
    expect(db.verno).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(6);
  });

  it('dane z bazy w wersji 1 przechodzą na najnowszą wersję bez zmiany znaczników', async () => {
    db.close();
    await Dexie.delete('ddd-firma');
    const old = new Dexie('ddd-firma');
    old.version(1).stores(V1_STORES);
    await old.open();
    await old.table('clients').add({ ...clientData('Sprzed migracji'), ...stamps, id: 'c1' });
    await old.table('sites').add({ id: 's1', clientId: 'c1', name: 'Stary obiekt', ...stamps });
    await old.table('jobs').add({ id: 'j1', clientId: 'c1', siteId: 's1', status: 'wykonane', number: 'Z/2026/0001', lines: [], materials: [], ...stamps });
    old.close();

    await db.open();

    expect(db.verno).toBe(SCHEMA_VERSION);
    // Migracja nie jest edycją, więc nie trafia do dziennika zmian.
    expect(await db.changes.count()).toBe(0);
    expect((await clients.get('c1'))?.name).toBe('Sprzed migracji');
    const site = (await sites.get('s1'))!;
    expect(site.stations).toEqual([]);
    expect(site.updatedAt).toBe(stamps.updatedAt);
    const job = (await jobs.get('j1'))!;
    expect(job.stationChecks).toEqual([]);
    expect(job.number).toBe('Z/2026/0001');
    expect(job.updatedAt).toBe(stamps.updatedAt);
  });
});
