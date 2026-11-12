import React, { useState, useEffect, useRef } from 'react';
import { FolderPlus, Plus, Trash2, Edit3, Upload, FileText, CheckCircle, AlertCircle, X, CheckCircle2, Clock } from 'lucide-react';
import { ProjectDTO, TaskDTO, ActiveSessionDTO } from '../../../shared/dtos';
import { END_THE_INTERRUPTION_FIRST } from '../../../shared/interruption';
import { pickTask } from '../../utils/pick-task';
import { Verb } from '../../../shared/words';
import { ConfirmPanel } from '../../components/ConfirmPanel';
import { ProjectFilterToggle } from '../../components/ProjectFilterToggle';
import { useOnlyProjectsWithTasks } from '../../hooks/useOnlyProjectsWithTasks';
import { useTaskVisibility } from '../../hooks/useTaskVisibility';
import { TaskOwnerBadge, TaskVisibilityToggle } from '../../components/TaskVisibilityToggle';
import { filterProjectsWithTasks, firstProjectWithTasks } from '../../../shared/project-filter';
import { orderTasksForSelection } from '../../../shared/task-order';
import { DEFAULT_TASK_VISIBILITY, visibleTasks } from '../../../shared/task-visibility';
import { hasTaskPage } from '../../../shared/task-page';
import { TaskPageButton } from '../../components/TaskPageButton';
import { OWN_PROJECT_PROVIDER_ID } from '../../../shared/local-provider';
import { countOf } from '../../utils/formatters';

