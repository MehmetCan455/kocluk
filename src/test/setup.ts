import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

/**
 * jsdom has no canvas implementation. Chart.js only needs a 2D context that
 * accepts the drawing calls; the DOM assertions in tests do not inspect pixels.
 */
function createCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const noop = () => undefined;
  const gradient = { addColorStop: noop };
  const context: Record<string, unknown> = {
    canvas,
    save: noop,
    restore: noop,
    resetTransform: noop,
    setTransform: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    bezierCurveTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    clip: noop,
    fillText: noop,
    strokeText: noop,
    measureText: (text: string) => ({
      width: text.length * 6,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
    }),
    setLineDash: noop,
    getLineDash: () => [],
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    drawImage: noop,
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    direction: 'inherit',
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    lineDashOffset: 0,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
  };
  return context as unknown as CanvasRenderingContext2D;
}

const canvasContexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  writable: true,
  value(this: HTMLCanvasElement) {
    let context = canvasContexts.get(this);
    if (!context) {
      context = createCanvasContext(this);
      canvasContexts.set(this, context);
    }
    return context;
  },
});

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
