/**
 * Test replacement for `virtual:pwa-register/react`. Unit tests never run a
 * real service worker; Playwright covers registration, update and offline
 * behaviour against the production build.
 */
export interface RegisterSWOptions {
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}

export function useRegisterSW(_options?: RegisterSWOptions) {
  return {
    offlineReady: [false, () => undefined] as [boolean, (value: boolean) => void],
    needRefresh: [false, () => undefined] as [boolean, (value: boolean) => void],
    updateServiceWorker: async (_reloadPage?: boolean) => undefined,
  };
}
