import { useEffect, useRef, useState } from 'react';
import { syncInBackground } from '../data/sync/runner';
import { haptic } from '../lib/haptics';
import { checkForUpdates } from '../lib/updates';
import { useFeedback } from './feedback';
import { Icon } from './icons';

/** Jak daleko trzeba pociągnąć (w pikselach po wytłumieniu), żeby puszczenie odświeżyło aplikację. */
const THRESHOLD = 70;
const MAX_PULL = 110;

/** Pola do pisania i otwarte okna nie uruchamiają odświeżania (przewijanie w nich zostaje normalne). */
function blocked(target: EventTarget | null): boolean {
  if (document.body.style.position === 'fixed') return true;
  return target instanceof Element && Boolean(target.closest('textarea, input, select, .sheet, [contenteditable="true"]'));
}

/**
 * „Pociągnij, aby odświeżyć”, jak w większości aplikacji: na górze ekranu pociągnij w dół, poczekaj na strzałkę
 * „Puść, aby odświeżyć” i puść. Aplikacja synchronizuje dane i sprawdza nową wersję.
 */
export function PullToRefresh() {
  const { toast } = useFeedback();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);
  const armed = useRef(false);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (busy || window.scrollY > 0 || e.touches.length !== 1 || blocked(e.target)) {
        start.current = null;
        return;
      }
      start.current = e.touches[0].clientY;
      armed.current = false;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return;
      const dy = e.touches[0].clientY - start.current;
      if (dy <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      const next = Math.min(MAX_PULL, dy * 0.5);
      // Przekroczenie progu czuć w dłoni: od tej chwili puszczenie odświeży.
      if (next >= THRESHOLD && !armed.current) {
        armed.current = true;
        haptic('light');
      } else if (next < THRESHOLD) armed.current = false;
      pullRef.current = next;
      setPull(next);
    };
    const onEnd = () => {
      if (start.current === null) return;
      start.current = null;
      const ready = pullRef.current >= THRESHOLD;
      pullRef.current = 0;
      setPull(0);
      if (!ready) return;
      setBusy(true);
      void (async () => {
        try {
          await syncInBackground().catch(() => undefined);
          const update = await checkForUpdates().catch(() => 'niedostepne' as const);
          toast(update === 'nowa' ? 'Odświeżono. Jest nowa wersja: dotknij „Odśwież” na dole ekranu.' : update === 'offline' ? 'Brak internetu: pokazuję dane z telefonu.' : 'Odświeżono');
        } finally {
          setBusy(false);
        }
      })();
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [busy, toast]);

  if (!busy && pull === 0) return null;
  const ready = pull >= THRESHOLD;
  return (
    <div className="pull-refresh" style={{ transform: `translate(-50%, ${busy ? 56 : pull}px)` }} role="status" aria-live="polite">
      <span className={busy ? 'pull-icon spinning' : 'pull-icon'} style={busy ? undefined : { transform: `rotate(${pull * 3}deg)` }}>
        <Icon name="refresh" size={20} />
      </span>
      <span className="pull-text">{busy ? 'Odświeżam…' : ready ? 'Puść, aby odświeżyć' : 'Pociągnij, aby odświeżyć'}</span>
    </div>
  );
}
