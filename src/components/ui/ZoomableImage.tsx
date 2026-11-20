import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from './Button';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SCALE_STEP = 0.25;

interface Point {
  x: number;
  y: number;
}

interface DragState {
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

interface PinchState {
  distance: number;
  scale: number;
}

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function formatScale(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export interface ZoomableImageProps {
  src: string;
  alt: string;
}

/**
 * Full-screen zoom viewer for note images. Supports buttons, wheel, double
 * click, drag-to-pan and two-finger pinch. The image is already compressed on
 * upload; this viewer never changes stored data.
 */
export function ZoomableImage({ src, alt }: ZoomableImageProps) {
  const [scale, setScale] = useState(MIN_SCALE);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const dragRef = useRef<DragState | null>(null);
  const pinchRef = useRef<PinchState | null>(null);

  useEffect(() => {
    if (scale === MIN_SCALE) {
      setOffset({ x: 0, y: 0 });
    }
  }, [scale]);

  const changeScale = useCallback((delta: number) => {
    setScale((current) => clampScale(current + delta));
  }, []);

  const reset = useCallback(() => {
    setScale(MIN_SCALE);
    setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      changeScale(event.deltaY < 0 ? SCALE_STEP : -SCALE_STEP);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [changeScale]);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 1 && scale > MIN_SCALE) {
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        offsetX: offset.x,
        offsetY: offset.y,
      };
      setDragging(true);
    } else if (pointersRef.current.size === 2) {
      dragRef.current = null;
      setDragging(false);
      const [first, second] = Array.from(pointersRef.current.values());
      pinchRef.current = {
        distance: distance(first, second),
        scale,
      };
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2 && pinchRef.current) {
      const [first, second] = Array.from(pointersRef.current.values());
      const nextDistance = distance(first, second);
      if (pinchRef.current.distance > 0) {
        setScale(
          clampScale(pinchRef.current.scale * (nextDistance / pinchRef.current.distance)),
        );
      }
      return;
    }

    if (pointersRef.current.size === 1 && dragRef.current && scale > MIN_SCALE) {
      setOffset({
        x: dragRef.current.offsetX + (event.clientX - dragRef.current.startX),
        y: dragRef.current.offsetY + (event.clientY - dragRef.current.startY),
      });
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (pointersRef.current.size === 0) {
      dragRef.current = null;
      setDragging(false);
    } else if (pointersRef.current.size === 1) {
      const [point] = Array.from(pointersRef.current.values());
      dragRef.current = {
        startX: point.x,
        startY: point.y,
        offsetX: offset.x,
        offsetY: offset.y,
      };
    }
  }

  function handleDoubleClick() {
    if (scale === MIN_SCALE) {
      setScale(2);
    } else {
      reset();
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      changeScale(SCALE_STEP);
    } else if (event.key === '-') {
      event.preventDefault();
      changeScale(-SCALE_STEP);
    } else if (event.key === '0') {
      event.preventDefault();
      reset();
    }
  }

  const cursor = scale > MIN_SCALE ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in';

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <div
        ref={containerRef}
        role="group"
        aria-label="Görsel görüntüleyici"
        tabIndex={0}
        className={`absolute inset-0 flex touch-none items-center justify-center overscroll-contain outline-none ${cursor}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full select-none object-contain"
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transition: dragging ? 'none' : 'transform 120ms ease-out',
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 p-3 sm:p-4">
        <p className="rounded-full bg-black/50 px-3 py-1 text-xs text-white/70">
          Sürükle · çift tıkla veya iki parmakla yakınlaştır
        </p>
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/15 bg-black/75 px-2 py-1 text-white shadow-lg backdrop-blur">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Uzaklaştır"
            disabled={scale <= MIN_SCALE}
            onClick={() => changeScale(-SCALE_STEP)}
            className="!text-white hover:!bg-white/15"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="min-w-12 text-center text-xs font-semibold tabular-nums" aria-live="polite">
            {formatScale(scale)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Yakınlaştır"
            disabled={scale >= MAX_SCALE}
            onClick={() => changeScale(SCALE_STEP)}
            className="!text-white hover:!bg-white/15"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="mx-1 h-5 w-px bg-white/20" aria-hidden="true" />
          <Button
            variant="ghost"
            size="sm"
            aria-label="Sıfırla"
            disabled={scale === MIN_SCALE}
            onClick={reset}
            className="!text-white hover:!bg-white/15"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </Button>
          <a
            href={src}
            target="_blank"
            rel="noreferrer"
            aria-label="Yeni sekmede aç"
            className="grid h-11 w-11 place-items-center rounded-lg text-white transition-colors hover:bg-white/15"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  );
}
