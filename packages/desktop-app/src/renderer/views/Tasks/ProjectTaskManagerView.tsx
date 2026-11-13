import React, { useState, useEffect, useRef } from 'react';
import { MoreHorizontal, Plus, Search, Star, Trash2 } from 'lucide-react';
import { ProjectDTO, TaskDTO, ActiveSessionDTO } from '../../../shared/dtos';
import { END_THE_INTERRUPTION_FIRST } from '../../../shared/interruption';
import { pickTask } from '../../utils/pick-task';
import { Verb } from '../../../shared/words';
import { ConfirmPanel } from '../../components/ConfirmPanel';
import { useOnlyProjectsWithTasks } from '../../hooks/useOnlyProjectsWithTasks';
import { useTaskVisibility } from '../../hooks/useTaskVisibility';
import { useStarredProjects, useStarredTasks } from '../../hooks/useStars';
import { filterProjectsWithTasks, firstProjectWithTasks, openTasksShown } from '../../../shared/project-filter';
import { orderTasksForSelection } from '../../../shared/task-order';
import { DEFAULT_TASK_VISIBILITY, TaskVisibility, visibleTasks } from '../../../shared/task-visibility';
import { TaskOwnership } from '../../../shared/task-ownership';
import { hasTaskPage } from '../../../shared/task-page';
import { TaskPageButton } from '../../components/TaskPageButton';
import { OWN_PROJECT_PROVIDER_ID } from '../../../shared/local-provider';
import { ADHOC_PROJECT_ID } from '../../../shared/adhoc-project';
import { providerDisplayName } from '../../../shared/provider-names';
import { countOf, ipcErrorMessage } from '../../utils/formatters';
import { SETTING_SELECT_CLASS, SettingButton } from '../../components/SettingRow';
import { ImportedTask, parseImport } from '../../utils/task-import';

type TaskStatus = TaskDTO['status'];
type StateFilter = 'open' | TaskStatus | 'all';
type SortKey = 'key' | 'title' | 'status' | 'who';
interface Sort { by: SortKey; descending: boolean }

const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
const STATE_FILTERS: ReadonlyArray<[StateFilter, string]> = [
  ['open', 'Open'], ['in_progress', 'In progress'], ['todo', 'To do'], ['done', 'Done'], ['all', 'All']
];
const STATUS_ORDER: Record<TaskStatus, number> = { in_progress: 0, todo: 1, done: 2 };
const WHO_ORDER: Record<string, number> = { [TaskOwnership.MINE]: 0, [TaskOwnership.OTHER]: 1, [TaskOwnership.UNASSIGNED]: 2 };
const keyCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** A project made in the app: the only kind whose name and tasks are the user's to change. */
const isOwnProject = (project: ProjectDTO | undefined): boolean => project?.providerId === OWN_PROJECT_PROVIDER_ID;

/** Who a task is with, as the table says it: me, a name, nobody. */
function whoOf(task: TaskDTO): string {
  switch (task.ownership ?? TaskOwnership.MINE) {
    case TaskOwnership.UNASSIGNED: return 'nobody';
    case TaskOwnership.OTHER: return task.assigneeName?.trim() || 'someone else';
    default: return 'me';
  }
}

function matchesState(task: TaskDTO, filter: StateFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'open') return task.status !== 'done';
  return task.status === filter;
}

function compareTasks(a: TaskDTO, b: TaskDTO, by: SortKey): number {
  switch (by) {
    case 'key': return keyCollator.compare(a.key, b.key);
    case 'title': return keyCollator.compare(a.title, b.title);
    case 'status': return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    case 'who':
      return (WHO_ORDER[a.ownership ?? TaskOwnership.MINE] - WHO_ORDER[b.ownership ?? TaskOwnership.MINE])
        || keyCollator.compare(whoOf(a), whoOf(b));
  }
}

/** Where a project's tasks come from, as its header says it. */
function originOf(project: ProjectDTO): string {
  if (project.id === ADHOC_PROJECT_ID || isOwnProject(project)) return 'kept on this computer';
  return `from ${providerDisplayName(project.providerId)}`;
}

