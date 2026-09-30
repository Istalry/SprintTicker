import { useState, useEffect, useCallback } from 'react';
import { TaskDTO, ProjectDTO } from '../../shared/dtos';

interface ProjectsAndTasks {
  projects: ProjectDTO[];
  tasks: TaskDTO[];
}

/** The projects, and the tasks of the selected one or else the first; null when the read failed. */
async function readProjectsAndTasks(selectedProjectId?: string): Promise<ProjectsAndTasks | null> {
  if (!window.electronAPI) return null;
  try {
    const projects = (await window.electronAPI.getProjects()) || [];
    const targetProjId = selectedProjectId || (projects.length > 0 ? projects[0].id : '');
    const tasks = targetProjId ? (await window.electronAPI.getTasks(targetProjId)) || [] : [];
    return { projects, tasks };
  } catch (err) {
    console.error('[useTasks] Error fetching projects and tasks:', err);
    return null;
  }
}

/**
 * Custom React hook fetching projects and tasks with support for fuzzy filtering.
 */
export function useTasks(selectedProjectId?: string) {
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  // Without the bridge there is nothing to wait for.
  const [loading, setLoading] = useState<boolean>(() => Boolean(window.electronAPI));

  // State changes only once the read has answered; see useWorklogs.
  const applyRead = useCallback((read: ProjectsAndTasks | null) => {
    if (read) {
      setProjects(read.projects);
      setTasks(read.tasks);
    }
    setLoading(false);
  }, []);

  const refresh = useCallback(
    () => readProjectsAndTasks(selectedProjectId).then(applyRead),
    [selectedProjectId, applyRead]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    projects,
    tasks,
    loading,
    refresh
  };
}
