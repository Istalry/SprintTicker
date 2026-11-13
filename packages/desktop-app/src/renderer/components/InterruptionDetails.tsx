import React, { useEffect, useState } from 'react';
import { RunningInterruptionDTO, AD_HOC_TITLE_MAX_CHARS } from '../../shared/interruption';
import { FlowSettingKey } from '../../shared/flow-settings';
import { Verb } from '../../shared/words';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { TaskPicker } from './TaskPicker';

const warn = (what: string) => (err: unknown) => console.warn(`[InterruptionDetails] ${what} failed:`, err);

/** "Started now ▾": how far back the running interruption can be set, in minutes. */
export const STARTED_AGO_CHOICES = [0, 2, 5, 10] as const;

/**
 * The running interruption's details on the session card (S9, P8e3): what
 * it is about -- the note the provider shows with its time -- when it
 * started, and which task its time goes to. The timer runs on through all
 * of it; nothing here ends the interruption.
 *
 * Mounted per interruption (its key), so the field and the choice start
 * fresh for the next one. The card's timer is drawn here, under the name.
 */
export const InterruptionDetails: React.FC<{ interruption: RunningInterruptionDTO; timer?: React.ReactNode }> = ({ interruption, timer = null }) => {
  const api = window.electronAPI;
  const { providerName } = useProviderCapabilities();
  const provider = providerName || 'your provider';
  const [name, setName] = useState(interruption.name ?? '');
  const [startedAgo, setStartedAgo] = useState<number>(0);
  const [choosing, setChoosing] = useState(false);
  // Unknown until read: the explanation waits rather than flash for someone who put it away.
  const [firstSeen, setFirstSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    const read = api?.getFlowSetting;
    if (!read) return undefined;
    read(FlowSettingKey.FIRST_INTERRUPTION_SEEN).then(
      seen => { if (live) setFirstSeen(seen); },
      err => warn('Reading whether the first interruption was explained')(err)
    );
    return () => { live = false; };
  }, [api]);

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === (interruption.name ?? '')) return;
    api.renameInterruption(interruption.id, trimmed).catch(warn('Naming the interruption'));
  };
  const setStart = (minutesAgo: number) => {
    setStartedAgo(minutesAgo);
    api.moveInterruptionStart(new Date(Date.now() - minutesAgo * 60_000).toISOString()).catch(warn('Setting the start'));
  };
  const choose = (taskId: string | null) => {
    setChoosing(false);
    api.chooseInterruptionTask(taskId).catch(warn('Choosing the task'));
  };
  const putExplanationAway = () => {
    setFirstSeen(true);
    api.saveFlowSetting(FlowSettingKey.FIRST_INTERRUPTION_SEEN, true).catch(warn('Saving the explanation as seen'));
  };

  const held = interruption.interruptedTaskKey;
  const label = 'text-[11px] text-text-secondary';
  const small = 'px-3 py-1.5 rounded-lg text-xs font-semibold border border-border-dark text-text-secondary hover:text-white hover:border-focus';
  // The name and the timer first, the help in one muted line (P15a3, the
  // user's choice on REVIEW-2026-11 C15): this card is read mid-call, and
  // five lines of help stood above the timer.
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={`interruption-name-${interruption.id}`} className={label} title={`${provider} shows it as the note.`}>
          What is it about?
        </label>
        <input
          id={`interruption-name-${interruption.id}`}
          type="text"
          value={name}
          maxLength={AD_HOC_TITLE_MAX_CHARS}
          placeholder={interruption.title}
          onChange={e => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setName(interruption.name ?? '');
            // The task picker and the dialogs listen on the window.
            e.stopPropagation();
          }}
          className="w-full bg-dark-900 border border-border-field rounded-lg px-3 py-2 text-base font-semibold text-white focus:outline-none focus:border-focus"
        />
      </div>

      {timer}

      <p className={`${label} flex flex-wrap items-center gap-x-1.5 gap-y-1`}>
        <span>
          {held
            ? `${held} waits, paused${interruption.interruptedWasPaused ? ', as it was' : ''}; this time is sent once it is placed.`
            : 'Nothing was timing: when it ends, it waits to be placed.'}
        </span>
        {interruption.index === 1 && (
          <span className="flex items-center gap-1.5">
            <span>Started</span>
            <select
              aria-label="When it started"
              title={held ? `Set it earlier, and those minutes come off ${held}` : undefined}
              value={startedAgo}
              onChange={e => setStart(Number(e.target.value))}
              className="bg-dark-900 border border-border-field rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-focus"
            >
              {STARTED_AGO_CHOICES.map(m => (
                <option key={m} value={m}>{m === 0 ? 'now' : `${m} min ago`}</option>
              ))}
            </select>
          </span>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {interruption.chosenTask ? (
          <>
            <span className="px-2.5 py-1 rounded-lg border border-accent-green/40 bg-accent-green/10 text-xs text-white">
              <span aria-hidden="true">↳</span> <span className="font-mono">{interruption.chosenTask.key}</span> {interruption.chosenTask.title}
            </span>
            <button type="button" className={small} onClick={() => setChoosing(true)}>Change…</button>
            <button type="button" className={small} title="It waits on Today until placed" onClick={() => choose(null)}>{Verb.LATER}</button>
          </>
        ) : (
          <>
            <button type="button" className={small} onClick={() => setChoosing(true)}>Choose a task…</button>
            <span className={label}>or leave it: it waits on Today until placed.</span>
          </>
        )}
      </div>

      {firstSeen === false && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-border-dark bg-dark-900/40 px-3 py-2 text-xs text-text-secondary">
          <p>
            <b className="text-white">Your first interruption.</b>{' '}
            When it ends, {Verb.PLACE.toLowerCase()} it on a task or keep it as its own entry. Nothing goes to {provider} until you choose its task.
          </p>
          <button type="button" className={`${small} shrink-0 whitespace-nowrap`} onClick={putExplanationAway}>Got it</button>
        </div>
      )}

      <TaskPicker
        isOpen={choosing}
        mode="place"
        title={`Which task is "${interruption.title}" for?`}
        subtitle="The timer keeps running; its time goes there when it ends."
        onClose={() => setChoosing(false)}
        onPick={picked => { if (picked.task) choose(picked.task.id); }}
      />
    </div>
  );
};
