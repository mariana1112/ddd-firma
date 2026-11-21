// Pisanie na telefonie: dopóki klawiatura jest otwarta, dolny pasek (Pulpit, Kalendarz…) się chowa, żeby zostało
// więcej miejsca na formularz. Atrybut <html data-typing> ustawiamy tu, a CSS chowa pasek tylko na telefonie
// (wąski ekran, dotyk). Na komputerze nic się nie zmienia.

/** Pola, przy których telefon otwiera klawiaturę (bez list wyboru, dat i przełączników: te mają własne okienka). */
const NO_KEYBOARD = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'date', 'time', 'datetime-local', 'month', 'week', 'hidden', 'image']);

export function opensKeyboard(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return !NO_KEYBOARD.has(el.type) && !el.readOnly && !el.disabled;
  return el instanceof HTMLElement && el.isContentEditable;
}

export function installTypingWatch() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const vv = window.visualViewport;
  // Wysokość widoku bez klawiatury i to, czy klawiatura (zmniejszony widok) już się pojawiła w tym pisaniu.
  let base = vv?.height ?? 0;
  let shrunk = false;
  const set = (on: boolean) => {
    if (on) root.setAttribute('data-typing', '');
    else root.removeAttribute('data-typing');
  };
  const typing = () => root.hasAttribute('data-typing');

  document.addEventListener('focusin', (e) => {
    if (!opensKeyboard(e.target as Element)) return;
    shrunk = false;
    set(true);
  });
  document.addEventListener('focusout', (e) => {
    // Przejście do następnego pola: pasek zostaje schowany.
    if (opensKeyboard(e.relatedTarget as Element | null)) return;
    set(false);
  });
  if (!vv) return;
  vv.addEventListener('resize', () => {
    // Powiększenie palcami też zmniejsza widok, ale to nie klawiatura.
    if (vv.scale > 1.05) return;
    const open = vv.height < base - 120;
    if (typing()) {
      if (open) shrunk = true;
      // Klawiatura zamknięta (np. „wstecz” na Androidzie), a pole dalej zaznaczone: pasek wraca.
      else if (shrunk) set(false);
      return;
    }
    if (open && opensKeyboard(document.activeElement)) {
      // Ponowne dotknięcie zaznaczonego pola otwiera klawiaturę bez nowego „focusin”.
      shrunk = true;
      set(true);
      return;
    }
    if (!open) base = vv.height;
  });
  window.addEventListener('orientationchange', () => {
    shrunk = false;
    base = 0;
    setTimeout(() => {
      if (!typing()) base = vv.height;
    }, 500);
  });
}
