import { orderCode, roman } from '../data/codes';
import { ULV_NOTICE } from '../data/methods';
import type { NextVisitState } from '../data/order-list';
// Elementy wspólne ekranów zleceń: etykiety, akcje kontaktu z klientem i udostępnianie tekstu.
import type { Order, PayMethod, Phone, Visit } from '../data/types';
import { formatTerm, formatDate } from '../lib/dates';
import { PAY_NAMES, smsUrl, telUrl } from '../data/texts';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Sheet } from '../ui/kit';
import { isIos, mapsQuery, navigationTargets } from '../data/maps';
import { orderAddress } from '../data/texts';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { EARLY_MINUTES, earlierSms, LATE_MINUTES, lateSms, type SmsKind } from '../data/sms';
import { getAppSettings, getProfile } from '../data/settings';
import { finishSms, reminderSms } from '../data/texts';
import { visits as visitRepo } from '../data/repo';

export function PayBadge({ method }: { method: PayMethod }) {
  return <span className={`pay-badge pay-${method}`}>{PAY_NAMES[method]}</span>;
}

export function PinkBadge() {
  return <span className="pink-badge">Kod pink</span>;
}

export function VisitBadge({ visit }: { visit: Visit }) {
  if (visit.status === 'wykonany') return <Badge tone="ok">Wykonany</Badge>;
  if (visit.status === 'w_trakcie') return <Badge tone="warn">W trakcie</Badge>;
  if (visit.status === 'odwolany') return <Badge tone="muted">Odwołany</Badge>;
  if (visit.start) return <Badge tone="primary">Umówiony</Badge>;
  // Nie każde zlecenie ma kolejny zabieg: zabieg II bez terminu jest tylko szarą informacją, nie zadaniem.
  return visit.seq > 1 ? <Badge tone="muted">Nieumówiony</Badge> : <Badge tone="warn">Do umówienia</Badge>;
}

/** Krótko o kolejnym zabiegu: czy jest już umówiony. */
export function NextVisitPill({ state }: { state: NextVisitState }) {
  const tone = state.kind === 'umowiony' ? 'ok' : 'muted';
  return <span className={`next-pill next-pill-${tone}`}>{nextVisitText(state)}</span>;
}

export function nextVisitText(state: NextVisitState): string {
  switch (state.kind) {
    case 'umowiony':
      return `Zabieg ${roman(state.seq)} umówiony: ${formatDate(state.start).slice(0, 5)}, ${state.start.slice(11, 16)}`;
    case 'do_umowienia':
    case 'nieumowiony':
      return `Zabieg ${roman(state.seq)}: jeszcze nieumówiony`;
    case 'brak':
      return 'Bez kolejnego zabiegu';
  }
}

export function visitWhen(visit: Visit): string {
  if (visit.start) return formatTerm(visit.start);
  return visit.seq > 1 ? 'Jeszcze nieumówiony' : 'Termin do umówienia';
}

export function orderLabel(order: Order): string {
  return orderCode(order);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Akcje kontaktu: każda pyta o potwierdzenie, bo jedno dotknięcie dzwoni albo otwiera wiadomość. */
export function useContactActions() {
  const { confirm, toast } = useFeedback();

  const call = async (phone: Phone) => {
    const ok = await confirm({
      title: 'Zadzwonić do klienta?',
      message: `${phone.number}${phone.label ? ` (${phone.label})` : ''}`,
      confirmLabel: 'Zadzwoń',
    });
    if (ok) window.location.href = telUrl(phone.number);
  };

  /** Kopiuje treść do schowka i po potwierdzeniu otwiera Wiadomości z gotowym tekstem. */
  const sms = async (phone: Phone, body: string) => {
    const copied = await copyText(body);
    const ok = await confirm({
      title: 'Przejść do wysyłania SMS?',
      message: `Do: ${phone.number}${phone.label ? ` (${phone.label})` : ''}\n\n${body}${copied ? '\n\nTreść jest też w schowku.' : ''}`,
      confirmLabel: 'Otwórz Wiadomości',
    });
    if (ok) window.location.href = smsUrl(phone.number, body);
  };

  /** Arkusz udostępniania iPhone'a, a gdy go nie ma, schowek. */
  const share = async (text: string, title: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        return;
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
      }
    }
    toast((await copyText(text)) ? 'Skopiowano do schowka' : 'Nie udało się skopiować tekstu');
  };

  const copy = async (text: string) => {
    toast((await copyText(text)) ? 'Skopiowano do schowka' : 'Nie udało się skopiować tekstu');
  };

  return { call, sms, share, copy };
}

