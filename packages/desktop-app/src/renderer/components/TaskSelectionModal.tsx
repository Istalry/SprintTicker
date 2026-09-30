import React, { useState, useEffect } from 'react';
import { X, Search, PlusCircle, ArrowLeft, Check, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { ProjectDTO, TaskDTO } from '../../shared/dtos';

interface TaskSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectDTO[];
  tasks?: TaskDTO[];
  onSelectTask: (taskId: string, isAdHoc?: boolean, customTitle?: string) => void;
}

const statusConfig: Record<string, { label: string; icon: React.FC<{ className?: string }>; color: string }> = {
  done: { label: 'Done', icon: CheckCircle2, color: 'text-accent-green' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'text-accent-blue' },
  todo: { label: 'To Do', icon: AlertCircle, color: 'text-text-secondary' }
};

/**
 * Each opening mounts the dialog afresh, so it starts on step 1 with nothing
 * typed. That reset used to be an effect on `isOpen` that set eight pieces of
 * state -- a render spent on the stale ones first, and, because it also
 * listened to `projects`, a sync landing mid-choice threw the user back to
 * step 1.
 */
export const TaskSelectionModal: React.FC<TaskSelectionModalProps> = props =>
  props.isOpen ? <TaskSelectionDialog {...props} /> : null;

