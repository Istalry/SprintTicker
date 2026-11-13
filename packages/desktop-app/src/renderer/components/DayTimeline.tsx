import React from 'react';
import { ScheduleSettingsDTO, WorklogDTO } from '../../shared/dtos';
import { dayGaps, gapSeconds, Span, spanOf, workingWindow } from '../../shared/day-gaps';
import { formatHoursAndMinutes, formatHoursMinutes } from '../utils/formatters';

/** Hours between the axis's marks. */
const TICK_HOURS = 2;
/** A mark this close to the end is dropped, so the end's label has room. */
const TICK_MIN_GAP_MS = 60 * 60_000;
/** A block narrower than this share of the strip has no label, only its tooltip. */
const LABEL_MIN_SHARE = 0.04;

/** The untracked stretches' look: hatched, as in the mockup and the legend. */
const HATCH: React.CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.14) 0 3px, transparent 3px 7px)'
};

export interface RunningSpan extends Span {
  label: string;
}

interface DayTimelineProps {
  /** The day, at local midnight or any time in it. */
  day: Date;
  entries: readonly WorklogDTO[];
  schedule: ScheduleSettingsDTO | null;
  /** The session running, on today: covered, not untracked. */
  running?: RunningSpan | null;
  /** On today, now: the rest of the day is not missing yet. */
  untilMs?: number;
  onGap: (gap: Span) => void;
  onEntry: (entry: WorklogDTO) => void;
}

const clock = (ms: number) => formatHoursMinutes(new Date(ms));

/**
 * The day as a strip (S14b, P9b): its working hours, each entry a block
 * named by its task, ⚡ for time that began as an interruption, lunch, and
 * the untracked stretches hatched. A click on a block opens Correct; on a
 * stretch, Add time at its times. Nothing is guessed or logged from a gap.
 */
export const DayTimeline: React.FC<DayTimelineProps> = ({ day, entries, schedule, running = null, untilMs, onGap, onEntry }) => {
  const window = schedule ? workingWindow(day, schedule) : null;
  const spans = entries.map(entry => ({ entry, ...spanOf(entry) }));
  const covered: Span[] = [...spans, ...(running ? [running] : [])];
  if (!window && covered.length === 0) return null;

  const fromMs = Math.min(window?.startMs ?? Infinity, ...covered.map(s => s.startMs));
  const toMs = Math.max(window?.endMs ?? -Infinity, ...covered.map(s => s.endMs));
  const length = toMs - fromMs;
  if (!(length > 0)) return null;
  const place = (span: Span): React.CSSProperties => ({
    left: `${((span.startMs - fromMs) / length) * 100}%`,
    width: `${Math.max(((span.endMs - span.startMs) / length) * 100, 0.4)}%`
  });
  const wide = (span: Span) => (span.endMs - span.startMs) / length >= LABEL_MIN_SHARE;

  const gaps = window ? dayGaps(window, covered, untilMs) : [];
  const logged = entries.reduce((sum, entry) => sum + entry.durationSeconds, 0);
  const ticks = [fromMs];
  const firstHour = new Date(fromMs);
  firstHour.setMinutes(0, 0, 0);
  for (let t = firstHour.getTime() + TICK_HOURS * 3600_000; t < toMs - TICK_MIN_GAP_MS; t += TICK_HOURS * 3600_000) ticks.push(t);
  ticks.push(toMs);

  return (
    <div aria-label="The day as a timeline" role="group" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
        <span>
          <span className="font-mono text-text-primary">{formatHoursAndMinutes(logged)}</span> logged
          {window && <> · <span className="font-mono text-text-primary">{formatHoursAndMinutes(gapSeconds(gaps))}</span> not timed in working hours</>}
        </span>
        {window && <span className="font-mono">{clock(window.startMs)} – {clock(window.endMs)}</span>}
      </div>

      <div className="relative h-10 rounded-lg bg-dark-900 border border-border-dark overflow-hidden">
        {window?.lunch && (
          <div
            title="Lunch"
            style={place(window.lunch)}
            className="absolute inset-y-0 bg-dark-700/60 text-[10px] text-text-secondary flex items-center justify-center"
          >
            {wide(window.lunch) && 'Lunch'}
          </div>
        )}
        {spans.map(({ entry, ...span }) => (
          <button
            key={entry.id}
            type="button"
            aria-label={`Correct ${entry.taskKey ?? entry.taskId}, ${clock(span.startMs)}–${clock(span.endMs)}`}
            title={`${entry.taskKey ?? entry.taskId} · ${entry.comment || entry.taskTitle || ''} · ${clock(span.startMs)}–${clock(span.endMs)}`}
            onClick={() => onEntry(entry)}
            style={place(span)}
            className={`absolute inset-y-1 rounded border text-[10px] font-mono font-bold truncate px-1 ${
              entry.fromInterruption
                ? 'bg-accent-amber/15 border-accent-amber/40 text-accent-amber hover:bg-accent-amber/25'
                : 'bg-dark-700 border-border-dark text-text-primary hover:border-focus'
            }`}
          >
            {wide(span) ? `${entry.fromInterruption ? '⚡ ' : ''}${entry.taskKey ?? entry.taskId}` : entry.fromInterruption ? '⚡' : ''}
          </button>
        ))}
        {running && (
          <div
            title={`${running.label} · running`}
            style={place(running)}
            className="absolute inset-y-1 rounded border border-accent-green/50 bg-accent-green/15 text-[10px] font-mono font-bold text-accent-green truncate px-1 flex items-center"
          >
            {wide(running) && running.label}
          </div>
        )}
        {gaps.map(gap => (
          <button
            key={gap.startMs}
            type="button"
            aria-label={`${clock(gap.startMs)}–${clock(gap.endMs)} not timed: add time`}
            title={`${clock(gap.startMs)}–${clock(gap.endMs)} not timed`}
            onClick={() => onGap(gap)}
            style={{ ...place(gap), ...HATCH }}
            className="absolute inset-y-1 rounded border border-dashed border-border-dark hover:border-focus"
          />
        ))}
      </div>

      <div className="relative h-4 text-[10px] text-text-secondary font-mono">
        {ticks.map((t, i) => (
          <span
            key={t}
            className="absolute"
            style={i === 0 ? { left: 0 } : i === ticks.length - 1 ? { right: 0 } : { left: `${((t - fromMs) / length) * 100}%`, transform: 'translateX(-50%)' }}
          >
            {clock(t)}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-secondary">
        {gaps.map(gap => (
          <button
            key={gap.startMs}
            type="button"
            onClick={() => onGap(gap)}
            className="hover:text-white underline-offset-2 hover:underline"
          >
            <span aria-hidden="true">▨</span> {clock(gap.startMs)}–{clock(gap.endMs)} not timed · add time
          </button>
        ))}
        <span className="ml-auto">Each block names its task · ⚡ marks an interruption · hatched is not timed</span>
      </div>
    </div>
  );
};
