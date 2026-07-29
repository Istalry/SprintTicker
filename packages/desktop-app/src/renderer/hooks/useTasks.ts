import { useState, useEffect } from 'react';
import { TaskDTO, ProjectDTO } from '../../shared/dtos';

/**
 * Custom React hook fetching projects and tasks with support for fuzzy filtering.
 */
export function useTasks(selectedProjectId?: string) {
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchProjectsAndTasks = async () => {
    if (!window.electronAPI) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const projs = await window.electronAPI.getProjects();
      setProjects(projs || []);

      const targetProjId = selectedProjectId || (projs && projs.length > 0 ? projs[0].id : '');
      if (targetProjId) {
        const taskList = await window.electronAPI.getTasks(targetProjId);
        setTasks(taskList || []);
      } else {
        setTasks([]);
      }
    } catch (err) {
      console.error('[useTasks] Error fetching projects and tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjectsAndTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  return {
    projects,
    tasks,
    loading,
    refresh: fetchProjectsAndTasks
  };
}
