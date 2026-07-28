import React, { useState, useEffect } from 'react';
import { FolderPlus, Plus, Trash2, Edit3, Upload, FileText, CheckCircle, AlertCircle, X, CheckCircle2, Clock } from 'lucide-react';
import { ProjectDTO, TaskDTO } from '../../../shared/dtos';
import { triggerDesktopConfetti } from '../../utils/confetti-fx';

export const ProjectTaskManagerView: React.FC = () => {
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

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

  // Fetch Projects
  const fetchProjects = async () => {
    if (window.electronAPI?.getProjects) {
      const projs = await window.electronAPI.getProjects();
      setProjects(projs);
      if (projs.length > 0 && !selectedProjectId) {
        setSelectedProjectId(projs[0].id);
      }
    }
    setLoading(false);
  };

  // Fetch Tasks for active project
  const fetchTasks = async (projId: string) => {
    if (!projId) return;
    if (window.electronAPI?.getTasks) {
      const taskList = await window.electronAPI.getTasks(projId);
      setTasks(taskList);
    }
  };

  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      fetchTasks(selectedProjectId);
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
        providerId: 'local'
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

  // Handle Project Deletion
  const handleDeleteProject = async (projId: string) => {
    if (!window.confirm(`Are you sure you want to delete project [${projId}] and all its tasks?`)) return;

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

  // Handle Task Status Update with confetti burst on done
  const handleSetTaskStatus = async (task: TaskDTO, newStatus: 'todo' | 'in_progress' | 'done') => {
    if (!window.electronAPI?.updateTask) return;

    await window.electronAPI.updateTask({ ...task, status: newStatus });

    if (newStatus === 'done') {
      triggerDesktopConfetti();
      if (window.electronAPI?.triggerConfettiBurst) {
        window.electronAPI.triggerConfettiBurst().catch(err =>
          console.warn('[TaskDone] Hardware confetti burst warning:', err)
        );
      }
    }

    await fetchTasks(selectedProjectId);
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
        setImportStatus(`Successfully imported ${parsedTasks.length} task(s)!`);
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

  if (loading) {
    return <div className="p-8 text-text-secondary font-mono text-sm">Loading Project & Task Registry...</div>;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 select-none font-mono">
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
            className="flex items-center space-x-2 px-3.5 py-2 bg-dark-700 hover:bg-dark-600 border border-border-dark text-text-primary hover:text-white rounded-lg text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
          >
            <Upload className="w-4 h-4 text-accent-purple" />
            <span>Import Tasks</span>
          </button>
          <button
            onClick={() => setIsAddProjOpen(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-accent-blue hover:bg-blue-600 text-white rounded-lg text-xs font-semibold shadow-md transition-all"
          >
            <FolderPlus className="w-4 h-4" />
            <span>+ New Project</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Projects (Left 1/3) & Tasks (Right 2/3) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Projects List Sidebar */}
        <div className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-border-dark pb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Projects ({projects.length})</h3>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {projects.map(proj => (
              <div
                key={proj.id}
                onClick={() => setSelectedProjectId(proj.id)}
                className={`group flex items-center justify-between p-3.5 rounded-lg border cursor-pointer transition-all ${
                  selectedProjectId === proj.id
                    ? 'bg-accent-blue/10 border-accent-blue text-white shadow-md'
                    : 'bg-dark-900/60 border-border-dark text-text-secondary hover:text-white hover:bg-dark-700/50'
                }`}
              >
                <div>
                  <div className="font-bold text-xs text-accent-blue">{proj.key}</div>
                  <div className="text-xs font-medium text-text-primary mt-0.5">{proj.name}</div>
                </div>

                <div className="opacity-0 group-hover:opacity-100 flex items-center space-x-1 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedProjectId(proj.id);
                      setEditProjKey(proj.key);
                      setEditProjName(proj.name);
                      setIsEditProjOpen(true);
                    }}
                    className="p-1 hover:bg-dark-700 text-text-secondary hover:text-white rounded"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteProject(proj.id);
                    }}
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
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                {activeProject ? `Tasks under [${activeProject.key}] ${activeProject.name}` : 'Select a Project'}
              </h3>
              <p className="text-xs text-text-secondary mt-0.5">{tasks.length} task(s) registered</p>
            </div>

            <button
              onClick={() => setIsAddTaskOpen(true)}
              disabled={!selectedProjectId}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-accent-green hover:bg-emerald-600 text-dark-900 rounded-lg text-xs font-bold shadow-sm transition-all disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>Add Task</span>
            </button>
          </div>

          {/* Tasks List */}
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1 flex-1">
            {tasks.length > 0 ? (
              tasks.map(task => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-3.5 bg-dark-900/60 border border-border-dark rounded-lg hover:border-dark-600 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 bg-dark-700 border border-border-dark text-accent-blue text-[10px] font-bold rounded">
                        {task.key}
                      </span>
                      <span className="text-xs font-bold text-white">{task.title}</span>
                    </div>
                    <div className="text-[10px] text-text-secondary">Project: {task.projectId}</div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {/* Status cycle buttons */}
                    <div className="flex items-center space-x-1 bg-dark-700/60 border border-border-dark rounded-lg p-1">
                      <button
                        title="Mark To Do"
                        onClick={() => handleSetTaskStatus(task, 'todo')}
                        className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                          task.status === 'todo'
                            ? 'bg-dark-600 border border-border-dark text-text-primary'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        <AlertCircle className="w-3 h-3" />
                        <span>To Do</span>
                      </button>
                      <button
                        title="Mark In Progress"
                        onClick={() => handleSetTaskStatus(task, 'in_progress')}
                        className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                          task.status === 'in_progress'
                            ? 'bg-accent-blue/20 border border-accent-blue/40 text-accent-blue'
                            : 'text-text-secondary hover:text-accent-blue'
                        }`}
                      >
                        <Clock className="w-3 h-3" />
                        <span>In Progress</span>
                      </button>
                      <button
                        title="Mark as Done 🎉"
                        onClick={() => handleSetTaskStatus(task, 'done')}
                        className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                          task.status === 'done'
                            ? 'bg-accent-green/20 border border-accent-green/40 text-accent-green'
                            : 'text-text-secondary hover:text-accent-green'
                        }`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Done</span>
                      </button>
                    </div>

                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-1.5 text-text-secondary hover:text-accent-red hover:bg-dark-700 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-12 text-xs text-text-secondary">
                No tasks found for this project. Click <span className="text-accent-green font-bold">&apos;+ Add Task&apos;</span> or <span className="text-accent-purple font-bold">&apos;Import Tasks&apos;</span> to create work items.
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
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white uppercase focus:border-accent-blue outline-none"
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
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white focus:border-accent-blue outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setIsAddProjOpen(false)} className="px-4 py-2 bg-dark-700 text-text-secondary rounded text-xs">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-accent-blue text-white rounded text-xs font-bold">
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
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white uppercase focus:border-accent-blue outline-none"
                />
              </div>

              <div>
                <label className="block text-text-secondary mb-1">Project Name</label>
                <input
                  type="text"
                  required
                  value={editProjName}
                  onChange={e => setEditProjName(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white focus:border-accent-blue outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button type="button" onClick={() => setIsEditProjOpen(false)} className="px-4 py-2 bg-dark-700 text-text-secondary rounded text-xs">
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 bg-accent-blue text-white rounded text-xs font-bold">
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
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white uppercase focus:border-accent-blue outline-none"
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
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white focus:border-accent-blue outline-none"
                />
              </div>

              <div>
                <label className="block text-text-secondary mb-1">Status</label>
                <select
                  value={newTaskStatus}
                  onChange={e => setNewTaskStatus(e.target.value as 'todo' | 'in_progress' | 'done')}
                  className="w-full bg-dark-900 border border-border-dark rounded px-3 py-2 text-white focus:border-accent-blue outline-none"
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
                <FileText className="w-5 h-5 text-accent-purple" />
                <h3 className="text-sm font-bold text-white">Import Tasks to [{selectedProjectId}]</h3>
              </div>
              <button onClick={() => setIsImportOpen(false)} className="text-text-secondary hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-text-secondary">
              Paste CSV lines (Format: <span className="text-white font-mono">KEY, TITLE, STATUS</span>) or JSON array (<span className="text-white font-mono">[&#123; &quot;key&quot;: &quot;KEY-1&quot;, &quot;title&quot;: &quot;Title&quot; &#125;]</span>):
            </p>

            <textarea
              rows={6}
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="PROJ-101, Implement Player Physics, todo&#10;PROJ-102, Design UI HUD, in_progress"
              className="w-full bg-dark-900 border border-border-dark rounded p-3 text-xs text-white font-mono focus:border-accent-purple outline-none resize-none"
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
              <button onClick={handleImportTasks} className="px-4 py-2 bg-accent-purple text-white rounded text-xs font-bold">
                Import Tasks
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
