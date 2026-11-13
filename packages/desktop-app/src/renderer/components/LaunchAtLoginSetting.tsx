import React, { useEffect, useState } from 'react';
import { LaunchAtLoginStatusDTO } from '../../shared/dtos';
import { SettingProblem, SettingRow, SettingSwitch } from './SettingRow';

const UNAVAILABLE_BECAUSE: Record<NonNullable<LaunchAtLoginStatusDTO['reason']>, string> = {
  'not-windows': 'Only on Windows.',
  // `pnpm dev` would register a bare electron.exe, which starts no app.
  'not-packaged': 'Only in an installed or portable build, not in development.'
};

/**
 * Starting SprintTicker with Windows, in the tray with no window (S19).
 *
 * The state is Windows', never this row's: the tray menu flips the same
 * switch, and Windows' Startup apps page can turn it off with no event the
 * app hears. So it is read again whenever the window regains focus, which is
 * when either of those can have happened.
 */
export const LaunchAtLoginSetting: React.FC = () => {
  const [status, setStatus] = useState<LaunchAtLoginStatusDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const read = (): void => {
      window.electronAPI?.getLaunchAtLogin().then(setStatus, (err: unknown) => setError(String(err)));
    };
    read();
    window.addEventListener('focus', read);
    return () => window.removeEventListener('focus', read);
  }, []);

  const toggle = async (next: boolean): Promise<void> => {
    setError(null);
    try {
      const applied = await window.electronAPI?.setLaunchAtLogin(next);
      if (applied) setStatus(applied);
    } catch (err) {
      setError(String(err));
    }
  };

  const unavailable = status && !status.available && status.reason ? UNAVAILABLE_BECAUSE[status.reason] : null;

  return (
    <SettingRow
      title="Start with Windows"
      description={unavailable ?? 'Opens in the tray when you sign in, with no window. Windows’ Startup apps show the same switch.'}
      control={
        <SettingSwitch
          label="Start with Windows"
          checked={status?.enabled ?? false}
          disabled={!status || !status.available}
          onChange={next => void toggle(next)}
        />
      }
    >
      {error && <SettingProblem>Could not change it: {error}</SettingProblem>}
    </SettingRow>
  );
};
