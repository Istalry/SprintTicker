import React, { useEffect, useState } from 'react';
import { couldNot } from '../utils/formatters';
import { FlowSettingKey } from '../../shared/flow-settings';
import { SettingProblem, SettingRow, SettingSwitch } from './SettingRow';

/** The row's title, and the switch's name. */
export const SHUTDOWN_AT_END_OF_DAY_TITLE = 'Shut down the PC when I end my day';

/**
 * Whether End my day starts with *Then shut down the PC* ticked (the user's
 * request, 2026-11-16). Off by default, as the box was: it only ticks the
 * box, which can still be unticked that day, and the shutdown still waits
 * for Undo and the queue.
 */
export const ShutdownAtEndOfDaySetting: React.FC = () => {
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.getFlowSetting(FlowSettingKey.SHUTDOWN_AT_END_OF_DAY)
      .then(setOn, (err: unknown) => setError(couldNot('read it', err)));
  }, []);

  const choose = (next: boolean): void => {
    setError(null);
    window.electronAPI.saveFlowSetting(FlowSettingKey.SHUTDOWN_AT_END_OF_DAY, next)
      .then(setOn, (err: unknown) => setError(couldNot('change it', err)));
  };

  return (
    <SettingRow
      title={SHUTDOWN_AT_END_OF_DAY_TITLE}
      description="Ticks “Then shut down the PC” in End my day for you; you can still untick it that day. The PC shuts down once the 10 s undo has passed and your time is sent."
      control={<SettingSwitch label={SHUTDOWN_AT_END_OF_DAY_TITLE} checked={on === true} disabled={on === null} onChange={choose} />}
    >
      {error && <SettingProblem>{error}</SettingProblem>}
    </SettingRow>
  );
};
