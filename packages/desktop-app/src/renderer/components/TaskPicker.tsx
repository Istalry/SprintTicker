import React, { useEffect, useRef, useState } from 'react';
import { useModal } from '../hooks/useModal';
import { ArrowLeft, ChevronRight, Download, PlusCircle, RefreshCw, Search, Star, X } from 'lucide-react';
import { ProjectDTO, TaskDTO } from '../../shared/dtos';
import { ADHOC_PROJECT_ID } from '../../shared/adhoc-project';
import { visibleTasks } from '../../shared/task-visibility';
import { TaskOwnership } from '../../shared/task-ownership';
import { orderTasksForSelection } from '../../shared/task-order';
import {
  PICKER_MINE_PREVIEW,
  PickerDataDTO,
  PickerMode,
  countProject,
  looksLikeTaskKey,
  matchesSearch,
  myOpenTasks,
  needsRealTask,
  offersOwnTask,
  orderProjects,
  parseProjectPrefix,
  recentWithJustChosen,
  searchByProject
} from '../../shared/task-picker';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { useTaskVisibility } from '../hooks/useTaskVisibility';
import { TaskOwnerBadge, TaskVisibilityToggle } from './TaskVisibilityToggle';
import { formatHoursAndMinutes, ipcErrorMessage } from '../utils/formatters';
import { KEEP_AS_OWN_ENTRY } from '../../shared/words';

/** What the user picked: a task, or work of their own named `ownTitle`. */
export interface PickedTask {
  task?: TaskDTO;
  ownTitle?: string;
  /** From an interruption: its time goes to the task picked too (P6's `takeAlong`). */
  takeAlong: boolean;
}

export interface TaskPickerProps {
  isOpen: boolean;
  mode: PickerMode;
  onClose: () => void;
  onPick: (picked: PickedTask) => void;
  /** The heading, when the mode's own is not enough: `Place "Call with Marc" on a task`. */
  title?: string;
  /** One line under the heading: what is being placed or moved. */
  subtitle?: string;
  /** Opened from an interruption: offers to put its time on the task picked (S7). */
  takeAlongOf?: { title: string; seconds: number } | null;
  /** Placing several: the tasks chosen earlier in this sitting, first in Recent (S12b). */
  justChosen?: TaskDTO[];
  /** Placing: keeps the time off the provider instead. */
  onKeepOff?: () => void;
  /** What keeping it does, as the button's tooltip: `keepAsOwnEntryMeaning`. */
  keepOffMeaning?: string;
  /** Its own window (`#picker`): fills it, with no overlay behind. */
  asWindow?: boolean;
}

/**
 * The one task picker (redesign P7, S7–S8, S12): Start, Switch, Assign,
 * Place and Move all choose a task here, in the window or as its own small
 * window. Search first, across every project; the groups and their order are
 * `shared/task-picker.ts`, the order within them `shared/task-order.ts`, and
 * the owners shown `shared/task-visibility.ts`, the same setting the bar's
 * picker reads.
 *
 * Mounted only while open, so each opening starts on the groups with nothing
 * typed and no project chosen.
 */
export const TaskPicker: React.FC<TaskPickerProps> = props =>
  props.isOpen ? <TaskPickerDialog {...props} /> : null;

const MODE_TITLE: Record<PickerMode, string> = {
  start: 'Start a task',
  switch: 'Switch task',
  assign: 'Assign to a task',
  place: 'Place on a task',
  move: 'Move to a task'
};

const STATUS_WORD: Record<TaskDTO['status'], string> = {
  in_progress: 'in progress',
  todo: 'to do',
  done: 'done'
};

const EMPTY_DATA: PickerDataDTO = { previous: null, recent: [], starred: [], tasks: [], projects: [], projectSeconds: {} };

/** One line of the list: something to pick, or a heading between them. */
type Row =
  | { kind: 'heading'; label: string; count?: number; note?: string; hint?: string }
  | { kind: 'task'; task: TaskDTO; note?: string }
  | { kind: 'project'; project: ProjectDTO; note: string }
  | { kind: 'mine' ; count: number }
  | { kind: 'own'; title: string }
  | { kind: 'fetch'; key: string };

const isActionable = (row: Row) => row.kind !== 'heading';

/** Everything the picker lists, from main; nothing without a bridge. */
function read(): Promise<PickerDataDTO> {
  const api = window.electronAPI;
  return api?.getPickerData ? api.getPickerData() : Promise.resolve(EMPTY_DATA);
}

