import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemoryServer } from '../test/memory-server';
import { buildBackup, BackupError, parseBackup, restoreBackup } from './backup';
import { stockOf } from './calc';
import { pendingCount } from './changes';
import { db } from './db';
import { addPurchase, createJob, deleteClient, emptyTrash, restoreRecord } from './domain';
import { attachments, clients, jobs, newId, orders, preparations, stockMovements } from './repo';
import { createOrder, type OrderDraft } from './orders';
import { getCompany, getDataKey, getSyncState, saveCompany, setDataKey, setOrderCounter } from './settings';
import { createDataKey, decryptFields } from './sync/crypto';
import { applyRemote, decryptRows, disableSync, enableSync, ensurePhoto, SyncError, syncNow, type Account } from './sync/engine';
import type { Client } from './types';

// Jedna baza Dexie udaje kilka urządzeń: przy przełączeniu zawartość wszystkich tabel jest
// odkładana na bok i zastępowana zawartością drugiego urządzenia.
const devices = new Map<string, Record<string, unknown[]>>();
let current: string | null = null;
// Klucz danych firmy. Każde nowe urządzenie dostaje go tak, jakby użytkownik wpisał hasło szyfrowania.
let companyKey: CryptoKey;

beforeAll(async () => {
  companyKey = (await createDataKey('hasło szyfrowania testowe')).key;
});

async function useDevice(name: string) {
  if (current) {
    const dump: Record<string, unknown[]> = {};
    for (const table of db.tables) dump[table.name] = await table.toArray();
    devices.set(current, dump);
  }
  const data = devices.get(name);
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
      if (data?.[table.name]?.length) await table.bulkAdd(data[table.name]);
    }
  });
  current = name;
  if (!data) await setDataKey(companyKey);
}

const account: Account = { orgId: 'org-1', orgName: 'Moja firma', userId: 'user-1', email: 'a@example.com' };

const clientData = (name: string): Omit<Client, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> => ({
  kind: 'firma',
  name,
  contactPerson: '',
  nip: '',
  phone: '',
  email: '',
  street: '',
  postalCode: '',
  city: '',
  notes: '',
});

const jobDraft = (clientId: string) => ({
  clientId,
  siteId: null,
  status: 'zaplanowane' as const,
  start: `${new Date().getFullYear()}-11-10T09:00`,
  durationMin: 60,
  category: 'dezynsekcja' as const,
  title: 'Karaluchy',
  pest: '',
  method: '',
  scope: '',
  notes: '',
  lines: [],
});

let server: MemoryServer;

beforeEach(async () => {
  devices.clear();
  current = null;
  server = new MemoryServer();
  await db.delete();
  await db.open();
});

/** Telefon z danymi włącza synchronizację, a drugie, puste urządzenie dołącza do firmy. */
async function twoDevices() {
  await useDevice('telefon');
  const client = await clients.create(clientData('Bar Alfa'));
  await saveCompany({ ...(await getCompany()), name: 'Żółta Pszczółka' });
  await enableSync(server, account);
  await useDevice('komputer');
  await enableSync(server, account);
  return { client };
}

describe('dziennik zmian', () => {
  it('każdy zapis przez repozytorium i operacje domenowe trafia do kolejki', async () => {
    const c = await clients.create(clientData('A'));
    await clients.update(c.id, { phone: '500' });
    await createJob(jobDraft(c.id));
    const kinds = (await db.changes.toArray()).map((ch) => `${ch.tbl}:${ch.op}`);
    expect(kinds).toEqual(['clients:create', 'clients:update', 'jobs:create']);
    expect((await db.changes.toArray())[1].patch).toEqual({ phone: '500', updatedAt: expect.any(String) });
  });

  it('plik zdjęcia nie trafia do dziennika', async () => {
    await attachments.create({ jobId: 'j', name: 'a.jpg', mime: 'image/jpeg', blob: new Blob(['x']) });
    const [change] = await db.changes.toArray();
    expect(change.patch).not.toHaveProperty('blob');
  });
});

