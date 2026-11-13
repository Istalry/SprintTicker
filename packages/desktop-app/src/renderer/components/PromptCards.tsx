import React, { useEffect, useState } from 'react';
import { Coffee, Play, Users, UtensilsCrossed } from 'lucide-react';
import { ActiveSessionDTO, CeremonyPromptDTO, UserMode } from '../../shared/dtos';
import { normalizeScheduleSettings } from '../../shared/schedule-defaults';
import { formatHoursMinutes } from '../utils/formatters';
import { Verb } from '../../shared/words';

const STANDUP_REMIND_MINUTES = 10;
/** "joined ▾": how long ago, in minutes; the minutes come off the task it replaces. */
export const JOINED_MINUTES_AGO = [0, 2, 5, 10, 15] as const;
const MS_PER_MINUTE = 60_000;

/** The ISO time `minutesAgo` before now, or undefined for now. */
export function joinedAt(minutesAgo: number, now: number = Date.now()): string | undefined {
  return minutesAgo > 0 ? new Date(now - minutesAgo * MS_PER_MINUTE).toISOString() : undefined;
}

const warn = (what: string) => (err: unknown) => console.warn(`[PromptCards] ${what} failed:`, err);

const primary = 'flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary/90 text-dark-900 text-xs font-semibold rounded-lg transition-all';
const secondary = 'px-3 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white text-xs font-semibold rounded-lg border border-border-dark transition-all';

/**
 * The stand-up's card (S6). It stays until Join, Skip today or Remind me:
 * the dialog it replaces closed itself after 10 s, and main brought the
 * window forward to show it (P8c). The bar asks too; an answer anywhere
 * closes both.
 */
export const StandupCard: React.FC<{ prompt: CeremonyPromptDTO; session: ActiveSessionDTO | null }> = ({ prompt, session }) => {
  const api = window.electronAPI;
  const [minutesAgo, setMinutesAgo] = useState<number>(0);
  // Only a running task is brought back after the stand-up; a paused one is not running to keep.
  const running = session && !session.interruption && session.status === 'TRACKING' ? session.taskKey : null;
  // S25: joining during an interruption ends it, and it waits to be placed.
  const interruption = session?.interruption ? session.taskTitle || 'the interruption' : null;
  return (
    <section aria-label="The stand-up" className="bg-dark-800 border border-accent-amber/50 rounded-xl p-5 space-y-3 select-none">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-accent-amber" />
        <h3 className="text-sm font-bold text-white">Stand-up at {prompt.at}</h3>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed">
        {interruption ? (
          <>Join? It ends &quot;{interruption}&quot;, which waits to be placed.</>
        ) : running ? (
          <>
            <span className="font-mono text-text-primary">{running}</span> keeps running until you press Join. Join stops it
            and times the stand-up, then <span className="font-mono text-text-primary">{running}</span> starts again when it ends.
            Joined late? Say when, and the minutes come off it.
          </>
        ) : (
          <>Join times the stand-up until you stop it.</>
        )}
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className={secondary} onClick={() => { api.snoozeCeremony('STANDUP', STANDUP_REMIND_MINUTES).catch(warn('Remind me')); }}>
          Remind me in {STANDUP_REMIND_MINUTES} min
        </button>
        <button type="button" className={secondary} onClick={() => { api.cancelStandupPrompt().catch(warn('Skip today')); }}>
          Skip today
        </button>
        <select
          aria-label="When you joined"
          title="Joined late? Say when, and the minutes come off the task before"
          value={minutesAgo}
          onChange={e => setMinutesAgo(Number(e.target.value))}
          className="bg-dark-700 border border-border-field rounded-lg px-2 py-2 text-xs text-text-primary"
        >
          {JOINED_MINUTES_AGO.map(m => <option key={m} value={m}>{m === 0 ? 'joined now' : `joined ${m} min ago`}</option>)}
        </select>
        <button type="button" className={primary} onClick={() => { api.joinStandup(joinedAt(minutesAgo)).catch(warn('Join')); }}>
          <Users className="w-3.5 h-3.5" />
          Join
        </button>
      </div>
    </section>
  );
};

