import { ActiveSessionDTO, TaskLeftReason } from './dtos';

/**
 * Whether finishing this session as done must ask first.
 *
 * A task that left the user's list is asked about because their completion
 * transition would move a task that is no longer theirs. A task *closed* on
 * the provider is the exception: there is nothing to move, so finishing it
 * asks nothing and sends no transition -- sending one moved an OpenProject
 * work package out of Closed again. The window, the mini timer and the bar
 * all decide through this, so none of them asks where another does not.
 */
export function finishNeedsConfirmation(session: Pick<ActiveSessionDTO, 'taskUnlisted' | 'taskLeftBecause'> | null | undefined): boolean {
  return session?.taskUnlisted === true && session.taskLeftBecause !== 'closed';
}

/** What the window says about a task that left the list; unknown reads as reassigned. */
export function taskLeftLabel(reason: TaskLeftReason | undefined): string {
  switch (reason) {
    case 'closed':
      return 'Closed on the provider';
    case 'gone':
      return 'No longer on the provider';
    default:
      return 'No longer assigned to you';
  }
}
