import { RefObject, useEffect, useLayoutEffect, useRef } from 'react';

/** What a Tab can land on inside a dialog. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

const focusables = (panel: HTMLElement): HTMLElement[] =>
  [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.closest('[inert]'));

/**
 * Where the focus goes when a dialog opens: an element marked
 * `data-autofocus` (the safe answer of a question), else the first field,
 * else the first button, else the panel itself.
 */
const firstFocus = (panel: HTMLElement): HTMLElement =>
  panel.querySelector<HTMLElement>('[data-autofocus]')
  ?? panel.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])')
  ?? focusables(panel)[0]
  ?? panel;

/** The dialogs open now, the last on top: only it hears Escape and Tab. */
const open: object[] = [];

/**
 * Makes `panel` behave as a modal dialog (P15a2, REVIEW-2026-11 A1/C4): the
 * focus moves in when it opens, Tab stays inside, Escape calls `onClose`, and
 * the focus goes back to what had it when the dialog closes.
 *
 * Not the native `<dialog>`: jsdom has no `showModal`, and every renderer
 * test would lose its dialogs. The listener is the document's, so Escape
 * works wherever the focus is -- it used to work only once the user had
 * tabbed into the dialog -- and only the dialog on top acts, so a picker
 * opened over Add time closes alone.
 *
 * Without `onClose` (the picker and Ctrl+K, which read Escape themselves;
 * the first run, which must be answered) Escape is left alone.
 */
export function useModal(panel: RefObject<HTMLElement | null>, onClose?: () => void): void {
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const element = panel.current;
    if (!element) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const me = {};
    open.push(me);
    if (!element.contains(document.activeElement)) {
      const target = firstFocus(element);
      if (target === element && !element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
      target.focus();
    }

    const onKey = (event: KeyboardEvent) => {
      if (open[open.length - 1] !== me) return;
      // An Escape something inside already used -- a menu closing, a
      // rename given up -- is not the dialog's.
      if (event.key === 'Escape' && close.current && !event.defaultPrevented) {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables(element);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = element.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      open.splice(open.indexOf(me), 1);
      // What opened it may be gone -- a row replaced, a step changed.
      if (opener?.isConnected) opener.focus();
    };
  }, [panel]);
}