/**
 * Tasks (S13): the projects in a column -- searchable, starred first, each
 * with its open count -- and the selected project's tasks as a table with
 * filters that say what they hide. Only the app's own projects can be
 * renamed, imported into or deleted, and only their tasks deleted: a
 * provider's are the provider's, and the next sync would put them back.
 */
export const ProjectTaskManagerView: React.FC = () => {
  const [projects, setProjects] = useState<ProjectDTO[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  // Without the bridge there is nothing to wait for.
  const [loading, setLoading] = useState<boolean>(() => Boolean(window.electronAPI?.getProjects));
  const [activeSession, setActiveSession] = useState<ActiveSessionDTO | null>(null);
  const [onlyWithTasks, setOnlyWithTasks] = useOnlyProjectsWithTasks();
  const [visibility, setVisibility] = useTaskVisibility();
  const [starredProjects, toggleProjectStar] = useStarredProjects();
  const [starredTasks, toggleTaskStar] = useStarredTasks();
  const [projectQuery, setProjectQuery] = useState('');
  const [taskQuery, setTaskQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>('open');
  const [sort, setSort] = useState<Sort | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /**
   * Which project the task list is showing, readable from a subscription.
   *
   * The push handlers below are registered once on mount, so they close over
   * the first render's `selectedProjectId` -- an empty string -- and would
   * refetch nothing. A ref is the state they can actually read.
   */
  const selectedProjectRef = useRef<string>('');

  // One dialog at a time: what it is for is all the state it needs.
  const [dialog, setDialog] = useState<'add-project' | 'rename' | 'add-task' | 'import' | null>(null);
  // A deletion waiting for its yes. Not `window.confirm`, which blocks the
  // renderer; and a task is asked about too -- it used to go on one click.
  const [askingDelete, setAskingDelete] = useState<{ kind: 'project' | 'task'; id: string; label: string } | null>(null);

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
      // would show it whatever "hide empty" says. Chosen under the default
      // visibility: the stored one may not have answered yet, and this only
      // picks where the tab opens.
      setSelectedProjectId(current => current || firstProjectWithTasks(projs, DEFAULT_TASK_VISIBILITY));
      setLoading(false);
    });
  };

  const fetchTasks = (projId: string): Promise<void> => {
    if (!projId || !window.electronAPI?.getTasks) return Promise.resolve();
    // The projects come back with them: every task change -- added, imported,
    // deleted, started, done -- moves a project's open-task count, and "hide
    // empty" reads it. A stale count hid a project whose first task had just
    // been added once another was selected.
    const projectsRead = window.electronAPI.getProjects ? window.electronAPI.getProjects().then(setProjects) : Promise.resolve();
    return Promise.all([window.electronAPI.getTasks(projId).then(setTasks), projectsRead]).then(() => undefined);
  };

  useEffect(() => {
    void fetchProjects();
    window.electronAPI?.getCurrentSession?.().then(setActiveSession)
      .catch(err => console.warn('[Tasks] Reading the session failed:', err));

    const unsubscribes: Array<() => void> = [];
    if (window.electronAPI?.onSessionUpdated) {
      unsubscribes.push(
        window.electronAPI.onSessionUpdated(session => {
          setActiveSession(session);
          // Starting a task moves it to in_progress and finishing one can mark
          // it done, both in main. Without this the status kept what it had
          // when the tab mounted, which reads as the action not having worked.
          void fetchTasks(selectedProjectRef.current);
        })
      );
    }
    // This list is a view of the local cache, which only the sync worker fills.
    // Without this subscription, entering provider credentials left the user
    // looking at an empty project list until the next five-minute tick.
    if (window.electronAPI?.onProjectsUpdated) {
      unsubscribes.push(
        window.electronAPI.onProjectsUpdated(({ projects: synced }) => {
          setProjects(synced);
          setSelectedProjectId(current => {
            if (current && synced.some(p => p.id === current)) return current;
            return firstProjectWithTasks(synced, DEFAULT_TASK_VISIBILITY);
          });
          // A sync that refreshed the projects refreshed their tasks too, and
          // a status changed on the board is the most likely thing to move.
          void fetchTasks(selectedProjectRef.current);
        })
      );
    }
    // Registered once: the handlers read the selection through the ref.
    return () => unsubscribes.forEach(fn => fn());
  }, []);

  useEffect(() => {
    selectedProjectRef.current = selectedProjectId;
    if (selectedProjectId) void fetchTasks(selectedProjectId);
  }, [selectedProjectId]);

  /** Runs a change, then reads again; a refusal is said above the table. */
  const act = (what: string, run: () => Promise<unknown>, after: () => Promise<void>) => {
    setProblem(null);
    run().then(after, (err: unknown) => setProblem(`${what}: ${ipcErrorMessage(err)}`));
  };

  const activeProject = projects.find(p => p.id === selectedProjectId);
  const ownProject = isOwnProject(activeProject);

  // The selected project stays listed whatever it holds -- one just created
  // has no task yet -- and so does the running session's.
  const { visible: listedProjects, hiddenCount, nothingAssigned } = filterProjectsWithTasks(
    projects,
    onlyWithTasks,
    [selectedProjectId, activeSession?.projectId ?? ''].filter(Boolean),
    visibility
  );
  const projectWords = projectQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searchedProjects = listedProjects.filter(p => {
    const text = `${p.key} ${p.name}`.toLowerCase();
    return projectWords.every(w => text.includes(w));
  });
  const starred = searchedProjects.filter(p => starredProjects.has(p.id));
  const unstarred = searchedProjects.filter(p => !starredProjects.has(p.id));

  // Under the same visibility as the bar; the running session's task stays
  // whoever's it is, or hiding a teammate's work would take away the Stop of
  // a session on one.
  const { visible: shownTasks, hiddenCount: hiddenTaskCount } = visibleTasks(
    tasks, visibility, [activeSession?.taskId ?? ''].filter(Boolean)
  );
  const taskWords = taskQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filteredTasks = shownTasks.filter(t => {
    const text = `${t.key} ${t.title} ${t.description ?? ''}`.toLowerCase();
    return matchesState(t, stateFilter) && taskWords.every(w => text.includes(w));
  });
  // The bar's order unless a column is chosen: one rule for both lists.
  const listedTasks = sort
    ? [...filteredTasks].sort((a, b) => (sort.descending ? -1 : 1) * compareTasks(a, b, sort.by))
    : orderTasksForSelection(filteredTasks);
  const filteredOut = shownTasks.length - filteredTasks.length;
  // One project's tasks: they all have a page, or none does.
  const tasksHavePages = hasTaskPage(activeProject?.id, activeProject?.providerId);

  const sortBy = (by: SortKey) => setSort(prev => (prev?.by === by ? { by, descending: !prev.descending } : { by, descending: false }));

  if (loading) {
    return <div className="p-8 text-sm text-text-secondary">Loading your projects…</div>;
  }

  return (
    <div className="mx-auto flex max-w-7xl gap-6 p-8">
      <ProjectColumn
        query={projectQuery}
        onQuery={setProjectQuery}
        starred={starred}
        others={unstarred}
        total={listedProjects.length}
        selectedId={selectedProjectId}
        onSelect={id => { setSelectedProjectId(id); setMenuOpen(false); }}
        isStarred={id => starredProjects.has(id)}
        onStar={toggleProjectStar}
        visibility={visibility}
        hideEmpty={onlyWithTasks}
        onHideEmpty={setOnlyWithTasks}
        hiddenCount={hiddenCount}
        nothingAssigned={nothingAssigned}
        onAddProject={() => setDialog('add-project')}
      />

      <section aria-label="Tasks" className="min-w-0 flex-1 space-y-3">
        {!activeProject ? (
          <div className="py-12 text-center">
            <h2 className="text-lg font-semibold text-text-primary">No project yet</h2>
            <p className="mt-1 text-sm text-text-secondary">Connect an account in Settings › Account, or make a project of your own.</p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3">
              <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-text-primary">
                {activeProject.name}
                <span className="text-sm font-normal text-text-secondary"> · {originOf(activeProject)} · {countOf(shownTasks.filter(t => t.status !== 'done').length, 'open task')}</span>
              </h2>
              {ownProject && (
                <SettingButton onClick={() => setDialog('add-task')}><Plus className="h-3.5 w-3.5" /> Task of my own</SettingButton>
              )}
              {ownProject && (
                <div className="relative">
                  <SettingButton tone="ghost" aria-label={`More for ${activeProject.name}`} aria-haspopup="menu" aria-expanded={menuOpen}
                    onClick={() => setMenuOpen(v => !v)}>
                    <MoreHorizontal className="h-4 w-4" />
                  </SettingButton>
                  {menuOpen && (
                    <div role="menu" className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-border-dark bg-dark-800 py-1 shadow-xl">
                      {([['import', 'Import tasks…'], ['rename', 'Rename…']] as const).map(([to, label]) => (
                        <button key={to} role="menuitem" type="button" onClick={() => { setMenuOpen(false); setDialog(to); }}
                          className="block w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-dark-700">{label}</button>
                      ))}
                      <button role="menuitem" type="button"
                        onClick={() => { setMenuOpen(false); setAskingDelete({ kind: 'project', id: activeProject.id, label: activeProject.name }); }}
                        className="block w-full px-3 py-1.5 text-left text-xs text-accent-red hover:bg-dark-700">Delete…</button>
                    </div>
                  )}
                </div>
              )}
            </header>

            <TaskFilters
              query={taskQuery}
              onQuery={setTaskQuery}
              visibility={visibility}
              onVisibility={setVisibility}
              hiddenByWho={hiddenTaskCount}
              state={stateFilter}
              onState={setStateFilter}
            />

            {problem && <p role="alert" className="text-xs text-accent-amber">{problem}</p>}

            <div className="overflow-hidden rounded-xl border border-border-dark bg-dark-800">
              <table className="w-full table-fixed text-left text-xs">
                <thead className="border-b border-border-dark text-text-secondary">
                  <tr>
                    <th className="w-8 px-3 py-2"><span className="sr-only">Starred</span></th>
                    <SortHeader label="Key" by="key" sort={sort} onSort={sortBy} width="w-24" />
                    <SortHeader label="Title" by="title" sort={sort} onSort={sortBy} />
                    <SortHeader label="Status" by="status" sort={sort} onSort={sortBy} width="w-24" />
                    <SortHeader label="Who" by="who" sort={sort} onSort={sortBy} width="w-28" />
                    <th className={`${ownProject ? 'w-32' : 'w-24'} px-3 py-2`}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-dark">
                  {listedTasks.map(task => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      starred={starredTasks.has(task.id)}
                      onStar={() => toggleTaskStar(task.id)}
                      hasPage={tasksHavePages}
                      session={activeSession}
                      deletable={ownProject}
                      onStop={() => act('Not stopped', () => window.electronAPI.completeSession(undefined, false), () => fetchTasks(selectedProjectId))}
                      onStart={() => act('Not started', () => pickTask('start', activeSession, { task, takeAlong: false }, (id, adHoc, title) =>
                        // pickTask logs and swallows a refusal: said here first, so the click does not look ignored.
                        window.electronAPI.startTask(id, adHoc, title).catch((err: unknown) => {
                          setProblem(`Not started: ${ipcErrorMessage(err)}`);
                          throw err;
                        })), () => fetchTasks(selectedProjectId))}
                      onDelete={() => setAskingDelete({ kind: 'task', id: task.id, label: `${task.key} ${task.title}` })}
                    />
                  ))}
                </tbody>
              </table>
              {listedTasks.length === 0 && (
                <p className="px-3 py-8 text-center text-xs text-text-secondary">
                  {shownTasks.length > 0
                    ? 'No task matches the search or the state chosen.'
                    : ownProject ? 'No task here yet. Add one with + Task of my own, or import some.' : 'No task here that the filters show.'}
                </p>
              )}
            </div>
            {filteredOut > 0 && listedTasks.length > 0 && (
              <p className="text-xs text-text-muted">{countOf(filteredOut, 'more task')} not shown by the search or the state chosen.</p>
            )}
          </>
        )}
      </section>

      {dialog === 'add-project' && (
        <ProjectDialog
          title="A project of my own"
          submit="Make the project"
          note="Its time stays on this computer and is never sent."
          initialKey=""
          initialName=""
          onCancel={() => setDialog(null)}
          onSubmit={(key, name) => {
            const id = key.toUpperCase();
            act('Not made', () => window.electronAPI.createProject({ id, key: id, name, providerId: OWN_PROJECT_PROVIDER_ID }),
              () => { setDialog(null); return fetchProjects().then(() => setSelectedProjectId(id)); });
          }}
        />
      )}
      {dialog === 'rename' && activeProject && (
        <ProjectDialog
          title={`Rename ${activeProject.name}`}
          submit="Rename"
          initialKey={activeProject.key}
          initialName={activeProject.name}
          onCancel={() => setDialog(null)}
          onSubmit={(key, name) => act('Not renamed',
            () => window.electronAPI.renameProject({ id: activeProject.id, name, key: key.toUpperCase() || activeProject.id }),
            () => { setDialog(null); return fetchProjects(); })}
        />
      )}
      {dialog === 'add-task' && activeProject && (
        <TaskDialog
          project={activeProject}
          onCancel={() => setDialog(null)}
          onSubmit={(key, title, status) => {
            const taskKey = key || `${activeProject.key}-${Date.now().toString().slice(-3)}`;
            act('Not added',
              () => window.electronAPI.updateTask({ id: `${activeProject.id}_${taskKey}`, projectId: activeProject.id, key: taskKey, title, status }),
              () => { setDialog(null); return fetchTasks(activeProject.id); });
          }}
        />
      )}
      {dialog === 'import' && activeProject && (
        <ImportDialog
          project={activeProject}
          onCancel={() => setDialog(null)}
          onImport={parsed => window.electronAPI.importTasks(activeProject.id, parsed).then(() => fetchTasks(activeProject.id))}
        />
      )}

      {askingDelete && (
        <Modal label={askingDelete.kind === 'project' ? 'Delete this project' : 'Delete this task'}>
          <ConfirmPanel
            title={askingDelete.kind === 'project' ? 'Delete this project and its tasks?' : 'Delete this task?'}
            tone="danger"
            message={
              <>
                <strong className="text-text-primary">{askingDelete.label}</strong>.{' '}
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
              if (target.kind === 'project') {
                act('Not deleted', () => window.electronAPI.deleteProject(target.id), () => { setSelectedProjectId(''); return fetchProjects(); });
              } else {
                act('Not deleted', () => window.electronAPI.deleteTask(target.id), () => fetchTasks(selectedProjectId));
              }
            }}
            onCancel={() => setAskingDelete(null)}
          />
        </Modal>
      )}
    </div>
  );
};