export const ProjectTaskManagerView: React.FC = () => {
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  // Without the bridge there is nothing to wait for.
  const [loading, setLoading] = useState<boolean>(() => Boolean(window.electronAPI?.getProjects));
  const [activeSession, setActiveSession] = useState<ActiveSessionDTO | null>(null);
  const [onlyWithTasks, setOnlyWithTasks] = useOnlyProjectsWithTasks();
  const [visibility, setVisibility] = useTaskVisibility();

  /**
   * Which project the task list is showing, readable from a subscription.
   *
   * The push handlers below are registered once on mount, so they close over
   * the first render's `selectedProjectId` -- an empty string -- and would
   * refetch nothing. A ref is the state they can actually read.
   */
  const selectedProjectRef = useRef<string>('');

  // Modals
  const [isAddProjOpen, setIsAddProjOpen] = useState<boolean>(false);
  const [newProjKey, setNewProjKey] = useState<string>('');
  const [newProjName, setNewProjName] = useState<string>('');

  const [isEditProjOpen, setIsEditProjOpen] = useState<boolean>(false);
  const [editProjName, setEditProjName] = useState<string>('');
  const [editProjKey, setEditProjKey] = useState<string>('');

  const [isAddTaskOpen, setIsAddTaskOpen] = useState<boolean>(false);
  const [newTaskKey, setNewTaskKey] = useState<string>('');
  const [newTaskTitle, setNewTaskTitle] = useState<string>('');
  const [newTaskStatus, setNewTaskStatus] = useState<'todo' | 'in_progress' | 'done'>('todo');

  const [isImportOpen, setIsImportOpen] = useState<boolean>(false);
  const [importText, setImportText] = useState<string>('');
  const [importStatus, setImportStatus] = useState<string>('');

  // Both are promise chains rather than async bodies because the mount effect
  // calls them, and state set in an async function's body reads to the hooks
  // linter as set synchronously in the effect. State changes only once main
  // has answered.
  const fetchProjects = (): Promise<void> => {
    if (!window.electronAPI?.getProjects) return Promise.resolve();
    return window.electronAPI.getProjects().then(projs => {
      setProjects(projs);
      // Keep a choice already made; a refetch after creating a project must
      // not jump back to the first one. Open on a project with something in
      // it: the selected project is never hidden, so opening on an empty one
      // would show it whatever the "only projects with tasks" switch says.
      // Chosen under the default visibility: the stored one may not have
      // answered yet, and this only picks where the tab opens.
      setSelectedProjectId(current => current || firstProjectWithTasks(projs, DEFAULT_TASK_VISIBILITY));
      setLoading(false);
    });
  };

  const fetchTasks = (projId: string): Promise<void> => {
    if (!projId || !window.electronAPI?.getTasks) return Promise.resolve();
    // The projects come back with them: every task change -- added, imported,
    // deleted, started, done -- moves a project's open-task count, and the
    // "only projects with tasks" switch reads it. A stale count hid a project
    // whose first task had just been added once another was selected.
    const projectsRead = window.electronAPI.getProjects ? window.electronAPI.getProjects().then(setProjects) : Promise.resolve();
    return Promise.all([window.electronAPI.getTasks(projId).then(setTasks), projectsRead]).then(() => undefined);
  };

  useEffect(() => {
    void fetchProjects();

    if (window.electronAPI?.getCurrentSession) {
      window.electronAPI.getCurrentSession().then(setActiveSession);
    }

    const unsubscribes: Array<() => void> = [];
    if (window.electronAPI?.onSessionUpdated) {
      unsubscribes.push(
        window.electronAPI.onSessionUpdated(session => {
          setActiveSession(session);
          // Starting a task moves it to in_progress and finishing one can mark
          // it done, both in the main process. Without this the badge kept the
          // status it had when the tab mounted, and leaving the tab and coming
          // back was the only way to see the change -- which reads as the
          // action not having worked.
          void fetchTasks(selectedProjectRef.current);
        })
      );
    }
    // This list is a view of the local cache, which only the sync worker fills.
    // Without this subscription, entering provider credentials left the user
    // looking at an empty project list until the next five-minute tick, with
    // nothing to distinguish "not synced yet" from "the remote has nothing".
    if (window.electronAPI?.onProjectsUpdated) {
      unsubscribes.push(
        window.electronAPI.onProjectsUpdated(({ projects: synced }) => {
          setProjects(synced);
          setSelectedProjectId(current => {
            if (current && synced.some(p => p.id === current)) return current;
            return firstProjectWithTasks(synced, DEFAULT_TASK_VISIBILITY);
          });
          // A sync that refreshed the projects refreshed the tasks under them
          // too, and a status changed on the board is the most likely thing to
          // have moved. Refetching only the projects left the statuses stale.
          void fetchTasks(selectedProjectRef.current);
        })
      );
    }

    // React accepts an undefined cleanup; state it explicitly for noImplicitReturns.
    if (unsubscribes.length === 0) return undefined;
    return () => unsubscribes.forEach(fn => fn());
  }, []);

  useEffect(() => {
    selectedProjectRef.current = selectedProjectId;
    if (selectedProjectId) {
      void fetchTasks(selectedProjectId);
    }
  }, [selectedProjectId]);

  // Handle Project Creation
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjKey.trim() || !newProjName.trim()) return;

    const id = newProjKey.trim().toUpperCase();
    if (window.electronAPI?.createProject) {
      await window.electronAPI.createProject({
        id,
        key: id,
        name: newProjName.trim(),
        providerId: OWN_PROJECT_PROVIDER_ID
      });
      setNewProjKey('');
      setNewProjName('');
      setIsAddProjOpen(false);
      await fetchProjects();
      setSelectedProjectId(id);
    }
  };

  // Handle Project Rename
  const handleRenameProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editProjName.trim() || !selectedProjectId) return;

    if (window.electronAPI?.renameProject) {
      await window.electronAPI.renameProject({
        id: selectedProjectId,
        name: editProjName.trim(),
        key: editProjKey.trim().toUpperCase() || selectedProjectId
      });
      setIsEditProjOpen(false);
      await fetchProjects();
    }
  };

  // A deletion waiting for its yes. Not `window.confirm`, which blocks the
  // renderer; and a task is asked about too -- it used to go on one click.
  const [askingDelete, setAskingDelete] = useState<{ kind: 'project' | 'task'; id: string; label: string } | null>(null);

  // Handle Project Deletion
  const handleDeleteProject = async (projId: string) => {
    if (window.electronAPI?.deleteProject) {
      await window.electronAPI.deleteProject(projId);
      setSelectedProjectId('');
      await fetchProjects();
    }
  };

  // Handle Task Creation
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !selectedProjectId) return;

    const selectedProj = projects.find(p => p.id === selectedProjectId);
    const projKey = selectedProj?.key || selectedProjectId;
    const taskKey = newTaskKey.trim() ? newTaskKey.trim().toUpperCase() : `${projKey}-${Date.now().toString().slice(-3)}`;
    const taskId = `${selectedProjectId}_${taskKey}`;

    if (window.electronAPI?.updateTask) {
      await window.electronAPI.updateTask({
        id: taskId,
        projectId: selectedProjectId,
        key: taskKey,
        title: newTaskTitle.trim(),
        status: newTaskStatus
      });
      setNewTaskKey('');
      setNewTaskTitle('');
      setIsAddTaskOpen(false);
      await fetchTasks(selectedProjectId);
    }
  };

  // Handle Task Deletion
  const handleDeleteTask = async (taskId: string) => {
    if (window.electronAPI?.deleteTask) {
      await window.electronAPI.deleteTask(taskId);
      await fetchTasks(selectedProjectId);
    }
  };


  // Handle CSV / JSON Task Import
  const handleImportTasks = async () => {
    if (!importText.trim() || !selectedProjectId) return;

    try {
      let parsedTasks: Array<{ key: string; title: string; status?: 'todo' | 'in_progress' | 'done' }> = [];

      if (importText.trim().startsWith('[') || importText.trim().startsWith('{')) {
        // Parse JSON
        parsedTasks = JSON.parse(importText);
      } else {
        // Parse CSV (Lines of: KEY, TITLE, STATUS or TITLE)
        const lines = importText.split('\n').map(l => l.trim()).filter(Boolean);
        parsedTasks = lines.map((line, idx) => {
          const parts = line.split(',');
          if (parts.length >= 2) {
            return {
              key: parts[0].trim(),
              title: parts[1].trim(),
              status: (parts[2]?.trim() as 'todo' | 'in_progress' | 'done') || 'todo'
            };
          }
          return {
            key: `IMP-${idx + 1}`,
            title: line,
            status: 'todo'
          };
        });
      }

      if (window.electronAPI?.importTasks) {
        await window.electronAPI.importTasks(selectedProjectId, parsedTasks);
        setImportStatus(`Imported ${countOf(parsedTasks.length, 'task')}.`);
        setTimeout(() => {
          setIsImportOpen(false);
          setImportText('');
          setImportStatus('');
        }, 1200);
        await fetchTasks(selectedProjectId);
      }
    } catch {
      setImportStatus('Failed to parse CSV/JSON input. Please verify format.');
    }
  };

  const activeProject = projects.find(p => p.id === selectedProjectId);
  // The selected project stays listed whatever it holds -- one just created
  // has no task yet -- and so does the running session's.
  const { visible: listedProjects, hiddenCount, nothingAssigned } = filterProjectsWithTasks(
    projects,
    onlyWithTasks,
    [selectedProjectId, activeSession?.projectId ?? ''].filter(Boolean),
    visibility
  );
  // In the bar's order, under the same visibility; the running session's task
  // stays whoever's it is, or hiding a teammate's work would take away the
  // Stop button of a session on one.
  const { visible: shownTasks, hiddenCount: hiddenTaskCount } = visibleTasks(
    tasks,
    visibility,
    [activeSession?.taskId ?? ''].filter(Boolean)
  );
  const listedTasks = orderTasksForSelection(shownTasks);
  // One project's tasks: they all have a page, or none does.
  const tasksHavePages = hasTaskPage(activeProject?.id, activeProject?.providerId);

  if (loading) {
    return <div className="p-8 text-text-secondary text-sm">Loading Project & Task Registry...</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 select-none">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide">Project & Task Manager</h2>
          <p className="text-xs text-text-secondary mt-1">
            Organize multi-project task registries, import tasks via CSV/JSON, and manage work items.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setIsImportOpen(true)}
            disabled={!selectedProjectId}
            className="flex items-center space-x-2 px-3.5 py-2 bg-dark-700 hover:bg-dark-600 border border-border-dark text-text-primary hover:text-white rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50 whitespace-nowrap"
          >
            <Upload className="w-4 h-4 text-text-primary" />
            <span>Import Tasks</span>
          </button>
          <button
            onClick={() => setIsAddProjOpen(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-primary hover:bg-primary/90 text-dark-900 rounded-lg text-xs font-semibold shadow-md transition-all whitespace-nowrap"
          >
            <FolderPlus className="w-4 h-4" />
            <span>New Project</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Projects (Left 1/3) & Tasks (Right 2/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Projects List Sidebar */}
        <div className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-border-dark pb-3">
            <h3 className="text-sm font-bold text-white">Projects ({listedProjects.length})</h3>
          </div>
          <ProjectFilterToggle enabled={onlyWithTasks} onChange={setOnlyWithTasks} hiddenCount={hiddenCount} nothingAssigned={nothingAssigned} />

          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {listedProjects.map(proj => (
              <div
                key={proj.id}
                onClick={() => setSelectedProjectId(proj.id)}
                className={`group flex items-center justify-between p-3.5 rounded-lg border cursor-pointer transition-all ${
                  selectedProjectId === proj.id
                    ? 'bg-select border-focus text-white shadow-md'
                    : 'bg-dark-900/60 border-border-dark text-text-secondary hover:text-white hover:bg-dark-700/50'
                }`}
              >
                <div>
                  <div className="font-mono font-bold text-xs text-text-primary">{proj.key}</div>
                  <div className="text-xs font-medium text-text-primary mt-0.5">{proj.name}</div>
                </div>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedProjectId(proj.id);
                      setEditProjKey(proj.key);
                      setEditProjName(proj.name);
                      setIsEditProjOpen(true);
                    }}
                    title={`Edit ${proj.key}`}
                    aria-label={`Edit ${proj.key}`}
                    className="p-1 hover:bg-dark-700 text-text-secondary hover:text-white rounded"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setAskingDelete({ kind: 'project', id: proj.id, label: `${proj.key} ${proj.name}` });
                    }}
                    title={`Delete ${proj.key}`}
                    aria-label={`Delete project ${proj.key}`}
                    className="p-1 hover:bg-dark-700 text-text-secondary hover:text-accent-red rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tasks Panel */}
        <div className="lg:col-span-2 bg-dark-800 border border-border-dark rounded-xl p-5 space-y-4 flex flex-col">
          <div className="flex items-center justify-between border-b border-border-dark pb-3">
            <div>
              <h3 className="text-sm font-bold text-white">
                {activeProject ? `Tasks under [${activeProject.key}] ${activeProject.name}` : 'Select a Project'}
              </h3>
              <p className="text-xs text-text-secondary mt-0.5">{countOf(listedTasks.length, 'task')} listed</p>
              <div className="mt-1.5">
                <TaskVisibilityToggle visibility={visibility} onChange={setVisibility} hiddenCount={hiddenTaskCount} />
              </div>
            </div>

            <button
              onClick={() => setIsAddTaskOpen(true)}
              disabled={!selectedProjectId}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-accent-green hover:bg-accent-green/90 text-dark-900 rounded-lg text-xs font-bold shadow-sm transition-all disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>Add Task</span>
            </button>
          </div>

          {/* Tasks List */}
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1 flex-1">
            {listedTasks.length > 0 ? (
              listedTasks.map(task => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-3.5 bg-dark-900/60 border border-border-dark rounded-lg hover:border-dark-600 transition-colors"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 bg-dark-700 border border-border-dark text-text-primary text-[10px] font-mono font-bold rounded whitespace-nowrap shrink-0">
                        {task.key}
                      </span>
                      <span className="text-xs font-bold text-white">{task.title}</span>
                      <TaskOwnerBadge task={task} />
                      {tasksHavePages && <TaskPageButton taskId={task.id} taskKey={task.key} />}
                    </div>
                    {task.description && (
                      <div className="text-[11px] text-text-secondary truncate" title={task.description}>
                        {task.description}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-2 shrink-0 ml-3">
                    {/* Status cycle buttons */}
                    <div className="flex items-center space-x-1">
                      {/* Status Label */}
                      <div className="px-3 py-1 bg-dark-700/60 border border-border-dark rounded-lg text-[10px] font-bold text-text-secondary mr-2 flex items-center space-x-1 whitespace-nowrap">
                        {task.status === 'todo' && <><AlertCircle className="w-3.5 h-3.5 text-text-primary"/><span className="text-text-primary">To Do</span></>}
                        {task.status === 'in_progress' && <><Clock className="w-3.5 h-3.5 text-text-primary"/><span className="text-text-primary">In Progress</span></>}
                        {task.status === 'done' && <><CheckCircle2 className="w-3.5 h-3.5 text-accent-green"/><span className="text-accent-green">Done</span></>}
                      </div>

                      {activeSession?.taskId === task.id ? (
                        <button
                          title="Stop the timer; the task stays open"
                          onClick={() => {
                            // One click, as Today's Stop: logged, the task left
                            // open, and Undo for UNDO_WINDOW_MS. Done and
                            // Discard are the session card's (redesign P7c:
                            // one finish flow, not a second dialog here).
                            window.electronAPI?.completeSession(undefined, false)
                              .then(() => fetchTasks(selectedProjectId))
                              .catch(err => console.warn('[Tasks] Stopping the session failed:', err));
                          }}
                          className="px-3 py-1 bg-dark-700 text-white border border-border-dark hover:bg-dark-600 font-bold text-xs rounded transition-colors"
                        >
                          {Verb.STOP}
                        </button>
                      ) : (
                        <button
                          // Choosing a task does nothing during an interruption (2026-11-12).
                          disabled={Boolean(activeSession?.interruption)}
                          title={activeSession?.interruption
                            ? END_THE_INTERRUPTION_FIRST
                            : activeSession ? 'Switch to this task' : 'Start this task'}
                          onClick={() => {
                            if (!window.electronAPI) return;
                            // The picker's own pick (P7c): during an
                            // interruption this is a switch from it, as
                            // the picker does, never a start beside it.
                            // No stop first: startTask logs a running
                            // session itself.
                            void pickTask('start', activeSession, { task, takeAlong: false }, (id, adHoc, title) =>
                              window.electronAPI.startTask(id, adHoc, title)
                            ).then(() => fetchTasks(selectedProjectId));
                          }}
                          className="px-3 py-1 bg-select text-text-primary border border-focus/40 hover:bg-dark-600 font-bold text-xs rounded transition-colors disabled:opacity-40"
                        >
                          {activeSession ? Verb.SWITCH : Verb.START}
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => setAskingDelete({ kind: 'task', id: task.id, label: `${task.key} ${task.title}` })}
                      title={`Delete ${task.key}`}
                      aria-label={`Delete ${task.key}`}
                      className="p-1.5 text-text-secondary hover:text-accent-red hover:bg-dark-700 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12 text-xs text-text-secondary">
                No tasks found for this project. Click <span className="text-accent-green font-bold">&apos;+ Add Task&apos;</span> or <span className="text-text-primary font-bold">&apos;Import Tasks&apos;</span> to create work items.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Project Modal */}
      {isAddProjOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4">
          <form onSubmit={handleCreateProject} className="w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border-dark pb-3">
              <h3 className="text-sm font-bold text-white">Create New Project</h3>
              <button type="button" onClick={() => setIsAddProjOpen(false)} className="text-text-secondary hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-text-secondary mb-1">Project Key (e.g., GAME1, RPG)</label>
                <input
                  type="text"
                  required
                  value={newProjKey}
                  onChange={e => setNewProjKey(e.target.value)}
                  placeholder="PROJ"
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white focus:border-focus outline-none"
                />
              </div>

              <div>
                <label className="block text-text-secondary mb-1">Project Full Name</label>
                <input
                  type="text"
                  required
                  value={newProjName}
                  onChange={e => setNewProjName(e.target.value)}
                  placeholder="Unannounced RPG Sandbox"
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white focus:border-focus outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setIsAddProjOpen(false)} className="px-4 py-2 bg-dark-700 text-text-secondary rounded text-xs">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-primary text-dark-900 rounded text-xs font-bold">
                Save Project
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Project Modal */}
      {isEditProjOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4">
          <form onSubmit={handleRenameProject} className="w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border-dark pb-3">
              <h3 className="text-sm font-bold text-white">Edit Project [{selectedProjectId}]</h3>
              <button type="button" onClick={() => setIsEditProjOpen(false)} className="text-text-secondary hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-text-secondary mb-1">Project Key</label>
                <input
                  type="text"
                  required
                  value={editProjKey}
                  onChange={e => setEditProjKey(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white focus:border-focus outline-none"
                />
              </div>

              <div>
                <label className="block text-text-secondary mb-1">Project Name</label>
                <input
                  type="text"
                  required
                  value={editProjName}
                  onChange={e => setEditProjName(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white focus:border-focus outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setIsEditProjOpen(false)} className="px-4 py-2 bg-dark-700 text-text-secondary rounded text-xs">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-primary text-dark-900 rounded text-xs font-bold">
                Update Project
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Task Modal */}
      {isAddTaskOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4">
          <form onSubmit={handleCreateTask} className="w-full max-w-md bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border-dark pb-3">
              <h3 className="text-sm font-bold text-white">Add Task to [{selectedProjectId}]</h3>
              <button type="button" onClick={() => setIsAddTaskOpen(false)} className="text-text-secondary hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-text-secondary mb-1">Task Key (Optional, e.g. PROJ-101)</label>
                <input
                  type="text"
                  value={newTaskKey}
                  onChange={e => setNewTaskKey(e.target.value)}
                  placeholder={`${selectedProjectId}-101`}
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white focus:border-focus outline-none"
                />
              </div>

              <div>
                <label className="block text-text-secondary mb-1">Task Title / Description</label>
                <input
                  type="text"
                  required
                  value={newTaskTitle}
                  onChange={e => setNewTaskTitle(e.target.value)}
                  placeholder="Implement Inventory System"
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white focus:border-focus outline-none"
                />
              </div>

              <div>
                <label className="block text-text-secondary mb-1">Status</label>
                <select
                  value={newTaskStatus}
                  onChange={e => setNewTaskStatus(e.target.value as 'todo' | 'in_progress' | 'done')}
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white focus:border-focus outline-none"
                >
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Done</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setIsAddTaskOpen(false)} className="px-4 py-2 bg-dark-700 text-text-secondary rounded text-xs">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-accent-green text-dark-900 rounded text-xs font-bold">
                Create Task
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CSV / JSON Task Importer Modal */}
      {isImportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-border-dark pb-3">
              <div className="flex items-center space-x-2">
                <FileText className="w-5 h-5 text-text-primary" />
                <h3 className="text-sm font-bold text-white">Import Tasks to [{selectedProjectId}]</h3>
              </div>
              <button onClick={() => setIsImportOpen(false)} className="text-text-secondary hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-text-secondary">
              Paste CSV lines (Format: <span className="text-white">KEY, TITLE, STATUS</span>) or JSON array (<span className="text-white">[&#123; &quot;key&quot;: &quot;KEY-1&quot;, &quot;title&quot;: &quot;Title&quot; &#125;]</span>):
            </p>

            <textarea
              rows={6}
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="PROJ-101, Implement Player Physics, todo&#10;PROJ-102, Design UI HUD, in_progress"
              className="w-full bg-dark-900 border border-border-dark rounded p-3 text-xs text-white focus:border-focus outline-none resize-none"
            />

            {importStatus && (
              <div className={`p-3 rounded text-xs flex items-center space-x-2 ${
                importStatus.includes('Failed') ? 'bg-accent-red/10 border border-accent-red text-accent-red' : 'bg-accent-green/10 border border-accent-green text-accent-green'
              }`}>
                {importStatus.includes('Failed') ? <AlertCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                <span>{importStatus}</span>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2">
              <button onClick={() => setIsImportOpen(false)} className="px-4 py-2 bg-dark-700 text-text-secondary rounded text-xs">
                Cancel
              </button>
              <button onClick={handleImportTasks} className="px-4 py-2 bg-primary text-dark-900 rounded text-xs font-bold">
                Import Tasks
              </button>
            </div>
          </div>
        </div>
      )}

      {askingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
          <div className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6">
            <ConfirmPanel
              title={askingDelete.kind === 'project' ? 'Delete this project and its tasks?' : 'Delete this task?'}
              tone="danger"
              message={
                <>
                  <strong className="text-white">{askingDelete.label}</strong>.{' '}
                  {askingDelete.kind === 'project'
                    ? 'Its tasks go too. A task with time logged is archived instead, so your history keeps it.'
                    : 'A task with time logged is archived instead, so your history keeps it.'}
                </>
              }
              confirmLabel="Delete"
              cancelLabel="Back"
              onConfirm={() => {
                const target = askingDelete;
                setAskingDelete(null);
                void (target.kind === 'project' ? handleDeleteProject(target.id) : handleDeleteTask(target.id));
              }}
              onCancel={() => setAskingDelete(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
