import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { FlowSettingKey, StartSideEffectsSetting } from '../../shared/flow-settings';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';

/** The waits offered, in seconds. Two minutes is the default (S20). */
const WAITS: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: 0, label: 'right away' },
  { seconds: 60, label: 'after 1 minute of timing' },
  { seconds: 120, label: 'after 2 minutes of timing' },
  { seconds: 300, label: 'after 5 minutes of timing' }
];

/**
 * What starting a task does at the provider, and when (S20): "a glance moves
 * nothing". Hidden for a provider that can neither move nor take a task --
 * a control it lacks is hidden, never greyed.
 */
export const StartSideEffectsCard: React.FC = () => {
  const { capabilities, providerName } = useProviderCapabilities();
  const [setting, setSetting] = useState<StartSideEffectsSetting | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.getFlowSetting(FlowSettingKey.START_SIDE_EFFECTS).then(setSetting, (err: unknown) => setError(String(err)));
  }, []);

  if (!capabilities || !(capabilities.canTransition || capabilities.canAssign) || !setting) return null;

  const save = async (next: StartSideEffectsSetting): Promise<void> => {
    setError(null);
    setSetting(next);
    try {
      const stored = await window.electronAPI?.saveFlowSetting(FlowSettingKey.START_SIDE_EFFECTS, next);
      if (stored) setSetting(stored);
    } catch (err) {
      setError(String(err));
    }
  };

  // A wait stored by hand that the list does not offer still shows as itself.
  const waits = WAITS.some(w => w.seconds === setting.afterSeconds)
    ? WAITS
    : [...WAITS, { seconds: setting.afterSeconds, label: `after ${setting.afterSeconds} s of timing` }];

  return (
    <div className="rounded-lg border border-border-dark bg-dark-800 p-5">
      <h3 className="text-sm font-semibold text-text-primary">When I start a task</h3>
      <p className="mt-1 text-xs text-text-secondary">
        Starting a task to look at it moves nothing in {providerName}. Once you have timed it long enough, it moves to
        In Progress, and a task nobody has becomes yours. Paused time does not count.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
        <label className="flex items-center space-x-2">
          <input
            type="checkbox"
            checked={setting.enabled}
            onChange={e => void save({ ...setting, enabled: e.target.checked })}
            className="h-4 w-4 accent-primary"
          />
          <span>Move and take the task</span>
        </label>
        <select
          aria-label="When"
          value={setting.afterSeconds}
          disabled={!setting.enabled}
          onChange={e => void save({ ...setting, afterSeconds: Number(e.target.value) })}
          className="bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-focus disabled:opacity-50"
        >
          {waits.map(w => <option key={w.seconds} value={w.seconds}>{w.label}</option>)}
        </select>
      </div>
      {error && (
        <p className="mt-3 flex items-center space-x-1.5 text-xs text-accent-amber">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Could not change it: {error}</span>
        </p>
      )}
    </div>
  );
};