/** When lunch ends, from the schedule; null until read. */
function useLunchEnd(active: boolean): string | null {
  const [end, setEnd] = useState<string | null>(null);
  useEffect(() => {
    const api = window.electronAPI;
    if (!active || !api?.getScheduleSettings) return undefined;
    let live = true;
    api.getScheduleSettings()
      .then(settings => { if (live) setEnd(normalizeScheduleSettings(settings).lunchEndTime ?? null); })
      .catch(warn('Reading the lunch hours'));
    return () => { live = false; };
  }, [active]);
  return end;
}

/**
 * Lunch or Away, on Today (S6): the task is paused, as it was, and nothing
 * is sent. Resume during lunch is working through it -- main ends Lunch for
 * the day -- and Resume during Away resumes the task and leaves Away.
 */
export const BreakCard: React.FC<{ mode: UserMode; session: ActiveSessionDTO | null; onLeaveAway: () => void }> = ({
  mode,
  session,
  onLeaveAway
}) => {
  const lunch = mode === 'LUNCH';
  const lunchEnd = useLunchEnd(lunch);
  if (mode === 'WORK') return null;
  const api = window.electronAPI;
  const held = session?.status === 'PAUSED' && !session.interruption ? session : null;
  const since = held?.lastPauseStartUtc ? formatHoursMinutes(new Date(held.lastPauseStartUtc)) : null;
  const Icon = lunch ? UtensilsCrossed : Coffee;
  const title = lunch ? (lunchEnd ? `Lunch until ${lunchEnd}` : 'Lunch') : since ? `Away since ${since}` : 'Away';

  const resume = () => {
    const resumed = api.resumeSession();
    if (lunch) {
      resumed.catch(warn('Resume'));
      return;
    }
    // Resumed first, so leaving Away finds nothing left to ask about.
    resumed.then(onLeaveAway).catch(warn('Back'));
  };

  return (
    <section aria-label={lunch ? 'Lunch' : 'Away'} className="bg-dark-800 border border-accent-amber/50 rounded-xl p-5 space-y-3 select-none">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-accent-amber" />
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed">
        {held ? (
          <>
            <span className="font-mono text-text-primary">{held.taskKey}</span> is paused, as it was; nothing is sent.{' '}
          </>
        ) : (
          <>Nothing is timing. </>
        )}
        {lunch
          ? <>Lunch is not timed.{held && lunchEnd && <> At {lunchEnd} you are asked if you are back.</>}</>
          : <>Away is not timed, and the bar shows you are away. Leave it from here, the mode chip, the tray, the bar or the deck.</>}
      </p>
      {held && (
        <div className="flex justify-end">
          <button type="button" className={primary} onClick={resume}>
            <Play className="w-3.5 h-3.5" />
            {`${Verb.RESUME} ${held.taskKey}`}
          </button>
        </div>
      )}
      {!held && !lunch && (
        <div className="flex justify-end">
          <button type="button" className={secondary} onClick={onLeaveAway}>I&apos;m back</button>
        </div>
      )}
    </section>
  );
};

/**
 * "Start lunch? It ends 'Call with Marc'" (S25): lunch's hour found an
 * interruption running, and lunch would end it. Yes ends it -- it waits to be
 * placed -- and starts Lunch; Not now works through lunch today.
 */
export const LunchQuestionCard: React.FC<{ prompt: CeremonyPromptDTO }> = ({ prompt }) => {
  const api = window.electronAPI;
  const name = prompt.endsInterruption ?? 'the interruption';
  return (
    <section aria-label="Lunch time" className="bg-dark-800 border border-accent-amber/50 rounded-xl p-5 space-y-3 select-none">
      <div className="flex items-center gap-2">
        <UtensilsCrossed className="w-4 h-4 text-accent-amber" />
        <h3 className="text-sm font-bold text-white">Lunch time · you are in an interruption</h3>
      </div>
      <p className="text-xs text-text-secondary leading-relaxed">
        Start lunch? It ends &quot;{name}&quot;, which waits to be placed. Not now keeps it running, and lunch does
        not start again today.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className={secondary} onClick={() => { api.answerLunchQuestion(false).catch(warn('Not now')); }}>Not now</button>
        <button type="button" className={primary} onClick={() => { api.answerLunchQuestion(true).catch(warn('Start lunch')); }}>
          <UtensilsCrossed className="w-3.5 h-3.5" />
          Start lunch
        </button>
      </div>
    </section>
  );
};
