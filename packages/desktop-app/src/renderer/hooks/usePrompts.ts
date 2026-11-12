import { useEffect, useState } from 'react';
import { CeremonyPromptDTO, ForgottenSessionReviewDTO, MorningDTO, ReminderDTO, ResumePromptDTO, UserMode } from '../../shared/dtos';

/**
 * The questions main is asking (redesign P8c), for Today's cards and the mini
 * timer's row. Main owns them -- the bar asks too, and an answer anywhere
 * closes them everywhere -- so these only follow: read once on mount, for a
 * window opened after the question, then pushed.
 */
function useFollowed<T>(
  read: (() => Promise<T | null>) | undefined,
  subscribe: ((callback: (value: T | null) => void) => () => void) | undefined,
  label: string
): [T | null, (value: T | null) => void] {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!read || !subscribe) return undefined;
    let live = true;
    read()
      .then(current => { if (live) setValue(current); })
      .catch(err => console.warn(`[usePrompts] Could not read ${label}:`, err));
    const off = subscribe(next => { if (live) setValue(next); });
    return () => {
      live = false;
      off();
    };
    // The bridge is fixed for the window's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return [value, setValue];
}

/** The ceremony waiting on an answer: the stand-up's card, or the wrap-up. */
export function useCeremonyPrompt(): CeremonyPromptDTO | null {
  const api = window.electronAPI;
  return useFollowed<CeremonyPromptDTO>(api?.getCeremonyPrompt, api?.onCeremonyPrompt, 'the ceremony prompt')[0];
}

/**
 * "Back at your desk?", "Back to MG-12?" or "Resume it anyway?". The setter
 * hides it at once on an answer, before main confirms.
 */
export function useResumePrompt(): [ResumePromptDTO | null, (value: ResumePromptDTO | null) => void] {
  const api = window.electronAPI;
  return useFollowed<ResumePromptDTO>(api?.getResumePrompt, api?.onResumePrompt, 'the resume question');
}

/** The "still...?" reminder being asked (P8d). The setter hides it at once on an answer. */
export function useReminder(): [ReminderDTO | null, (value: ReminderDTO | null) => void] {
  const api = window.electronAPI;
  return useFollowed<ReminderDTO>(api?.getReminder, api?.onReminder, 'the reminder');
}

/**
 * A session left running overnight (S18): the dialog while it is asked, the
 * card on Today and the mini timer once deferred. The setter hides it at
 * once on an answer.
 */
export function useForgottenReview(): [ForgottenSessionReviewDTO | null, (value: ForgottenSessionReviewDTO | null) => void] {
  const api = window.electronAPI;
  return useFollowed<ForgottenSessionReviewDTO>(api?.getForgottenReview, api?.onForgottenReview, 'the overnight question');
}

/** Work, Lunch or Away, as main keeps it. */
export function useUserMode(): [UserMode, (mode: UserMode) => void] {
  const api = window.electronAPI;
  const [mode, setMode] = useFollowed<UserMode>(api?.getUserMode, api?.onUserModeUpdated, 'the mode');
  return [mode ?? 'WORK', setMode];
}

/**
 * The morning card (S4b), read once when Today opens; null once the day has
 * begun. It goes as soon as a session starts, wherever it was started -- the
 * bar, the deck, the picker -- and the second value puts it away: either
 * way main is told, so it is not shown again today.
 */
export function useMorning(): [MorningDTO | null, () => void] {
  const [morning, setMorning] = useState<MorningDTO | null>(null);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getMorning) return undefined;
    let live = true;
    let shown = false;
    api.getMorning()
      .then(current => {
        if (!live) return;
        shown = current !== null;
        setMorning(current);
      })
      .catch(err => console.warn('[usePrompts] Could not read the morning:', err));
    // Once a second while a task runs: only the first one after the card was shown counts.
    const off = api.onSessionUpdated?.(session => {
      if (!live || !session || !shown) return;
      shown = false;
      setMorning(null);
      api.markMorningSeen().catch(err => console.warn('[usePrompts] Could not mark the morning seen:', err));
    });
    return () => {
      live = false;
      off?.();
    };
  }, []);
  const putAway = () => {
    setMorning(null);
    window.electronAPI.markMorningSeen().catch(err => console.warn('[usePrompts] Could not mark the morning seen:', err));
  };
  return [morning, putAway];
}
