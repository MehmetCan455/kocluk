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

class IntersectionObserverStub {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: readonly number[] = [];

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver;
}

/**
 * ProseMirror measures the selection while handling input. jsdom has no layout,
 * so text nodes and ranges need empty rects and hit testing needs a stable
 * target; assertions never inspect geometry.
 */
const emptyRect = {
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
} as DOMRect;

if (typeof Range.prototype.getClientRects !== 'function') {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [],
  });
}

if (typeof Range.prototype.getBoundingClientRect !== 'function') {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => emptyRect,
  });
}

if (!('getClientRects' in Text.prototype)) {
  Object.defineProperty(Text.prototype, 'getClientRects', {
    configurable: true,
    value: () => [],
  });
}

if (!('getBoundingClientRect' in Text.prototype)) {
  Object.defineProperty(Text.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => emptyRect,
  });
}

if (typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => document.body;
}

/**
 * jsdom has no object URL implementation. Attachments create a temporary URL
 * for previews and must revoke it again, so a deterministic counter keeps both
 * calls observable in tests.
 */
let objectUrlCounter = 0;

if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: () => `blob:kocluk-test/${++objectUrlCounter}`,
  });
}

if (typeof URL.revokeObjectURL !== 'function') {
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: () => undefined,
  });
}
