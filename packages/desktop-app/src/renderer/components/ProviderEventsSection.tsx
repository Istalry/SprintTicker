import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { useAutoSave } from '../hooks/useAutoSave';
import { AutoSaveIndicator } from './AutoSaveIndicator';
import {
  DEFAULT_PROVIDER_EVENT_SETTINGS,
  MAX_PROVIDER_EVENT_POLL_SECONDS,
  MIN_PROVIDER_EVENT_POLL_SECONDS,
  PROVIDER_EVENT_KINDS,
  PROVIDER_EVENT_KIND_LABELS,
  ProviderEventKind,
  ProviderEventSettingsDTO
} from '../../shared/provider-events';

export interface ProviderEventsSectionProps {
  /** Shown in the copy: "Notifications from OpenProject". */
  providerName: string;
  /** Without a bar the bar option is not offered. */
  hasBar: boolean;
  /** The kinds this provider can produce; all of them by default. */
  kinds?: readonly ProviderEventKind[];
  /** What this provider's notifications cannot see, when that needs saying. */
  note?: string;
}

/**
 * What the user is told about activity on their tasks in the provider, and
 * how: a Windows toast, a banner on the bar, or both.
 *
 * Saves itself, like the panel around it. Its settings are not the
 * provider's credentials and live under their own key, so it owns its load
 * and its save rather than threading through the provider form.
 */
export const ProviderEventsSection: React.FC<ProviderEventsSectionProps> = ({ providerName, hasBar, kinds = PROVIDER_EVENT_KINDS, note }) => {
  const [settings, setSettings] = useState<ProviderEventSettingsDTO>(DEFAULT_PROVIDER_EVENT_SETTINGS);
  // Nothing to wait for without the bridge.
  const [loaded, setLoaded] = useState<boolean>(() => !window.electronAPI?.getProviderEventSettings);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.getProviderEventSettings) return;
    window.electronAPI.getProviderEventSettings()
      .then(stored => setSettings(stored))
      .catch(err => console.error('[ProviderEventsSection] Could not load the settings:', err))
      .finally(() => setLoaded(true));
  }, []);

  const saveStatus = useAutoSave(
    async () => {
      await window.electronAPI?.saveProviderEventSettings?.(settings);
    },
    [
      settings.enabled,
      settings.pollIntervalSeconds,
      settings.showToasts,
      settings.showOnBar,
      ...PROVIDER_EVENT_KINDS.map(kind => settings.kinds[kind])
    ],
    loaded
  );

  const update = (patch: Partial<ProviderEventSettingsDTO>): void => setSettings(prev => ({ ...prev, ...patch }));
  const toggleKind = (kind: ProviderEventKind, on: boolean): void =>
    setSettings(prev => ({ ...prev, kinds: { ...prev.kinds, [kind]: on } }));

  const sendTest = (): void => {
    if (!window.electronAPI?.testProviderEvents) return;
    window.electronAPI.testProviderEvents()
      .then(result => {
        const sent = [result.toast && 'as a Windows notification', result.bar && 'to the bar'].filter(Boolean);
        setTestResult(sent.length > 0 ? `Sent ${sent.join(' and ')}.` : 'Nothing sent: every destination is off.');
      })
      .catch(err => {
        console.error('[ProviderEventsSection] Test notification failed:', err);
        setTestResult('The test notification failed. See the log.');
      });
  };

  const checkbox = 'rounded bg-dark-900 border-border-dark text-accent-blue focus:ring-0';
  const disabled = !settings.enabled;

  return (
    <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4 max-w-xl font-mono">
      <div className="flex items-center justify-between border-b border-border-dark pb-3">
        <h3 className="text-md font-bold text-white flex items-center space-x-2">
          <Bell className="w-4 h-4 text-accent-purple" />
          <span>Notifications from {providerName}</span>
        </h3>
        <AutoSaveIndicator status={saveStatus} />
      </div>

      <label className="flex items-center space-x-3 text-xs text-white cursor-pointer select-none">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={e => update({ enabled: e.target.checked })}
          className={checkbox}
        />
        <span>Tell me when something happens on my tasks</span>
      </label>

      <fieldset disabled={disabled} className={`space-y-4 ${disabled ? 'opacity-50' : ''}`}>
        <div>
          <p className="text-xs text-text-secondary mb-2">About</p>
          <div className="grid grid-cols-2 gap-2">
            {kinds.map(kind => (
              <label key={kind} className="flex items-center space-x-2 text-xs text-white cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.kinds[kind]}
                  onChange={e => toggleKind(kind, e.target.checked)}
                  className={checkbox}
                />
                <span>{PROVIDER_EVENT_KIND_LABELS[kind]}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-text-secondary mb-2">As</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center space-x-2 text-xs text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.showToasts}
                onChange={e => update({ showToasts: e.target.checked })}
                className={checkbox}
              />
              <span>Windows notification</span>
            </label>
            {hasBar && (
              <label className="flex items-center space-x-2 text-xs text-white cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={settings.showOnBar}
                  onChange={e => update({ showOnBar: e.target.checked })}
                  className={checkbox}
                />
                <span>Banner on the BUSY Bar</span>
              </label>
            )}
          </div>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div>
            <label htmlFor="provider-event-interval" className="block text-xs text-text-secondary mb-1">
              Check every (seconds)
            </label>
            <input
              id="provider-event-interval"
              type="number"
              value={settings.pollIntervalSeconds}
              onChange={e => update({ pollIntervalSeconds: Number(e.target.value) })}
              min={MIN_PROVIDER_EVENT_POLL_SECONDS}
              max={MAX_PROVIDER_EVENT_POLL_SECONDS}
              className="w-32 bg-dark-900 border border-border-dark rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-blue"
            />
          </div>
          <button
            type="button"
            onClick={sendTest}
            className="px-3 py-1.5 bg-dark-700 text-accent-purple text-xs font-bold rounded hover:bg-dark-600 transition-colors"
          >
            Send a test notification
          </button>
        </div>
        {testResult && <p className="text-xs text-text-secondary" role="status">{testResult}</p>}
      </fieldset>

      <p className="text-xs text-text-secondary">
        Only what happens after you turn this on. Nothing {providerName} already had is replayed.
      </p>
      {note && <p className="text-xs text-text-secondary">{note}</p>}
    </div>
  );
};
