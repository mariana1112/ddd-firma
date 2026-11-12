import { useState } from 'react';

const KEY = 'ddd:raport-z-km';

/** Czy raport (ekran i PDF) pokazuje kilometry. Domyślnie bez; wybór zostaje na tym telefonie. */
export function useReportKm(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = (next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      // Bez pamięci przeglądarki wybór działa do zamknięcia ekranu.
    }
  };
  return [value, set];
}
