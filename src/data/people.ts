import { messages, orders, trips, visits } from './repo';

/**
 * Po zmianie imienia konta przez admina poprawia je w zapisanych danych: zabiegi (technik, kto umówił), zlecenia
 * (kto przyjął, prośby o usunięcie), przejazdy (kierowca) i czat. Dzięki temu raporty i historia pokazują nowe imię.
 * Zwraca liczbę poprawionych rekordów.
 */
export async function renamePersonInRecords(userId: string, oldName: string, newName: string): Promise<number> {
  const name = newName.trim();
  if (!userId || !name) return 0;
  let changed = 0;
  for (const v of await visits.allRegions()) {
    const patch: Record<string, string> = {};
    if (v.technicianId === userId && v.technicianName !== name) patch.technicianName = name;
    if (v.bookedById === userId && v.bookedByName !== name) patch.bookedByName = name;
    if (Object.keys(patch).length) {
      await visits.update(v.id, patch);
      changed++;
    }
  }
  for (const o of await orders.allRegions()) {
    const patch: Record<string, unknown> = {};
    if (o.ownerId === userId && o.ownerName !== name) patch.ownerName = name;
    if (o.deleteRequest?.byId === userId && o.deleteRequest.byName !== name) patch.deleteRequest = { ...o.deleteRequest, byName: name };
    if (Object.keys(patch).length) {
      await orders.update(o.id, patch);
      changed++;
    }
  }
  for (const t of await trips.allRegions()) {
    // Kierowca wpisany ręcznie innym imieniem zostaje; zmienia się tylko to, co było imieniem konta.
    if (t.ownerId === userId && t.driver && t.driver === oldName && oldName !== name) {
      await trips.update(t.id, { driver: name });
      changed++;
    }
  }
  for (const m of await messages.allRegions()) {
    if (m.authorId === userId && m.authorName !== name) {
      await messages.update(m.id, { authorName: name });
      changed++;
    }
  }
  return changed;
}
