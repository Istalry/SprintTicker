import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { FlowSettingKey } from '../../shared/flow-settings';

/**
 * "When I close the window" (P12a): keep running in the tray, which keeps
 * the timer, the bar and the Stream Deck going, or quit. Quitting clears the
 * bar and stops the deck's connection, so keeping running is the default.
 */
export const CloseToTrayCard: React.FC = () => {
  const [keepRunning, setKeepRunning] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.getFlowSetting(FlowSettingKey.CLOSE_TO_TRAY).then(setKeepRunning, (err: unknown) => setError(String(err)));
  }, []);

  const choose = (next: boolean): void => {
    setError(null);
    window.electronAPI.saveFlowSetting(FlowSettingKey.CLOSE_TO_TRAY, next).then(setKeepRunning, (err: unknown) => setError(String(err)));
  };

  return (
    <div className="rounded-lg border border-border-dark bg-dark-800 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 id="close-to-tray-title" className="text-sm font-semibold text-text-primary">When I close the window</h3>
          <p className="mt-1 text-xs text-text-secondary">
            Kept running, SprintTicker goes to the tray by the clock: your timer, the bar and the Stream Deck go on.
            Quit from the tray&apos;s menu.
          </p>
        </div>
        <select
          aria-labelledby="close-to-tray-title"
          value={keepRunning === false ? 'quit' : 'keep'}
          disabled={keepRunning === null}
          onChange={e => choose(e.target.value === 'keep')}
          className="rounded-lg border border-border-dark bg-dark-700 px-2 py-1.5 text-xs text-text-primary disabled:opacity-50"
        >
          <option value="keep">Keep running</option>
          <option value="quit">Quit SprintTicker</option>
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
