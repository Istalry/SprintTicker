import type { ActiveSessionDTO } from '../../shared/dtos';
import { isAdHocSession } from '../../shared/interruption';
import { Verb } from '../../shared/words';
import { SETTINGS_ENTRIES, SETTINGS_GROUPS, SettingsGroupId } from '../views/Settings/settings-groups';

/**
 * What the command palette (redesign P7c, S30) can do. Each is one action of
 * the glossary, run by the window the way its own button runs it.
 */
export type PaletteActionId =
  | 'start' | 'switch' | 'previous'
  | 'pause' | 'resume' | 'stop'
  | 'interrupt' | 'another' | 'back'
  | 'assign' | 'place' | 'end-day' | 'mini'
  | 'go-today' | 'go-tasks' | 'go-history';

export interface PaletteAction {
  id: PaletteActionId | `settings:${SettingsGroupId}`;
  /** As the window writes it, from `words.ts`. */
  label: string;
  /** A glyph from the glossary, drawn in the key column. */
  glyph: string;
  /** Shown at the right: a count, or the settings group. */
  hint?: string;
  /**
   * Other words for it, so the old ones still lead somewhere: "sort" and
   * "assign" find Place, "finish" and "log" find Stop.
   */
  words: readonly string[];
}

export interface PaletteState {
  session: ActiveSessionDTO | null;
  /** Interruptions waiting to be placed. */
  toPlace: number;
  /** The task Previous goes back to, by key; null for none. */
  previousKey: string | null;
}

/**
 * The actions the current state allows, in the glossary's order: the
 * session's first, then the day's, then the places. Done and Discard stay on
 * the session card: each asks a question first, and the palette runs an
 * action in one keystroke.
 */
export function paletteActions(state: PaletteState): PaletteAction[] {
  const { session, toPlace, previousKey } = state;
  const interruption = session?.interruption ?? null;
  const actions: PaletteAction[] = [];
  const add = (action: PaletteAction): void => { actions.push(action); };

  if (!session) {
    add({ id: 'start', label: `${Verb.START} a task…`, glyph: '▶', words: ['begin', 'pick', 'choose', 'select', 'selector', 'new task', 'timer'] });
  } else if (!interruption) {
    // During an interruption choosing a task does nothing: it ends first (2026-11-12).
    add({ id: 'switch', label: `${Verb.SWITCH} task…`, glyph: '⇄', words: ['change task', 'pick', 'choose', 'select', 'selector', 'other task', 'start'] });
  }
  if (session && !interruption && previousKey) {
    add({ id: 'previous', label: `${Verb.PREVIOUS} task: ${previousKey}`, glyph: '⟲', words: ['last task', 'prev', 'go back'] });
  }

  if (interruption) {
    if (interruption.interruptedSessionId) {
      add({ id: 'back', label: `${Verb.BACK} to ${interruption.interruptedTaskKey}`, glyph: '↩', words: ['return', 'resume', 'end interruption'] });
    }
    add({ id: 'stop', label: Verb.STOP, glyph: '■', words: ['end interruption', 'finish', 'end'] });
    add({ id: 'another', label: `${Verb.ANOTHER} interruption`, glyph: '⚡', words: ['interrupt', 'next interruption', 'new interruption'] });
  } else if (session) {
    if (session.status === 'TRACKING') {
      add({ id: 'pause', label: Verb.PAUSE, glyph: '❚❚', words: ['hold', 'break', 'wait'] });
    } else {
      add({ id: 'resume', label: Verb.RESUME, glyph: '▶', words: ['continue', 'unpause', 'go on'] });
    }
    add({ id: 'stop', label: Verb.STOP, glyph: '■', words: ['finish', 'end', 'log', 'log time', 'not done', 'stop timer'] });
    add({ id: 'interrupt', label: Verb.INTERRUPT, glyph: '⚡', words: ['interruption', 'call', 'meeting', 'someone at my desk'] });
    if (isAdHocSession(session)) {
      add({ id: 'assign', label: 'Place on a task…', glyph: '↳', words: ['sort', 'file', 'put on a task', 'link'] });
    }
  } else {
    add({ id: 'interrupt', label: Verb.INTERRUPT, glyph: '⚡', words: ['interruption', 'call', 'meeting', 'someone at my desk'] });
  }

  if (toPlace > 0) {
    add({
      id: 'place', label: `${Verb.PLACE} interruptions`, glyph: '↳', hint: `${toPlace} to place`,
      words: ['sort', 'assign', 'file', 'to place', 'unsorted', 'interruptions', 'keep off']
    });
  }
  add({ id: 'end-day', label: 'End my day…', glyph: '☾', words: ['wrap-up', 'eod', 'shutdown', 'go home', 'finish day'] });
  add({ id: 'mini', label: 'Mini timer', glyph: '▭', words: ['small', 'compact', 'always on top', 'floating', 'widget'] });
  add({ id: 'go-today', label: 'Today', glyph: '◷', words: ['dashboard', 'home', 'session'] });
  add({ id: 'go-tasks', label: 'Tasks', glyph: '☰', words: ['projects', 'task list'] });
  add({ id: 'go-history', label: 'History', glyph: '↺', words: ['worklogs', 'timesheet', 'entries', 'week', 'log'] });
  return actions;
}

/** Every settings group, and every setting by name, each opening its group. */
export function settingsActions(showDeveloper: boolean): PaletteAction[] {
  const groups = SETTINGS_GROUPS.filter(g => showDeveloper || !g.developerOnly);
  const label = new Map(groups.map(g => [g.id, g.label] as const));
  return [
    ...groups.map(g => ({
      id: `settings:${g.id}` as const, label: `Settings: ${g.label}`, glyph: '⚙', words: ['settings', 'preferences', 'options']
    })),
    ...SETTINGS_ENTRIES.filter(e => label.has(e.group)).map(e => ({
      id: `settings:${e.group}` as const, label: e.label, glyph: '⚙', hint: label.get(e.group), words: e.keywords ?? []
    }))
  ];
}

/**
 * How well an action answers the query: 3 for a label that starts with it,
 * 2 for another word that does, 1 for one that contains it, 0 for none. The
 * palette keeps the order of the actions within a score.
 */
export function paletteScore(action: PaletteAction, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const label = action.label.toLowerCase();
  const words = action.words.map(w => w.toLowerCase());
  if (label.startsWith(q) || label.split(/[\s:]+/).some(w => w.startsWith(q))) return 3;
  if (words.some(w => w.startsWith(q))) return 2;
  if (label.includes(q) || words.some(w => w.includes(q))) return 1;
  return 0;
}

/** The actions that answer the query, best first, the given order kept within a score. */
export function filterPalette(actions: readonly PaletteAction[], query: string): PaletteAction[] {
  return actions
    .map((action, index) => ({ action, index, score: paletteScore(action, query) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(x => x.action);
}
