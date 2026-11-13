import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { NotificationListenerStatusDTO, WindowsNotificationSettingsDTO } from '../../shared/dtos';
import { createDefaultNotificationSettings } from '../../shared/notification-defaults';
import { useAutoSave } from './useAutoSave';
import { AutoSaveStatus } from './auto-save-scheduler';

/** How often the listener's state is read while a page shows it. */
export const LISTENER_STATUS_POLL_MS = 3000;

/** The levels a Default and a High Priority app are shown at, from the priority rules. */
export interface NotificationLevels {
  defaultScore: number;
  highScore: number;
}

export interface NotificationSettingsStore {
  settings: WindowsNotificationSettingsDTO;
  setSettings: Dispatch<SetStateAction<WindowsNotificationSettingsDTO>>;
  saveStatus: AutoSaveStatus;
  levels: NotificationLevels;
}

/**
 * The Windows notification settings, read once and saved as they change.
 *
 * One object, saved whole: a page that shows parts of it in several places
 * (Desk devices: the switch, the apps, the two timings) must share one store,
 * or two copies would each save over the other's edits.
 */
export const useNotificationSettings = (onSaved?: () => void): NotificationSettingsStore => {
  // Seeded from the shared defaults rather than a local copy. The copy that
  // used to live in the view disagreed with the main process on which apps
  // were HIGH_PRIORITY, so the effective default depended on which process
  // wrote to the database first.
  const [settings, setSettings] = useState<WindowsNotificationSettingsDTO>(createDefaultNotificationSettings);
  // With no stored settings to read there is nothing to wait for; loaded is
  // otherwise set once the read settles.
  const [loaded, setLoaded] = useState<boolean>(() => !window.electronAPI?.getNotificationSettings);
  const [levels, setLevels] = useState<NotificationLevels>({ defaultScore: 40, highScore: 95 });

  useEffect(() => {
    window.electronAPI?.getNotificationSettings?.()
      .then(res => {
        if (res && Array.isArray(res.sourceRules)) setSettings(res);
      })
      .catch(err => console.error('[useNotificationSettings] Error fetching settings:', err))
      // Auto-save is gated on this: the defaults include a full sourceRules
      // table, and writing that over the stored one would discard every
      // per-app priority the user had set.
      .finally(() => setLoaded(true));

    window.electronAPI?.getPriorityRules?.()
      .then(res => {
        const obj = res as unknown as { rules?: Array<{ eventName: string; priority: number }> };
        const list = Array.isArray(res) ? res : Array.isArray(obj?.rules) ? obj.rules : [];
        const level = (event: string) => list.find(r => r.eventName === event)?.priority;
        setLevels(prev => ({
          defaultScore: level('messagingPriority') ?? prev.defaultScore,
          highScore: level('highNotificationPriority') ?? prev.highScore
        }));
      })
      // The levels only label the choices; the defaults read just as well.
      .catch(err => console.warn('[useNotificationSettings] Could not read the priority levels:', err));
  }, []);

  const saveStatus = useAutoSave(async () => {
    await window.electronAPI?.saveNotificationSettings?.(settings);
    onSaved?.();
  }, [settings], loaded);

  return { settings, setSettings, saveStatus, levels };
};

/**
 * The listener's state, read now and every few seconds while mounted: after
 * "Grant access" the user comes back from Windows' settings, and the row
 * should say so without a reload.
 */
export const useNotificationListenerStatus = (): NotificationListenerStatusDTO | null => {
  const [status, setStatus] = useState<NotificationListenerStatusDTO | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getNotificationListenerStatus) return undefined;
    let live = true;
    const read = () => {
      api.getNotificationListenerStatus()
        .then(res => { if (live && res?.status) setStatus(res.status); })
        .catch(err => console.warn('[useNotificationListenerStatus] Could not read the listener:', err));
    };
    read();
    const timer = setInterval(read, LISTENER_STATUS_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  return status;
};
