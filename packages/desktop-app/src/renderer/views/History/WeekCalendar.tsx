import React, { useEffect, useRef, useState } from 'react';
import { ScheduleSettingsDTO, WorklogDTO } from '../../../shared/dtos';
import { addLocalDays, localDateKey } from '../../../shared/local-date';
import {
  CALENDAR_CLICK_MINUTES,
  CALENDAR_SNAP_MINUTES,
  calendarHours,
  movedEntry,
  overlapFixes,
  placeDay,
  resizedEntry,
  snapMinutes
} from '../../../shared/calendar';
import { dayGaps, Span, spanOf, workingWindow } from '../../../shared/day-gaps';
import { findOverlaps } from '../../../shared/overlap';
import { closedWeekWarning, isInClosedWeek } from '../../../shared/closed-week';
import { checkWorklogCorrection, WorklogCorrectionDTO } from '../../../shared/worklog-correction';
import { EntryAction, useEntryActions } from '../../components/EntryActions';
import { AddTimeStart, toLocalInput } from '../../components/AddTimeDialog';
import { ConfirmDialog } from '../../components/ConfirmPanel';
import { SPLIT_MIN_SECONDS } from '../../components/SplitWorklogDialog';
import { formatHoursAndMinutes, formatHoursMinutes, formatWeekday, ipcErrorMessage } from '../../utils/formatters';
import { useProviderCapabilities } from '../../hooks/useProviderCapabilities';
import { useMenu } from '../../hooks/useMenu';

/** One hour of the grid, in pixels: a quarter is 12, which a pointer can hit. */
export const CALENDAR_HOUR_PX = 48;
const MINUTE_PX = CALENDAR_HOUR_PX / 60;
/** A pointer that moved less than this clicked; more, it drags. */
const DRAG_THRESHOLD_PX = 4;
/** The shortest block drawn, so a two-minute entry can still be hit. */
const BLOCK_MIN_PX = 14;
/** Weekdays shown even when empty: Monday to Friday. A weekend shows when it has time. */
const WEEKDAYS_SHOWN = 5;

interface WeekRead {
  monday: string;
  entries: WorklogDTO[];
  schedule: ScheduleSettingsDTO | null;
  running: (Span & { label: string }) | null;
  readAtMs: number;
}

/** What the pointer is doing: drawing a new entry, or moving or resizing one. */
interface Drag {
  kind: 'new' | 'move' | 'start' | 'end';
  dayIndex: number;
  log?: WorklogDTO;
  fromX: number;
  fromY: number;
  dx: number;
  dy: number;
  /** The width of a day's column when the drag began, to tell how many days it crossed. */
  columnWidth: number;
  /** Where the column's top was on screen, for the slot being drawn. */
  columnTop: number;
  moved: boolean;
}

/** The clock, read when a gesture lands -- never during render. */
const nowMs = (): number => Date.now();

const dateOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** The hours the schedule works, as whole hours, from its first working day this week. */
function workingHours(schedule: ScheduleSettingsDTO | null, dayKeys: readonly string[]): { start: number; end: number } | null {
  if (!schedule) return null;
  for (const key of dayKeys) {
    const window = workingWindow(dateOf(key), schedule);
    if (!window) continue;
    const start = new Date(window.startMs);
    const end = new Date(window.endMs);
    return { start: start.getHours(), end: end.getHours() + (end.getMinutes() ? 1 : 0) };
  }
  return null;
}

/**
 * History's calendar (LOCAL-WORK-AND-CALENDAR.md §5, T3): the week as
 * columns and its entries as blocks over the hours, made to change as a
 * calendar is. A click on an empty slot adds an entry there -- dragging
 * sets its length; a click on a block selects it, with handles at its top
 * and bottom; dragging a block moves it to another hour or day; a click on
 * the selected block opens Correct, Split in two, Move and Delete, and the
 * Delete key deletes it. Each goes through the commands the rows use, with
 * their Undo, and asks first in a closed week as they do. The week's
 * overlaps are listed under it, each with its fixes.
 */
