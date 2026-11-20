export const IMAGE_TYPE_ERROR = 'Bu görsel formatı desteklenmiyor';

const JPEG_TYPE = 'image/jpeg';
const DEFAULT_MAX_DIM = 1600;
const DEFAULT_QUALITY = 0.82;
const THUMB_MAX_DIM = 400;
const THUMB_QUALITY = 0.7;

export interface CompressedImage {
  blob: Blob;
  thumbBlob: Blob;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

function isSupportedImage(file: File): boolean {
  if (!file.type.startsWith('image/')) {
    return false;
  }
  // iOS Safari cannot decode HEIC/HEIF through createImageBitmap and Android
  // browsers report the same error; fail before touching the decoder.
  return !/^image\/(heic|heif)$/i.test(file.type);
}

/** Scales down to the longest edge; small images are never upscaled. */
function scaledSize(width: number, height: number, maxDim: number): Size {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) {
    throw new Error(IMAGE_TYPE_ERROR);
  }
  if (longest <= maxDim) {
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  }
  const ratio = maxDim / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function renderJpeg(bitmap: ImageBitmap, size: Size, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error(IMAGE_TYPE_ERROR);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, size.width, size.height);

  return new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      reject(new Error(IMAGE_TYPE_ERROR));
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error(IMAGE_TYPE_ERROR));
        }
      },
      JPEG_TYPE,
      quality,
    );
  });
}

/**
 * Converts a picked image to a compressed JPEG plus a small thumbnail. The
 * original file is never stored. Any decode/encode failure surfaces as one
 * user-friendly Turkish message so callers do not have to translate browser
 * specific errors (HEIC is the most common case on phones).
 */
export async function compressImage(
  file: File,
  maxDim = DEFAULT_MAX_DIM,
  quality = DEFAULT_QUALITY,
): Promise<CompressedImage> {
  if (!isSupportedImage(file)) {
    throw new Error(IMAGE_TYPE_ERROR);
  }

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (!bitmap.width || !bitmap.height) {
      throw new Error(IMAGE_TYPE_ERROR);
    }

    const size = scaledSize(bitmap.width, bitmap.height, maxDim);
    const thumbSize = scaledSize(bitmap.width, bitmap.height, THUMB_MAX_DIM);
    const blob = await renderJpeg(bitmap, size, quality);
    const thumbBlob = await renderJpeg(bitmap, thumbSize, THUMB_QUALITY);

    return { blob, thumbBlob, width: size.width, height: size.height };
  } catch (caught: unknown) {
    if (caught instanceof Error && caught.message === IMAGE_TYPE_ERROR) {
      throw caught;
    }
    throw new Error(IMAGE_TYPE_ERROR);
  } finally {
    bitmap?.close();
  }
}
