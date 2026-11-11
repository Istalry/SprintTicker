import React, { useState } from 'react';
import type { TaskDTO } from '../../shared/dtos';
import type { InterruptionSource, InterruptionToPlaceDTO } from '../../shared/interruption';
import { localDateKey } from '../../shared/local-date';
import { closedWeekWarning, isInClosedWeek } from '../../shared/closed-week';
import { Verb, keepOffLabel } from '../../shared/words';
import { formatClockTime, formatDay, formatHoursAndMinutes, ipcErrorMessage } from '../utils/formatters';
import { TaskPicker } from './TaskPicker';
import { ConfirmPanel } from './ConfirmPanel';

/** Where an unnamed one was started, said beside it: the place helps recall it. */
const STARTED_FROM: Partial<Record<InterruptionSource, string>> = {
  mini: 'from the mini timer',
  tray: 'from the tray',
  bar: 'from the bar',
  deck: 'from the Stream Deck',
  shortcut: 'from the shortcut'
};

/** What one row is set to: a task, or kept off the provider. Unset rows are left. */
type Choice = { kind: 'task'; task: TaskDTO } | { kind: 'off' };

export interface PlaceInterruptionsDialogProps {
  /** The interruptions waiting, in the list's order. */
  waiting: InterruptionToPlaceDTO[];
  providerName: string;
  /** The Monday of the last week closed, for the closed-week question. */
  lastWeekClosed: string | null;
  onClose: () => void;
  /** A refusal from main, said by the list under it. */
  onError: (message: string) => void;
}

/**
 * Placing several interruptions, one row at a time (redesign P7c, S12b).
 * Each row has its own choice, made in the place picker: Starred first, then
 * Recent with the tasks just chosen above, so a talk that came back is one
 * click from its first part. Nothing is chosen until the user clicks, and a
 * row left unchosen stays to place. An unnamed one asks for a name once its
 * task is chosen: the provider would otherwise show "Interruption at 14:02"
 * as the entry's note.
 *
 * Mounted only while open, so every opening starts with nothing chosen.
 */
