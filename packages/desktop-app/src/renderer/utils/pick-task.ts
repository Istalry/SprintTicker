import type { ActiveSessionDTO } from '../../shared/dtos';
import type { PickedTask } from '../components/TaskPicker';
import { END_THE_INTERRUPTION_FIRST } from '../../shared/interruption';

/**
 * What the picker was opened for: a task to time, one to assign the ad-hoc
 * session to, or the one the running interruption's time goes to (P12d).
 */
export type PickPurpose = 'start' | 'assign' | 'place';

/**
 * What a pick from the task picker does, in the window or in the picker's
 * own window (P7b). During an interruption a task picked starts nothing
 * (the user's choice, 2026-11-12): it ends first, and main refuses the
 * start too. A picker left open from before it began says so. Settles once main has
 * answered, so the picker window closes only after its request is made; a
 * failure is logged, never thrown -- the picker has closed by then.
 */
export async function pickTask(
  purpose: PickPurpose,
  session: ActiveSessionDTO | null,
  picked: PickedTask,
  startTask: (taskId: string, isAdHoc?: boolean, customTitle?: string) => Promise<unknown>
): Promise<void> {
  const warn = (what: string) => (err: unknown) => console.warn(`[Picker] ${what} failed:`, err);
  if (purpose === 'place') {
    // The timer runs on; only where its time goes is chosen.
    if (picked.task) await window.electronAPI.chooseInterruptionTask(picked.task.id).catch(warn('Choosing the task'));
    return;
  }
  if (session?.interruption && purpose === 'start') {
    console.warn(`[Picker] ${END_THE_INTERRUPTION_FIRST}`);
    return;
  }
  if (picked.ownTitle) {
    // Empty id: main owns ad-hoc identity and makes the row.
    await startTask('', true, picked.ownTitle).catch(warn('Starting own work'));
    return;
  }
  const task = picked.task;
  if (!task) return;
  if (purpose === 'assign') {
    await window.electronAPI.assignSession(task.id).catch(warn('Assigning the session'));
  } else {
    await startTask(task.id, false, task.title).catch(warn('Starting the task'));
  }
}