describe('synchronizacja dwóch urządzeń', () => {
  it('drugie urządzenie dostaje wszystkie dane i dane firmy', async () => {
    const { client } = await twoDevices();
    expect((await clients.get(client.id))?.name).toBe('Bar Alfa');
    expect((await getCompany()).name).toBe('Żółta Pszczółka');
    expect(await pendingCount()).toBe(0);
  });

  it('zmiany różnych pól tego samego rekordu z obu urządzeń się łączą', async () => {
    const { client } = await twoDevices();
    await clients.update(client.id, { phone: '600700800' });
    await useDevice('telefon');
    await clients.update(client.id, { city: 'Łódź' });
    await syncNow(server);
    await useDevice('komputer');
    await syncNow(server);
    await useDevice('telefon');
    await syncNow(server);

    for (const device of ['telefon', 'komputer']) {
      await useDevice(device);
      const c = await clients.get(client.id);
      expect([c?.phone, c?.city]).toEqual(['600700800', 'Łódź']);
    }
  });

  it('zapis całego formularza wysyła tylko zmienione pola, więc nie nadpisuje zmian z innego urządzenia', async () => {
    const { client } = await twoDevices();
    // Formularz klienta zapisuje wszystkie pola naraz, także te niezmienione.
    const fullForm = async (patch: Partial<Client>) => {
      const { id, createdAt, updatedAt, deletedAt, ...rest } = (await clients.get(client.id))!;
      void id, createdAt, updatedAt, deletedAt;
      await clients.update(client.id, { ...rest, ...patch });
    };
    await fullForm({ city: 'Kraków' });
    await useDevice('telefon');
    await fullForm({ phone: '600700800' });
    await syncNow(server);
    await useDevice('komputer');
    await syncNow(server);
    await useDevice('telefon');
    await syncNow(server);

    for (const device of ['telefon', 'komputer']) {
      await useDevice(device);
      const c = await clients.get(client.id);
      expect([c?.city, c?.phone]).toEqual(['Kraków', '600700800']);
    }
  });

  it('zapis bez żadnej zmiany niczego nie wysyła', async () => {
    const { client } = await twoDevices();
    const before = await db.changes.count();
    await clients.update(client.id, { name: 'Bar Alfa' });
    expect(await db.changes.count()).toBe(before);
  });

  it('przy zmianie tego samego pola wygrywa zmiana przyjęta później, a obie zostają w historii', async () => {
    const { client } = await twoDevices();
    await clients.update(client.id, { name: 'Wersja komputera' });
    await useDevice('telefon');
    await clients.update(client.id, { name: 'Wersja telefonu' });
    await useDevice('komputer');
    await syncNow(server);
    await useDevice('telefon');
    await syncNow(server);
    await useDevice('komputer');
    await syncNow(server);

    expect((await clients.get(client.id))?.name).toBe('Wersja telefonu');
    const names: unknown[] = [];
    for (const h of server.history.filter((h) => h.recordId === client.id && 'name' in h.patch)) {
      names.push((await decryptFields(companyKey, 'clients', client.id, { name: h.patch.name })).name);
    }
    expect(names).toContain('Wersja komputera');
  });

  it('zmiana zrobiona w trakcie pobierania nie znika', async () => {
    const { client } = await twoDevices();
    await useDevice('telefon');
    await clients.update(client.id, { notes: 'od telefonu' });
    await syncNow(server);
    await useDevice('komputer');
    await clients.update(client.id, { phone: '111' });
    // Pobranie bez wcześniejszej wysyłki: lokalna zmiana czeka w kolejce.
    await applyRemote((await decryptRows(companyKey, await server.pull(account.orgId, 0, 500))).readable);
    const c = await clients.get(client.id);
    expect([c?.notes, c?.phone]).toEqual(['od telefonu', '111']);
  });

  it('usunięcie i przywrócenie z kosza przechodzi między urządzeniami', async () => {
    const { client } = await twoDevices();
    await deleteClient(client.id);
    await syncNow(server);
    await useDevice('telefon');
    await syncNow(server);
    expect(await clients.all()).toHaveLength(0);

    await restoreRecord('clients', client.id);
    await syncNow(server);
    await useDevice('komputer');
    await syncNow(server);
    expect(await clients.all()).toHaveLength(1);
  });

  it('opróżnienie kosza usuwa rekord trwale na wszystkich urządzeniach', async () => {
    const { client } = await twoDevices();
    await clients.softDelete(client.id);
    await emptyTrash();
    await syncNow(server);
    await useDevice('telefon');
    await syncNow(server);
    expect(await db.clients.get(client.id)).toBeUndefined();
    // Spóźniona zmiana z innego urządzenia nie wskrzesza trwale usuniętego rekordu.
    expect(server.recordOf(account.orgId, 'clients', client.id)?.purged).toBe(true);
    // Historia na serwerze nie przechowuje już danych trwale usuniętego klienta.
    const history = server.history.filter((h) => h.recordId === client.id);
    expect(history.length).toBeGreaterThan(0);
    expect(history.every((h) => Object.keys(h.patch).length === 0)).toBe(true);
  });

  it('stan magazynu jest zgodny, gdy zakup i zużycie są na różnych urządzeniach', async () => {
    const { client } = await twoDevices();
    const prep = await preparations.create({
      name: 'Żel',
      activeSubstance: '',
      permitNo: '',
      unit: 'kg',
      minStockMilli: 0,
      targetPests: '',
      dosage: '',
      safetyPeriod: '',
    });
    await addPurchase({
      preparationId: prep.id,
      preparationName: 'Żel',
      date: '2026-11-01',
      qtyMilli: 2000,
      batchNo: 'B',
      expiryDate: null,
      cost: 0,
      supplier: '',
      note: '',
    });
    await syncNow(server);
    await useDevice('telefon');
    await syncNow(server);
    const job = await createJob(jobDraft(client.id));
    await jobs.update(job.id, {
      status: 'wykonane',
      materials: [{ id: newId(), preparationId: prep.id, name: 'Żel', permitNo: '', activeSubstance: '', batchNo: 'B', qtyMilli: 500, unit: 'kg' }],
    });
    await syncNow(server);
    await useDevice('komputer');
    await syncNow(server);
    expect(stockOf(prep.id, await stockMovements.all(), await jobs.all())).toBe(1500);
  });
});