export const WeekCalendar: React.FC<{
  monday: string;
  revision: number;
  onChanged: () => void;
  onAdd: (start: AddTimeStart) => void;
}> = ({ monday, revision, onChanged, onAdd }) => {
  const [read, setRead] = useState<WeekRead | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [asking, setAsking] = useState<{ log: WorklogDTO; correction: WorklogCorrectionDTO } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [lastWeekClosed, setLastWeekClosed] = useState<string | null>(null);
  // A drag ends in a click on the same block; that click is the drag's, not a selection.
  const dragged = useRef(false);
  const { providerName } = useProviderCapabilities();
  const entries = read?.entries ?? [];
  const actions = useEntryActions(entries, onChanged);
  const sunday = addLocalDays(monday, 6);

  useEffect(() => {
    let current = true;
    const api = window.electronAPI;
    const today = localDateKey();
    const thisWeek = today >= monday && today <= sunday;
    Promise.all([
      api?.getWorklogsRange ? api.getWorklogsRange(monday, sunday) : Promise.resolve([]),
      api?.getScheduleSettings ? api.getScheduleSettings().catch(() => null) : Promise.resolve(null),
      thisWeek && api?.getCurrentSession ? api.getCurrentSession().catch(() => null) : Promise.resolve(null),
      api?.getLastWeekClosed ? api.getLastWeekClosed().catch(() => null) : Promise.resolve(null)
    ]).then(
      ([logs, schedule, session, closed]) => {
        if (!current) return;
        const readAtMs = Date.now();
        setLastWeekClosed(closed);
        setRead({
          monday,
          entries: logs,
          schedule,
          running: session
            ? { startMs: Date.parse(session.startTimeUtc), endMs: readAtMs, label: session.interruption ? '⚡' : session.taskKey }
            : null,
          readAtMs
        });
      },
      err => {
        console.error('[WeekCalendar] Failed to read the week of', monday, err);
        if (current) setRead({ monday, entries: [], schedule: null, running: null, readAtMs: Date.now() });
      }
    );
    return () => { current = false; };
  }, [monday, sunday, revision]);

  if (!read || read.monday !== monday) return <div className="text-xs text-text-secondary py-4">Loading the week…</div>;

  const allDays = Array.from({ length: 7 }, (_, i) => addLocalDays(monday, i));
  const keyOf = (ms: number) => localDateKey(new Date(ms));
  const withTime = new Set(entries.map(e => keyOf(Date.parse(e.startedAtUtc))));
  const dayKeys = allDays.filter((key, i) => i < WEEKDAYS_SHOWN || withTime.has(key));
  const hours = calendarHours([...entries.map(spanOf), ...(read.running ? [read.running] : [])], workingHours(read.schedule, dayKeys));
  const gridHeight = (hours.end - hours.start) * CALENDAR_HOUR_PX;
  const today = localDateKey();
  const byId = new Map(entries.map(e => [e.id, e]));
  const selectedLog = selected ? byId.get(selected) ?? null : null;

  /** Minutes since the grid's first hour, of a moment on `dayKey`. */
  const minuteOf = (ms: number, dayKey: string) => (ms - dateOf(dayKey).getTime()) / 60_000 - hours.start * 60;

  /** Saves a gesture's correction -- after asking, when it touches a closed week. */
  const apply = (log: WorklogDTO, correction: WorklogCorrectionDTO) => {
    const refusal = checkWorklogCorrection(correction, nowMs());
    if (refusal) {
      setProblem(refusal);
      return;
    }
    if (isInClosedWeek(log.startedAtUtc, lastWeekClosed) || isInClosedWeek(correction.startedAtUtc, lastWeekClosed)) {
      setAsking({ log, correction });
      return;
    }
    save(log, correction);
  };
  const save = (log: WorklogDTO, correction: WorklogCorrectionDTO) => {
    setProblem(null);
    window.electronAPI.updateWorklog(log.id, correction).then(onChanged, err => setProblem(ipcErrorMessage(err)));
  };

  const run = (log: WorklogDTO, action: EntryAction) => {
    setMenuFor(null);
    actions.run(log, action);
  };

  const beginDrag = (e: React.PointerEvent<HTMLElement>, kind: Drag['kind'], dayIndex: number, log?: WorklogDTO) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragged.current = false;
    const column = (e.currentTarget.closest('[data-day]') as HTMLElement | null)?.getBoundingClientRect();
    setDrag({ kind, dayIndex, log, fromX: e.clientX, fromY: e.clientY, dx: 0, dy: 0, columnWidth: column?.width ?? 0, columnTop: column?.top ?? 0, moved: false });
  };
  const moveDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const dx = e.clientX - drag.fromX;
    const dy = e.clientY - drag.fromY;
    setDrag({ ...drag, dx, dy, moved: drag.moved || Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX });
  };
  const endDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const columnTop = drag.columnTop;
    const dx = e.clientX - drag.fromX;
    const dy = e.clientY - drag.fromY;
    const moved = drag.moved || Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX;
    setDrag(null);
    if (drag.kind === 'new') {
      const top = Math.min(drag.fromY, e.clientY) - columnTop;
      const bottom = Math.max(drag.fromY, e.clientY) - columnTop;
      const startMinute = hours.start * 60 + snapMinutes(top / MINUTE_PX - (moved ? 0 : CALENDAR_SNAP_MINUTES / 2));
      const minutes = moved ? Math.max(snapMinutes((bottom - top) / MINUTE_PX), CALENDAR_SNAP_MINUTES) : CALENDAR_CLICK_MINUTES;
      const start = dateOf(dayKeys[drag.dayIndex]);
      start.setMinutes(startMinute);
      onAdd({ dateKey: dayKeys[drag.dayIndex], start: toLocalInput(start), durationSeconds: minutes * 60 });
      return;
    }
    if (!moved || !drag.log) return;
    dragged.current = true;
    const minutes = dy / MINUTE_PX;
    if (drag.kind === 'move') {
      const days = drag.columnWidth > 0 ? Math.round(dx / drag.columnWidth) : 0;
      apply(drag.log, movedEntry(drag.log, minutes, days));
    } else {
      apply(drag.log, resizedEntry(drag.log, drag.kind, minutes));
    }
  };

  // The week's overlaps, a day at a time: an entry overlaps only its own day's.
  const overlaps = dayKeys.flatMap(key => findOverlaps(entries.filter(e => keyOf(Date.parse(e.startedAtUtc)) === key)));
  const clock = (ms: number) => formatHoursMinutes(new Date(ms));
  const label = (log: WorklogDTO) => log.taskKey ?? log.taskId;

  return (
    <section
      aria-label="The week as a calendar"
      className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-3 select-none"
      onKeyDown={e => {
        if (e.key === 'Escape' && (selected || menuFor)) {
          setSelected(null);
          setMenuFor(null);
        }
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-text-secondary">
          Click an empty slot to add time, or drag over it for its length. Click an entry to select it, drag it to move it, drag its edges to change its times; click it again for Correct, Split, Move and Delete.
        </p>
        <button
          type="button"
          onClick={() => onAdd({ dateKey: today >= monday && today <= sunday ? today : monday })}
          className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-border-dark text-text-secondary hover:text-white hover:border-focus"
        >
          + Add time
        </button>
      </div>
      {problem && <p role="alert" className="text-xs text-accent-red">Not changed: {problem}</p>}
      {actions.moveError && <p role="alert" className="text-xs text-accent-red">Not moved: {actions.moveError}</p>}

      <div className="overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="flex border-b border-border-dark text-xs text-text-secondary">
            <div className="w-12 shrink-0" />
            {dayKeys.map(key => {
              const seconds = entries.filter(e => keyOf(Date.parse(e.startedAtUtc)) === key).reduce((sum, e) => sum + e.durationSeconds, 0);
              return (
                <div key={key} className={`flex-1 px-2 py-2 ${key === today ? 'text-white font-bold' : ''}`}>
                  {formatWeekday(key, 'short')} {dateOf(key).getDate()}
                  {seconds > 0 && <span className="ml-2 font-mono font-normal text-text-secondary">{formatHoursAndMinutes(seconds)}</span>}
                </div>
              );
            })}
          </div>

          <div className="flex">
            <div className="w-12 shrink-0 relative" style={{ height: gridHeight }} aria-hidden="true">
              {Array.from({ length: hours.end - hours.start }, (_, i) => (
                <div key={i} className="absolute right-2 -translate-y-1/2 text-[10px] font-mono text-text-secondary" style={{ top: i * CALENDAR_HOUR_PX }}>
                  {i === 0 ? '' : `${String(hours.start + i).padStart(2, '0')}:00`}
                </div>
              ))}
            </div>

            {dayKeys.map((key, dayIndex) => {
              const dayStart = dateOf(key);
              const dayEntries = entries.filter(e => keyOf(Date.parse(e.startedAtUtc)) === key);
              const window = read.schedule ? workingWindow(dayStart, read.schedule) : null;
              const running = read.running && keyOf(read.running.startMs) === key ? read.running : null;
              const covered = [...dayEntries.map(spanOf), ...(running ? [running] : [])];
              const untilMs = key === today ? read.readAtMs : key > today ? dayStart.getTime() : undefined;
              const gaps = window ? dayGaps(window, covered, untilMs) : [];
              const at = (span: Span) => {
                const top = Math.max(minuteOf(span.startMs, key), 0) * MINUTE_PX;
                const bottom = Math.min(minuteOf(span.endMs, key) * MINUTE_PX, gridHeight);
                return { top, height: Math.max(bottom - top, BLOCK_MIN_PX) };
              };
              return (
                <div
                  key={key}
                  role="group"
                  aria-label={`${formatWeekday(key, 'long')} ${dayStart.getDate()}: click to add time`}
                  data-day={key}
                  className={`relative flex-1 border-l border-border-dark ${key === today ? 'bg-dark-900/40' : ''} cursor-crosshair`}
                  style={{ height: gridHeight }}
                  onPointerDown={e => {
                    setSelected(null);
                    setMenuFor(null);
                    beginDrag(e, 'new', dayIndex);
                  }}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                >
                  {Array.from({ length: hours.end - hours.start }, (_, i) => (
                    <div key={i} aria-hidden="true" className="absolute inset-x-0 border-t border-border-dark/60 pointer-events-none" style={{ top: i * CALENDAR_HOUR_PX }} />
                  ))}
                  {gaps.map(gap => (
                    <div
                      key={gap.startMs}
                      aria-hidden="true"
                      title="Not timed"
                      className="absolute inset-x-1 rounded border border-dashed border-border-field pointer-events-none"
                      style={at(gap)}
                    />
                  ))}
                  {drag?.kind === 'new' && drag.dayIndex === dayIndex && drag.moved && (
                    <div
                      aria-hidden="true"
                      className="absolute inset-x-1 rounded bg-accent-green/20 border border-accent-green pointer-events-none"
                      style={{ top: Math.min(drag.fromY, drag.fromY + drag.dy) - drag.columnTop, height: Math.abs(drag.dy) }}
                    />
                  )}
                  {running && (
                    <div
                      role="img"
                      aria-label={`${running.label} running since ${clock(running.startMs)}`}
                      className="absolute inset-x-1 rounded bg-accent-green/20 border border-accent-green px-1.5 text-[11px] text-white overflow-hidden"
                      style={at(running)}
                      onPointerDown={e => e.stopPropagation()}
                    >
                      <span className="font-mono font-bold">{running.label}</span> running
                    </div>
                  )}
                  {placeDay(dayEntries).map(({ entry: log, column, columns }) => {
                    const span = spanOf(log);
                    const place = at(span);
                    const isDragged = drag && drag.log?.id === log.id && drag.moved;
                    const shift = isDragged && drag
                      ? drag.kind === 'move'
                        ? { top: place.top + snapMinutes(drag.dy / MINUTE_PX) * MINUTE_PX, height: place.height }
                        : drag.kind === 'start'
                        ? { top: place.top + snapMinutes(drag.dy / MINUTE_PX) * MINUTE_PX, height: place.height - snapMinutes(drag.dy / MINUTE_PX) * MINUTE_PX }
                        : { top: place.top, height: place.height + snapMinutes(drag.dy / MINUTE_PX) * MINUTE_PX }
                      : place;
                    const dayShift = isDragged && drag?.kind === 'move' && drag.columnWidth > 0 ? Math.round(drag.dx / drag.columnWidth) : 0;
                    return (
                      <CalendarBlock
                        key={log.id}
                        log={log}
                        label={label(log)}
                        times={`${clock(span.startMs)}–${clock(span.endMs)}`}
                        style={{
                          top: shift.top,
                          height: Math.max(shift.height, BLOCK_MIN_PX),
                          left: `calc(${(column / columns) * 100}% + 2px)`,
                          width: `calc(${100 / columns}% - 4px)`,
                          transform: dayShift ? `translateX(${dayShift * 100 * columns}%)` : undefined
                        }}
                        selected={selected === log.id}
                        menuOpen={menuFor === log.id}
                        dragging={Boolean(isDragged)}
                        onPointerDown={(e, kind) => beginDrag(e, kind, dayIndex, log)}
                        onClick={() => {
                          if (dragged.current) {
                            dragged.current = false;
                            return;
                          }
                          if (selected === log.id) setMenuFor(menuFor === log.id ? null : log.id);
                          else {
                            setSelected(log.id);
                            setMenuFor(null);
                          }
                        }}
                        onDelete={() => run(log, 'delete')}
                        onAction={action => run(log, action)}
                        onCloseMenu={() => setMenuFor(null)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {overlaps.length > 0 && (
        <section aria-label="Overlaps this week" className="space-y-2 pt-2">
          <h4 className="text-xs font-bold text-accent-amber">Overlaps this week · the later entry is held until one is corrected</h4>
          <ul className="space-y-1.5">
            {overlaps.map(overlap => {
              const fixes = overlapFixes(overlap);
              const first = spanOf(overlap.earlier);
              const second = spanOf(overlap.later);
              const button = 'px-2 py-0.5 rounded-md border border-border-dark text-text-primary hover:text-white hover:border-focus';
              return (
                <li key={`${overlap.earlier.id}-${overlap.later.id}`} className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                  <span>
                    {formatWeekday(keyOf(first.startMs), 'short')}: <span className="font-mono text-text-primary">{label(overlap.earlier)}</span> {clock(first.startMs)}–{clock(first.endMs)} and{' '}
                    <span className="font-mono text-text-primary">{label(overlap.later)}</span> {clock(second.startMs)}–{clock(second.endMs)} share {formatHoursAndMinutes(overlap.seconds)}
                  </span>
                  {fixes.endFirst && (
                    <button type="button" className={button} onClick={() => apply(overlap.earlier, fixes.endFirst!)}>
                      End {label(overlap.earlier)} at {clock(second.startMs)}
                    </button>
                  )}
                  {fixes.startSecond && (
                    <button type="button" className={button} onClick={() => apply(overlap.later, fixes.startSecond!)}>
                      Start {label(overlap.later)} at {clock(first.endMs)}
                    </button>
                  )}
                  <button type="button" className={button} onClick={() => run(overlap.later, 'edit')}>Correct…</button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {selectedLog && (
        <p className="text-[11px] text-text-secondary">
          Selected: <span className="font-mono text-text-primary">{label(selectedLog)}</span> — click it again for its actions, Delete to delete it, Escape to let go.
        </p>
      )}

      {actions.dialogs}
      {asking && (
        <ConfirmDialog
          title="Change closed-week time?"
          message={closedWeekWarning(providerName || 'your provider')}
          confirmLabel="Change it"
          cancelLabel="Leave it"
          onConfirm={() => {
            save(asking.log, asking.correction);
            setAsking(null);
          }}
          onCancel={() => setAsking(null)}
        />
      )}
    </section>
  );
};

/** One entry on the grid: selected, it has handles; its menu holds the row's actions. */
const CalendarBlock: React.FC<{
  log: WorklogDTO;
  label: string;
  times: string;
  style: React.CSSProperties;
  selected: boolean;
  menuOpen: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>, kind: 'move' | 'start' | 'end') => void;
  onClick: () => void;
  onDelete: () => void;
  onAction: (action: EntryAction) => void;
  onCloseMenu: () => void;
}> = ({ log, label, times, style, selected, menuOpen, dragging, onPointerDown, onClick, onDelete, onAction, onCloseMenu }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useMenu(menuOpen, onCloseMenu, { root: rootRef, menu: menuRef, trigger: triggerRef });
  const held = log.syncState === 'held-overlap';
  const tone = held
    ? 'bg-accent-amber/15 border-accent-amber'
    : log.fromInterruption
    ? 'bg-dark-700 border-accent-amber/60'
    : 'bg-dark-700 border-border-field';
  const item = 'w-full text-left px-3 py-1.5 rounded-md hover:bg-dark-700';
  return (
    <div ref={rootRef} className={`absolute ${dragging ? 'z-30 opacity-80' : selected ? 'z-20' : 'z-10'}`} style={style}>
      <button
        ref={triggerRef}
        type="button"
        aria-pressed={selected}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`${label} ${log.taskTitle ?? ''}, ${times}${held ? ', held by an overlap' : ''}`}
        onPointerDown={e => onPointerDown(e, 'move')}
        onClick={onClick}
        onKeyDown={e => {
          if (selected && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            onDelete();
          }
        }}
        className={`w-full h-full rounded border px-1.5 text-left text-[11px] leading-tight overflow-hidden cursor-grab ${tone} ${selected ? 'ring-2 ring-focus' : ''}`}
      >
        <span className="font-mono font-bold text-text-primary">{log.fromInterruption && <span aria-hidden="true">⚡</span>}{label}</span>{' '}
        <span className="text-text-secondary">{log.comment || log.taskTitle}</span>
      </button>
      {selected && (
        <>
          <div
            aria-hidden="true"
            data-handle="start"
            className="absolute left-1/2 -top-1 h-2 w-6 -translate-x-1/2 rounded bg-focus cursor-ns-resize"
            onPointerDown={e => onPointerDown(e, 'start')}
          />
          <div
            aria-hidden="true"
            data-handle="end"
            className="absolute left-1/2 -bottom-1 h-2 w-6 -translate-x-1/2 rounded bg-focus cursor-ns-resize"
            onPointerDown={e => onPointerDown(e, 'end')}
          />
        </>
      )}
      {menuOpen && (
        <div ref={menuRef} role="menu" aria-label={`Actions for ${label}`} className="absolute left-full top-0 ml-2 z-40 w-40 rounded-lg border border-border-dark bg-dark-800 p-1 text-xs shadow-xl">
          <button type="button" role="menuitem" className={item} onClick={() => onAction('edit')}>Correct…</button>
          {log.durationSeconds >= SPLIT_MIN_SECONDS && <button type="button" role="menuitem" className={item} onClick={() => onAction('split')}>Split in two…</button>}
          <button type="button" role="menuitem" className={item} onClick={() => onAction('move')}>↳ Move…</button>
          <button type="button" role="menuitem" className={`${item} text-accent-red`} onClick={() => onAction('delete')}>Delete…</button>
        </div>
      )}
    </div>
  );
};
