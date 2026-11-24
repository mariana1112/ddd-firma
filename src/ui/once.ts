import { useCallback, useRef, useState } from 'react';

/**
 * Jedno wykonanie naraz: podwójne (albo potrójne) stuknięcie przycisku, który coś tworzy (zlecenie, kolejny zabieg,
 * koszt, przejazd, wiadomość), uruchamiało zapis kilka razy i powstawały duplikaty. Kolejne wywołania w trakcie
 * trwającego zapisu są pomijane. `pending` pozwala wyszarzyć przycisk.
 */
export function useOnce() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const once = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    try {
      return await action();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);
  return { once, pending };
}
