import React, { useEffect, useState } from 'react';
import { Link2, Trash2, Zap } from 'lucide-react';
import { InterruptionToPlaceDTO } from '../../shared/interruption';
import { localDateKey } from '../../shared/local-date';
import { closedWeekWarning, isInClosedWeek } from '../../shared/closed-week';
import { Verb, keepOffLabel } from '../../shared/words';
import { formatClockTime, formatDay, formatHoursAndMinutes, ipcErrorMessage } from '../utils/formatters';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { InlineRename } from './InlineRename';
import { TaskSelectionModal } from './TaskSelectionModal';
import { ConfirmPanel } from './ConfirmPanel';

interface InterruptionsToPlaceProps {
  /** One line under the heading: what placing does, said for where the list is. */
  hint: string;
  /** Jumps to the day an interruption began; History passes it, the wrap-up does not. */
  onJumpToDay?: (dateKey: string) => void;
  /** Tighter rows, for a dialog. */
  compact?: boolean;
}

/** The interruptions being placed, and how the list says them in a question. */
interface Placing {
  ids: string[];
  label: string;
}

/**
 * The interruptions that ended and wait to be placed (P6): History's list and
 * the wrap-up's, one component so the two cannot drift. Each can be named,
 * placed on a task -- its time is then sent like any entry, with ten seconds
 * to undo -- kept off the provider, or discarded.
 *
 * Follows main rather than owning the list: an interruption ended on the bar
 * or the deck, or placed in the other window, arrives on
 * `onInterruptionsUpdated`.
 */
export const InterruptionsToPlace: React.FC<InterruptionsToPlaceProps> = ({ hint, onJumpToDay, compact = false }) => {
  const [waiting, setWaiting] = useState<InterruptionToPlaceDTO[]>([]);
  const [placing, setPlacing] = useState<Placing | null>(null);
  // A place of closed-week time, waiting for the user to say go on.
  const [asking, setAsking] = useState<Placing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastWeekClosed, setLastWeekClosed] = useState<string | null>(null);
  const { providerName } = useProviderCapabilities();

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getInterruptionsToPlace) return undefined;
    let current = true;
    api.getInterruptionsToPlace().then(
      list => { if (current) setWaiting(list); },
      err => console.error('[InterruptionsToPlace] Could not read the interruptions to place:', err)
    );
    const off = api.onInterruptionsUpdated?.(list => { if (current) setWaiting(list); });
    return () => {
      current = false;
      off?.();
    };
  }, []);

  useEffect(() => {
    const read = window.electronAPI?.getLastWeekClosed;
    if (!read) return undefined;
    let current = true;
    read().then(
      monday => { if (current) setLastWeekClosed(monday); },
      err => console.error('[InterruptionsToPlace] Could not read the last week closed:', err)
    );
    return () => { current = false; };
  }, []);

  if (waiting.length === 0) return null;

  /** Main answers with the list on its own channel; a failure is shown here. */
  const act = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch(err => setError(ipcErrorMessage(err)));
  };

  const startPlacing = (items: InterruptionToPlaceDTO[], label: string) => {
    const request = { ids: items.map(item => item.id), label };
    if (items.some(item => isInClosedWeek(item.startedAtUtc, lastWeekClosed))) setAsking(request);
    else setPlacing(request);
  };

  const placeOn = (ids: string[], taskId: string) => {
    setPlacing(null);
    act(() => ids.length === 1
      ? window.electronAPI.placeInterruption(ids[0], taskId)
      : window.electronAPI.placeInterruptions(ids, taskId));
  };

  const row = compact ? 'py-1 px-2' : 'py-1.5 px-2.5';
  const small = 'flex items-center gap-1 px-2 py-0.5 border border-border-dark rounded text-text-secondary hover:text-white hover:border-focus';
  const today = localDateKey();

  return (
    <section aria-label="Interruptions to place" className={`bg-accent-amber/5 border border-accent-amber/30 rounded-xl ${compact ? 'p-4 space-y-2' : 'p-5 space-y-3'}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Zap className="w-4 h-4 text-accent-amber" />
          <span>Interruptions to place ({waiting.length})</span>
        </div>
        {waiting.length > 1 && (
          <button
            type="button"
            className={small}
            title="Put all of them on one task"
            onClick={() => startPlacing(waiting, `${waiting.length} interruptions`)}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>{Verb.PLACE} all</span>
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-secondary">{hint}</p>

      <div className="space-y-1.5">
        {waiting.map(item => {
          const dateKey = localDateKey(new Date(item.startedAtUtc));
          const when = dateKey === today
            ? formatClockTime(new Date(item.startedAtUtc))
            : `${formatDay(dateKey)} ${formatClockTime(new Date(item.startedAtUtc))}`;
          return (
            <div key={item.id} className={`flex items-center justify-between gap-3 text-xs ${row} bg-dark-900/60 border border-border-dark rounded-lg`}>
              <div className="min-w-0 flex-1">
                <InlineRename
                  title={item.title}
                  ownerId={item.id}
                  onRename={name => window.electronAPI.renameInterruption(item.id, name)}
                  className="font-bold text-white"
                  inputClassName="flex-1 bg-dark-800 border border-focus rounded px-2 py-0.5 text-white outline-none"
                />
                <div className="text-[10px] text-text-secondary truncate">
                  {onJumpToDay ? (
                    <button
                      type="button"
                      onClick={() => onJumpToDay(dateKey)}
                      className="hover:text-white underline-offset-2 hover:underline"
                    >
                      {when}
                    </button>
                  ) : when}
                  {item.interruptedTaskKey && <> · during <span className="font-mono">{item.interruptedTaskKey}</span></>}
                  {item.ofRun > 1 && <> · {item.index} of {item.ofRun}</>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono font-bold text-text-primary">{formatHoursAndMinutes(item.durationSeconds)}</span>
                <button
                  type="button"
                  aria-label={`${Verb.PLACE} ${item.title} on a task`}
                  title="Put its time on a task: sent like any entry, ten seconds to undo"
                  onClick={() => startPlacing([item], item.title)}
                  className={small}
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>{Verb.PLACE}…</span>
                </button>
                <button
                  type="button"
                  aria-label={`${keepOffLabel(providerName)}: ${item.title}`}
                  title="Keep its time in SprintTicker only, never sent"
                  onClick={() => act(() => window.electronAPI.keepInterruptionOff(item.id))}
                  className={small}
                >
                  {keepOffLabel(providerName)}
                </button>
                <button
                  type="button"
                  aria-label={`${Verb.DISCARD} ${item.title}`}
                  title="Throw it away: its time is kept nowhere. Ten seconds to undo."
                  onClick={() => act(() => window.electronAPI.discardInterruption(item.id))}
                  className="p-1 rounded text-text-secondary hover:text-accent-red hover:bg-accent-red/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p role="alert" className="text-xs text-accent-red">Not done: {error}</p>}

      {asking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6">
            <ConfirmPanel
              title={`${Verb.PLACE} ${asking.label}?`}
              message={closedWeekWarning(providerName)}
              confirmLabel={`${Verb.PLACE} anyway`}
              onConfirm={() => { setPlacing(asking); setAsking(null); }}
              onCancel={() => setAsking(null)}
            />
          </div>
        </div>
      )}

      <TaskSelectionModal
        isOpen={placing !== null}
        mode="move"
        projects={[]}
        onClose={() => setPlacing(null)}
        onSelectTask={taskId => { if (placing) placeOn(placing.ids, taskId); }}
      />
    </section>
  );
};
