/**
 * Krótkie wibracje przy zakończonych działaniach i potwierdzeniach.
 * Android: Vibration API. iPhone (Safari 17.4+) nie ma tego API, ale przełącznik `<input type="checkbox" switch>`
 * daje systemową haptykę przy przełączeniu, więc przełączamy niewidoczny przełącznik.
 */
export type HapticKind = 'success' | 'error' | 'light';

const PATTERNS: Record<HapticKind, number | number[]> = {
  success: 15,
  light: 8,
  error: [30, 60, 30],
};

let iosSwitch: HTMLLabelElement | null = null;

function tapIosSwitch(): void {
  if (!iosSwitch) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;overflow:hidden;';
    label.append(input);
    document.body.append(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

export function haptic(kind: HapticKind = 'success'): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(PATTERNS[kind]);
      return;
    }
    if (typeof document !== 'undefined') {
      tapIosSwitch();
      // Błąd: dwa krótkie stuknięcia.
      if (kind === 'error') setTimeout(tapIosSwitch, 120);
    }
  } catch {
    // Haptyka to tylko dodatek: bez niej wszystko działa tak samo.
  }
}

/** Co jest „dotknięciem opcji”: przyciski, linki (np. wiersz zlecenia), opcje wyboru, przełączniki. */
const TAPPABLE = 'button, a[href], [role="option"], [role="tab"], .chip, .choice-item, summary, label.check, input[type="checkbox"]:not([switch]), input[type="radio"]';

let tapsInstalled = false;

/**
 * Lekka haptyka przy każdym dotknięciu przycisku, opcji albo wiersza (np. zlecenia) i przy wyborze z listy.
 * Jeden nasłuch na cały dokument, więc działa też na ekranach dodanych później. Tylko prawdziwe dotknięcia
 * (isTrusted): kliknięcie niewidocznego przełącznika iPhone'a nie wywołuje kolejnej haptyki.
 */
export function installTapHaptics(): void {
  if (tapsInstalled || typeof document === 'undefined') return;
  tapsInstalled = true;
  document.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return;
      const target = e.target.closest(TAPPABLE);
      if (!target || target.matches(':disabled, [aria-disabled="true"]')) return;
      haptic('light');
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    'change',
    (e) => {
      if (e.isTrusted && e.target instanceof HTMLSelectElement) haptic('light');
    },
    { capture: true, passive: true },
  );
}
