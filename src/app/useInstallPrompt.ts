import { useCallback, useEffect, useState } from 'react';

/**
 * The `beforeinstallprompt` event is not in the DOM lib. Chromium fires it once
 * the app is installable; calling `prompt()` must happen from a user gesture.
 */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;

export interface InstallPromptState {
  canInstall: boolean;
  promptInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

/**
 * Shared installability state. Both the shell banner and the Settings guide use
 * this hook, so whichever mounts after the browser event still sees it.
 */
export function useInstallPrompt(): InstallPromptState {
  const [available, setAvailable] = useState(() => deferredPrompt !== null && !installed);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      deferredPrompt = event as BeforeInstallPromptEvent;
      installed = false;
      setAvailable(true);
    };
    const onInstalled = () => {
      deferredPrompt = null;
      installed = true;
      setAvailable(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const prompt = deferredPrompt;
    if (!prompt || installed) {
      return 'unavailable' as const;
    }
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        deferredPrompt = null;
        installed = true;
        setAvailable(false);
      }
      return choice.outcome;
    } catch (error: unknown) {
      console.error('Kurulum istemi gösterilemedi', error);
      return 'unavailable' as const;
    }
  }, []);

  return { canInstall: available, promptInstall };
}