const ProjectColumn: React.FC<{
  query: string;
  onQuery: (q: string) => void;
  starred: ProjectDTO[];
  others: ProjectDTO[];
  total: number;
  selectedId: string;
  onSelect: (id: string) => void;
  isStarred: (id: string) => boolean;
  onStar: (id: string) => void;
  visibility: TaskVisibility;
  hideEmpty: boolean;
  onHideEmpty: (on: boolean) => void;
  hiddenCount: number;
  nothingAssigned: boolean;
  onAddProject: () => void;
}> = props => {
  const item = (p: ProjectDTO) => {
    const count = openTasksShown(p, props.visibility);
    const selected = p.id === props.selectedId;
    const starred = props.isStarred(p.id);
    return (
      <li key={p.id} className={`flex items-center rounded-lg ${selected ? 'bg-select' : 'hover:bg-dark-700'}`}>
        <button type="button" aria-label={`${starred ? 'Unstar' : 'Star'} ${p.name}`} aria-pressed={starred}
          onClick={() => props.onStar(p.id)}
          className={`p-1.5 ${starred ? 'text-accent-amber' : 'text-text-muted hover:text-text-primary'}`}>
          <Star className="h-3.5 w-3.5" fill={starred ? 'currentColor' : 'none'} />
        </button>
        <button type="button" aria-current={selected ? 'true' : undefined} title={p.key} onClick={() => props.onSelect(p.id)}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pr-2 text-left text-xs">
          <span className={`truncate ${selected ? 'text-text-primary' : 'text-text-secondary'}`}>{p.name}</span>
          {count !== null && <span className="font-mono text-text-muted">{count}</span>}
        </button>
      </li>
    );
  };
  return (
    <nav aria-label="Projects" className="w-52 shrink-0 space-y-3">
      <label className="flex items-center gap-2 rounded-lg border border-border-dark bg-dark-800 px-3 py-2 focus-within:border-focus">
        <Search className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
        <input type="search" value={props.query} onChange={e => props.onQuery(e.target.value)} placeholder="Projects"
          aria-label="Search projects"
          className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none" />
      </label>
      {props.starred.length > 0 && (
        <div>
          <h3 className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Starred</h3>
          <ul aria-label="Starred projects" className="space-y-0.5">{props.starred.map(item)}</ul>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between px-2 pb-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">All · {props.total}</h3>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-secondary"
            title="Hides projects with no open task the lists show. The bar's own picker follows the same setting.">
            <input type="checkbox" checked={props.hideEmpty} onChange={e => props.onHideEmpty(e.target.checked)} className="accent-primary" />
            hide empty
          </label>
        </div>
        {props.hideEmpty && props.hiddenCount > 0 && <p className="px-2 pb-1 text-[11px] text-text-muted">{props.hiddenCount} empty hidden</p>}
        {props.hideEmpty && props.nothingAssigned && <p className="px-2 pb-1 text-[11px] text-text-muted">None has an open task: showing all.</p>}
        <ul aria-label="All projects" className="max-h-[60vh] space-y-0.5 overflow-y-auto">{props.others.map(item)}</ul>
        {props.starred.length + props.others.length === 0 && props.query.trim() !== '' && (
          <p className="px-2 py-1 text-xs text-text-muted">No project by that name.</p>
        )}
      </div>
      <SettingButton tone="ghost" onClick={props.onAddProject}><Plus className="h-3.5 w-3.5" /> A project of my own</SettingButton>
    </nav>
  );
};

const PILL_ON = 'border-focus/40 bg-select text-text-primary';
const PILL_OFF = 'border-border-dark text-text-secondary hover:text-text-primary';

const TaskFilters: React.FC<{
  query: string;
  onQuery: (q: string) => void;
  visibility: TaskVisibility;
  onVisibility: (v: TaskVisibility) => void;
  hiddenByWho: number;
  state: StateFilter;
  onState: (s: StateFilter) => void;
}> = ({ query, onQuery, visibility, onVisibility, hiddenByWho, state, onState }) => (
  <div className="flex flex-wrap items-center gap-2">
    <label className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-lg border border-border-dark bg-dark-800 px-3 py-1.5 focus-within:border-focus">
      <Search className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
      <input type="search" value={query} onChange={e => onQuery(e.target.value)} placeholder="Search this project"
        aria-label="Search this project"
        className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none" />
    </label>
    <div role="group" aria-label="Whose tasks" className="flex items-center gap-1"
      title="Your own tasks are always listed. The bar's own picker follows the same setting.">
      <span className={`rounded-full border px-2.5 py-1 text-[11px] ${PILL_ON}`}>✓ mine</span>
      {([['unassigned', 'unassigned'], ['others', "teammates'"]] as const).map(([field, label]) => (
        <button key={field} type="button" aria-pressed={visibility[field]}
          onClick={() => onVisibility({ ...visibility, [field]: !visibility[field] })}
          className={`rounded-full border px-2.5 py-1 text-[11px] ${visibility[field] ? PILL_ON : PILL_OFF}`}>
          {visibility[field] ? '✓ ' : ''}{label}
        </button>
      ))}
      {hiddenByWho > 0 && <span className="text-[11px] text-text-muted">{hiddenByWho} hidden</span>}
    </div>
    <select aria-label="State" value={state} onChange={e => onState(e.target.value as StateFilter)} className={SETTING_SELECT_CLASS}>
      {STATE_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  </div>
);

const SortHeader: React.FC<{ label: string; by: SortKey; sort: Sort | null; onSort: (by: SortKey) => void; width?: string }> = ({ label, by, sort, onSort, width = '' }) => {
  const active = sort?.by === by;
  return (
    <th className={`${width} px-3 py-2 font-medium`} aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'}>
      <button type="button" onClick={() => onSort(by)} className="hover:text-text-primary">
        {label}{active ? (sort.descending ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
};

const TaskRow: React.FC<{
  task: TaskDTO;
  starred: boolean;
  onStar: () => void;
  hasPage: boolean;
  session: ActiveSessionDTO | null;
  deletable: boolean;
  onStop: () => void;
  onStart: () => void;
  onDelete: () => void;
}> = ({ task, starred, onStar, hasPage, session, deletable, onStop, onStart, onDelete }) => {
  const running = session?.taskId === task.id;
  const who = whoOf(task);
  return (
    <tr className={running ? 'bg-accent-green/5' : 'hover:bg-dark-700/40'}>
      <td className="px-3 py-2">
        <button type="button" aria-label={`${starred ? 'Unstar' : 'Star'} ${task.key}`} aria-pressed={starred} onClick={onStar}
          className={starred ? 'text-accent-amber' : 'text-text-muted hover:text-text-primary'}>
          <Star className="h-3.5 w-3.5" fill={starred ? 'currentColor' : 'none'} />
        </button>
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className="font-mono font-semibold text-text-primary">{task.key}</span>
        {hasPage && <span className="ml-1 inline-block align-middle"><TaskPageButton taskId={task.id} taskKey={task.key} /></span>}
      </td>
      <td className="px-3 py-2">
        <div className="truncate text-text-primary" title={task.description ?? task.title}>{task.title}</div>
      </td>
      <td className={`whitespace-nowrap px-3 py-2 ${task.status === 'in_progress' ? 'text-text-primary' : 'text-text-secondary'}`}>
        {STATUS_LABEL[task.status]}
      </td>
      <td className={`truncate whitespace-nowrap px-3 py-2 ${who === 'nobody' ? 'text-accent-amber' : 'text-text-secondary'}`} data-testid="task-owner" title={who}>
        {who}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {running ? (
          // One click, as Today's Stop: logged, the task left open, and Undo
          // for UNDO_WINDOW_MS. Done and Discard are the session card's.
          <SettingButton title="Stop the timer; the task stays open" onClick={onStop}>{Verb.STOP}</SettingButton>
        ) : (
          <SettingButton
            // Choosing a task does nothing during an interruption (2026-11-12).
            disabled={Boolean(session?.interruption)}
            title={session?.interruption ? END_THE_INTERRUPTION_FIRST : session ? 'Switch to this task' : 'Start this task'}
            onClick={onStart}
          >
            {session ? Verb.SWITCH : Verb.START}
          </SettingButton>
        )}
        {deletable && (
          <button type="button" onClick={onDelete} aria-label={`Delete ${task.key}`} title={`Delete ${task.key}`}
            className="ml-1 rounded p-1 align-middle text-text-muted hover:text-accent-red">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
};

const Modal: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 p-4 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-md space-y-4 rounded-xl border border-border-dark bg-dark-800 p-6 shadow-2xl">
      {children}
    </div>
  </div>
);

const FIELD = 'w-full rounded-lg border border-border-dark bg-dark-900 px-3 py-2 text-xs text-text-primary focus:border-focus focus:outline-none';

const DialogButtons: React.FC<{ submit: string; onCancel: () => void; disabled?: boolean }> = ({ submit, onCancel, disabled }) => (
  <div className="flex justify-end gap-2 pt-1">
    <SettingButton tone="ghost" onClick={onCancel}>Cancel</SettingButton>
    <SettingButton tone="primary" type="submit" disabled={disabled}>{submit}</SettingButton>
  </div>
);

const ProjectDialog: React.FC<{
  title: string;
  submit: string;
  note?: string;
  initialKey: string;
  initialName: string;
  onCancel: () => void;
  onSubmit: (key: string, name: string) => void;
}> = ({ title, submit, note, initialKey, initialName, onCancel, onSubmit }) => {
  const [key, setKey] = useState(initialKey);
  const [name, setName] = useState(initialName);
  return (
    <Modal label={title}>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (key.trim() && name.trim()) onSubmit(key.trim(), name.trim()); }}>
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {note && <p className="text-xs text-text-secondary">{note}</p>}
        <label className="block text-xs text-text-secondary">Key, e.g. ADMIN
          <input type="text" required value={key} onChange={e => setKey(e.target.value)} placeholder="ADMIN" className={`${FIELD} mt-1 font-mono`} />
        </label>
        <label className="block text-xs text-text-secondary">Name
          <input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Studio admin" className={`${FIELD} mt-1`} />
        </label>
        <DialogButtons submit={submit} onCancel={onCancel} disabled={!key.trim() || !name.trim()} />
      </form>
    </Modal>
  );
};

const TaskDialog: React.FC<{
  project: ProjectDTO;
  onCancel: () => void;
  onSubmit: (key: string, title: string, status: TaskStatus) => void;
}> = ({ project, onCancel, onSubmit }) => {
  const [key, setKey] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const label = `A task of my own in ${project.name}`;
  return (
    <Modal label={label}>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (title.trim()) onSubmit(key.trim().toUpperCase(), title.trim(), status); }}>
        <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
        <label className="block text-xs text-text-secondary">Key, or leave it for one to be made
          <input type="text" value={key} onChange={e => setKey(e.target.value)} placeholder={`${project.key}-101`} className={`${FIELD} mt-1 font-mono`} />
        </label>
        <label className="block text-xs text-text-secondary">Title
          <input type="text" required value={title} onChange={e => setTitle(e.target.value)} placeholder="Expense report" className={`${FIELD} mt-1`} />
        </label>
        <label className="block text-xs text-text-secondary">Status
          <select value={status} onChange={e => setStatus(e.target.value as TaskStatus)} className={`${FIELD} mt-1`}>
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <DialogButtons submit="Add the task" onCancel={onCancel} disabled={!title.trim()} />
      </form>
    </Modal>
  );
};

const ImportDialog: React.FC<{
  project: ProjectDTO;
  onCancel: () => void;
  onImport: (tasks: ImportedTask[]) => Promise<void>;
}> = ({ project, onCancel, onImport }) => {
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const label = `Import tasks into ${project.name}`;
  const run = () => {
    let parsed: ImportedTask[];
    try {
      parsed = parseImport(text);
    } catch (err) {
      setResult({ ok: false, text: `Not read: ${err instanceof Error ? err.message : String(err)}. Nothing was imported.` });
      return;
    }
    onImport(parsed).then(
      () => setResult({ ok: true, text: `Imported ${countOf(parsed.length, 'task')}.` }),
      (err: unknown) => setResult({ ok: false, text: `Not imported: ${ipcErrorMessage(err)}` })
    );
  };
  return (
    <Modal label={label}>
      <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
      <p className="text-xs text-text-secondary">
        One task a line, <span className="font-mono text-text-primary">KEY, Title, todo</span> -- or a title alone -- or a JSON
        array of <span className="font-mono text-text-primary">{'{ "key", "title" }'}</span>.
      </p>
      <textarea rows={6} aria-label="Tasks to import" value={text} onChange={e => { setText(e.target.value); setResult(null); }}
        placeholder={`${project.key}-101, Expense report, todo`} className={`${FIELD} resize-none font-mono`} />
      {result && (result.ok
        ? <p role="status" className="text-xs text-accent-green">{result.text}</p>
        : <p role="alert" className="text-xs text-accent-red">{result.text}</p>)}
      <div className="flex justify-end gap-2">
        <SettingButton tone="ghost" onClick={onCancel}>{result?.ok ? 'Close' : 'Cancel'}</SettingButton>
        {!result?.ok && <SettingButton tone="primary" disabled={!text.trim()} onClick={run}>Import</SettingButton>}
      </div>
    </Modal>
  );
};
