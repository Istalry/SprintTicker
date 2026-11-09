/**
 * The global keyboard shortcut for Interrupt: what a chord may be, and how
 * the window turns a key press into one. Shared so the window records only
 * what main will register, and main refuses whatever the window did not.
 *
 * A chord is an Electron accelerator, `Ctrl+Alt+Shift+I`: modifiers in that
 * order, then one key.
 */

/** Suggested, never registered unasked: the shortcut is off until turned on. */
export const DEFAULT_INTERRUPT_ACCELERATOR = 'Ctrl+Alt+Shift+I';

/** Stored under `INTERRUPT_SHORTCUT_KEY`. */
export interface InterruptShortcutSetting {
  enabled: boolean;
  accelerator: string;
}

export const INTERRUPT_SHORTCUT_KEY = 'interrupt_shortcut';

export const DEFAULT_INTERRUPT_SHORTCUT: InterruptShortcutSetting = {
  enabled: false,
  accelerator: DEFAULT_INTERRUPT_ACCELERATOR
};

/** Electron's names, in the order a chord writes them. */
const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super'] as const;

const NAMED_KEYS = new Set([
  'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Enter', 'Home', 'End',
  'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Pause'
]);

/** `KeyboardEvent.key` names that Electron spells otherwise. */
const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
};

function isKey(name: string): boolean {
  return /^[A-Z0-9]$/.test(name) || /^F([1-9]|1[0-9]|2[0-4])$/.test(name) || NAMED_KEYS.has(name);
}

/**
 * Why a chord cannot be registered, or null when it can.
 *
 * Shift alone is refused: Shift+I is a capital I, and a global shortcut
 * takes it from every app. So is a bare key.
 */
export function chordProblem(accelerator: string): string | null {
  const parts = accelerator.split('+');
  const key = parts.pop() ?? '';
  if (!isKey(key)) return 'A shortcut ends in a letter, a digit, F1 to F24 or a named key.';
  let last = -1;
  for (const part of parts) {
    const at = MODIFIERS.indexOf(part as (typeof MODIFIERS)[number]);
    if (at <= last) return 'Ctrl, Alt, Shift and Win, once each and in that order, then the key.';
    last = at;
  }
  if (!parts.some(part => part !== 'Shift')) return 'A shortcut needs Ctrl, Alt or Win: alone, Shift only types capitals.';
  return null;
}

/**
 * A chord worth a second look though it registers: Ctrl+Alt is AltGr on
 * AZERTY and many other layouts, so Ctrl+Alt+E would take the euro sign.
 */
export function chordCaution(accelerator: string): string | null {
  const parts = accelerator.split('+').slice(0, -1);
  if (parts.length === 2 && parts[0] === 'Ctrl' && parts[1] === 'Alt') {
    return 'Ctrl+Alt is AltGr on many keyboard layouts, so this may take a character you type. Adding Shift avoids it.';
  }
  return null;
}

/** The slice of a `KeyboardEvent` the recording reads. */
export interface ChordKeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * The key of a press, as Electron names it, or null for a modifier or a key
 * Electron has no name for.
 *
 * A letter is read from `key`, which follows the layout as Windows' virtual
 * keys do: on AZERTY the key labelled A is A, though its `code` is `KeyQ`.
 * But with Ctrl+Alt (AltGr) `key` is the character typed, `€` for E, and
 * then `code` stands in. Digits come from `code`: AZERTY types `&` on 1.
 */
function keyOf(event: ChordKeyEvent): string | null {
  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase();
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) return letter[1];
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
  if (digit) return digit[1];
  const named = KEY_NAMES[event.key] ?? event.key;
  return isKey(named) && named.length > 1 ? named : null;
}

/**
 * The chord a key press records, or null while only modifiers are down --
 * the recording waits for the key.
 */
export function acceleratorFromKeyEvent(event: ChordKeyEvent): string | null {
  const key = keyOf(event);
  if (!key) return null;
  const held = [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'];
  return [...held.filter((part): part is string => typeof part === 'string'), key].join('+');
}

/** How the window shows a chord: Win, which is what the key says. */
export function describeAccelerator(accelerator: string): string {
  return accelerator.split('+').map(part => (part === 'Super' ? 'Win' : part)).join('+');
}
