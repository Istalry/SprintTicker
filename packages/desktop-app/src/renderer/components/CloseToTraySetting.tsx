import React, { useEffect, useState } from 'react';
import { couldNot } from '../utils/formatters';
import { FlowSettingKey } from '../../shared/flow-settings';
import { SETTING_SELECT_CLASS, SettingProblem, SettingRow } from './SettingRow';

/**
 * "When I close the window" (P12a, S19): keep running in the tray, which
 * keeps the timer, the bar and the Stream Deck going, or quit. Quitting
 * clears the bar and stops the deck's connection, so keeping running is the
 * default.
 */
export const CloseToTraySetting: React.FC = () => {
  const [keepRunning, setKeepRunning] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.getFlowSetting(FlowSettingKey.CLOSE_TO_TRAY).then(setKeepRunning, (err: unknown) => setError(couldNot('read it', err)));
  }, []);

  const choose = (next: boolean): void => {
    setError(null);
    window.electronAPI.saveFlowSetting(FlowSettingKey.CLOSE_TO_TRAY, next).then(setKeepRunning, (err: unknown) => setError(couldNot('change it', err)));
  };

  return (
    <SettingRow
      title="When I close the window"
      description="Kept running, SprintTicker goes on in the tray: your timer, the bar and the Stream Deck. Quit from the tray’s menu."
      control={
        <select
          aria-label="When I close the window"
          value={keepRunning === false ? 'quit' : 'keep'}
          disabled={keepRunning === null}
          onChange={e => choose(e.target.value === 'keep')}
          className={SETTING_SELECT_CLASS}
        >
          <option value="keep">Keep running</option>
          <option value="quit">Quit SprintTicker</option>
        </select>
      }
    >
      {error && <SettingProblem>{error}</SettingProblem>}
    </SettingRow>
  );
};
