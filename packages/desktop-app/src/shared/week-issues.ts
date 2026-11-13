import type { ScheduleSettingsDTO, WeekChangeDTO, WorklogDTO } from './dtos';
import { localDateKey, localMidnight } from './local-date';
import { formatHoursAndMinutes } from './time-format';
import { dayGaps, gapSeconds, Span, spanOf, workingWindow } from './day-gaps';
import { findOverlaps } from './overlap';
import { refusalReason } from './refused-entry';

/**
 * Check my week (S15b, P9d): every problem of a week in one list, each with
 * its fix, so nothing has to be hunted across Today, History and End my day.
 * Pure: the window reads the week and passes it in, with the clock.
 *
 * What is listed, in this order:
 * - each interruption of the week still to place (Place…);
 * - the corrections not answered yet, and the entries not sent (Send now,
 *   when one was refused -- a row on its way needs nothing);
 * - the entries the provider refused for good (P11c), with its reason:
 *   sending again would not help, so the fix opens the day, whose ⋯ moves
 *   one or keeps it off the provider;
 * - each day worked with untracked time in its working hours (Open <day>).
 *   There is no daily target to be "under" (the user's choice, 2026-11-12):
 *   a gap is time nobody accounted for, which is what a target would show;
 * - each pair of overlapping entries (Fix…, on that day);
 * - in a week already closed, each change made after it closed: what the
 *   user's manager saw has moved.
 */

export type WeekIssueKind = 'to-place' | 'correction' | 'not-sent' | 'refused' | 'gaps' | 'overlap' | 'closed-change';

export type WeekIssueFix =
  | { kind: 'place' }
  | { kind: 'send-now' }
  | { kind: 'open-day'; dateKey: string; label: string }
  | { kind: 'none' };

export interface WeekIssue {
  kind: WeekIssueKind;
  title: string;
  /** One line each. */
  details: string[];
  fix: WeekIssueFix;
}

/** What the check reads of an interruption still to place. */
export interface FragmentToPlace {
  id: string;
  title: string;
  startedAtUtc: string;
  endedAtUtc: string;
  durationSeconds: number;
  interruptedTaskKey: string | null;
}

export interface WeekCheckInput {
  /** The week's seven days, Monday first. */
  dayKeys: readonly string[];
  entries: readonly WorklogDTO[];
  /** Every interruption waiting, of any day: the week's are picked here. */
  toPlace: readonly FragmentToPlace[];
  /** The working hours; null leaves the gaps out. */
  schedule: ScheduleSettingsDTO | null;
  /** The session running now, covered rather than untracked. */
  running: Span | null;
  /** Changes made after the week closed, or null for a week still open. */
  changes: readonly WeekChangeDTO[] | null;
  nowMs: number;
  providerName: string;
  dayName: (dateKey: string) => string;
  clock: (ms: number) => string;
}

export interface WeekCheck {
  issues: WeekIssue[];
  /** Whether the week is closed: with no change listed, the window says so. */
  closed: boolean;
}

const dayOf = (startedAtUtc: string) => localDateKey(new Date(startedAtUtc));
const keyOf = (entry: WorklogDTO) => entry.taskKey ?? entry.taskId;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "+25m", "−10m", or null when only the times moved. */
function changeOf(entry: WorklogDTO): string | null {
  if (entry.providerSeconds === undefined) return null;
  const delta = entry.durationSeconds - entry.providerSeconds;
  if (delta === 0) return null;
  return `${delta > 0 ? '+' : '−'}${formatHoursAndMinutes(Math.abs(delta))}`;
}

const OPERATION_WORDS: Record<WeekChangeDTO['operation'], string> = {
  CREATE: 'added',
  UPDATE: 'corrected',
  DELETE: 'deleted'
};

