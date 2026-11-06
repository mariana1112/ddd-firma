// Zdjęcia zmniejszamy przed zapisem, żeby baza i kopie zapasowe nie puchły.

async function loadImage(source: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(source);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    // Obraz po decode() jest już w pamięci.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function drawScaled(img: HTMLImageElement, maxSize: number, background?: string): HTMLCanvasElement {
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Nie udało się przetworzyć obrazu.');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function resizePhoto(file: Blob, maxSize = 1600, quality = 0.8): Promise<Blob> {
  const canvas = drawScaled(await loadImage(file), maxSize, '#ffffff');
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Nie udało się przetworzyć zdjęcia.'))),
      'image/jpeg',
      quality,
    );
  });
}

/** Logo jako PNG data URL, bo pdfmake przyjmuje tylko JPEG i PNG. */
export async function imageToPngDataUrl(file: Blob, maxSize = 480): Promise<string> {
  return drawScaled(await loadImage(file), maxSize).toDataURL('image/png');
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
