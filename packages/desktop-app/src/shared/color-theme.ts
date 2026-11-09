import { ColorThemeId } from './dtos';

/**
 * The colour of the task key on the bar's front display. It used to live in
 * the renderer's memory alone: every restart drew the key blue again, and the
 * window's list always opened on the first entry, whatever was chosen.
 */
export const COLOR_THEME_KEY = 'color_theme';

export const DEFAULT_COLOR_THEME: ColorThemeId = 'emerald';

/** The ids, and the colour each draws -- `emerald` has always drawn blue. */
export const COLOR_THEMES: ReadonlyArray<{ id: ColorThemeId; label: string }> = [
  { id: 'emerald', label: 'Blue' },
  { id: 'cyberpunk', label: 'Pink' },
  { id: 'retro_arcade', label: 'Amber' },
  { id: 'nordic_cyan', label: 'Pale cyan' }
];

export function isColorThemeId(value: unknown): value is ColorThemeId {
  return COLOR_THEMES.some(theme => theme.id === value);
}
