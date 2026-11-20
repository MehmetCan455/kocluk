import { beforeEach, expect, test, vi } from 'vitest';
import { IMAGE_TYPE_ERROR, compressImage } from './image';

interface FakeBitmap {
  width: number;
  height: number;
  close: ReturnType<typeof vi.fn>;
}

interface CanvasCall {
  width: number;
  height: number;
  type?: string;
  quality?: number;
}

let createBitmapMock: ReturnType<typeof vi.fn>;
let canvasCalls: CanvasCall[];

function stubBitmap(width: number, height: number): FakeBitmap {
  const bitmap: FakeBitmap = { width, height, close: vi.fn() };
  createBitmapMock.mockResolvedValueOnce(bitmap);
  return bitmap;
}

beforeEach(() => {
  canvasCalls = [];
  createBitmapMock = vi.fn();
  vi.stubGlobal('createImageBitmap', createBitmapMock);

  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    writable: true,
    value: vi.fn(function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
      quality?: number,
    ) {
      canvasCalls.push({
        width: this.width,
        height: this.height,
        type,
        quality,
      });
      callback(new Blob(['jpeg'], { type: type ?? 'image/png' }));
    }),
  });
});

test('uzun kenarı 1600 px olacak şekilde JPEG sıkıştırır ve 400 px küçük resim üretir', async () => {
  const bitmap = stubBitmap(2000, 1000);
  const file = new File(['png-içeriği'], 'soru.png', { type: 'image/png' });

  const result = await compressImage(file);

  expect(createBitmapMock).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
  expect(result.width).toBe(1600);
  expect(result.height).toBe(800);
  expect(result.blob.type).toBe('image/jpeg');
  expect(result.thumbBlob.type).toBe('image/jpeg');
  expect(canvasCalls.map((call) => [call.width, call.height])).toEqual([
    [1600, 800],
    [400, 200],
  ]);
  expect(canvasCalls[0].type).toBe('image/jpeg');
  expect(canvasCalls[0].quality).toBeCloseTo(0.82);
  expect(bitmap.close).toHaveBeenCalledTimes(1);
});

test('küçük görseli büyütmez ve özel sınır/kalite değerlerini kullanır', async () => {
  stubBitmap(320, 240);

  const result = await compressImage(
    new File(['x'], 'kucuk.webp', { type: 'image/webp' }),
    2000,
    0.85,
  );

  expect(result.width).toBe(320);
  expect(result.height).toBe(240);
  expect(canvasCalls[0]).toMatchObject({ width: 320, height: 240, type: 'image/jpeg', quality: 0.85 });
  expect(canvasCalls[1]).toMatchObject({ width: 320, height: 240 });
});

test('dikey görselde uzun kenar yüksekliği sınırlar', async () => {
  stubBitmap(1200, 2400);

  const result = await compressImage(new File(['x'], 'dikey.jpg', { type: 'image/jpeg' }));

  expect(result.width).toBe(800);
  expect(result.height).toBe(1600);
  expect(canvasCalls[0]).toMatchObject({ width: 800, height: 1600 });
});

test('HEIC, PDF ve boş türde Türkçe desteklenmiyor hatası verir', async () => {
  await expect(
    compressImage(new File(['x'], 'foto.heic', { type: 'image/heic' })),
  ).rejects.toThrow(IMAGE_TYPE_ERROR);
  await expect(
    compressImage(new File(['x'], 'foto.heif', { type: 'image/heif' })),
  ).rejects.toThrow(IMAGE_TYPE_ERROR);
  await expect(
    compressImage(new File(['x'], 'belge.pdf', { type: 'application/pdf' })),
  ).rejects.toThrow(IMAGE_TYPE_ERROR);
  await expect(
    compressImage(new File(['x'], 'bilinmeyen', { type: '' })),
  ).rejects.toThrow('Bu görsel formatı desteklenmiyor');

  expect(createBitmapMock).not.toHaveBeenCalled();
});

test('createImageBitmap başarısız olduğunda Türkçe hata verir', async () => {
  createBitmapMock.mockRejectedValueOnce(new Error('decode failed'));

  await expect(
    compressImage(new File(['x'], 'bozuk.jpg', { type: 'image/jpeg' })),
  ).rejects.toThrow('Bu görsel formatı desteklenmiyor');
});

test('toBlob boş döndürdüğünde Türkçe hata verir ve bitmap kapatılır', async () => {
  const bitmap = stubBitmap(800, 600);
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    configurable: true,
    writable: true,
    value: vi.fn((callback: BlobCallback) => callback(null)),
  });

  await expect(
    compressImage(new File(['x'], 'soru.jpg', { type: 'image/jpeg' })),
  ).rejects.toThrow('Bu görsel formatı desteklenmiyor');
  expect(bitmap.close).toHaveBeenCalledTimes(1);
});
