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

export async function sendMessage(channel: string, text: string, mentions: string[] = []): Promise<void> {
  const profile = await getProfile();
  await messages.create({ channel, authorId: profile.userId, authorName: profile.name || 'Bez imienia', text: text.trim(), mentions });
}

/** Osoba, którą można oznaczyć na czacie (@Imię). */
export interface Person {
  id: string;
  name: string;
}

/**
 * Kogo można oznaczyć: konta firmy widoczne z serwera (technik widzi swój region) oraz każdy, kto pisał na czacie
 * (admin, księgowa). Bez siebie samego, bez pustych imion, po kolei alfabetycznie.
 */
export function chatPeople(list: Message[], members: Person[], me: string | null): Person[] {
  const byId = new Map<string, string>();
  for (const m of members) if (m.id && m.name.trim()) byId.set(m.id, m.name.trim());
  for (const m of list) if (m.authorId && m.authorName.trim() && !byId.has(m.authorId)) byId.set(m.authorId, m.authorName.trim());
  if (me) byId.delete(me);
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

/** Oznaczeni w tekście: wybrane osoby, których „@Imię” nadal jest w wiadomości. */
export function mentionsIn(text: string, picked: Person[]): string[] {
  return [...new Set(picked.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id))];
}

/** „@Ja” na końcu wpisywanego tekstu: fragment imienia do podpowiedzi albo null, gdy nikogo nie oznaczam. */
export function mentionQuery(text: string): string | null {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text);
  return match ? match[1] : null;
}

/** Wstawia „@Imię ” w miejsce wpisywanego „@…” (albo dopisuje na końcu). */
export function insertMention(text: string, person: Person): string {
  const query = mentionQuery(text);
  const base = query === null ? text.replace(/\s*$/, text.trim() ? ' ' : '') : text.slice(0, text.length - query.length - 1);
  return `${base}@${person.name} `;
}

/** Tekst wiadomości pocięty na zwykłe fragmenty i oznaczenia (do wyróżnienia na ekranie). */
export function splitMentions(text: string, names: string[]): Array<{ text: string; mention: boolean }> {
  const sorted = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return [{ text, mention: false }];
  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(@(?:${escaped.join('|')}))`, 'g'));
  return parts.filter((p) => p !== '').map((p) => ({ text: p, mention: p.startsWith('@') && sorted.includes(p.slice(1)) }));
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
  return list.filter((m) => m.channel === channel && m.authorId !== me && m.createdAt > since && !m.deletedAt && m.kind !== 'odczyt');
}

// ---------- Kto przeczytał ----------

/** Znacznik „przeczytane” (synchronizowany), nie wiadomość do pokazania. */
export const isReadMarker = (m: Pick<Message, 'kind'>) => m.kind === 'odczyt';

/** Wiadomości bez znaczników „przeczytane”. */
export const realMessages = (list: Message[]) => list.filter((m) => !isReadMarker(m) && !m.deletedAt);

const markerId = (channel: string, userId: string) => `odczyt-${channel}-${userId}`;

/**
 * Zapisuje, że ta osoba przeczytała kanał (widzą to inni: „Przeczytane: Ania 14:05”). Zapis tylko wtedy, gdy od
 * ostatniego czytania przyszło coś od innych, żeby nie wysyłać zmian przy każdym otwarciu.
 */
export async function markReadForOthers(channel: string, list: Message[], at = new Date().toISOString()): Promise<void> {
  const profile = await getProfile();
  if (!profile.userId) return;
  const id = markerId(channel, profile.userId);
  const existing = await messages.get(id);
  const newest = realMessages(list)
    .filter((m) => m.channel === channel && m.authorId !== profile.userId)
    .reduce((max, m) => (m.createdAt > max ? m.createdAt : max), '');
  if (!newest || (existing && !existing.deletedAt && (existing.readAt ?? '') >= newest)) return;
  if (existing) await messages.update(id, { readAt: at, authorName: profile.name || existing.authorName });
  else await messages.create({ channel, authorId: profile.userId, authorName: profile.name || 'Bez imienia', text: '', kind: 'odczyt', readAt: at }, id);
}

/** Kto przeczytał wiadomość i kiedy (bez autora wiadomości). */
export function readersOf(message: Message, list: Message[]): Array<{ name: string; at: string }> {
  return list
    .filter((m) => isReadMarker(m) && !m.deletedAt && m.channel === message.channel && m.authorId !== message.authorId && (m.readAt ?? '') >= message.createdAt)
    .map((m) => ({ name: m.authorName, at: m.readAt! }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Ostatnia prawdziwa wiadomość kanału (do listy rozmów). */
export function lastMessage(list: Message[], channel: string): Message | undefined {
  return realMessages(list)
    .filter((m) => m.channel === channel)
    .reduce<Message | undefined>((last, m) => (!last || m.createdAt > last.createdAt ? m : last), undefined);
}
