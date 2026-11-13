import React, { useEffect, useState } from 'react';
import { Link2, Zap } from 'lucide-react';
import { InterruptionToPlaceDTO } from '../../shared/interruption';
import { localDateKey } from '../../shared/local-date';
import { closedWeekWarning, isInClosedWeek } from '../../shared/closed-week';
import { INTERRUPTION_SOURCE_WORDS, KEEP_AS_OWN_ENTRY, Verb, keepAsOwnEntryMeaning, toPlaceHint } from '../../shared/words';
import { formatClockTime, formatDay, formatHoursAndMinutes, ipcErrorMessage } from '../utils/formatters';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { InlineRename } from './InlineRename';
import { TaskPicker } from './TaskPicker';
import { ConfirmDialog } from './ConfirmPanel';
import { PlaceInterruptionsDialog } from './PlaceInterruptionsDialog';
import { RowMenu } from './RowMenu';

interface InterruptionsToPlaceProps {
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
 * The interruptions waiting to be placed, from any day, as main has them:
 * read once and followed on `onInterruptionsUpdated` -- one ended on the bar
 * or the deck, or placed in the other window, arrives there.
 */
export function useInterruptionsToPlace(): InterruptionToPlaceDTO[] {
  const [waiting, setWaiting] = useState<InterruptionToPlaceDTO[]>([]);
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
  return waiting;
}

/**
 * The interruptions that ended and wait to be placed (P6): Today's card,
 * History's list and the wrap-up's, one component so they cannot drift. Each can be named,
 * placed on a task -- its time is then sent like any entry, with ten seconds
 * to undo -- kept off the provider, or discarded.
 *
 * Follows main rather than owning the list: an interruption ended on the bar
 * or the deck, or placed in the other window, arrives on
 * `onInterruptionsUpdated`.
 */
export const InterruptionsToPlace: React.FC<InterruptionsToPlaceProps> = ({ onJumpToDay, compact = false }) => {
  const waiting = useInterruptionsToPlace();
  const [placing, setPlacing] = useState<Placing | null>(null);
  // A place of closed-week time, waiting for the user to say go on.
  const [asking, setAsking] = useState<Placing | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Each row its own task and name, in one dialog: Place all (S12b), or
  // one row's ↳ Place… -- which names it too (2026-11-12). Null when closed.
  const [placingRows, setPlacingRows] = useState<InterruptionToPlaceDTO[] | null>(null);
  // The rows ticked, to place together on one task (S5).
  const [ticks, setTicks] = useState<ReadonlySet<string>>(() => new Set());
  // Rename from ⋯: the row, and a count that remounts its field each time.
  const [renaming, setRenaming] = useState<{ id: string; n: number } | null>(null);
  const [lastWeekClosed, setLastWeekClosed] = useState<string | null>(null);
  const { providerName, capabilities } = useProviderCapabilities();
  const localOnly = capabilities?.providerId === 'adhoc';

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

  // A ticked row placed elsewhere leaves the list, and its tick with it.
  const ticked = waiting.filter(item => ticks.has(item.id));
  const totalSeconds = waiting.reduce((sum, item) => sum + item.durationSeconds, 0);

  /** Main answers with the list on its own channel; a failure is shown here. */
  const act = (action: () => Promise<unknown>) => {
    setError(null);
    action().catch(err => setError(ipcErrorMessage(err)));
  };

  const toggle = (id: string) => {
    setTicks(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startPlacing = (items: InterruptionToPlaceDTO[], label: string) => {
    const request = { ids: items.map(item => item.id), label };
    if (items.some(item => isInClosedWeek(item.startedAtUtc, lastWeekClosed))) setAsking(request);
    else setPlacing(request);
  };

  const placeOn = (ids: string[], taskId: string) => {
    setPlacing(null);
    setTicks(new Set());
    act(() => ids.length === 1
      ? window.electronAPI.placeInterruption(ids[0], taskId)
      : window.electronAPI.placeInterruptions(ids, taskId));
  };

  const row = compact ? 'py-1 px-2' : 'py-1.5 px-2.5';
  const small = 'flex items-center gap-1 px-2 py-0.5 border border-border-dark rounded text-text-secondary hover:text-white hover:border-focus';
  const primary = 'flex items-center gap-1 px-2 py-0.5 rounded bg-primary text-dark-900 font-semibold hover:bg-primary/90';
  const today = localDateKey();
  const keepMeaning = keepAsOwnEntryMeaning(providerName, localOnly);
  // One explanation wherever the list is -- Today, End my day, History --
  // which said it three ways, one with the retired "Kept off" (W4, W20).
  const hint = toPlaceHint(providerName, localOnly);

  return (
    <section aria-label="Interruptions to place" className={`bg-accent-amber/5 border border-accent-amber/30 rounded-xl ${compact ? 'p-4 space-y-2' : 'p-5 space-y-3'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <Zap className="w-4 h-4 text-accent-amber" />
            <span>Interruptions to place · {waiting.length} · <span className="font-mono">{formatHoursAndMinutes(totalSeconds)}</span></span>
          </h3>
          <p className="text-[11px] text-text-secondary">{hint}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs">
          {waiting.length > 1 && (
            <button
              type="button"
              className={small}
              title="Choose a task for each, in one place"
              onClick={() => { setError(null); setPlacingRows(waiting); }}
            >
              {Verb.PLACE} all {waiting.length}…
            </button>
          )}
          {ticked.length > 0 && (
            <button
              type="button"
              className={primary}
              title="Put the ticked ones on one task"
              onClick={() => startPlacing(ticked, ticked.length === 1 ? `"${ticked[0].title}"` : `the ${ticked.length} ticked`)}
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>{Verb.PLACE} {ticked.length}…</span>
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        {waiting.map(item => {
          const dateKey = localDateKey(new Date(item.startedAtUtc));
          const when = dateKey === today
            ? formatClockTime(new Date(item.startedAtUtc))
            : `${formatDay(dateKey)} ${formatClockTime(new Date(item.startedAtUtc))}`;
          const source = INTERRUPTION_SOURCE_WORDS[item.source];
          const renamingThis = renaming !== null && renaming.id === item.id;
          return (
            <div key={item.id} className={`flex items-center justify-between gap-3 text-xs ${row} bg-dark-900/60 border border-border-dark rounded-lg`}>
              <input
                type="checkbox"
                aria-label={`Tick ${item.title}`}
                checked={ticks.has(item.id)}
                onChange={() => toggle(item.id)}
                className="shrink-0 accent-primary"
              />
              <div className="min-w-0 flex-1">
                <InlineRename
                  key={renamingThis ? `${item.id}-${renaming.n}` : item.id}
                  title={item.title}
                  ownerId={item.id}
                  startEditing={renamingThis}
                  onRename={name => window.electronAPI.renameInterruption(item.id, name)}
                  className="font-bold text-white"
                  inputClassName="flex-1 bg-dark-800 border border-focus rounded px-2 py-0.5 text-white outline-none"
                />
                <div className="text-[10px] text-text-secondary truncate">
                  {item.interruptedTaskKey ? <>during <span className="font-mono">{item.interruptedTaskKey}</span></> : 'with nothing timing'}
                  {source && <> · {source}</>}
                  {item.ofRun > 1 && <> · {item.index} of {item.ofRun}</>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono font-bold text-text-primary">{formatHoursAndMinutes(item.durationSeconds)}</span>
                <span className="font-mono text-text-secondary text-right">
                  {onJumpToDay ? (
                    <button
                      type="button"
                      onClick={() => onJumpToDay(dateKey)}
                      className="hover:text-white underline-offset-2 hover:underline"
                    >
                      {when}
                    </button>
                  ) : when}
                </span>
                <button
                  type="button"
                  aria-label={`${Verb.PLACE} ${item.title} on a task`}
                  title="Name it and put its time on a task: sent like any entry, ten seconds to undo"
                  // The dialog asks about a closed week itself.
                  onClick={() => { setError(null); setPlacingRows([item]); }}
                  className={small}
                >
                  <span aria-hidden="true">↳</span> {Verb.PLACE}…
                </button>
                <RowMenu
                  name={item.title}
                  menuName={`Actions for ${item.title}`}
                  items={[
                    { label: 'Rename…', run: () => setRenaming(previous => ({ id: item.id, n: (previous?.n ?? 0) + 1 })) },
                    {
                      label: KEEP_AS_OWN_ENTRY,
                      title: keepMeaning,
                      run: () => act(() => window.electronAPI.keepInterruptionOff(item.id))
                    },
                    {
                      label: Verb.DISCARD,
                      danger: true,
                      title: 'Throw it away: its time is kept nowhere. Ten seconds to undo.',
                      run: () => act(() => window.electronAPI.discardInterruption(item.id))
                    }
                  ]}
                />
              </div>
            </div>
          );
        })}
      </div>

      {error && <p role="alert" className="text-xs text-accent-red">Not done: {error}</p>}

      {asking && (
            <ConfirmDialog
              title={`${Verb.PLACE} ${asking.label}?`}
              message={closedWeekWarning(providerName)}
              confirmLabel={`${Verb.PLACE} anyway`}
              onConfirm={() => { setPlacing(asking); setAsking(null); }}
              onCancel={() => setAsking(null)}
            />
      )}

      {placingRows && (
        <PlaceInterruptionsDialog
          // Rows placed elsewhere meanwhile leave it, as they leave the list.
          waiting={placingRows.filter(row => waiting.some(item => item.id === row.id))}
          providerName={providerName}
          localOnly={localOnly}
          lastWeekClosed={lastWeekClosed}
          onClose={() => setPlacingRows(null)}
          onError={setError}
        />
      )}

      <TaskPicker
        isOpen={placing !== null}
        mode="place"
        title={placing ? `${Verb.PLACE} ${placing.label} on a task` : undefined}
        subtitle="Its time is sent to the task you pick, with ten seconds to undo."
        onClose={() => setPlacing(null)}
        onPick={picked => { if (placing && picked.task) placeOn(placing.ids, picked.task.id); }}
        onKeepOff={placing ? () => act(() => Promise.all(placing.ids.map(id => window.electronAPI.keepInterruptionOff(id)))) : undefined}
        keepOffMeaning={keepMeaning}
      />
    </section>
  );
};
