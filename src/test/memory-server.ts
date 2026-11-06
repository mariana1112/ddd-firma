// Serwer w pamięci o tej samej semantyce co funkcje SQL w supabase/migrations.
// Pozwala testować synchronizację wielu urządzeń bez sieci.
import type { PushChange, RemoteRecord, SyncServer } from '../data/sync/engine';

interface StoredRecord {
  tbl: string;
  id: string;
  data: Record<string, unknown>;
  rev: number;
  purged: boolean;
}

export class MemoryServer implements SyncServer {
  records = new Map<string, StoredRecord>();
  history: Array<PushChange & { deviceId: string }> = [];
  files = new Map<string, Blob>();
  counters = new Map<string, number>();
  minSchema = 0;
  private seenChanges = new Set<string>();
  private rev = 0;
  /** Symulacja zerwanego połączenia: po zapisie na serwerze odpowiedź nie dociera. */
  failAfterNextPush = false;
  offline = false;

  private check() {
    if (this.offline) throw new TypeError('Failed to fetch');
  }

  async push(orgId: string, deviceId: string, schema: number, changes: PushChange[]): Promise<void> {
    this.check();
    if (schema < this.minSchema) throw new Error('UPDATE_REQUIRED');
    // Jak sync_push: każda wartość pola musi być szyfrogramem aplikacji.
    for (const change of changes) {
      if (Object.values(change.patch).some((v) => typeof v !== 'string' || !v.startsWith('e1:'))) {
        throw new Error('NOT_ENCRYPTED');
      }
    }
    for (const change of changes) {
      if (this.seenChanges.has(change.id)) continue;
      this.seenChanges.add(change.id);
      this.history.push({ ...change, deviceId });
      const key = `${orgId}/${change.tbl}/${change.recordId}`;
      const existing = this.records.get(key);
      const rev = ++this.rev;
      if (change.op === 'purge') {
        this.records.set(key, { tbl: change.tbl, id: change.recordId, data: {}, rev, purged: true });
        // Jak wyzwalacz records_clear_purged_history: treść historii usuniętego rekordu znika.
        for (const entry of this.history) {
          if (entry.tbl === change.tbl && entry.recordId === change.recordId) entry.patch = {};
        }
      } else if (!existing) {
        this.records.set(key, { tbl: change.tbl, id: change.recordId, data: { ...change.patch }, rev, purged: false });
      } else if (!existing.purged) {
        this.records.set(key, { ...existing, data: { ...existing.data, ...change.patch }, rev });
      }
    }
    if (this.failAfterNextPush) {
      this.failAfterNextPush = false;
      throw new TypeError('Failed to fetch');
    }
  }

  async pull(orgId: string, sinceRev: number, limit: number): Promise<RemoteRecord[]> {
    this.check();
    return [...this.records.entries()]
      .filter(([key, r]) => key.startsWith(`${orgId}/`) && r.rev > sinceRev)
      .map(([, r]) => structuredClone(r))
      .sort((a, b) => a.rev - b.rev)
      .slice(0, limit);
  }

  async reserveNumbers(orgId: string, series: string, minNext: number, count: number): Promise<number> {
    this.check();
    const key = `${orgId}/${series}`;
    const first = Math.max(this.counters.get(key) ?? 1, minNext);
    this.counters.set(key, first + count);
    return first;
  }

  async uploadFile(path: string, blob: Blob): Promise<void> {
    this.check();
    this.files.set(path, blob);
  }

  async deleteFile(path: string): Promise<void> {
    this.check();
    this.files.delete(path);
  }

  async downloadFile(path: string): Promise<Blob> {
    this.check();
    const blob = this.files.get(path);
    if (!blob) throw new Error('Nie ma pliku');
    return blob;
  }

  recordOf(orgId: string, tbl: string, id: string) {
    return this.records.get(`${orgId}/${tbl}/${id}`);
  }
}