describe('odporność', () => {
  it('ponowna wysyłka po zerwanym połączeniu nie dubluje zmian', async () => {
    await useDevice('telefon');
    await enableSync(server, account);
    const c = await clients.create(clientData('A'));
    await clients.update(c.id, { phone: '1' });
    server.failAfterNextPush = true;
    await expect(syncNow(server)).rejects.toThrow();
    expect(await pendingCount()).toBe(2);

    await syncNow(server);
    expect(await pendingCount()).toBe(0);
    expect(server.history.filter((h) => h.recordId === c.id)).toHaveLength(2);
  });

  it('bez internetu zmiany czekają w kolejce i wychodzą po powrocie sieci', async () => {
    await useDevice('telefon');
    await enableSync(server, account);
    server.offline = true;
    await clients.create(clientData('Offline'));
    await expect(syncNow(server)).rejects.toThrow();
    server.offline = false;
    await syncNow(server);
    await useDevice('komputer');
    await enableSync(server, account);
    expect((await clients.all()).map((c) => c.name)).toEqual(['Offline']);
  });

  it('stara wersja aplikacji nie wysyła danych, gdy serwer wymaga nowszej', async () => {
    await useDevice('telefon');
    await clients.create(clientData('A'));
    server.minSchema = 999;
    await expect(enableSync(server, account)).rejects.toThrow('UPDATE_REQUIRED');
    expect(await pendingCount()).toBe(1);
    expect(server.records.size).toBe(0);
  });

  it('rekordy nieznanych tabel z nowszej wersji są pomijane', async () => {
    await applyRemote([{ tbl: 'przyszlaTabela', id: 'x', data: { a: 1 }, rev: 1, purged: false }]);
    expect(await db.clients.count()).toBe(0);
  });
});

