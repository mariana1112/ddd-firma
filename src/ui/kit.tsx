import { useEffect, useRef, type ReactNode } from 'react';
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

export function Page(props: { title: string; back?: string; actions?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = `${props.title} · DDD Firma`;
  }, [props.title]);
  return (
    <div className={props.back ? 'page page-sub' : 'page'}>
      <header className="page-head">
        {props.back && <BackButton fallback={props.back} />}
        <h1>{props.title}</h1>
        <div className="page-actions">{props.actions}</div>
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

export function Row(props: {
  to?: string;
  onClick?: () => void;
  icon?: IconName;
  title: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
}) {
  const interactive = Boolean(props.to || props.onClick);
  const inner = (
    <>
      {props.icon && (
        <span className="row-icon">
          <Icon name={props.icon} />
        </span>
      )}
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
      <Link className="row" to={props.to}>
        {inner}
      </Link>
    );
  }
  if (props.onClick) {
    return (
      <button type="button" className="row" onClick={props.onClick}>
        {inner}
      </button>
    );
  }
  return <div className="row">{inner}</div>;
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

export function Field(props: { label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className={props.error ? 'field field-error' : 'field'}>
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.error && <span className="field-message">{props.error}</span>}
      {!props.error && props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Sheet(props: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
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
