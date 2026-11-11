import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { chatChannels, markRead, readMap, sendMessage, unread } from '../data/chat';
import { db } from '../data/db';
import { buildNotifications, type AppNotification } from '../data/notifications';
import { decideOrderDeletion } from '../data/orders';
import { messages, orders, visits } from '../data/repo';
import { getProfile, getRegions, getSyncState } from '../data/settings';
import { formatDate, todayWarsaw } from '../lib/dates';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Chips, Empty, Group, Loading, Page, lockScroll, unlockScroll } from '../ui/kit';

const SEEN_KEY = 'ddd:powiadomienia-widziane';

/** „11.11.2026 14:05” z chwili zapisu (czas polski). */
const when = (iso: string) =>
  `${formatDate(iso)} ${new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' })}`;

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
    const unseen = list.filter((n) => n.kind === 'usuniecie' || n.kind === 'czat' || !seen.has(n.id));
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
    if (n) saveSeen(n.list.filter((x) => x.kind !== 'usuniecie' && x.kind !== 'czat').map((x) => x.id));
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
          <div key={item.id} className={`notification${shown.has(item.id) && item.kind !== 'usuniecie' && item.kind !== 'czat' ? '' : ' notification-new'}`}>
            <button type="button" className="notification-main" onClick={() => navigate(item.to)}>
              <span className="notification-head">
                <Badge tone={item.kind === 'usuniecie' ? 'danger' : item.kind === 'czat' ? 'info' : 'primary'}>{KIND_LABEL[item.kind]}</Badge>
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

/** Czat: kanały „Księgowość”, „Cała firma” i regionu; wiadomości synchronizują się jak zlecenia. */
export function ChatPage() {
  const [params, setParams] = useSearchParams();
  const { run } = useFeedback();
  const [text, setText] = useState('');
  // Dotknięcie pola wiadomości powiększa je na cały ekran: wygodne pisanie i poprawianie dłuższego tekstu.
  const [big, setBig] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!big) return;
    lockScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBig(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      unlockScroll();
    };
  }, [big]);
  const shrink = () => {
    setBig(false);
    field.current?.blur();
  };
  const data = useLiveQuery(async () => ({
    state: await getSyncState(),
    me: (await getProfile()).userId,
    regions: await getRegions(),
    messages: await messages.allRegions(),
  }));
  const channels = data ? chatChannels(data.state, data.regions) : [];
  const channel = params.get('k') && channels.some((c) => c.id === params.get('k')) ? params.get('k')! : (channels[0]?.id ?? 'ksiegowosc');
  const list = (data?.messages ?? []).filter((m) => m.channel === channel).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Otwarty kanał jest przeczytany; widok przewija się do najnowszej wiadomości.
  useEffect(() => {
    if (!data) return;
    markRead(channel);
    end.current?.scrollIntoView({ block: 'end' });
  }, [channel, data, list.length]);

  if (!data) return <Loading />;
  const read = readMap();

  return (
    <Page title="Czat" back="/wiecej">
      <Chips
        value={channel}
        onChange={(k: string) => setParams({ k }, { replace: true })}
        options={channels.map((c) => ({ value: c.id, label: c.label, count: c.id === channel ? undefined : unread(data.messages, c.id, data.me, read).length || undefined }))}
      />
      <div className="chat">
        {list.length === 0 && <Empty icon="message" title="Brak wiadomości. Napisz pierwszą." />}
        {list.map((m) => {
          const mine = m.authorId === data.me;
          return (
            <div key={m.id} className={mine ? 'chat-msg chat-mine' : 'chat-msg'}>
              {!mine && <span className="chat-author">{m.authorName}</span>}
              <span className="chat-text">{m.text}</span>
              <span className="chat-time">{when(m.createdAt)}</span>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form
        className={big ? 'chat-form chat-form-big' : 'chat-form'}
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          void run(async () => {
            await sendMessage(channel, text);
            setText('');
            shrink();
          });
        }}
      >
        {big && (
          <div className="chat-big-head">
            <button type="button" className="btn btn-sm" onClick={shrink}>
              <Icon name="back" /> Zmniejsz
            </button>
            <span className="chat-big-channel">{channels.find((c) => c.id === channel)?.label}</span>
          </div>
        )}
        <textarea
          ref={field}
          rows={big ? 8 : 2}
          value={text}
          placeholder="Napisz wiadomość"
          aria-label="Wiadomość"
          onFocus={() => setBig(true)}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
          <Icon name="message" /> Wyślij
        </button>
      </form>
      {!data.state && <p className="field-hint">Czat działa po zalogowaniu do konta firmy.</p>}
    </Page>
  );
}
