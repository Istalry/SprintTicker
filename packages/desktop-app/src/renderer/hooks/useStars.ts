import { useCallback, useEffect, useRef, useState } from 'react';
import { FlowSettingKey } from '../../shared/flow-settings';

const warn = (what: string) => (err: unknown) => console.warn(`[useStars] ${what} failed:`, err);

/**
 * A set of starred ids, shown at once and saved through `save`, which answers
 * the ids main keeps; a save refused puts the previous set back. The current
 * set is read from a ref, not inside a state updater: React may run an
 * updater twice, and each run would send the save again.
 */
function useStarSet(
  read: () => Promise<string[]> | undefined,
  save: (id: string, starred: boolean, next: string[]) => Promise<string[]>,
  what: string
): [ReadonlySet<string>, (id: string) => void] {
  const [ids, setIdsState] = useState<string[]>([]);
  const current = useRef<string[]>([]);
  const setIds = useCallback((next: string[]) => {
    current.current = next;
    setIdsState(next);
  }, []);

  useEffect(() => {
    let live = true;
    read()?.then(value => { if (live) setIds(value); }, warn(`Reading the ${what}`));
    return () => { live = false; };
    // Read once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback((id: string) => {
    const previous = current.current;
    const starred = previous.includes(id);
    const next = starred ? previous.filter(x => x !== id) : [...previous, id];
    setIds(next);
    save(id, starred, next).then(setIds, err => { warn(`Starring in the ${what}`)(err); setIds(previous); });
  }, [save, setIds, what]);

  return [new Set(ids), toggle];
}

const readProjects = () => window.electronAPI?.getFlowSetting?.(FlowSettingKey.STARRED_PROJECTS);
const saveProjects = (_id: string, _starred: boolean, next: string[]) =>
  window.electronAPI.saveFlowSetting(FlowSettingKey.STARRED_PROJECTS, next);

/** The projects starred in Tasks (S13), kept as a flow setting. */
export const useStarredProjects = (): [ReadonlySet<string>, (projectId: string) => void] =>
  useStarSet(readProjects, saveProjects, 'starred projects');

const readTasks = () => window.electronAPI?.getStarredTasks?.().then(tasks => tasks.map(t => t.id));
const saveTasks = (id: string, starred: boolean) =>
  (starred ? window.electronAPI.unstarTask(id) : window.electronAPI.starTask(id)).then(tasks => tasks.map(t => t.id));

/**
 * The tasks starred (P4, `tasks:star`): the same stars the picker and the
 * deck read. Main answers the whole list after each change.
 */
export const useStarredTasks = (): [ReadonlySet<string>, (taskId: string) => void] =>
  useStarSet(readTasks, saveTasks, 'starred tasks');
