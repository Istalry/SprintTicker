import React, { useEffect, useState } from 'react';
import { Download, X, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { UpdateStatusDTO } from '../../shared/dtos';

/**
 * Update notices.
 *
 * The app checks whether a newer release exists; it never downloads or installs
 * one. Builds are unsigned, so an automatic update would re-trigger SmartScreen
 * every time and some would be blocked outright -- a worse route than the manual
 * download it would replace. See ROADMAP.md §2.
 *
 * The banner appears only for an available update, because that is the only
 * state the user can act on. A check that *failed* is reported where the user
 * asks for it, in the card below, rather than as a banner on every launch: the
 * rule inherited from audit F-18 is that the app must never claim to be up to
 * date when it does not know, not that it must interrupt to say so.
 */
export const UpdateBanner: React.FC = () => {
  const [status, setStatus] = useState<UpdateStatusDTO | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return undefined;
    const unsubscribe = window.electronAPI.onUpdateStatus(next => {
      setStatus(next);
      // A newer version than the one already dismissed deserves a fresh notice.
      if (next.status === 'update-available') setDismissed(false);
    });
    return () => unsubscribe();
  }, []);

  if (dismissed || !status || status.status !== 'update-available') return null;

  return (
    <div className="mb-4 flex items-center justify-between rounded-lg border border-accent-blue/40 bg-accent-blue/10 px-4 py-3">
      <div className="flex items-center space-x-3">
        <Download className="h-4 w-4 shrink-0 text-accent-blue" />
        <p className="text-sm text-text-primary">
          <span className="font-semibold">SprintTicker {status.latestVersion}</span> is available.
          <span className="ml-2 font-mono text-xs text-text-secondary">
            You have {status.currentVersion}.
          </span>
        </p>
      </div>
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={() => void window.electronAPI?.openReleasePage(status.releaseUrl)}
          className="rounded bg-accent-blue px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-blue/80"
        >
          View release
        </button>
        <button
          type="button"
          aria-label="Dismiss update notice"
          onClick={() => setDismissed(true)}
          className="rounded p-1.5 text-text-secondary transition-colors hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

/**
 * The manual control: check on demand, and turn the check off.
 *
 * Turning it off stops the request being made at all, rather than hiding its
 * result -- this is the app's only outbound connection, and someone running an
 * offline-first tracker may reasonably want none.
 */
export const UpdateSettingsCard: React.FC = () => {
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<UpdateStatusDTO | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void window.electronAPI?.getUpdateCheckEnabled().then(setEnabled);
  }, []);

  const runCheck = async (): Promise<void> => {
    setChecking(true);
    try {
      const result = await window.electronAPI?.checkForUpdate();
      if (result) setStatus(result);
    } finally {
      setChecking(false);
    }
  };

  const toggle = async (next: boolean): Promise<void> => {
    const applied = await window.electronAPI?.setUpdateCheckEnabled(next);
    setEnabled(applied ?? next);
    if (!next) setStatus(null);
  };

  return (
    <div className="rounded-lg border border-border-dark bg-dark-800 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Updates</h3>
          <p className="mt-1 text-xs text-text-secondary">
            Checks GitHub for a newer release. Nothing is downloaded or installed.
          </p>
        </div>
        <label className="flex items-center space-x-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => void toggle(e.target.checked)}
            className="h-4 w-4 accent-accent-blue"
          />
          <span>Check automatically</span>
        </label>
      </div>

      <div className="flex items-center space-x-3">
        <button
          type="button"
          disabled={checking}
          onClick={() => void runCheck()}
          className="flex items-center space-x-2 rounded border border-border-dark px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-dark-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
          <span>{checking ? 'Checking…' : 'Check now'}</span>
        </button>

        {status?.status === 'up-to-date' && (
          <span className="flex items-center space-x-1.5 text-xs text-accent-green">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Up to date ({status.currentVersion}).</span>
          </span>
        )}

        {status?.status === 'update-available' && (
          <button
            type="button"
            onClick={() => void window.electronAPI?.openReleasePage(status.releaseUrl)}
            className="text-xs font-semibold text-accent-blue hover:underline"
          >
            {status.latestVersion} is available — view release
          </button>
        )}

        {status?.status === 'disabled' && (
          <span className="text-xs text-text-secondary">Automatic checking is off.</span>
        )}

        {/* Stated plainly rather than shown as "up to date". */}
        {status?.status === 'failed' && (
          <span className="flex items-center space-x-1.5 text-xs text-accent-amber">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Could not check: {status.reason}</span>
          </span>
        )}
      </div>
    </div>
  );
};