const TaskPickerDialog: React.FC<TaskPickerProps> = ({
  mode,
  onClose,
  onPick,
  title,
  subtitle,
  takeAlongOf,
  justChosen = [],
  onKeepOff,
  keepOffMeaning,
  asWindow = false
}) => {
  const { capabilities, providerName } = useProviderCapabilities();
  const [visibility, setVisibility] = useTaskVisibility();
  const [data, setData] = useState<PickerDataDTO | null>(null);
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [view, setView] = useState<'groups' | 'mine'>('groups');
  const [naming, setNaming] = useState(false);
  const [ownTitle, setOwnTitle] = useState('');
  const [takeAlong, setTakeAlong] = useState(false);
  const [selected, setSelected] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<'fetch' | 'refresh' | null>(null);

  useEffect(() => {
    let live = true;
    read().then(
      answer => { if (live) setData(answer); },
      err => {
        console.warn('[TaskPicker] Could not read the tasks:', err);
        if (live) setData(EMPTY_DATA);
      }
    );
    return () => { live = false; };
  }, []);

  const realOnly = needsRealTask(mode);
  const usable = (task: TaskDTO) => !realOnly || task.projectId !== ADHOC_PROJECT_ID;
  const snapshot = data ?? EMPTY_DATA;
  const { visible: tasks, hiddenCount } = visibleTasks(snapshot.tasks, visibility);
  const projects = orderProjects(snapshot.projects, tasks, snapshot.starred, snapshot.projectSeconds);
  const projectOf = new Map(snapshot.projects.map(p => [p.id, p]));
  const project = projectId ? projectOf.get(projectId) ?? null : null;
  const starredIds = new Set(snapshot.starred.map(t => t.id));
  const trimmed = query.trim();

  const rows: Row[] = [];
  const pushTasks = (list: TaskDTO[], note?: (t: TaskDTO) => string | undefined) => {
    for (const task of list) if (usable(task)) rows.push({ kind: 'task', task, note: note?.(task) });
  };
  const bySection = (list: TaskDTO[]) => {
    const ordered = orderTasksForSelection(list);
    const sections: Array<[string, TaskDTO['status']]> = [['In progress', 'in_progress'], ['To do, most urgent first', 'todo'], ['Done', 'done']];
    for (const [label, status] of sections) {
      const part = ordered.filter(t => t.status === status);
      if (part.length === 0) continue;
      rows.push({ kind: 'heading', label, count: part.length });
      pushTasks(part);
    }
  };

  if (view === 'mine') {
    bySection(myOpenTasks(tasks).filter(t => matchesSearch(t, trimmed, projectOf.get(t.projectId))));
  } else if (project) {
    // One list in the lists' order -- yours first, then status, then priority
    // (`task-order.ts`) -- as the bar's picker has it; the counts above say
    // how many of each status.
    pushTasks(orderTasksForSelection(tasks.filter(t => t.projectId === project.id && matchesSearch(t, trimmed, project))));
  } else if (trimmed) {
    for (const group of searchByProject(tasks, trimmed, projects)) {
      rows.push({ kind: 'heading', label: group.project.name, count: group.tasks.length });
      pushTasks(group.tasks);
    }
    const found = rows.some(r => r.kind === 'task');
    if (!found && looksLikeTaskKey(trimmed) && capabilities?.canFetchByKey) rows.push({ kind: 'fetch', key: trimmed.toUpperCase() });
    if (offersOwnTask(mode)) rows.push({ kind: 'own', title: trimmed });
  } else {
    if (mode === 'switch' && snapshot.previous && usable(snapshot.previous)) {
      rows.push({ kind: 'task', task: snapshot.previous, note: 'previous task' });
    }
    const recent = mode === 'place' ? recentWithJustChosen(snapshot.recent, justChosen) : snapshot.recent;
    const justIds = new Set(justChosen.map(t => t.id));
    // Place opens on Starred: an interruption is most often about a usual place (S12).
    const groups: Array<[string, TaskDTO[], string | undefined]> = mode === 'place'
      ? [['Starred', snapshot.starred, '★ your usual places for time'], ['Recent', recent, justChosen.length ? 'just chosen first' : undefined]]
      : [['Recent', recent, undefined], ['Starred', snapshot.starred, undefined]];
    // The first day has no Recent and no Starred: the picker opens on the
    // user's own open tasks, and says where the other two will come (S31).
    const firstDay = groups.every(([, list]) => list.filter(usable).length === 0);
    for (const [label, list, note] of groups) {
      const shown = list.filter(usable);
      if (shown.length === 0) continue;
      rows.push({ kind: 'heading', label, note });
      pushTasks(shown, t => (justIds.has(t.id) ? 'just chosen' : projectOf.get(t.projectId)?.name));
    }
    if (mode !== 'place' && mode !== 'move') {
      const mine = myOpenTasks(tasks);
      if (mine.length > 0) {
        const projectCount = new Set(mine.map(t => t.projectId)).size;
        rows.push(firstDay
          ? {
              kind: 'heading',
              label: 'Assigned to me · open',
              note: 'in progress first, then to do by priority',
              hint: 'Recent and Starred appear once you have used a task or starred one.'
            }
          : { kind: 'heading', label: 'Assigned to me · open', note: `${mine.length} in ${projectCount} project${projectCount === 1 ? '' : 's'}` });
        pushTasks(mine.slice(0, PICKER_MINE_PREVIEW), t => projectOf.get(t.projectId)?.name);
        if (mine.length > PICKER_MINE_PREVIEW) rows.push({ kind: 'mine', count: mine.length });
      }
    }
    if (projects.length > 0) {
      rows.push({ kind: 'heading', label: 'All projects', note: 'starred first, then most used', count: projects.length });
      for (const p of projects) {
        const counts = countProject(tasks.filter(t => t.projectId === p.id));
        rows.push({ kind: 'project', project: p, note: `${counts.total} tasks · ${counts.inProgress} in progress` });
      }
    }
    if (offersOwnTask(mode)) rows.push({ kind: 'own', title: '' });
  }

  const actionable = rows.filter(isActionable);
  const current = Math.min(selected, Math.max(actionable.length - 1, 0));

  const pick = (picked: Omit<PickedTask, 'takeAlong'>) => {
    onPick({ ...picked, takeAlong: Boolean(takeAlongOf) && takeAlong });
    onClose();
  };

  const fetchByKey = (key: string) => {
    setBusy('fetch');
    setProblem(null);
    window.electronAPI.fetchTaskByKey(key).then(
      task => {
        setBusy(null);
        if (task) pick({ task });
        else setProblem(`${providerName} has no task ${key}, or you cannot see it.`);
      },
      err => {
        setBusy(null);
        setProblem(ipcErrorMessage(err));
      }
    );
  };

  const refresh = () => {
    setBusy('refresh');
    setProblem(null);
    window.electronAPI.syncProviderNow()
      .then(() => read())
      .then(
        answer => { setData(answer); setBusy(null); },
        err => { setBusy(null); setProblem(ipcErrorMessage(err)); }
      );
  };

  const toggleStar = (task: TaskDTO) => {
    const api = window.electronAPI;
    const change = starredIds.has(task.id) ? api.unstarTask(task.id) : api.starTask(task.id);
    change.then(
      starred => setData(previous => ({ ...(previous ?? EMPTY_DATA), starred })),
      err => setProblem(ipcErrorMessage(err))
    );
  };

  const activate = (row: Row) => {
    switch (row.kind) {
      case 'task':
        pick({ task: row.task });
        return;
      case 'project':
        setProjectId(row.project.id);
        setQuery('');
        setSelected(0);
        return;
      case 'mine':
        setView('mine');
        setSelected(0);
        return;
      case 'own':
        if (row.title) pick({ ownTitle: row.title });
        else setNaming(true);
        return;
      case 'fetch':
        fetchByKey(row.key);
        return;
      default:
    }
  };

  const changeQuery = (value: string) => {
    setSelected(0);
    setProblem(null);
    // "pf " filters to Pixel Forge (S7c), and the rest is searched inside it.
    const prefix = !project && view === 'groups' ? parseProjectPrefix(value, snapshot.projects) : null;
    if (prefix) {
      setProjectId(prefix.project.id);
      setQuery(prefix.rest);
      return;
    }
    setQuery(value);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (naming) setNaming(false);
      else onClose();
    } else if (naming) {
      return;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(Math.min(current + 1, actionable.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(Math.max(current - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = actionable[current];
      if (row) activate(row);
    } else if (e.key === 'Backspace' && query === '' && (project || view === 'mine')) {
      // Backspace on an empty search takes the project off (S7c).
      setProjectId(null);
      setView('groups');
    }
  };

  const heading = title ?? MODE_TITLE[mode];
  const counts = project ? countProject(tasks.filter(t => t.projectId === project.id)) : null;
  const placeholder = view === 'mine'
    ? `Filter my ${myOpenTasks(tasks).length} tasks`
    : project
    ? `Search in ${project.name}`
    : `Search all ${tasks.length} tasks -- key, title or project`;

  // As its own window it is frameless: the border is its only edge against
  // a dark desktop or a dark app behind it.
  const frame = asWindow
    ? 'h-screen w-screen bg-dark-800 border border-border-dark flex flex-col overflow-hidden select-none'
    : 'w-full max-w-xl max-h-[85vh] bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col';

  const panelRef = useRef<HTMLDivElement | null>(null);
  useModal(panelRef);

  const body = (
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={heading} className={frame} onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border-dark">
        <div className="min-w-0 flex items-center gap-2">
          {view === 'mine' && (
            <button type="button" aria-label="Back to all groups" onClick={() => setView('groups')} className="p-1 rounded text-text-secondary hover:text-white hover:bg-dark-700">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white truncate">{view === 'mine' ? 'My open tasks' : heading}</h3>
            {subtitle && <p className="text-[11px] text-text-secondary truncate">{subtitle}</p>}
          </div>
        </div>
        <button type="button" aria-label="Close the picker" onClick={onClose} className="p-1.5 rounded text-text-secondary hover:text-white hover:bg-dark-700">
          <X className="w-4 h-4" />
        </button>
      </div>

      {naming ? (
        <div className="p-5 space-y-3">
          <label className="block text-xs text-text-secondary" htmlFor="picker-own-title">What is it? It stays in SprintTicker, never sent to {providerName}.</label>
          <input
            id="picker-own-title"
            autoFocus
            value={ownTitle}
            onChange={e => setOwnTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && ownTitle.trim()) pick({ ownTitle: ownTitle.trim() }); }}
            placeholder="e.g. Code review with the lead"
            className="w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-focus"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNaming(false)} className="px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:text-white">Back</button>
            <button
              type="button"
              disabled={!ownTitle.trim()}
              onClick={() => pick({ ownTitle: ownTitle.trim() })}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent-green text-dark-900 disabled:bg-dark-700 disabled:text-text-secondary"
            >
              Start it
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-5 pt-3 space-y-2">
            <TaskVisibilityToggle visibility={visibility} onChange={setVisibility} hiddenCount={hiddenCount} />
            <div className="flex items-center gap-2 bg-dark-900 border border-border-dark rounded-lg px-3 focus-within:border-focus">
              <Search className="w-4 h-4 text-text-secondary shrink-0" />
              {project && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-select text-xs text-text-primary shrink-0">
                  {project.name}
                  <button type="button" aria-label={`Show every project, not only ${project.name}`} onClick={() => setProjectId(null)} className="text-text-secondary hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
              {/* Keyed on the project, so choosing one hands the focus back here. */}
              <input
                key={projectId ?? 'all'}
                autoFocus
                aria-label="Search tasks"
                value={query}
                onChange={e => changeQuery(e.target.value)}
                placeholder={placeholder}
                className="flex-1 min-w-0 bg-transparent py-2 text-sm text-white outline-none"
              />
            </div>
            {counts && (
              <p className="text-[11px] text-text-secondary">
                {counts.total} tasks: {counts.inProgress} in progress · {counts.todo} to do · {counts.done} done · {counts.mineLeft} left are yours
              </p>
            )}
            {takeAlongOf && (
              <label className="flex items-center gap-2 text-xs text-text-primary">
                <input type="checkbox" checked={takeAlong} onChange={e => setTakeAlong(e.target.checked)} />
                Put &quot;{takeAlongOf.title}&quot; ({formatHoursAndMinutes(takeAlongOf.seconds)}) on it too
                <span className="text-text-secondary">-- unticked, it waits to be placed</span>
              </label>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2" role="listbox" aria-label="Tasks">
            {data === null ? (
              <p className="px-2 py-6 text-center text-xs text-text-secondary">Reading your tasks…</p>
            ) : rows.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-text-secondary">Nothing matches.</p>
            ) : (
              rows.map((row, i) => {
                if (row.kind === 'heading') {
                  return (
                    <div key={`h-${i}`} className="px-2 pt-3 pb-1 text-[11px] text-text-secondary">
                      <div className="flex items-baseline gap-2 font-bold">
                        <span>{row.label}</span>
                        {row.count !== undefined && <span className="font-normal">{row.count}</span>}
                        {row.note && <span className="font-normal">{row.note}</span>}
                      </div>
                      {row.hint && <div className="mt-0.5">{row.hint}</div>}
                    </div>
                  );
                }
                const index = actionable.indexOf(row);
                const active = index === current;
                const base = `w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm ${active ? 'bg-select text-white' : 'text-text-primary hover:bg-dark-700'}`;
                const focus = () => setSelected(index);
                switch (row.kind) {
                  case 'task': {
                    const t = row.task;
                    const starred = starredIds.has(t.id);
                    const p = projectOf.get(t.projectId);
                    const free = (t.ownership ?? TaskOwnership.MINE) === TaskOwnership.UNASSIGNED && capabilities?.canAssign && (mode === 'start' || mode === 'switch');
                    return (
                      <div key={`t-${t.id}-${i}`} role="option" aria-selected={active} className={`group ${base}`} onMouseEnter={focus}>
                        <button type="button" className="flex-1 min-w-0 flex items-baseline gap-2 text-left" onClick={() => pick({ task: t })}>
                          <span className="font-mono font-bold shrink-0">{t.key}</span>
                          <span className="truncate">{t.title}</span>
                          <span className="ml-auto pl-2 text-[11px] text-text-secondary shrink-0 truncate">
                            {row.note ?? p?.name}
                            {t.status !== 'todo' && ` · ${STATUS_WORD[t.status]}`}
                            {free && ' · starting it makes it yours'}
                          </span>
                        </button>
                        <TaskOwnerBadge task={t} />
                        {t.projectId !== ADHOC_PROJECT_ID && (
                          <button
                            type="button"
                            aria-label={`${starred ? 'Unstar' : 'Star'} ${t.key}`}
                            onClick={() => toggleStar(t)}
                            className={`p-0.5 rounded ${starred ? 'text-accent-amber' : 'text-text-secondary opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                          >
                            <Star className="w-3.5 h-3.5" fill={starred ? 'currentColor' : 'none'} />
                          </button>
                        )}
                      </div>
                    );
                  }
                  case 'project':
                    return (
                      <button key={`p-${row.project.id}`} type="button" role="option" aria-selected={active} className={base} onMouseEnter={focus} onClick={() => activate(row)}>
                        <ChevronRight className="w-3.5 h-3.5 text-text-secondary" />
                        <span className="truncate">{row.project.name}</span>
                        <span className="ml-auto text-[11px] text-text-secondary">{row.note}</span>
                      </button>
                    );
                  case 'mine':
                    return (
                      <button key="mine" type="button" role="option" aria-selected={active} className={base} onMouseEnter={focus} onClick={() => activate(row)}>
                        <ChevronRight className="w-3.5 h-3.5 text-text-secondary" />
                        <span>all {row.count} of my open tasks</span>
                      </button>
                    );
                  case 'own':
                    return (
                      <button key="own" type="button" role="option" aria-selected={active} className={`${base} text-text-secondary`} onMouseEnter={focus} onClick={() => activate(row)}>
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>{row.title ? <>A task of my own named &quot;{row.title}&quot;</> : 'A task of my own…'}</span>
                      </button>
                    );
                  case 'fetch':
                    return (
                      <button key="fetch" type="button" role="option" aria-selected={active} disabled={busy === 'fetch'} className={base} onMouseEnter={focus} onClick={() => activate(row)}>
                        <Download className="w-3.5 h-3.5 text-text-secondary" />
                        <span>Fetch <span className="font-mono">{row.key}</span> from {providerName}</span>
                        <span className="ml-auto text-[11px] text-text-secondary">{busy === 'fetch' ? 'reading…' : 'not fetched yet'}</span>
                      </button>
                    );
                  default:
                    return null;
                }
              })
            )}
          </div>

          {problem && <p role="alert" className="px-5 pb-1 text-xs text-accent-red">{problem}</p>}

          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border-dark">
            <button type="button" onClick={refresh} disabled={busy === 'refresh'} className="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-white">
              <RefreshCw className={`w-3.5 h-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
              A ticket is missing? Refresh from {providerName}
            </button>
            <div className="flex items-center gap-2">
              {onKeepOff && (
                <button
                  type="button"
                  title={keepOffMeaning}
                  onClick={() => { onKeepOff(); onClose(); }}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border-dark text-text-secondary hover:text-white"
                >
                  {KEEP_AS_OWN_ENTRY}
                </button>
              )}
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg text-text-secondary hover:text-white">Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  );

  if (asWindow) return body;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
      {body}
    </div>
  );
};
