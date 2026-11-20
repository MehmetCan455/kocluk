import { useEffect, useRef, useState } from 'react';

/**
 * Creates one object URL per stable identity key and reuses it while the key
 * stays the same. IndexedDB hands back a fresh Blob instance on every read, so
 * keying by the Blob object itself would recreate every image URL on each
 * live-query write and make the UI flicker.
 *
 * The current Blob is kept in a ref; a key change always picks up the latest
 * blob without adding the blob instance to the effect dependencies.
 */
export function useStableObjectUrl(
  key: string | undefined,
  blob: Blob | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const blobRef = useRef(blob);
  const urlRef = useRef<string | null>(null);
  const keyRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    blobRef.current = blob;
  }, [blob]);

  const hasBlob = blob !== undefined;

  useEffect(() => {
    if (!key || !hasBlob) {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      keyRef.current = key;
      setUrl(null);
      return;
    }

    if (urlRef.current && keyRef.current === key) {
      return;
    }

    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }

    try {
      const next = URL.createObjectURL(blobRef.current as Blob);
      urlRef.current = next;
      keyRef.current = key;
      setUrl(next);
    } catch (caught: unknown) {
      console.error('Önizleme bağlantısı oluşturulamadı', caught);
      keyRef.current = key;
      setUrl(null);
    }
  }, [key, hasBlob]);

  useEffect(
    () => () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    },
    [],
  );

  return url;
}