describe('numery zleceń', () => {
  const draft = (): OrderDraft => ({
    building: 'dom',
    street: 'Polna',
    houseNo: '1',
    flatNo: '',
    floor: '',
    staircase: '',
    postalCode: '',
    city: 'Gdynia',
    access: '',
    pest: 'karaluchy',
    pestOther: '',
    description: '',
    areaM2: null,
    priceMin: null,
    priceMax: null,
    invoice: 'brak',
    clientName: 'Klient',
    email: '',
    nip: '',
    invoiceAddress: '',
    phones: [{ number: '600700800', label: '' }],
    pink: false,
    pinkNote: '',
  });
  const plan = { start: null, durationMin: 60 };

  it('dwa urządzenia nie nadają tego samego numeru, a numery sprzed synchronizacji się nie powtarzają', async () => {
    await useDevice('telefon');
    await setOrderCounter(209);
    await createOrder(draft(), plan, null);
    await enableSync(server, account);
    await useDevice('komputer');
    await enableSync(server, account);

    const numbers = new Set((await orders.all()).map((o) => o.number));
    for (let i = 0; i < 3; i++) numbers.add((await createOrder(draft(), plan, null)).order.number);
    await syncNow(server);
    await useDevice('telefon');
    for (let i = 0; i < 3; i++) numbers.add((await createOrder(draft(), plan, null)).order.number);
    expect(numbers.size).toBe(7);
    // Numeracja ciągnie się dalej od #210 nadanego przed włączeniem synchronizacji.
    expect(Math.min(...numbers)).toBe(210);
    expect([...numbers].every((n) => n >= 210)).toBe(true);
  });

  it('po wyczerpaniu puli bez internetu numeracja ciągnie się dalej od ostatniego numeru', async () => {
    await useDevice('telefon');
    await enableSync(server, account);
    server.offline = true;
    const numbers: number[] = [];
    for (let i = 0; i < 21; i++) numbers.push((await createOrder(draft(), plan, null)).order.number);
    expect(numbers.slice(0, 3)).toEqual([1, 2, 3]);
    expect(numbers[20]).toBe(21);
    expect(new Set(numbers).size).toBe(21);
  });
});

describe('zdjęcia', () => {
  it('plik trafia na serwer, a drugie urządzenie pobiera go przy wyświetleniu', async () => {
    await twoDevices();
    await useDevice('telefon');
    const photo = await attachments.create({
      jobId: 'j',
      name: 'a.jpg',
      mime: 'image/jpeg',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    });
    await syncNow(server);
    expect((await attachments.get(photo.id))?.remotePath).toBe(`org-1/${photo.id}`);

    await useDevice('komputer');
    await syncNow(server);
    const remote = (await attachments.get(photo.id))!;
    expect(remote.blob).toBeNull();
    const blob = await ensurePhoto(server, remote);
    expect(Array.from(new Uint8Array(await blob!.arrayBuffer()))).toEqual([1, 2, 3]);
    expect((await attachments.get(photo.id))?.blob).toBeTruthy();
  });
});

describe('szyfrowanie end-to-end', () => {
  it('serwer przechowuje rekordy, historię i zdjęcia wyłącznie zaszyfrowane', async () => {
    await useDevice('telefon');
    const c = await clients.create({ ...clientData('Tajny Klient Żółw'), phone: '600700800', city: 'Łódź' });
    await saveCompany({ ...(await getCompany()), name: 'Tajna Firma', nip: '5260001246' });
    const photo = await attachments.create({
      jobId: 'j',
      name: 'zdjecie-klienta.jpg',
      mime: 'image/jpeg',
      blob: new Blob(['JAWNE-BAJTY-ZDJECIA'], { type: 'image/jpeg' }),
    });
    await enableSync(server, account);

    const everything = JSON.stringify([...server.records.values()]) + JSON.stringify(server.history);
    for (const secret of ['Tajny Klient', '600700800', 'Łódź', 'Tajna Firma', '5260001246', 'zdjecie-klienta']) {
      expect(everything).not.toContain(secret);
    }
    const file = server.files.get(`org-1/${photo.id}`)!;
    expect(await file.text()).not.toContain('JAWNE-BAJTY-ZDJECIA');
    expect(server.recordOf(account.orgId, 'clients', c.id)).toBeTruthy();
  });

  it('urządzenie bez klucza nie synchronizuje i nie wysyła jawnych danych', async () => {
    await useDevice('telefon');
    await setDataKey(null);
    await clients.create(clientData('A'));
    await expect(enableSync(server, account)).rejects.toBeInstanceOf(SyncError);
    expect(server.records.size).toBe(0);
  });

  it('urządzenie z innym kluczem nie odczyta danych i dostaje komunikat', async () => {
    await twoDevices();
    await useDevice('obce');
    await setDataKey((await createDataKey('zupełnie inne hasło 123')).key);
    await expect(enableSync(server, account)).rejects.toThrow('Nie udało się odszyfrować');
    expect(await clients.all()).toHaveLength(0);
  });

  it('klucz zostaje na urządzeniu, ale nie trafia do kopii zapasowej', async () => {
    await useDevice('telefon');
    expect(await getDataKey()).toBeTruthy();
    const backup = await buildBackup({ includePhotos: false });
    expect(backup.tables.meta.map((m) => m.key)).not.toContain('dataKey');
  });
});

