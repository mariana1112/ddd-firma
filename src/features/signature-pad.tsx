import { useEffect, useRef } from 'react';

const WIDTH = 360;
const HEIGHT = 150;
const SCALE = 2;

/** Podpis palcem. Wynik to PNG data URL albo null, gdy pole jest puste. */
export function SignaturePad(props: { value: string | null; onChange: (value: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2.2 * SCALE;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#14213d';
    if (props.value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, WIDTH * SCALE, HEIGHT * SCALE);
      img.src = props.value;
    }
    // Istniejący podpis rysujemy tylko raz; później płótno samo jest źródłem obrazu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * WIDTH * SCALE,
      y: ((e.clientY - rect.top) / rect.height) * HEIGHT * SCALE,
    };
  };

  const line = (to: { x: number; y: number }) => {
    const ctx = canvasRef.current?.getContext('2d');
    const from = last.current ?? to;
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x + 0.01, to.y);
    ctx.stroke();
    last.current = to;
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (canvasRef.current) props.onChange(canvasRef.current.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    props.onChange(null);
  };

  return (
    <div className="signature">
      <canvas
        ref={canvasRef}
        width={WIDTH * SCALE}
        height={HEIGHT * SCALE}
        aria-label="Pole podpisu"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = null;
          line(point(e));
        }}
        onPointerMove={(e) => {
          if (drawing.current) line(point(e));
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <button type="button" className="link" onClick={clear}>
        Wyczyść podpis
      </button>
    </div>
  );
}
