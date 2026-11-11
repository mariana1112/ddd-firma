import { cloneElement, createContext, isValidElement, useContext, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './icons';

export function BackButton({ fallback }: { fallback: string }) {
  const navigate = useNavigate();
  const onClick = () => {
    // Aplikacja zainstalowana na iPhonie nie ma przycisku wstecz, więc to jedyna droga powrotu.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
  return (
    <button type="button" className="icon-btn back-btn" onClick={onClick} aria-label="Wstecz">
      <Icon name="back" size={26} />
    </button>
  );
}

/** Pasek nad tytułem strony, np. „Panel admina · Pomorskie”, gdy ekran pokazuje region wybrany w panelu. */
export const ScopeBannerContext = createContext<ReactNode>(null);

/** Element w nagłówku każdego ekranu (dzwoneczek powiadomień), podawany przez aplikację. */
export const HeaderExtraContext = createContext<ReactNode>(null);

export function Page(props: { title: string; back?: string; actions?: ReactNode; children: ReactNode }) {
  const banner = useContext(ScopeBannerContext);
  const extra = useContext(HeaderExtraContext);
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = `${props.title} · Pogromcy Insektów`;
  }, [props.title]);
  return (
    <div className={props.back ? 'page page-sub' : 'page'}>
      {banner}
      <header className="page-head">
        {props.back && <BackButton fallback={props.back} />}
        <h1>{props.title}</h1>
        <div className="page-actions">
          {props.actions}
          {extra}
        </div>
      </header>
      <main className="page-body">{props.children}</main>
    </div>
  );
}

export function Group(props: { title?: string; action?: ReactNode; children: ReactNode; plain?: boolean }) {
  return (
    <section className="group">
      {(props.title || props.action) && (
        <div className="group-head">
          <h2>{props.title}</h2>
          {props.action}
        </div>
      )}
      {props.plain ? props.children : <div className="group-body">{props.children}</div>}
    </section>
  );
}

/** Sekcja zwijana: nagłówek z krótkim podsumowaniem, treść po dotknięciu. Skraca długie ekrany. */
export function Collapsible(props: { title: string; summary?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <section className={open ? 'group collapsible open' : 'group collapsible'}>
      <button type="button" className="collapsible-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="collapsible-title">
          <strong>{props.title}</strong>
          {!open && props.summary && <span className="collapsible-summary">{props.summary}</span>}
        </span>
        <Icon name="chevron" size={18} />
      </button>
      {open && <div className="collapsible-body">{props.children}</div>}
    </section>
  );
}

export function Row(props: {
  to?: string;
  onClick?: () => void;
  icon?: IconName;
  /** Własny element na początku wiersza, np. kafelek z datą. */
  lead?: ReactNode;
  /** Dodatkowa klasa wiersza, np. wyróżnienie. */
  className?: string;
  title: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  const interactive = Boolean(props.to || props.onClick);
  const rowClass = props.className ? `row ${props.className}` : 'row';
  const inner = (
    <>
      {props.icon && (
        <span className="row-icon">
          <Icon name={props.icon} />
        </span>
      )}
      {props.lead}
      <span className="row-main">
        <span className="row-title">{props.title}</span>
        {props.sub && <span className="row-sub">{props.sub}</span>}
        {props.meta && <span className="row-meta">{props.meta}</span>}
      </span>
      {props.trailing && <span className="row-trailing">{props.trailing}</span>}
      {interactive && (
        <span className="row-chevron">
          <Icon name="chevron" size={18} />
        </span>
      )}
    </>
  );
  if (props.to) {
    return (
      <Link className={rowClass} to={props.to}>
        {inner}
      </Link>
    );
  }
  if (props.onClick) {
    return (
      <button type="button" className={rowClass} onClick={props.onClick}>
        {inner}
      </button>
    );
  }
  return <div className={rowClass}>{inner}</div>;
}

export type Tone = 'primary' | 'ok' | 'info' | 'warn' | 'danger' | 'muted';

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Empty(props: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {props.icon && <Icon name={props.icon} size={32} />}
      <p className="empty-title">{props.title}</p>
      {props.children}
    </div>
  );
}

