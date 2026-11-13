import React, { useEffect, useState } from 'react';
import { couldNot } from '../utils/formatters';
import { FlowSettingKey, StartSideEffectsSetting as StartSideEffects } from '../../shared/flow-settings';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { SETTING_SELECT_CLASS, SettingProblem, SettingRow } from './SettingRow';

/** The waits offered, in seconds. Two minutes is the default (S20). */
const WAITS: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: 0, label: 'right away' },
  { seconds: 60, label: 'after 1 min' },
  { seconds: 120, label: 'after 2 min' },
  { seconds: 300, label: 'after 5 min' }
];

/** The menu's value for "never": the setting's `enabled: false`. */
const NEVER = 'never';

/**
 * "When I start a task" (S20): what starting a task does at the provider,
 * and when -- "a glance moves nothing". One menu, never or after how long,
 * where the card had a checkbox and a wait. Hidden for a provider that can
 * neither move nor take a task: a control it lacks is hidden, never greyed.
 */
export const StartSideEffectsSetting: React.FC = () => {
  const { capabilities, providerName } = useProviderCapabilities();
  const [setting, setSetting] = useState<StartSideEffects | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.getFlowSetting(FlowSettingKey.START_SIDE_EFFECTS).then(setSetting, (err: unknown) => setError(couldNot('read it', err)));
  }, []);

  if (!capabilities || !(capabilities.canTransition || capabilities.canAssign) || !setting) return null;

  const save = async (next: StartSideEffects): Promise<void> => {
    setError(null);
    setSetting(next);
    try {
      const stored = await window.electronAPI?.saveFlowSetting(FlowSettingKey.START_SIDE_EFFECTS, next);
      if (stored) setSetting(stored);
    } catch (err) {
      setError(couldNot('change it', err));
    }
  };

  // A wait stored by hand that the list does not offer still shows as itself.
  const waits = WAITS.some(w => w.seconds === setting.afterSeconds)
    ? WAITS
    : [...WAITS, { seconds: setting.afterSeconds, label: `after ${setting.afterSeconds} s` }];

  return (
    <SettingRow
      title="When I start a task"
      description={`Moves it to In Progress in ${providerName}, and takes it if nobody has it, once it has run this long. A glance moves nothing; paused time does not count.`}
      control={
        <select
          aria-label="When I start a task"
          value={setting.enabled ? String(setting.afterSeconds) : NEVER}
          onChange={e => void save(
            e.target.value === NEVER ? { ...setting, enabled: false } : { enabled: true, afterSeconds: Number(e.target.value) }
          )}
          className={SETTING_SELECT_CLASS}
        >
          {waits.map(w => <option key={w.seconds} value={w.seconds}>{w.label}</option>)}
          <option value={NEVER}>never</option>
        </select>
      }
    >
      {error && <SettingProblem>{error}</SettingProblem>}
    </SettingRow>
  );
};
