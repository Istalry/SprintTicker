import type { ActiveSessionDTO } from '../../shared/dtos';
import type { PickedTask } from '../components/TaskPicker';

/** What the picker was opened for: a task to time, or one to assign the ad-hoc session to. */
export type PickPurpose = 'start' | 'assign';

/**
 * What a pick from the task picker does, in the window or in the picker's
 * own window (P7b). During an interruption a task picked is a switch, and
 * its time goes along when asked (P6's `takeAlong`). Settles once main has
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
  if (picked.ownTitle) {
    // Empty id: main owns ad-hoc identity and makes the row.
    await startTask('', true, picked.ownTitle).catch(warn('Starting own work'));
    return;
  }
  const task = picked.task;
  if (!task) return;
  if (purpose === 'assign') {
    await window.electronAPI.assignSession(task.id).catch(warn('Assigning the session'));
  } else if (session?.interruption) {
    await window.electronAPI.switchFromInterruption(task.id, picked.takeAlong).catch(warn('Switching from the interruption'));
  } else {
    await startTask(task.id, false, task.title).catch(warn('Starting the task'));
  }
}