describe('trwałe usunięcie zdjęć', () => {
  it('opróżnienie kosza usuwa plik zdjęcia z serwera', async () => {
    await useDevice('telefon');
    await enableSync(server, account);
    const photo = await attachments.create({ jobId: 'j', name: 'a.jpg', mime: 'image/jpeg', blob: new Blob(['x']) });
    await syncNow(server);
    expect(server.files.has(`org-1/${photo.id}`)).toBe(true);

    await attachments.softDelete(photo.id);
    await syncNow(server);
    // W koszu plik jeszcze zostaje, żeby dało się zdjęcie przywrócić.
    expect(server.files.has(`org-1/${photo.id}`)).toBe(true);

    await emptyTrash();
    await syncNow(server);
    expect(server.files.has(`org-1/${photo.id}`)).toBe(false);
    expect(server.recordOf(account.orgId, 'attachments', photo.id)?.purged).toBe(true);
  });
});

describe('kopie zapasowe przy synchronizacji', () => {
  it('zastąpienie danych jest zablokowane, a scalenie wysyła zaimportowane rekordy', async () => {
    await useDevice('telefon');
    const c = await clients.create(clientData('Z kopii'));
    const { backup } = await parseBackup(JSON.stringify(await buildBackup({ includePhotos: false })));
    await db.clients.delete(c.id);
    await enableSync(server, account);

    await expect(restoreBackup(backup, 'replace')).rejects.toBeInstanceOf(BackupError);
    await restoreBackup(backup, 'merge');
    await syncNow(server);
    const stored = server.recordOf(account.orgId, 'clients', c.id)!;
    expect((await decryptFields(companyKey, 'clients', c.id, stored.data)).name).toBe('Z kopii');
  });

  it('kopia nie przenosi stanu synchronizacji na inne urządzenie', async () => {
    await useDevice('telefon');
    await enableSync(server, account);
    const backup = await buildBackup({ includePhotos: false });
    expect(backup.tables.meta.map((m) => m.key)).not.toContain('sync');
  });
});

describe('wylogowanie', () => {
  it('bez usuwania zostawia dane, a z usuwaniem czyści urządzenie', async () => {
    await twoDevices();
    await disableSync({ wipe: false });
    expect(await getSyncState()).toBeNull();
    expect(await clients.all()).toHaveLength(1);

    await disableSync({ wipe: true });
    expect(await clients.all()).toHaveLength(0);
    expect((await getCompany()).name).not.toBe('Żółta Pszczółka');
  });
});

describe('zmiana hasła szyfrowania przez admina', () => {
  it('po wymianie klucza nowe urządzenie odczytuje dane nowym hasłem, a stary klucz już nie', async () => {
    const { rotateDataKey } = await import('./sync/engine');
    const { unwrapDataKey } = await import('./sync/crypto');
    const owner: Account = { ...account, role: 'owner' };
    const { client } = await (async () => {
      await useDevice('telefon');
      const c = await clients.create(clientData('Bar Alfa'));
      await enableSync(server, owner);
      return { client: c };
    })();
    let stored: unknown = null;
    const steps: string[] = [];
    await rotateDataKey(server, 'nowe hasło firmy 2026', async (_org, wrapped) => void (stored = wrapped), (s) => steps.push(s));
    expect(steps.length).toBe(4);

    // Nowe urządzenie z kluczem odwiniętym nowym hasłem odczytuje wszystko.
    await useDevice('nowy-telefon');
    await setDataKey(await unwrapDataKey('nowe hasło firmy 2026', stored as Parameters<typeof unwrapDataKey>[1]));
    await enableSync(server, account);
    expect((await clients.get(client.id))?.name).toBe('Bar Alfa');

    // Urządzenie ze starym kluczem nie odczyta już rekordu klienta z serwera.
    await useDevice('stary-komputer');
    await expect(enableSync(server, account)).rejects.toThrow(SyncError);
    expect(await clients.get(client.id)).toBeUndefined();
  });
});
