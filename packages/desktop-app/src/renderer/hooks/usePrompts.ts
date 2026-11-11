import { useEffect, useState } from 'react';
import { CeremonyPromptDTO, ReminderDTO, ResumePromptDTO, UserMode } from '../../shared/dtos';

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

/** Work, Lunch or Away, as main keeps it. */
export function useUserMode(): [UserMode, (mode: UserMode) => void] {
  const api = window.electronAPI;
  const [mode, setMode] = useFollowed<UserMode>(api?.getUserMode, api?.onUserModeUpdated, 'the mode');
  return [mode ?? 'WORK', setMode];
}