const TaskSelectionDialog: React.FC<TaskSelectionModalProps> = ({
  onClose,
  projects: propProjects,
  onSelectTask
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  // The prop is what App had; the dialog asks main for the current list on
  // mount and falls back to the prop if that fails.
  const [activeProjects, setActiveProjects] = useState<ProjectDTO[]>(propProjects || []);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => propProjects?.[0]?.id ?? '');
  const [loadedTasks, setLoadedTasks] = useState<{ projectId: string; tasks: TaskDTO[] } | null>(null);
  const [isAdHocMode, setIsAdHocMode] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  useEffect(() => {
    if (!window.electronAPI?.getProjects) return;
    window.electronAPI.getProjects().then(projs => {
      const list = projs || [];
      setActiveProjects(list);
      setSelectedProjectId(list.length > 0 ? list[0].id : '');
    }).catch(() => {
      setActiveProjects(propProjects || []);
    });
    // Once per opening: a later `projects` prop must not reset a choice in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tasks are fetched for the project on step 2, and belong to the project
  // they were fetched for. Loading is derived from that rather than flagged:
  // a flag set before the request is state set synchronously in an effect,
  // and a late answer for the previous project could overwrite the current one.
  const wantsTasks = step === 2 && !isAdHocMode && Boolean(selectedProjectId) && Boolean(window.electronAPI?.getTasks);
  useEffect(() => {
    if (!wantsTasks) return undefined;
    let current = true;
    const projectId = selectedProjectId;
    window.electronAPI.getTasks(projectId).then(
      tasks => { if (current) setLoadedTasks({ projectId, tasks }); },
      err => {
        console.warn('[TaskSelectionModal] Failed to load tasks for project:', projectId, err);
        if (current) setLoadedTasks({ projectId, tasks: [] });
      }
    );
    return () => { current = false; };
  }, [wantsTasks, selectedProjectId]);

  const tasksAreForSelection = loadedTasks?.projectId === selectedProjectId;
  const projectTasks = tasksAreForSelection ? loadedTasks.tasks : [];
  const loadingTasks = wantsTasks && !tasksAreForSelection;

  const query = searchQuery.toLowerCase();
  const filteredTasks = projectTasks.filter(t =>
    t.key.toLowerCase().includes(query) ||
    t.title.toLowerCase().includes(query) ||
    (t.description ?? '').toLowerCase().includes(query)
  );

  // Handle keyboard events (Esc to close, Enter to confirm, Arrow keys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filteredTasks.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (step === 2) {
          if (isAdHocMode) {
            if (customTitle.trim()) {
              // Empty id: the main process owns ad-hoc task identity and returns the row it creates.
              onSelectTask('', true, customTitle.trim());
              onClose();
            }
          } else if (filteredTasks[selectedIndex]) {
            onSelectTask(filteredTasks[selectedIndex].id, false, filteredTasks[selectedIndex].title);
            onClose();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, isAdHocMode, customTitle, filteredTasks, selectedIndex, onClose, onSelectTask]);

  const selectedProject = activeProjects.find(p => p.id === selectedProjectId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-dark bg-dark-700/50">
          <div className="flex items-center space-x-2">
            {step === 2 && (
              <button
                onClick={() => { setStep(1); setSearchQuery(''); setSelectedIndex(0); }}
                className="p-1 hover:bg-dark-700 rounded-md text-text-secondary hover:text-white transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <h3 className="text-md font-bold text-white font-mono">
              {step === 1
                ? 'Step 1: Select Target Project'
                : isAdHocMode
                ? 'Step 2: Enter Custom Ad-Hoc Task Title'
                : `Step 2: Select Task under [${selectedProject?.key ?? selectedProjectId}]`}
            </h3>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 hover:bg-dark-700 rounded-md text-text-secondary hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-4 flex-1">
          {step === 1 ? (
            <div className="space-y-3">
              <p className="text-xs text-text-secondary">
                Choose an active project to track time against:
              </p>

              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {activeProjects.length > 0 ? (
                  activeProjects.map(proj => (
                    <button
                      key={proj.id}
                      onClick={() => {
                        setSelectedProjectId(proj.id);
                        setIsAdHocMode(false);
                        setStep(2);
                      }}
                      className={`w-full flex items-center justify-between p-3.5 rounded-lg border text-left font-medium text-sm transition-all ${
                        selectedProjectId === proj.id && !isAdHocMode
                          ? 'bg-accent-blue/10 border-accent-blue text-accent-blue'
                          : 'bg-dark-700/50 border-border-dark text-text-primary hover:bg-dark-700'
                      }`}
                    >
                      <div>
                        <div className="font-mono font-bold">{proj.key}</div>
                        <div className="text-xs text-text-secondary">{proj.name}</div>
                      </div>
                      {selectedProjectId === proj.id && !isAdHocMode && <Check className="w-5 h-5" />}
                    </button>
                  ))
                ) : (
                  <div className="p-4 bg-dark-900/50 border border-border-dark rounded-lg text-center text-xs text-text-secondary font-mono">
                    No active projects registered in database.
                  </div>
                )}

                <button
                  onClick={() => {
                    setIsAdHocMode(true);
                    setStep(2);
                  }}
                  className={`w-full flex items-center space-x-3 p-3.5 rounded-lg border text-left font-medium text-sm transition-all ${
                    isAdHocMode
                      ? 'bg-accent-purple/10 border-accent-purple text-accent-purple'
                      : 'bg-dark-700/30 border-dashed border-border-dark text-text-secondary hover:text-white hover:bg-dark-700/60'
                  }`}
                >
                  <PlusCircle className="w-5 h-5 text-accent-purple" />
                  <div>
                    <div className="font-bold text-white">+ Create Custom / Ad-Hoc Task</div>
                    <div className="text-xs text-text-secondary">Logged under fallback ticket MISC-1</div>
                  </div>
                </button>
              </div>
            </div>
          ) : isAdHocMode ? (
            <div className="space-y-4">
              <p className="text-xs text-text-secondary">
                Enter a custom description for your overhead or non-sprint work:
              </p>

              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">Custom Task Title</label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={e => setCustomTitle(e.target.value)}
                  placeholder="e.g. Code Review with Lead Architect"
                  autoFocus
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent-blue font-sans"
                />
              </div>

              <div className="text-xs font-mono text-accent-amber bg-accent-amber/10 p-3 rounded-lg border border-accent-amber/20">
                ℹ️ Time will be logged under fallback ticket: <strong>MISC-1</strong>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3.5 top-3 text-text-secondary" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    setSelectedIndex(0);
                  }}
                  placeholder="Search task key, title or description..."
                  autoFocus
                  className="w-full bg-dark-900 border border-border-dark rounded-lg pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-accent-blue font-sans"
                />
              </div>

              <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                {loadingTasks ? (
                  <div className="text-center py-6 text-xs text-text-secondary font-mono">
                    Loading tasks for [{selectedProject?.key}]...
                  </div>
                ) : filteredTasks.length > 0 ? (
                  filteredTasks.map((t, idx) => {
                    const conf = statusConfig[t.status] ?? statusConfig['todo'];
                    const StatusIcon = conf.icon;
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          onSelectTask(t.id, false, t.title);
                          onClose();
                        }}
                        className={`w-full flex items-center justify-between p-3 rounded-lg text-left text-sm font-medium transition-all ${
                          selectedIndex === idx
                            ? 'bg-accent-blue/15 border border-accent-blue/40 text-white'
                            : 'bg-dark-700/40 border border-transparent text-text-primary hover:bg-dark-700'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-accent-blue font-bold">{t.key}</div>
                          <div className="text-xs text-text-secondary">{t.title}</div>
                          {t.description && (
                            <div className="text-[11px] text-text-secondary/70 truncate">{t.description}</div>
                          )}
                        </div>
                        <div className={`flex items-center space-x-1 text-xs ${conf.color}`}>
                          <StatusIcon className="w-3.5 h-3.5" />
                          <span className="font-mono">{conf.label}</span>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="text-center py-6 text-xs text-text-secondary font-mono">
                    No matching tasks under [{selectedProject?.key ?? selectedProjectId}].
                    <br />
                    <span className="text-accent-purple">Add tasks in Projects &amp; Tasks manager.</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border-dark bg-dark-700/30">
          <span className="text-xs font-mono text-text-secondary">Use Enter to select • Esc to dismiss</span>

          <div className="flex items-center space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-dark-700 hover:bg-dark-700/80 text-text-secondary hover:text-white text-xs font-semibold rounded-lg border border-border-dark transition-all"
            >
              Cancel
            </button>

            {step === 2 && isAdHocMode && (
              <button
                onClick={() => {
                  if (customTitle.trim()) {
                    // Empty id: the main process owns ad-hoc task identity and returns the row it creates.
              onSelectTask('', true, customTitle.trim());
                    onClose();
                  }
                }}
                disabled={!customTitle.trim()}
                className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                  customTitle.trim()
                    ? 'bg-accent-green hover:bg-emerald-600 text-dark-900'
                    : 'bg-dark-700 text-text-secondary cursor-not-allowed'
                }`}
              >
                Start Session
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
