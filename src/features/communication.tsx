import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { chatChannels, chatPeople, insertMention, lastMessage, markRead, markReadForOthers, mentionQuery, mentionsIn, readersOf, readMap, realMessages, sendMessage, splitMentions, unread, type Person } from '../data/chat';
import { db } from '../data/db';
import { buildNotifications, type AppNotification } from '../data/notifications';
import { decideOrderDeletion } from '../data/orders';
import { clockInWarsaw, dayInWarsaw, firstName } from '../data/texts';
import { messages, orders, visits } from '../data/repo';
import { getProfile, getRegions, getSyncState } from '../data/settings';
import { formatDate, todayWarsaw } from '../lib/dates';
import type { Message } from '../data/types';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Empty, Group, Loading, Page, Row } from '../ui/kit';

const SEEN_KEY = 'ddd:powiadomienia-widziane';

/** „11.11.2026 14:05” z chwili zapisu (czas polski). */
const when = (iso: string) => `${formatDate(dayInWarsaw(iso))} ${clockInWarsaw(iso)}`;

function readSeen(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveSeen(ids: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...readSeen(), ...ids])].slice(-500)));
  } catch {
    // Bez pamięci przeglądarki dzwoneczek pokaże je znowu.
  }
}

/** Powiadomienia tej osoby, liczone z danych na telefonie. */
function useNotifications(): { list: AppNotification[]; unseen: AppNotification[]; refresh: () => void } | undefined {
  const [tick, setTick] = useState(0);
  const data = useLiveQuery(async () => {
    const state = await getSyncState();
    const profile = await getProfile();
    return {
      state,
      me: profile.userId,
      orders: await orders.all(),
      deletedOrders: await db.orders.filter((o) => Boolean(o.deletedAt && o.deleteRequest)).toArray(),
      visits: await visits.all(),
      messages: await messages.allRegions(),
      regions: await getRegions(),
    };
  }, []);
  return useMemo(() => {
    if (!data) return undefined;
    void tick;
    const read = readMap();
    const list = buildNotifications({
      orders: data.orders,
      deletedOrders: data.deletedOrders,
      visits: data.visits,
      messages: data.messages,
      channels: chatChannels(data.state, data.regions),
      me: data.me,
      owner: data.state?.role === 'owner',
      read,
      today: todayWarsaw(),
    }).filter((x) => x.kind !== 'czat');
    const seen = new Set(readSeen());
    // Prośby o usunięcie i czat liczą się, dopóki admin nie zdecyduje albo kanał nie zostanie przeczytany.
    const unseen = list.filter((n) => n.kind === 'usuniecie' || n.kind === 'oznaczenie' || !seen.has(n.id));
    return { list, unseen, refresh: () => setTick((t) => t + 1) };
  }, [data, tick]);
}

/** Ikona czatu w nagłówku każdego ekranu (obok dzwoneczka): liczba nieprzeczytanych wiadomości. */
export function ChatButton() {
  const data = useLiveQuery(async () => ({
    state: await getSyncState(),
    me: (await getProfile()).userId,
    regions: await getRegions(),
    messages: await messages.allRegions(),
  }));
  const read = readMap();
  const count = data ? chatChannels(data.state, data.regions).reduce((n, c) => n + unread(data.messages, c.id, data.me, read).length, 0) : 0;
  return (
    <Link to="/czat" className="bell" aria-label={count ? `Czat: ${count} nieprzeczytanych` : 'Czat'}>
      <Icon name="message" size={22} />
      {count > 0 && <span className="bell-count">{count > 9 ? '9+' : count}</span>}
    </Link>
  );
}

/** Dzwoneczek w nagłówku każdego ekranu: liczba nowych powiadomień. */
export function NotificationBell() {
  const n = useNotifications();
  const count = n?.unseen.length ?? 0;
  return (
    <Link to="/powiadomienia" className="bell" aria-label={count ? `Powiadomienia: ${count} nowych` : 'Powiadomienia'}>
      <Icon name="bell" size={22} />
      {count > 0 && <span className="bell-count">{count > 9 ? '9+' : count}</span>}
    </Link>
  );
}

const KIND_LABEL: Record<AppNotification['kind'], string> = {
  usuniecie: 'Do zatwierdzenia',
  decyzja: 'Decyzja admina',
  czat: 'Czat',
  oznaczenie: 'Oznaczenie',
  nowe: 'Nowe zlecenie',
};

