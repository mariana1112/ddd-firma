import { orderCode, roman } from '../data/codes';
import type { NextVisitState } from '../data/order-list';
// Elementy wspólne ekranów zleceń: etykiety, akcje kontaktu z klientem i udostępnianie tekstu.
import type { Order, PayMethod, Phone, Visit } from '../data/types';
import { formatTerm, formatDate } from '../lib/dates';
import { PAY_NAMES, smsUrl, telUrl } from '../data/texts';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge } from '../ui/kit';

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
  return visit.start ? <Badge tone="primary">Umówiony</Badge> : <Badge tone="warn">Do umówienia</Badge>;
}

/** Krótko o kolejnym zabiegu: czy jest już umówiony. */
export function NextVisitPill({ state }: { state: NextVisitState }) {
  const tone = state.kind === 'umowiony' ? 'ok' : state.kind === 'brak' ? 'muted' : 'warn';
  return <span className={`next-pill next-pill-${tone}`}>{nextVisitText(state)}</span>;
}

export function nextVisitText(state: NextVisitState): string {
  switch (state.kind) {
    case 'umowiony':
      return `Zabieg ${roman(state.seq)} umówiony: ${formatDate(state.start).slice(0, 5)}, ${state.start.slice(11, 16)}`;
    case 'do_umowienia':
      return `Zabieg ${roman(state.seq)} do umówienia`;
    case 'nieumowiony':
      return `Zabieg ${roman(state.seq)} nieumówiony`;
    case 'brak':
      return 'Bez kolejnego zabiegu';
  }
}

export function visitWhen(visit: Visit): string {
  return visit.start ? formatTerm(visit.start) : 'Termin do umówienia';
}

export function orderLabel(order: Order): string {
  return orderCode(order);
}

async function copyText(text: string): Promise<boolean> {
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

export function ContactBar(props: { order: Order; onSms?: (phone: Phone) => void; mapsHref: string }) {
  const { call } = useContactActions();
  const phone = props.order.phones[0];
  return (
    <div className="contact-bar">
      <a className="contact-btn" href={props.mapsHref} target="_blank" rel="noreferrer">
        <Icon name="nav" />
        <span>Nawiguj</span>
      </a>
      <button type="button" className="contact-btn" disabled={!phone} onClick={() => phone && void call(phone)}>
        <Icon name="phone" />
        <span>Zadzwoń</span>
      </button>
      <button type="button" className="contact-btn" disabled={!phone || !props.onSms} onClick={() => phone && props.onSms?.(phone)}>
        <Icon name="message" />
        <span>SMS</span>
      </button>
    </div>
  );
}
