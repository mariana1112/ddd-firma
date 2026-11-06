import type { TDocumentDefinitions } from 'pdfmake/interfaces';

// pdfmake z czcionkami waży około 2 MB, więc ładuje się dopiero przy pierwszym dokumencie.
// Service worker i tak trzyma te pliki w pamięci podręcznej, więc działa to też offline.
let loaded: Promise<typeof import('pdfmake/build/pdfmake')> | undefined;

function loadPdfMake() {
  loaded ??= Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]).then(
    ([pdfMakeModule, fontsModule]) => {
      const pdfMake = ((pdfMakeModule as { default?: unknown }).default ?? pdfMakeModule) as typeof import('pdfmake/build/pdfmake');
      const vfs = (fontsModule as { default?: unknown }).default ?? fontsModule;
      pdfMake.addVirtualFileSystem(vfs as Parameters<typeof pdfMake.addVirtualFileSystem>[0]);
      return pdfMake;
    },
  );
  return loaded;
}

export async function renderPdf(definition: TDocumentDefinitions): Promise<Blob> {
  const pdfMake = await loadPdfMake();
  return pdfMake.createPdf(definition).getBlob();
}

export function pdfFileName(prefix: string, number: string): string {
  return `${prefix}-${number.replace(/[^\w-]+/g, '-')}.pdf`;
}
