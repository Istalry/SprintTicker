import React, { useEffect, useState } from 'react';
import { Download, X, RefreshCw, CheckCircle2 } from 'lucide-react';
import { UpdateStatusDTO } from '../../shared/dtos';
import { SettingButton, SettingProblem, SettingRow, SettingSwitch } from './SettingRow';

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
 * asks for it, in Settings' row below, rather than as a banner on every launch: the
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
    <div className="mb-4 flex items-center justify-between rounded-lg border border-focus/40 bg-select px-4 py-3">
      <div className="flex items-center space-x-3">
        <Download className="h-4 w-4 shrink-0 text-text-primary" />
        <p className="text-sm text-text-primary">
          <span className="font-semibold">SprintTicker {status.latestVersion}</span> is available.
          <span className="ml-2 text-xs text-text-secondary">
            You have {status.currentVersion}.
          </span>
        </p>
      </div>
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={() => void window.electronAPI?.openReleasePage(status.releaseUrl)}
          className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-dark-900 transition-colors hover:bg-primary/90"
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
 * "Check for updates" (S19): check on demand, and turn the check off.
 *
 * Turning it off stops the request being made at all, rather than hiding its
 * result -- this is the app's only outbound connection, and someone running an
 * offline-first tracker may reasonably want none.
 */
export const UpdateCheckSetting: React.FC = () => {
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
    <SettingRow
      title="Check for updates"
      description="Asks GitHub once a day whether a newer release is out. Nothing is downloaded or installed."
      control={
        <>
          <SettingButton tone="ghost" disabled={checking} onClick={() => void runCheck()}>
            <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking…' : 'Check now'}
          </SettingButton>
          <SettingSwitch label="Check for updates automatically" checked={enabled} onChange={next => void toggle(next)} />
        </>
      }
    >
      {status?.status === 'up-to-date' && (
        <p className="flex items-center gap-1.5 text-xs text-accent-green">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>Up to date ({status.currentVersion}).</span>
        </p>
      )}
      {status?.status === 'update-available' && (
        <button
          type="button"
          onClick={() => void window.electronAPI?.openReleasePage(status.releaseUrl)}
          className="text-xs font-semibold text-text-primary hover:underline"
        >
          You have {status.currentVersion}; {status.latestVersion} is out — view release
        </button>
      )}
      {status?.status === 'disabled' && <p className="text-xs text-text-secondary">Automatic checking is off.</p>}
      {/* Stated plainly rather than shown as "up to date". */}
      {status?.status === 'failed' && <SettingProblem>Could not check: {status.reason}</SettingProblem>}
    </SettingRow>
  );
};