export const PlaceInterruptionsDialog: React.FC<PlaceInterruptionsDialogProps> = ({
  waiting,
  providerName,
  lastWeekClosed,
  onClose,
  onError
}) => {
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [choosing, setChoosing] = useState<InterruptionToPlaceDTO | null>(null);
  // The tasks chosen, the latest first: the picker lists them first.
  const [justChosen, setJustChosen] = useState<TaskDTO[]>([]);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const keepOff = keepOffLabel(providerName);
  const chosen = waiting.filter(item => choices[item.id]);
  const total = waiting.reduce((sum, item) => sum + item.durationSeconds, 0);
  const chosenSeconds = chosen.reduce((sum, item) => sum + item.durationSeconds, 0);
  const today = localDateKey();

  const choose = (item: InterruptionToPlaceDTO, choice: Choice): void => {
    setChoices(current => ({ ...current, [item.id]: choice }));
    if (choice.kind === 'task') {
      setJustChosen(current => [choice.task, ...current.filter(t => t.id !== choice.task.id)]);
    }
  };

  /** The one before it in its run, while it is still here to name: "after 'Call with Marc'". */
  const before = (item: InterruptionToPlaceDTO): InterruptionToPlaceDTO | undefined =>
    item.index > 1
      ? waiting
          .filter(o => o.ofRun === item.ofRun && o.index === item.index - 1 && o.interruptedTaskKey === item.interruptedTaskKey
            && o.endedAtUtc <= item.startedAtUtc)
          .sort((a, b) => b.endedAtUtc.localeCompare(a.endedAtUtc))[0]
      : undefined;

  const nameOf = (item: InterruptionToPlaceDTO): string => names[item.id]?.trim() || item.title;

  const place = async (): Promise<void> => {
    setBusy(true);
    const api = window.electronAPI;
    try {
      // Names first: the entry's note is the name when it is placed.
      for (const item of chosen) {
        const name = names[item.id]?.trim();
        if (name && name !== item.title) await api.renameInterruption(item.id, name);
      }
      const byTask = new Map<string, string[]>();
      for (const item of chosen) {
        const choice = choices[item.id];
        if (choice.kind === 'task') byTask.set(choice.task.id, [...(byTask.get(choice.task.id) ?? []), item.id]);
      }
      for (const [taskId, ids] of byTask) {
        await (ids.length === 1 ? api.placeInterruption(ids[0], taskId) : api.placeInterruptions(ids, taskId));
      }
      for (const item of chosen) {
        if (choices[item.id].kind === 'off') await api.keepInterruptionOff(item.id);
      }
      onClose();
    } catch (err) {
      // What went through stays done; main sends the list that is left.
      onError(ipcErrorMessage(err));
      onClose();
    }
  };

  const confirmPlace = (): void => {
    if (chosen.some(item => isInClosedWeek(item.startedAtUtc, lastWeekClosed))) setAsking(true);
    else void place();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
      <div
        role="dialog"
        aria-label={`${Verb.PLACE} ${waiting.length} interruptions`}
        className="w-full max-w-2xl max-h-[85vh] bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onKeyDown={e => { if (e.key === 'Escape' && !choosing) onClose(); }}
      >
        <div className="px-5 pt-4 pb-3 border-b border-border-dark">
          <h4 className="text-sm font-bold text-white">
            {Verb.PLACE} {waiting.length} interruptions · {formatHoursAndMinutes(total)}
          </h4>
          <p className="text-[11px] text-text-secondary mt-1">
            Choose a task for each, or keep one off {providerName.trim() || 'the provider'}. Leave one, and it waits here.
          </p>
        </div>

        <div className="overflow-y-auto px-5 py-3 space-y-1.5">
          {waiting.map(item => {
            const dateKey = localDateKey(new Date(item.startedAtUtc));
            const when = dateKey === today
              ? formatClockTime(new Date(item.startedAtUtc))
              : `${formatDay(dateKey)} ${formatClockTime(new Date(item.startedAtUtc))}`;
            const previous = before(item);
            const choice = choices[item.id];
            const unnamed = item.name === null;
            return (
              <div key={item.id} className="flex items-start justify-between gap-3 py-2 px-3 bg-dark-900/60 border border-border-dark rounded-lg text-xs">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-bold text-white truncate">{nameOf(item)}</div>
                  <div className="text-[10px] text-text-secondary truncate">
                    {when} · {formatHoursAndMinutes(item.durationSeconds)}
                    {item.interruptedTaskKey && <> · during <span className="font-mono">{item.interruptedTaskKey}</span></>}
                    {previous ? <> · after &ldquo;{nameOf(previous)}&rdquo;</> : item.ofRun > 1 && <> · {item.index} of {item.ofRun}</>}
                    {unnamed && STARTED_FROM[item.source] && <> · {STARTED_FROM[item.source]}</>}
                  </div>
                  {unnamed && choice?.kind === 'task' && (
                    <input
                      autoFocus
                      aria-label={`Name ${item.title}`}
                      value={names[item.id] ?? ''}
                      onChange={e => setNames(current => ({ ...current, [item.id]: e.target.value }))}
                      placeholder={`What was it? Sent as the note on ${choice.task.key}`}
                      className="w-full bg-dark-800 border border-focus rounded px-2 py-1 text-white outline-none"
                    />
                  )}
                </div>
                <button
                  type="button"
                  aria-label={`Choose a task for ${nameOf(item)}`}
                  onClick={() => setChoosing(item)}
                  className={`shrink-0 max-w-[45%] truncate px-2.5 py-1 rounded border text-left ${
                    choice ? 'border-border-dark text-white' : 'border-dashed border-text-secondary text-text-secondary'
                  } hover:border-focus`}
                >
                  {choice?.kind === 'task'
                    ? <><span className="font-mono">{choice.task.key}</span> {choice.task.title} ▾</>
                    : choice?.kind === 'off' ? `${keepOff} ▾` : 'Choose a task ▾'}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border-dark">
          <span className="text-[11px] text-text-secondary">{chosen.length} chosen · {waiting.length - chosen.length} left</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:text-white">
              Close
            </button>
            <button
              type="button"
              disabled={chosen.length === 0 || busy}
              onClick={confirmPlace}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-primary text-dark-900 disabled:opacity-40"
            >
              {Verb.PLACE} the {chosen.length} chosen · {formatHoursAndMinutes(chosenSeconds)}
            </button>
          </div>
        </div>
      </div>

      <TaskPicker
        isOpen={choosing !== null}
        mode="place"
        title={choosing ? `${Verb.PLACE} "${nameOf(choosing)}" on a task` : undefined}
        subtitle="Chosen for this row only. Nothing is sent until you place the ones chosen."
        justChosen={justChosen}
        onClose={() => setChoosing(null)}
        onPick={picked => { if (choosing && picked.task) choose(choosing, { kind: 'task', task: picked.task }); }}
        onKeepOff={choosing ? () => choose(choosing, { kind: 'off' }) : undefined}
      />

      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6">
            <ConfirmPanel
              title={`${Verb.PLACE} ${chosen.length} interruptions?`}
              message={closedWeekWarning(providerName)}
              confirmLabel={`${Verb.PLACE} anyway`}
              onConfirm={() => { setAsking(false); void place(); }}
              onCancel={() => setAsking(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
