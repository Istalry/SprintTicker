import React, { useEffect, useRef, useState } from 'react';
import { useProviderCapabilities } from '../../hooks/useProviderCapabilities';
import { ProviderId } from '../../../shared/provider-names';
import { ipcErrorMessage } from '../../utils/formatters';
import { SettingButton, SettingProblem, SettingRow, SettingsList } from '../../components/SettingRow';
import { useAnnounce } from '../../components/LiveAnnouncer';

/** Where the erase stands: it asks twice before anything goes. */
type EraseStep = 'idle' | 'first' | 'second' | 'erasing';

/**
 * Settings · Data (S23): export the logs, erase everything on this computer.
 * The erase asks twice -- once to say what goes, once to say it cannot be
 * undone -- because nothing brings the history back.
 */
export const DataSettings: React.FC = () => {
  const { capabilities, providerName } = useProviderCapabilities();
  const [exported, setExported] = useState<string | null>(null);
  useAnnounce(exported, exported ?? '');
  const [step, setStep] = useState<EraseStep>('idle');
  // Each question replaces the button that asked it: Keep them takes the
  // focus, and Erase… gets it back when the answer is no (REVIEW-2026-11 A4).
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const eraseRef = useRef<HTMLButtonElement | null>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (step === 'first' || step === 'second') {
      asked.current = true;
      keepRef.current?.focus();
    } else if (step === 'idle' && asked.current) {
      asked.current = false;
      eraseRef.current?.focus();
    }
  }, [step]);
  const [eraseResult, setEraseResult] = useState<{ ok: boolean; text: string } | null>(null);
  useAnnounce(eraseResult?.ok ? eraseResult.text : null, eraseResult?.text ?? '');

  const exportLogs = () => {
    setExported(null);
    window.electronAPI.exportDiagnosticLogs()
      .then(saved => setExported(saved ? 'Saved. Attach the file to your bug report.' : null),
        (err: unknown) => setExported(`Could not export: ${ipcErrorMessage(err)}`));
  };

  const ownOnly = capabilities?.providerId === ProviderId.ADHOC || !capabilities;

  const erase = () => {
    setStep('erasing');
    window.electronAPI.wipeAllData()
      .then(() => setEraseResult({ ok: true, text: ownOnly ? 'Erased.' : `Erased. Your ${providerName} tasks come back at the next refresh.` }),
        (err: unknown) => setEraseResult({ ok: false, text: `Nothing was erased: ${ipcErrorMessage(err)}` }))
      .finally(() => setStep('idle'));
  };

  // The app's own projects and ad-hoc time live here only: for them the
  // erase is final, and nothing elsewhere has a copy.
  const elsewhere = ownOnly
    ? 'Nothing anywhere else is touched.'
    : `Nothing in ${providerName} is touched.`;

  return (
    <SettingsList label="Data">
      <SettingRow
        title="Export logs"
        description="A file to attach to a bug report. Your tokens are removed from it."
        control={<SettingButton onClick={exportLogs}>Export…</SettingButton>}
      >
        {exported && <p className="text-xs text-text-secondary">{exported}</p>}
      </SettingRow>

      <SettingRow
        title="Erase everything on this computer"
        description={`Tasks, projects and history. ${elsewhere} Asks twice.`}
        control={step === 'idle' && (
          <SettingButton ref={eraseRef} tone="danger" onClick={() => { setEraseResult(null); setStep('first'); }}>Erase…</SettingButton>
        )}
      >
        {step === 'first' && (
          <div role="alertdialog" aria-label="Erase everything?" className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 p-3">
            <span className="flex-1 text-xs text-text-primary">
              Erase every task, project, session and entry of your history on this computer?
            </span>
            <SettingButton tone="danger" onClick={() => setStep('second')}>Erase</SettingButton>
            <SettingButton ref={keepRef} tone="ghost" onClick={() => setStep('idle')}>Keep them</SettingButton>
          </div>
        )}
        {(step === 'second' || step === 'erasing') && (
          <div role="alertdialog" aria-label="This cannot be undone" className="flex flex-wrap items-center gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 p-3">
            <span className="flex-1 text-xs font-semibold text-accent-red">
              This cannot be undone. Time not yet sent is lost with it.
            </span>
            <SettingButton tone="danger" disabled={step === 'erasing'} onClick={erase}>
              {step === 'erasing' ? 'Erasing…' : 'Erase everything now'}
            </SettingButton>
            <SettingButton ref={keepRef} tone="ghost" disabled={step === 'erasing'} onClick={() => setStep('idle')}>Keep them</SettingButton>
          </div>
        )}
        {eraseResult && (eraseResult.ok
          ? <p className="text-xs text-text-secondary">{eraseResult.text}</p>
          : <SettingProblem>{eraseResult.text}</SettingProblem>)}
      </SettingRow>
    </SettingsList>
  );
};
