import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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
 * jsdom has no object URL implementation and the Node implementation rejects
 * jsdom/IndexedDB blob-like values. Attachments create a temporary URL for
 * previews and must revoke it again, so a deterministic counter keeps both
 * calls observable in tests.
 */
let objectUrlCounter = 0;

Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  writable: true,
  value: () => `blob:kocluk-test/${++objectUrlCounter}`,
});

Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  writable: true,
  value: () => undefined,
});

/**
 * fake-indexeddb uses the Node structured clone algorithm, which treats jsdom
 * Blob/File wrappers as opaque objects. Real IndexedDB preserves their bytes,
 * and backup round-trip tests need that behavior. The clone below only replaces
 * the algorithm fake-indexeddb calls; Dexie and IndexedDB stay real.
 */
interface JsdomBlobImpl {
  _bytes?: Uint8Array;
}

const { implForWrapper } = require('jsdom/lib/generated/idl/utils.js') as {
  implForWrapper(value: object): JsdomBlobImpl | null;
};
const nativeStructuredClone = globalThis.structuredClone;

function copyBytes(value: ArrayBufferView): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return copy.buffer;
}

function cloneForIndexedDb<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return seen.get(value) as T;
  }

  if (value instanceof Blob) {
    const bytes = implForWrapper(value)?._bytes;
    if (!bytes) {
      return nativeStructuredClone(value);
    }
    const copied = copyBytes(bytes);
    if (value instanceof File) {
      return new File([copied], value.name, {
        type: value.type,
        lastModified: value.lastModified,
      }) as T;
    }
    return new Blob([copied], { type: value.type }) as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T;
  }
  if (ArrayBuffer.isView(value)) {
    const copied = copyBytes(value);
    if (value instanceof DataView) {
      return new DataView(copied) as T;
    }
    const TypedArray = value.constructor as new (buffer: ArrayBuffer) => ArrayBufferView;
    return new TypedArray(copied) as T;
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const item of value) {
      clone.push(cloneForIndexedDb(item, seen));
    }
    return clone as T;
  }
  if (value instanceof Map) {
    const clone = new Map();
    seen.set(value, clone);
    for (const [key, item] of value) {
      clone.set(cloneForIndexedDb(key, seen), cloneForIndexedDb(item, seen));
    }
    return clone as T;
  }
  if (value instanceof Set) {
    const clone = new Set();
    seen.set(value, clone);
    for (const item of value) {
      clone.add(cloneForIndexedDb(item, seen));
    }
    return clone as T;
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as T;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) {
    const clone: Record<string, unknown> = {};
    seen.set(value, clone);
    for (const [key, item] of Object.entries(value)) {
      clone[key] = cloneForIndexedDb(item, seen);
    }
    return clone as T;
  }

  return nativeStructuredClone(value);
}

globalThis.structuredClone = ((value: unknown) =>
  cloneForIndexedDb(value)) as typeof structuredClone;
