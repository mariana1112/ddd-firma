/**
 * Niedokończone formularze zapisane w pamięci przeglądarki: szkic nowego zlecenia i niezapisane zmiany w edycji.
 * Pulpit pokazuje je w „Do dokończenia”.
 */

export const NEW_ORDER_DRAFT_KEY = 'ddd-szkic-zlecenia';
export const EDIT_DRAFT_PREFIX = 'ddd-edycja-zlecenia-';

export interface DraftInfo {
  /** Szkic nowego zlecenia z wpisanym czymkolwiek ważnym (adres, klient, telefon, opis). */
  newOrder: string | null;
  /** Zlecenia z niezapisanymi zmianami w edycji (z zabiegiem, gdy edycję otwarto z karty zabiegu). */
  edits: Array<{ orderId: string; visitId: string | null }>;
}

export function listDrafts(): DraftInfo {
  const info: DraftInfo = { newOrder: null, edits: [] };
  try {
    const raw = localStorage.getItem(NEW_ORDER_DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Record<string, unknown>;
      const text = ['clientName', 'street', 'city', 'phone1', 'description']
        .map((k) => (typeof d[k] === 'string' ? (d[k] as string).trim() : ''))
        .filter(Boolean);
      if (text.length) info.newOrder = [d.clientName, d.street, d.city].filter((x) => typeof x === 'string' && x.trim()).join(', ') || 'bez nazwy';
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(EDIT_DRAFT_PREFIX)) continue;
      // Klucz: zlecenie albo „zlecenie-zabieg” (identyfikatory mają po 36 znaków).
      const rest = key.slice(EDIT_DRAFT_PREFIX.length);
      info.edits.push({ orderId: rest.slice(0, 36), visitId: rest.length > 37 ? rest.slice(37) : null });
    }
  } catch {
    // Bez pamięci przeglądarki nie ma szkiców.
  }
  return info;
}

export function dropEditDraft(orderId: string, visitId: string | null = null): void {
  try {
    localStorage.removeItem(EDIT_DRAFT_PREFIX + orderId + (visitId ? `-${visitId}` : ''));
  } catch {
    // nic
  }
}
