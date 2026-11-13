import { RefObject, useEffect, useLayoutEffect, useRef } from 'react';

const ITEM = '[role^="menuitem"]:not([disabled])';

/**
 * A menu that behaves as its role says (P15a2, REVIEW-2026-11 A5): the first
 * item takes the focus when it opens; ArrowUp, ArrowDown, Home and End move
 * between items; Escape closes it and gives the focus back to its button;
 * Tab or a click outside closes it.
 *
 * `root` holds the button and the menu, `menu` the items, `trigger` the
 * button. Every ⋯ and ▾ in the window uses it -- the mode chip had no Escape
 * at all, and none moved the focus.
 */
export function useMenu(
  isOpen: boolean,
  close: () => void,
  refs: { root: RefObject<HTMLElement | null>; menu: RefObject<HTMLElement | null>; trigger: RefObject<HTMLElement | null> }
): void {
  const closeRef = useRef(close);
  useLayoutEffect(() => {
    closeRef.current = close;
  });
  const { root, menu, trigger } = refs;

  useEffect(() => {
    if (!isOpen) return undefined;
    const items = (): HTMLElement[] => [...(menu.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
    const checked = menu.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    // A panel with no items (the status panel) takes the focus itself.
    (checked ?? items()[0] ?? menu.current)?.focus();

    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) closeRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        trigger.current?.focus();
        return;
      }
      // Only from an item: a question shown in the menu (Stop's Discard…)
      // keeps Tab and the arrows for its own buttons.
      const onItem = document.activeElement instanceof HTMLElement && document.activeElement.matches(ITEM);
      if (!onItem || !menu.current?.contains(document.activeElement)) return;
      if (event.key === 'Tab') {
        closeRef.current();
        return;
      }
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLElement);
      const go = (index: number) => {
        event.preventDefault();
        list[(index + list.length) % list.length]?.focus();
      };
      if (event.key === 'ArrowDown') go(at + 1);
      else if (event.key === 'ArrowUp') go(at - 1);
      else if (event.key === 'Home') go(0);
      else if (event.key === 'End') go(list.length - 1);
    };
    document.addEventListener('mousedown', onDown);
    // Captured, so a dialog the menu sits in sees the Escape as used
    // (`defaultPrevented`) and stays open.
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [isOpen, root, menu, trigger]);
}