/** Lista powiadomień z pełną treścią; prośby o usunięcie admin zatwierdza albo odrzuca od razu tutaj. */
export function NotificationsPage() {
  const n = useNotifications();
  const navigate = useNavigate();
  const { confirm, run, toast } = useFeedback();
  const [shown] = useState(() => new Set(readSeen()));

  // Otwarcie listy oznacza powiadomienia jako przeczytane (dzwoneczek się zeruje), ale lista zostaje widoczna.
  useEffect(() => {
    if (n) saveSeen(n.list.filter((x) => x.kind !== 'usuniecie' && x.kind !== 'oznaczenie').map((x) => x.id));
  }, [n]);

  if (!n) return <Loading />;
  const decide = async (item: AppNotification, approve: boolean) => {
    if (!item.orderId) return;
    if (approve) {
      const ok = await confirm({ title: 'Usunąć zlecenie?', message: 'Zlecenie z zabiegami i zdjęciami trafi do kosza. Technik dostanie informację.', confirmLabel: 'Usuń', danger: true });
      if (!ok) return;
    }
    await run(async () => {
      await decideOrderDeletion(item.orderId!, approve);
      toast(approve ? 'Zlecenie usunięte (w koszu)' : 'Prośba odrzucona');
    });
  };

  return (
    <Page title="Powiadomienia" back="/">
      <Group>
        {n.list.length === 0 && <Empty icon="bell" title="Brak powiadomień" />}
        {n.list.map((item) => (
          <div key={item.id} className={`notification${shown.has(item.id) && item.kind !== 'usuniecie' && item.kind !== 'oznaczenie' ? '' : ' notification-new'}`}>
            <button type="button" className="notification-main" onClick={() => navigate(item.to)}>
              <span className="notification-head">
                <Badge tone={item.kind === 'usuniecie' ? 'danger' : item.kind === 'czat' || item.kind === 'oznaczenie' ? 'info' : 'primary'}>{KIND_LABEL[item.kind]}</Badge>
                <span className="row-sub">{when(item.at)}</span>
              </span>
              <strong>{item.title}</strong>
              <span>{item.text}</span>
            </button>
            {item.kind === 'usuniecie' && (
              <div className="notification-actions">
                <button type="button" className="btn btn-sm btn-danger" onClick={() => void decide(item, true)}>
                  Zatwierdź usunięcie
                </button>
                <button type="button" className="btn btn-sm" onClick={() => void decide(item, false)}>
                  Odrzuć
                </button>
              </div>
            )}
          </div>
        ))}
      </Group>
    </Page>
  );
}

/**
 * Czat: najpierw lista rozmów („Księgowość”, „Cała firma”, regiony) z liczbą nieprzeczytanych, po dotknięciu rozmowa.
 * Wiadomości synchronizują się jak zlecenia; pod własną wiadomością widać, kto ją przeczytał i kiedy.
 */
export function ChatPage() {
  const [params, setParams] = useSearchParams();
  const data = useLiveQuery(async () => ({
    state: await getSyncState(),
    me: (await getProfile()).userId,
    regions: await getRegions(),
    messages: await messages.allRegions(),
  }));
  if (!data) return <Loading />;
  const channels = chatChannels(data.state, data.regions);
  const open = channels.find((c) => c.id === params.get('k'));
  if (open) return <ChatConversation channel={open} data={data} onBack={() => setParams({}, { replace: true })} />;

  const read = readMap();
  return (
    <Page title="Czat" back="/">
      <Group>
        {channels.map((c) => {
          const last = lastMessage(data.messages, c.id);
          const fresh = unread(data.messages, c.id, data.me, read).length;
          return (
            <Row
              key={c.id}
              icon="message"
              onClick={() => setParams({ k: c.id })}
              title={c.label}
              sub={last ? `${last.authorId === data.me ? 'Ty' : firstName(last.authorName)}: ${last.text}` : 'Brak wiadomości'}
              trailing={
                <span className="chat-list-meta">
                  {last && <span className="row-sub">{when(last.createdAt).slice(-5)}</span>}
                  {fresh > 0 && <span className="bell-count chat-list-count">{fresh > 9 ? '9+' : fresh}</span>}
                </span>
              }
            />
          );
        })}
      </Group>
      {!data.state && <p className="field-hint">Czat działa po zalogowaniu do konta firmy.</p>}
    </Page>
  );
}

