import { messages } from './repo';
import { getProfile, type RegionInfo } from './settings';
import type { Message, SyncState } from './types';

/**
 * Czat firmy: „Księgowość” (technicy, admin i księgowa), „Cała firma” (między regionami) i kanał regionu.
 * Wiadomości są zaszyfrowanymi rekordami jak zlecenia; co kto przeczytał, pamięta tylko jego telefon.
 */
export interface Channel {
  id: string;
  label: string;
}

export function chatChannels(state: Pick<SyncState, 'role' | 'branchId' | 'branchName'> | null, regions: Record<string, RegionInfo>): Channel[] {
  const list: Channel[] = [
    { id: 'ksiegowosc', label: 'Księgowość' },
    { id: 'firma', label: 'Cała firma' },
  ];
  const all = state?.role === 'owner' || state?.role === 'ksiegowosc';
  if (all) {
    for (const [id, info] of Object.entries(regions).sort((a, b) => a[1].name.localeCompare(b[1].name, 'pl'))) {
      list.push({ id: `region:${id}`, label: `Region ${info.name}` });
    }
  } else if (state?.branchId) {
    list.push({ id: `region:${state.branchId}`, label: `Region ${state.branchName || regions[state.branchId]?.name || ''}`.trim() });
  }
  return list;
}

export async function sendMessage(channel: string, text: string): Promise<void> {
  const profile = await getProfile();
  await messages.create({ channel, authorId: profile.userId, authorName: profile.name || 'Bez imienia', text: text.trim() });
}

const READ_KEY = 'ddd:czat-przeczytane';

/** Kiedy ta osoba ostatnio czytała każdy kanał (tylko na tym telefonie). */
export function readMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function markRead(channel: string, at = new Date().toISOString()): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify({ ...readMap(), [channel]: at }));
  } catch {
    // Bez pamięci przeglądarki kanał po prostu zostanie nieprzeczytany.
  }
}

/** Nieprzeczytane wiadomości od innych osób w kanale. */
export function unread(list: Message[], channel: string, me: string | null, read: Record<string, string>): Message[] {
  const since = read[channel] ?? '';
  return list.filter((m) => m.channel === channel && m.authorId !== me && m.createdAt > since && !m.deletedAt);
}
