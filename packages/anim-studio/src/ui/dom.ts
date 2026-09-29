/**
 * A few lines of DOM construction, in place of a framework.
 *
 * The studio is deliberately not React: it is a separate tool with its own
 * lifetime, and tying it to the app's stack would drag the app's upgrade
 * schedule along with it.
 */

type Attrs = Record<string, string | number | boolean | undefined | EventListener>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (key in el && typeof value !== 'string') {
      // Properties such as `checked` and `value` must be set, not attributed.
      (el as unknown as Record<string, unknown>)[key] = value;
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

/** A labelled row for an inspector. */
export function field(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, h('span', {}, label), control);
}

export interface NumberInputOptions {
  min: number;
  max: number;
  step?: number;
  onCommit: (value: number) => void;
}

/**
 * A number input that commits on `change`, not on every keystroke: typing
 * "30" must not pass through a scene with a period of 3.
 */
export function numberInput(value: number, { min, max, step = 1, onCommit }: NumberInputOptions): HTMLInputElement {
  const input = h('input', { type: 'number', min, max, step, value: String(value) });
  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) {
      input.value = String(value);
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(parsed / step) * step));
    input.value = String(clamped);
    onCommit(clamped);
  });
  return input;
}

export function select<T extends string>(
  value: T,
  options: readonly T[] | readonly { value: T; label: string }[],
  onCommit: (value: T) => void
): HTMLSelectElement {
  const el = h('select');
  for (const option of options) {
    const v = typeof option === 'string' ? option : option.value;
    const label = typeof option === 'string' ? option : option.label;
    el.append(h('option', { value: v, selected: v === value }, label));
  }
  el.addEventListener('change', () => onCommit(el.value as T));
  return el;
}

export function colorInput(value: string, onCommit: (value: string) => void): HTMLInputElement {
  const input = h('input', { type: 'color', value: value.toLowerCase() });
  input.addEventListener('change', () => onCommit(input.value.toUpperCase()));
  return input;
}

export function button(label: string, onClick: () => void, attrs: Attrs = {}): HTMLButtonElement {
  return h('button', { type: 'button', ...attrs, onclick: () => onClick() }, label);
}
