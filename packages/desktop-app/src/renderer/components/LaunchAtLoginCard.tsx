import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { LaunchAtLoginStatusDTO } from '../../shared/dtos';

const UNAVAILABLE_BECAUSE: Record<NonNullable<LaunchAtLoginStatusDTO['reason']>, string> = {
  'not-windows': 'Only on Windows.',
  // `pnpm dev` would register a bare electron.exe, which starts no app.
  'not-packaged': 'Only in an installed or portable build, not in development.'
};

/**
 * Starting SprintTicker with Windows, in the tray with no window.
 *
 * The state is Windows', never this card's: the tray menu flips the same
 * switch, and Windows' Startup apps page can turn it off with no event the
 * app hears. So it is read again whenever the window regains focus, which is
 * when either of those can have happened.
 */
export const LaunchAtLoginCard: React.FC = () => {
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

  const unavailable = status && !status.available;

  return (
    <div className="rounded-lg border border-border-dark bg-dark-800 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Start with Windows</h3>
          <p className="mt-1 text-xs text-text-secondary">
            Starts SprintTicker in the tray when you sign in, with no window. Windows&apos; Startup apps
            settings show the same switch.
          </p>
        </div>
        <label className="flex items-center space-x-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={status?.enabled ?? false}
            disabled={!status || !status.available}
            onChange={e => void toggle(e.target.checked)}
            className="h-4 w-4 accent-accent-blue disabled:opacity-50"
          />
          <span>Start at sign-in</span>
        </label>
      </div>

      {unavailable && status.reason && (
        <p className="mt-3 text-xs text-text-secondary">{UNAVAILABLE_BECAUSE[status.reason]}</p>
      )}

      {error && (
        <p className="mt-3 flex items-center space-x-1.5 text-xs text-accent-amber">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Could not change it: {error}</span>
        </p>
      )}
    </div>
  );
};
