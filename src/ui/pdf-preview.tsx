import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

/**
 * Podgląd wydruku PDF przed udostępnieniem, pobraniem albo drukiem. Strony rysuje pdf.js (biblioteka Mozilli)
 * na obrazkach, bo wbudowany podgląd PDF na telefonach nie działa (Android) albo pokazuje tylko pierwszą stronę
 * (iPhone). Biblioteka ładuje się dopiero przy pierwszym podglądzie.
 */
async function renderPages(blob: Blob, container: HTMLElement, isCancelled: () => boolean): Promise<number> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  const width = Math.max(240, container.clientWidth - 24);
  // Podwójna rozdzielczość: po „Powiększ” (2× szerzej) tekst dalej jest ostry.
  const ratio = Math.min(window.devicePixelRatio || 1, 2) * 2;
  for (let n = 1; n <= doc.numPages; n++) {
    if (isCancelled()) break;
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (width / base.width) * ratio });
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.setAttribute('aria-label', `Strona ${n} z ${doc.numPages}`);
    container.append(canvas);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
  }
  const pages = doc.numPages;
  void doc.destroy();
  return pages;
}

/** Druk na komputerze: PDF w ukrytej ramce i systemowe okno drukowania. */
function printBlob(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.className = 'print-frame';
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, '_blank');
    }
  };
  document.body.append(frame);
  setTimeout(() => {
    frame.remove();
    URL.revokeObjectURL(url);
  }, 5 * 60_000);
}

export function PdfPreview(props: { blob: Blob; filename: string; touch: boolean; onShare: () => void; onClose: () => void }) {
  const pages = useRef<HTMLDivElement>(null);
  // Okno systemowe (dialog) leży w warstwie nad wszystkimi okienkami aplikacji: PDF z „Więcej opcji” (też okienka)
  // pokazuje się nad nim, a nie pod spodem.
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; count: number }>({ status: 'loading', count: 0 });
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    const container = pages.current;
    if (!container) return;
    let cancelled = false;
    container.replaceChildren();
    renderPages(props.blob, container, () => cancelled)
      .then((count) => !cancelled && setState({ status: 'ready', count }))
      .catch(() => !cancelled && setState({ status: 'error', count: 0 }));
    return () => {
      cancelled = true;
    };
  }, [props.blob]);

  return (
    <dialog
      ref={dialog}
      className="pdf-preview"
      aria-label="Podgląd wydruku"
      // Esc (komputer) zamyka podgląd tak samo jak krzyżyk.
      onCancel={(e) => {
        e.preventDefault();
        props.onClose();
      }}
    >
      <div className="pdf-preview-head">
        <span>
          <strong>Podgląd wydruku</strong>
          <small>
            {props.filename}
            {state.status === 'ready' ? ` · ${state.count} ${state.count === 1 ? 'strona' : state.count < 5 ? 'strony' : 'stron'}` : ''}
          </small>
        </span>
        <button type="button" className="btn btn-sm" aria-pressed={zoom} onClick={() => setZoom(!zoom)}>
          {zoom ? 'Pomniejsz' : 'Powiększ'}
        </button>
        <button type="button" className="icon-btn" aria-label="Zamknij podgląd" onClick={props.onClose}>
          <Icon name="close" size={22} />
        </button>
      </div>
      <div className="pdf-preview-body">
        {state.status === 'loading' && <div className="loading" role="status" aria-label="Przygotowuję podgląd" />}
        {state.status === 'error' && <p className="field-hint">Nie udało się pokazać podglądu. Plik możesz i tak udostępnić albo pobrać.</p>}
        <div ref={pages} className={zoom ? 'pdf-pages pdf-pages-zoom' : 'pdf-pages'} />
      </div>
      <div className="pdf-preview-foot">
        {props.touch ? (
          <>
            <button type="button" className="btn btn-primary" onClick={props.onShare}>
              <Icon name="share" /> Udostępnij, zapisz lub drukuj
            </button>
            <p className="field-hint">Drukowanie: w oknie udostępniania wybierz „Drukuj”.</p>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-primary" onClick={() => printBlob(props.blob)}>
              <Icon name="file" /> Drukuj
            </button>
            <button type="button" className="btn" onClick={props.onShare}>
              Pobierz plik
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