export function checkWeek(input: WeekCheckInput): WeekCheck {
  const { dayKeys, entries, providerName, dayName, clock } = input;
  const inWeek = new Set(dayKeys);
  const week = entries.filter(e => inWeek.has(dayOf(e.startedAtUtc)));
  const fragments = input.toPlace.filter(f => inWeek.has(dayOf(f.startedAtUtc)));
  const issues: WeekIssue[] = [];

  for (const fragment of [...fragments].sort((a, b) => a.startedAtUtc.localeCompare(b.startedAtUtc))) {
    const during = fragment.interruptedTaskKey ? `, during ${fragment.interruptedTaskKey}` : '';
    issues.push({
      kind: 'to-place',
      title: `${formatHoursAndMinutes(fragment.durationSeconds)} to place`,
      details: [`${dayName(dayOf(fragment.startedAtUtc))} · ${fragment.title}${during}`],
      fix: { kind: 'place' }
    });
  }

  const corrections = week.filter(e => e.syncState === 'correction-pending' || e.syncState === 'correction-failed');
  if (corrections.length) {
    issues.push({
      kind: 'correction',
      title: `${plural(corrections.length, 'correction', 'corrections')} not sent`,
      details: corrections.map(e => [
        keyOf(e),
        dayName(dayOf(e.startedAtUtc)),
        changeOf(e),
        e.syncState === 'correction-failed' ? `${providerName} did not answer` : 'on its way'
      ].filter(Boolean).join(' · ')),
      fix: corrections.some(e => e.syncState === 'correction-failed') ? { kind: 'send-now' } : { kind: 'none' }
    });
  }

  const refused = week.filter(e => e.syncState === 'failed');
  if (refused.length) {
    issues.push({
      kind: 'not-sent',
      title: `${plural(refused.length, 'entry', 'entries')} not sent`,
      details: refused.map(e => `${keyOf(e)} · ${dayName(dayOf(e.startedAtUtc))} · ${formatHoursAndMinutes(e.durationSeconds)} · ${providerName} did not take it`),
      fix: { kind: 'send-now' }
    });
  }

  const turnedDown = week.filter(e => e.syncState === 'refused');
  if (turnedDown.length) {
    const first = dayOf(turnedDown[0].startedAtUtc);
    issues.push({
      kind: 'refused',
      title: `${providerName} refused ${plural(turnedDown.length, 'entry', 'entries')}`,
      details: turnedDown.map(e =>
        `${keyOf(e)} · ${dayName(dayOf(e.startedAtUtc))} · ${formatHoursAndMinutes(e.durationSeconds)} · ${refusalReason(e.refusal)}`
      ),
      fix: { kind: 'open-day', dateKey: first, label: `Open ${dayName(first)}` }
    });
  }

  if (input.schedule) {
    for (const dateKey of dayKeys) {
      const window = workingWindow(localMidnight(dateKey), input.schedule);
      // A day not begun is not missing anything yet.
      if (!window || window.startMs >= input.nowMs) continue;
      const covered: Span[] = [
        ...week.filter(e => dayOf(e.startedAtUtc) === dateKey).map(spanOf),
        ...fragments.filter(f => dayOf(f.startedAtUtc) === dateKey)
          .map(f => ({ startMs: Date.parse(f.startedAtUtc), endMs: Date.parse(f.endedAtUtc) })),
        ...(input.running ? [input.running] : [])
      ];
      const gaps = dayGaps(window, covered, input.nowMs);
      if (gaps.length === 0) continue;
      const name = dayName(dateKey);
      const nothing = !week.some(e => dayOf(e.startedAtUtc) === dateKey);
      issues.push({
        kind: 'gaps',
        title: nothing ? `Nothing logged on ${name}` : `${name} has ${formatHoursAndMinutes(gapSeconds(gaps))} not timed`,
        details: [nothing
          ? `${formatHoursAndMinutes(gapSeconds(gaps))} of working hours`
          : `${plural(gaps.length, 'gap', 'gaps')} · ${gaps.map(g => `${clock(g.startMs)}–${clock(g.endMs)}`).join(', ')}`],
        fix: { kind: 'open-day', dateKey, label: `Open ${name}` }
      });
    }
  }

  for (const overlap of findOverlaps(week)) {
    const { earlier, later } = overlap;
    const start = Date.parse(later.startedAtUtc);
    const when = `${dayName(dayOf(later.startedAtUtc))} ${clock(start)}–${clock(start + overlap.seconds * 1000)}, with ${keyOf(earlier)}.`;
    const held = later.syncState === 'held-overlap';
    const bothThere = earlier.providerSeconds !== undefined && later.providerSeconds !== undefined;
    issues.push({
      kind: 'overlap',
      title: held
        ? `2 entries overlap · ${keyOf(later)}'s ${formatHoursAndMinutes(later.durationSeconds)} waits`
        : '2 entries overlap',
      details: [
        `${when} ${held
          ? `The later entry is not sent until the overlap is fixed, so ${providerName} never gets the same minutes twice.`
          : bothThere
            ? `Both are at ${providerName}: those minutes are counted twice.`
            : 'Those minutes are counted twice.'}`
      ],
      fix: { kind: 'open-day', dateKey: dayOf(later.startedAtUtc), label: 'Fix…' }
    });
  }

  if (input.changes && input.changes.length) {
    issues.push({
      kind: 'closed-change',
      title: `${plural(input.changes.length, 'change', 'changes')} to a closed week`,
      details: [...input.changes]
        .sort((a, b) => a.queuedAtUtc.localeCompare(b.queuedAtUtc))
        .map(c => [
          c.taskKey ?? 'An entry',
          dayName(dayOf(c.startedAtUtc)),
          `${formatHoursAndMinutes(c.durationSeconds)} ${OPERATION_WORDS[c.operation]}`,
          c.state === 'sent' ? `${providerName} has it` : c.state === 'failed' ? `${providerName} did not take it` : 'on its way'
        ].join(' · ')),
      fix: { kind: 'none' }
    });
  }

  return { issues, closed: input.changes !== null };
}

/** The dialog's line under its title: "37h 20m logged. 4 things to look at." */
export function describeWeekCheck(loggedSeconds: number, check: WeekCheck): string {
  const count = check.issues.length;
  return `${formatHoursAndMinutes(loggedSeconds)} logged. ${count === 0 ? 'Nothing to look at.' : `${plural(count, 'thing', 'things')} to look at.`}`;
}
