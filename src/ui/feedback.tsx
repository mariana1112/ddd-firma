import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { haptic } from '../lib/haptics';
import { BackupError } from '../data/backup';
import { DomainError } from '../data/domain';
import { CryptoError } from '../data/sync/crypto';
import { SyncError } from '../data/sync/engine';
import { Sheet } from './kit';
import { Icon } from './icons';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastState {
  id: number;
  message: string;
  tone: 'default' | 'error';
  action?: ToastAction;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  /** Napis drugiego przycisku; domyślnie „Anuluj”. */
  cancelLabel?: string;
  danger?: boolean;
}

interface FeedbackApi {
  toast: (message: string, options?: { action?: ToastAction; tone?: ToastState['tone'] }) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  deliverFile: (blob: Blob, filename: string) => void;
  /** Uruchamia operację i pokazuje błąd po polsku zamiast rzucać go dalej. */
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
}

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const api = useContext(FeedbackContext);
  if (!api) throw new Error('Brak FeedbackProvider');
  return api;
}

const isTouch = () => window.matchMedia('(pointer: coarse)').matches;

function downloadFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toastState, setToast] = useState<ToastState | null>(null);
  const [confirmState, setConfirm] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const [file, setFile] = useState<{ blob: Blob; filename: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const nextId = useRef(1);

  const toast = useCallback<FeedbackApi['toast']>((message, options) => {
    window.clearTimeout(timer.current);
    // Każde zakończone działanie (zapis, wysłanie, usunięcie) i każdy błąd czuć w dłoni.
    haptic(options?.tone === 'error' ? 'error' : 'success');
    setToast({ id: nextId.current++, message, tone: options?.tone ?? 'default', action: options?.action });
    timer.current = window.setTimeout(() => setToast(null), options?.action ? 7000 : 3500);
  }, []);

  const confirm = useCallback<FeedbackApi['confirm']>(
    (options) => {
      haptic('light');
      return new Promise((resolve) => setConfirm({ ...options, resolve }));
    },
    [],
  );

  const deliverFile = useCallback<FeedbackApi['deliverFile']>((blob, filename) => {
    // iOS pozwala otworzyć arkusz udostępniania tylko bezpośrednio po dotknięciu, a generowanie
    // pliku trwa dłużej. Dlatego na telefonie użytkownik dotyka jeszcze raz, gdy plik jest gotowy.
    if (isTouch()) setFile({ blob, filename });
    else downloadFile(blob, filename);
  }, []);

  /** Nieznany błąd: bez internetu prosto o połączeniu, w innym razie z krótką przyczyną, żeby dało się powiedzieć, co się stało. */
  const unknownErrorText = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/fetch|network|load failed/i.test(message) || navigator.onLine === false) return 'Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.';
    const reason = message.trim().slice(0, 140);
    return reason ? `Operacja się nie powiodła (${reason}). Spróbuj ponownie.` : 'Operacja się nie powiodła. Spróbuj ponownie.';
  };

  const run = useCallback<FeedbackApi['run']>(
    async (action) => {
      try {
        return await action();
      } catch (error) {
        console.error(error);
        const known =
          error instanceof DomainError ||
          error instanceof BackupError ||
          error instanceof SyncError ||
          error instanceof CryptoError;
        toast(known ? (error as Error).message : unknownErrorText(error), { tone: 'error' });
        return undefined;
      }
    },
    [toast],
  );

  const api = useMemo(() => ({ toast, confirm, deliverFile, run }), [toast, confirm, deliverFile, run]);

  const closeConfirm = (ok: boolean) => {
    confirmState?.resolve(ok);
    setConfirm(null);
  };

  const shareFile = async () => {
    if (!file) return;
    const shareable = new File([file.blob], file.filename, { type: file.blob.type });
    if (navigator.canShare?.({ files: [shareable] })) {
      try {
        await navigator.share({ files: [shareable] });
        setFile(null);
        return;
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
      }
    }
    downloadFile(file.blob, file.filename);
    setFile(null);
  };

  return (
    <FeedbackContext.Provider value={api}>
      {children}
      {toastState && (
        <div key={toastState.id} className={`toast toast-${toastState.tone}`} role="status">
          <span>{toastState.message}</span>
          {toastState.action && (
            <button
              type="button"
              onClick={() => {
                toastState.action?.onClick();
                setToast(null);
              }}
            >
              {toastState.action.label}
            </button>
          )}
        </div>
      )}
      <Sheet open={Boolean(confirmState)} title={confirmState?.title ?? ''} onClose={() => closeConfirm(false)}>
        <p className="sheet-text">{confirmState?.message}</p>
        <div className="btn-stack">
          <button
            type="button"
            className={confirmState?.danger ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={() => {
              haptic('success');
              closeConfirm(true);
            }}
          >
            {confirmState?.confirmLabel}
          </button>
          <button type="button" className="btn" onClick={() => closeConfirm(false)}>
            {confirmState?.cancelLabel ?? 'Anuluj'}
          </button>
        </div>
      </Sheet>
      <Sheet open={Boolean(file)} title="Plik gotowy" onClose={() => setFile(null)}>
        <p className="sheet-text break">{file?.filename}</p>
        <button type="button" className="btn btn-primary btn-block" onClick={shareFile}>
          <Icon name="file" /> Udostępnij lub zapisz
        </button>
      </Sheet>
    </FeedbackContext.Provider>
  );
}
