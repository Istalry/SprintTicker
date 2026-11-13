import React, { useEffect, useId, useRef, useState } from 'react';
import { useModal } from '../hooks/useModal';
import type { ActiveSessionDTO, ProjectDTO, TaskDTO } from '../../shared/dtos';
import { matchesSearch } from '../../shared/task-picker';
import { orderTasksForSelection } from '../../shared/task-order';
import { visibleTasks } from '../../shared/task-visibility';
import { useTaskVisibility } from '../hooks/useTaskVisibility';
import { filterPalette, PaletteAction, paletteActions, settingsActions } from '../utils/palette-actions';
import { readShowDeveloper } from '../views/Settings/SettingsPage';

/** Tasks the palette lists for a query; the picker is there for more. */
export const PALETTE_TASK_LIMIT = 6;

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  session: ActiveSessionDTO | null;
  /** Interruptions waiting to be placed. */
  toPlace: number;
  /** Runs an action, as the window's own control for it does. */
  onAction: (id: PaletteAction['id']) => void;
  /** A task chosen: started, or switched to, as the picker's pick. */
  onPickTask: (task: TaskDTO) => void;
}

/**
 * The command palette, Ctrl+K (redesign P7c, S30): every action the state
 * allows by name, every setting, and every task by key or title, from the
 * keyboard. Typing filters all three; Enter does the one selected.
 *
 * Mounted only while open, so each opening starts clean and reads the tasks
 * afresh.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = props =>
  props.isOpen ? <PaletteDialog {...props} /> : null;

interface Snapshot {
  previous: TaskDTO | null;
  tasks: TaskDTO[];
  projects: ProjectDTO[];
}

const EMPTY: Snapshot = { previous: null, tasks: [], projects: [] };

type Row =
  | { kind: 'action'; action: PaletteAction }
  | { kind: 'task'; task: TaskDTO; project?: ProjectDTO };

const PaletteDialog: React.FC<CommandPaletteProps> = ({ onClose, session, toPlace, onAction, onPickTask }) => {
  const [visibility] = useTaskVisibility();
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  const [query, setQuery] = useState('');
  const listId = useId();
  const [selected, setSelected] = useState(0);
  const [showDeveloper] = useState<boolean>(readShowDeveloper);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getPickerData) return undefined;
    let live = true;
    api.getPickerData().then(
      data => { if (live) setSnapshot({ previous: data.previous, tasks: data.tasks, projects: data.projects }); },
      err => console.warn('[CommandPalette] Could not read the tasks:', err)
    );
    return () => { live = false; };
  }, []);

  const trimmed = query.trim();
  const actions = filterPalette(
    [
      ...paletteActions({ session, toPlace, previousKey: snapshot.previous?.key ?? null }),
      // Settings by name only once something is typed: forty of them would
      // bury the actions.
      ...(trimmed ? settingsActions(showDeveloper) : [])
    ],
    trimmed
  );
  const projectOf = new Map(snapshot.projects.map(p => [p.id, p] as const));
  const tasks = trimmed
    ? orderTasksForSelection(
        visibleTasks(snapshot.tasks, visibility).visible
          .filter(t => t.id !== session?.taskId && matchesSearch(t, trimmed, projectOf.get(t.projectId)))
      ).slice(0, PALETTE_TASK_LIMIT)
    : [];

  const rows: Row[] = [
    ...actions.map(action => ({ kind: 'action' as const, action })),
    ...tasks.map(task => ({ kind: 'task' as const, task, project: projectOf.get(task.projectId) }))
  ];
  const current = Math.min(selected, Math.max(rows.length - 1, 0));

  const run = (row: Row): void => {
    onClose();
    if (row.kind === 'action') onAction(row.action.id);
    else onPickTask(row.task);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(Math.min(current + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(Math.max(current - 1, 0));
    } else if (e.key === 'Enter' && rows[current]) {
      e.preventDefault();
      run(rows[current]);
    }
  };

  const taskHint = session ? 'switch to it' : 'start it';
  const rowClass = (index: number): string =>
    `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm ${
      index === current ? 'bg-select text-white' : 'text-text-primary hover:bg-dark-700'
    }`;

  const panelRef = useRef<HTMLDivElement | null>(null);
  useModal(panelRef);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-dark-900/80 backdrop-blur-sm p-4 select-none"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl bg-dark-800 border border-border-dark rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-dark">
          <span aria-hidden className="text-text-secondary">›</span>
          <input
            autoFocus
            aria-label="Command"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={actions.length + tasks.length > 0 ? `${listId}-opt-${current}` : undefined}
            value={query}
            onChange={e => { setQuery(e.target.value); setSelected(0); }}
            placeholder="An action, a setting or a task"
            className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-text-secondary"
          />
        </div>

        <div id={listId} role="listbox" aria-label="Commands" className="overflow-y-auto p-2">
          {actions.length > 0 && <div role="presentation" className="px-3 pt-1 pb-1 text-[11px] font-semibold text-text-secondary">Actions</div>}
          {actions.map((action, i) => (
            <button
              key={`${action.id}:${action.label}`}
              type="button"
              role="option"
              id={`${listId}-opt-${i}`}
              tabIndex={-1}
              aria-selected={i === current}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run({ kind: 'action', action })}
              className={rowClass(i)}
            >
              <span aria-hidden className="w-12 shrink-0 text-center text-text-secondary">{action.glyph}</span>
              <span className="flex-1 truncate">{action.label}</span>
              {action.hint && <span className="text-xs text-text-secondary">{action.hint}</span>}
            </button>
          ))}

          {tasks.length > 0 && <div role="presentation" className="px-3 pt-3 pb-1 text-[11px] font-semibold text-text-secondary">Tasks</div>}
          {tasks.map((task, j) => {
            const i = actions.length + j;
            return (
              <button
                key={task.id}
                type="button"
                role="option"
                id={`${listId}-opt-${i}`}
                tabIndex={-1}
                aria-selected={i === current}
                onMouseEnter={() => setSelected(i)}
                onClick={() => run({ kind: 'task', task })}
                className={rowClass(i)}
              >
                <span className="w-12 shrink-0 font-mono text-xs text-text-secondary">{task.key}</span>
                <span className="flex-1 truncate">{task.title}</span>
                <span className="text-xs text-text-secondary">{taskHint}</span>
              </button>
            );
          })}

          {rows.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-text-secondary">Nothing by that name.</div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border-dark text-[11px] text-text-secondary">
          <span>Also: settings by name, and any task by key or title</span>
          <span><kbd className="px-1 rounded border border-border-dark">Ctrl</kbd>+<kbd className="px-1 rounded border border-border-dark">K</kbd></span>
        </div>
      </div>
    </div>
  );
};