export function Stat(props: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="stat">
      <span className="stat-label">{props.label}</span>
      <span className={`stat-value num${props.tone ? ` text-${props.tone}` : ''}`}>{props.value}</span>
    </div>
  );
}

export function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="info">
      <span className="info-label">{label}</span>
      <span className="info-value">{children}</span>
    </div>
  );
}

/**
 * Pole formularza: nazwa, pole, błąd albo podpowiedź. Nazwa i podpowiedź są jawnie powiązane z polem, więc iPhone
 * (autouzupełnianie, VoiceOver) zawsze wie, co to za pole, a dotknięcie nazwy ustawia kursor.
 */
export function Field(props: { label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  const id = useId();
  const described = props.error || props.hint ? `${id}-opis` : undefined;
  const child = isValidElement(props.children)
    ? cloneElement(props.children as ReactElement<Record<string, unknown>>, {
        'aria-labelledby': `${id}-nazwa`,
        'aria-describedby': described,
        'aria-invalid': props.error ? true : undefined,
      })
    : props.children;
  return (
    <label className={props.error ? 'field field-error' : 'field'}>
      <span className="field-label" id={`${id}-nazwa`}>
        {props.label}
      </span>
      {child}
      {props.error && (
        <span className="field-message" id={described}>
          {props.error}
        </span>
      )}
      {!props.error && props.hint && (
        <span className="field-hint" id={described}>
          {props.hint}
        </span>
      )}
    </label>
  );
}

/**
 * Blokada przewijania strony pod otwartym oknem (SMS, szczegóły, potwierdzenia). iPhone przewija tło mimo okna
 * modalnego, więc strona jest przypinana w miejscu, a po zamknięciu ostatniego okna wraca na to samo miejsce.
 */
let openSheets = 0;
let lockedScroll = 0;

export function lockScroll() {
  if (openSheets++ > 0) return;
  lockedScroll = window.scrollY;
  const body = document.body.style;
  body.position = 'fixed';
  body.top = `-${lockedScroll}px`;
  body.left = '0';
  body.right = '0';
  body.overflow = 'hidden';
}

export function unlockScroll() {
  if (openSheets === 0 || --openSheets > 0) return;
  const body = document.body.style;
  body.position = '';
  body.top = '';
  body.left = '';
  body.right = '';
  body.overflow = '';
  window.scrollTo(0, lockedScroll);
}

export function Sheet(props: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);
  // Tło stoi w miejscu, dopóki okno jest otwarte (także gdy okno zniknie razem z ekranem).
  useEffect(() => {
    if (!props.open) return;
    lockScroll();
    return unlockScroll;
  }, [props.open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onClose={props.onClose}
      onClick={(e) => {
        if (e.target === ref.current) props.onClose();
      }}
    >
      {props.open && (
        <div className="sheet-inner">
          <div className="sheet-head">
            {/* Fokus na tytule: pole formularza otworzyłoby klawiaturę na iPhonie od razu. */}
            <h2 tabIndex={-1} autoFocus>{props.title}</h2>
            <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Zamknij">
              <Icon name="close" />
            </button>
          </div>
          <div className="sheet-body">{props.children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Search(props: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="search">
      <Icon name="search" size={18} />
      <input
        type="search"
        value={props.value}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

export function Chips<T extends string>(props: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
}) {
  return (
    <div className="chips" role="group">
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === props.value ? 'chip active' : 'chip'}
          aria-pressed={o.value === props.value}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
          {o.count ? <span className="chip-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function AddLink({ to, label }: { to: string; label: string }) {
  return (
    <Link className="icon-btn icon-btn-primary" to={to} aria-label={label} title={label}>
      <Icon name="plus" size={24} />
    </Link>
  );
}

export function Loading() {
  return <div className="loading" role="status" aria-label="Wczytywanie" />;
}

export function NotFound({ back }: { back: string }) {
  return (
    <Page title="Nie znaleziono" back={back}>
      <Empty icon="alert" title="Ten rekord nie istnieje lub został usunięty." />
    </Page>
  );
}