function ChatConversation(props: {
  channel: { id: string; label: string };
  data: { state: Awaited<ReturnType<typeof getSyncState>>; me: string | null; messages: Message[] };
  onBack: () => void;
}) {
  const { data, channel } = props;
  const { run } = useFeedback();
  const [text, setText] = useState('');
  // Oznaczone osoby (@Imię) wybrane z podpowiedzi; przy wysyłaniu liczą się te, które zostały w tekście.
  const [picked, setPicked] = useState<Person[]>([]);
  const [picking, setPicking] = useState(false);
  const [members, setMembers] = useState<Person[]>([]);
  const field = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const list = realMessages(data.messages)
    .filter((m) => m.channel === channel.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const orgId = data.state?.orgId;

  // Konta firmy do oznaczania (technik widzi swój region); bez internetu zostają osoby, które pisały na czacie.
  useEffect(() => {
    if (!orgId) return;
    void import('../data/sync/supabase')
      .then((api) => api.listMembers(orgId))
      .then((all) => setMembers(all.filter((m) => m.approved && !m.suspended).map((m) => ({ id: m.userId, name: m.displayName }))))
      .catch(() => setMembers([]));
  }, [orgId]);

  // Otwarta rozmowa jest przeczytana (u mnie i dla innych: „Przeczytane”); widok przewija się do najnowszej.
  useEffect(() => {
    markRead(channel.id);
    void markReadForOthers(channel.id, data.messages).catch(() => undefined);
    end.current?.scrollIntoView({ block: 'end' });
  }, [channel.id, data.messages, list.length]);

  // Pole rośnie razem z tekstem (do ok. 40% ekranu), dalej przewija się w środku.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(window.innerHeight * 0.4))}px`;
  }, [text]);

  // Na czacie samo imię (oznaczanie „@Maciej”); pełne imię i nazwisko jest w raportach.
  const people = chatPeople(realMessages(data.messages), members, data.me).map((p) => ({ ...p, name: firstName(p.name) }));
  const names = [...people.map((p) => p.name), ...list.map((m) => firstName(m.authorName))];
  const query = mentionQuery(text);
  const showPicker = picking || query !== null;
  const suggestions = people.filter((p) => !query || p.name.toLocaleLowerCase('pl').startsWith(query.toLocaleLowerCase('pl')));
  const pick = (person: Person) => {
    setText(insertMention(text, person));
    setPicked((prev) => [...prev.filter((p) => p.id !== person.id), person]);
    setPicking(false);
    field.current?.focus();
  };

  return (
    <Page title={channel.label} back="/czat" onBack={props.onBack}>
      <div className="chat">
        {list.length === 0 && <Empty icon="message" title="Brak wiadomości. Napisz pierwszą." />}
        {list.map((m) => {
          const mine = m.authorId === data.me;
          const tagged = Boolean(data.me && m.mentions?.includes(data.me));
          const readers = mine ? readersOf(m, data.messages) : [];
          return (
            <div key={m.id} className={`chat-msg${mine ? ' chat-mine' : ''}${tagged ? ' chat-tagged' : ''}`}>
              {!mine && <span className="chat-author">{firstName(m.authorName)}</span>}
              <span className="chat-text">
                {splitMentions(m.text, names).map((part, i) =>
                  part.mention ? (
                    <strong key={i} className="chat-mention">
                      {part.text}
                    </strong>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </span>
              <span className="chat-time">{when(m.createdAt)}</span>
              {mine && (
                <span className="chat-read">
                  {readers.length ? `Przeczytane: ${readers.map((r) => `${firstName(r.name)} ${when(r.at).slice(-5)}`).join(', ')}` : 'Wysłane, jeszcze nieprzeczytane'}
                </span>
              )}
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void run(async () => {
            await sendMessage(channel.id, text, mentionsIn(text, picked));
            setText('');
            setPicked([]);
            setPicking(false);
          });
        }}
      >
        {showPicker && (
          <div className="chat-picker" role="listbox" aria-label="Oznacz osobę">
            {suggestions.length === 0 ? (
              <span className="field-hint">{people.length === 0 ? 'Nie ma jeszcze kogo oznaczyć.' : 'Nikt o takim imieniu.'}</span>
            ) : (
              suggestions.map((p) => (
                <button key={p.id} type="button" className="chip" role="option" aria-selected={false} onClick={() => pick(p)}>
                  @{p.name}
                </button>
              ))
            )}
          </div>
        )}
        <div className="chat-form-row">
          <button
            type="button"
            className={showPicker ? 'btn chat-at active' : 'btn chat-at'}
            aria-label="Oznacz osobę"
            aria-pressed={showPicker}
            onClick={() => (query !== null ? setText(text.slice(0, text.length - query.length - 1)) : setPicking(!picking))}
          >
            @
          </button>
          <textarea ref={field} rows={1} value={text} placeholder="Napisz wiadomość" aria-label="Wiadomość" onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={!text.trim()} aria-label="Wyślij">
            <Icon name="message" /> Wyślij
          </button>
        </div>
      </form>
    </Page>
  );
}