/**
 * Wybór mapy do nawigacji. Aplikacja z ekranu początkowego iPhone'a otwiera google.com w przeglądarce, która nie
 * prowadzi trasy, dlatego na iPhonie są też aplikacja Google Maps i Apple Mapy.
 */
export function NavigateSheet(props: { order: Order; open: boolean; onClose: () => void }) {
  const { copy } = useContactActions();
  const targets = navigationTargets(props.order, isIos());
  const query = mapsQuery(props.order);
  return (
    <Sheet open={props.open} title="Nawiguj" onClose={props.onClose}>
      <p className="sheet-text">
        {orderAddress(props.order) || 'Brak adresu'}
        {props.order.postalCode ? `, ${props.order.postalCode}` : ''}
        {props.order.mapsLink ? ' · zapisane miejsce z Google Maps' : ''}
      </p>
      {targets.length === 0 ? (
        <p className="field-hint">Zlecenie nie ma adresu. Dodaj go w edycji zlecenia.</p>
      ) : (
        <div className="btn-stack">
          {targets.map((t, i) => (
            <a
              key={t.id}
              className={i === 0 ? 'btn btn-primary' : 'btn'}
              href={t.url}
              target={t.app ? undefined : '_blank'}
              rel="noreferrer"
              onClick={props.onClose}
            >
              <Icon name="nav" /> {t.label}
            </a>
          ))}
          {query && (
            <button type="button" className="btn" onClick={() => void copy(query)}>
              <Icon name="copy" /> Kopiuj adres
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

/**
 * Menu „SMS”: przypomnienie z prośbą o potwierdzenie, „spóźnię się” (ile minut), prośba o przyjazd wcześniej
 * (ile minut) albo własna wiadomość. Tekst można poprawić przed wysłaniem; „Wyślij” otwiera Wiadomości.
 */
export function SmsSheet(props: { order: Order; visit?: Visit | null; open: boolean; onClose: () => void; initial?: SmsKind }) {
  const { order, visit } = props;
  const data = useLiveQuery(async () => ({ settings: await getAppSettings(), profile: await getProfile() }));
  const phones = order.phones.filter((p) => p.number.trim());
  const [phoneIdx, setPhoneIdx] = useState(0);
  const planned = visit && visit.status === 'zaplanowany' && visit.start ? visit : null;
  const done = visit && visit.status === 'wykonany' ? visit : null;
  // Kolejny zabieg zlecenia: jego termin trafia do podsumowania po wykonanym zabiegu.
  const next = useLiveQuery(
    async () => (done ? ((await visitRepo.where('orderId', done.orderId)).find((v) => v.seq === done.seq + 1 && v.status !== 'odwolany') ?? null) : null),
    [done?.id],
  );
  const [kind, setKind] = useState<SmsKind>(props.initial ?? (done ? 'zalecenia' : planned ? 'przypomnienie' : 'wlasna'));
  const [minutes, setMinutes] = useState(15);
  const [text, setText] = useState('');

  // Treść gotowej wiadomości przelicza się po wyborze rodzaju i minut; własną wpisuje technik.
  useEffect(() => {
    if (!data || !props.open) return;
    const who = data.profile.name;
    const base = visit ?? { start: null, seq: 1 };
    if (kind === 'zalecenia' && done) setText(finishSms(done, next ?? null, data.settings));
    else if (kind === 'przypomnienie' && planned) setText(reminderSms(order, planned, data.settings));
    else if (kind === 'spoznienie') setText(lateSms(order, base, minutes, who));
    else if (kind === 'wczesniej') setText(earlierSms(order, base, minutes, who));
    else if (kind === 'wlasna') setText('');
  }, [kind, minutes, data, props.open, order, visit, planned, done, next]);

  if (!props.open) return null;
  const phone = phones[phoneIdx];
  const options: Array<[SmsKind, string]> = [
    ...(done ? ([['zalecenia', 'Podsumowanie zabiegu i zalecenia']] as Array<[SmsKind, string]>) : []),
    ...(planned ? ([['przypomnienie', 'Przypomnienie i prośba o potwierdzenie']] as Array<[SmsKind, string]>) : []),
    ['spoznienie', 'Spóźnię się'],
    ['wczesniej', 'Czy mogę przyjechać wcześniej?'],
    ['wlasna', 'Własna wiadomość'],
  ];
  const send = async () => {
    if (!phone) return;
    await copyText(text);
    // Przypomnienie znika z listy „do wysłania” na Pulpicie.
    if (kind === 'przypomnienie' && planned) await visitRepo.update(planned.id, { remindedAt: new Date().toISOString() });
    props.onClose();
    window.location.href = smsUrl(phone.number, text);
  };
  return (
    <Sheet open={props.open} title="SMS do klienta" onClose={props.onClose}>
      <div className="form">
        {phones.length > 1 && (
          <div className="choice">
            {phones.map((p, i) => (
              <button key={i} type="button" className={i === phoneIdx ? 'choice-item active' : 'choice-item'} onClick={() => setPhoneIdx(i)}>
                {p.number}
                {p.label ? ` (${p.label})` : ''}
              </button>
            ))}
          </div>
        )}
        <div className="sms-options">
          {options.map(([value, label]) => (
            <button key={value} type="button" className={kind === value ? 'choice-item active' : 'choice-item'} aria-pressed={kind === value} onClick={() => setKind(value)}>
              {label}
            </button>
          ))}
        </div>
        {(kind === 'spoznienie' || kind === 'wczesniej') && (
          <div className="field">
            <span className="field-label">{kind === 'spoznienie' ? 'Ile minut spóźnienia (mniej więcej)?' : 'Ile minut wcześniej?'}</span>
            <div className="chips chips-wrap">
              {(kind === 'spoznienie' ? LATE_MINUTES : EARLY_MINUTES).map((m) => (
                <button key={m} type="button" className={minutes === m ? 'chip active' : 'chip'} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
                  {m} min
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="field">
          <span className="field-label">Treść (możesz poprawić)</span>
          <textarea rows={5} value={text} placeholder="Wpisz wiadomość" onChange={(e) => setText(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary btn-block" disabled={!phone || !text.trim()} onClick={() => void send()}>
          <Icon name="message" /> Wyślij {phone ? `do ${phone.number}` : ''}
        </button>
      </div>
    </Sheet>
  );
}

export function ContactBar(props: { order: Order; visit?: Visit | null }) {
  const { call } = useContactActions();
  const [navOpen, setNavOpen] = useState(false);
  const [smsOpen, setSmsOpen] = useState(false);
  const phone = props.order.phones.find((p) => p.number.trim());
  return (
    <div className="contact-bar">
      <button type="button" className="contact-btn" onClick={() => setNavOpen(true)}>
        <Icon name="nav" />
        <span>Nawiguj</span>
      </button>
      <NavigateSheet order={props.order} open={navOpen} onClose={() => setNavOpen(false)} />
      <button type="button" className="contact-btn" disabled={!phone} onClick={() => phone && void call(phone)}>
        <Icon name="phone" />
        <span>Zadzwoń</span>
      </button>
      <button type="button" className="contact-btn" disabled={!phone} onClick={() => setSmsOpen(true)}>
        <Icon name="message" />
        <span>SMS</span>
      </button>
      {smsOpen && <SmsSheet order={props.order} visit={props.visit} open={smsOpen} onClose={() => setSmsOpen(false)} />}
    </div>
  );
}

/** Uwaga przy zamgławianiu ULV: zawsze widoczna przy zleceniu, zabiegu i w formularzu. */
export function UlvNotice() {
  return (
    <div className="notice notice-warn notice-ulv">
      <Icon name="alert" />
      <span>{ULV_NOTICE}</span>
    </div>
  );
}
