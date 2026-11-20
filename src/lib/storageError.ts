/**
 * Shared storage-failure helpers. IndexedDB reports a full disk with a
 * `QuotaExceededError` DOMException; browsers differ on the name, so both the
 * modern and legacy names are accepted.
 */
export const STORAGE_QUOTA_MESSAGE =
  'Telefonda yeterli yer yok. Bazı fotoğrafları silip tekrar dene.';

export function isStorageQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === 'QuotaExceededError' ||
    candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    candidate.code === 22 ||
    candidate.code === 1014
  );
}
