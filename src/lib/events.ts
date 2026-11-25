/**
 * Cross-layer notifications that are not owned by React.
 *
 * `kocluk:settings-updated` is dispatched after a canonical settings row has
 * been written locally (pull, full sync or an applied push result), so the
 * settings UI can reload without a page refresh. The event carries no payload:
 * listeners re-read the account settings from the active database.
 */

export const SETTINGS_UPDATED_EVENT = 'kocluk:settings-updated';

export function notifySettingsUpdated(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(SETTINGS_UPDATED_EVENT));
}
