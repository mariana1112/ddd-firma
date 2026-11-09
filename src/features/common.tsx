import { orderCode, roman } from '../data/codes';
import type { NextVisitState } from '../data/order-list';
// Elementy wspólne ekranów zleceń: etykiety, akcje kontaktu z klientem i udostępnianie tekstu.
import type { Order, PayMethod, Phone, Visit } from '../data/types';
import { formatTerm, formatDate } from '../lib/dates';
import { PAY_NAMES, smsUrl, telUrl } from '../data/texts';
import { useFeedback } from '../ui/feedback';
import { Icon } from '../ui/icons';
import { Badge, Sheet } from '../ui/kit';
import { isIos, mapsQuery, mapsSearchUrl, navigationTargets } from '../data/maps';
import { orderAddress } from '../data/texts';
import { useState } from 'react';

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

/**
 * Wybór mapy do nawigacji. Aplikacja z ekranu początkowego iPhone'a otwiera google.com w przeglądarce, która nie
 * prowadzi trasy, dlatego na iPhonie są też aplikacja Google Maps, Apple Mapy i Waze.
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
            <a className="btn" href={mapsSearchUrl(query)} target="_blank" rel="noreferrer">
              <Icon name="search" /> Pokaż adres w Google Maps
            </a>
          )}
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

export function ContactBar(props: { order: Order; onSms?: (phone: Phone) => void }) {
  const { call } = useContactActions();
  const [navOpen, setNavOpen] = useState(false);
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
      <button type="button" className="contact-btn" disabled={!phone || !props.onSms} onClick={() => phone && props.onSms?.(phone)}>
        <Icon name="message" />
        <span>SMS</span>
      </button>
    </div>
  );
}
