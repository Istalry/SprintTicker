import React, { useRef, useState } from 'react';
import { useMenu } from '../hooks/useMenu';
import { MoreHorizontal } from 'lucide-react';

export interface RowMenuItem {
  label: string;
  run: () => void;
  /** Throws something away: drawn red on hover. */
  danger?: boolean;
  title?: string;
}

/**
 * ⋯ on a row (S5): the actions a row needs less often, in a menu, so the
 * row says what it is before what can be done to it. Today's entries,
 * History's and the interruptions to place share it.
 *
 * `name` says which row, for the button's and the menu's accessible names.
 */
export const RowMenu: React.FC<{ name: string; menuName: string; items: RowMenuItem[] }> = ({ name, menuName, items }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useMenu(open, () => setOpen(false), { root: rootRef, menu: menuRef, trigger: triggerRef });

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="p-1 text-text-secondary hover:text-white hover:bg-dark-700 rounded transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label={menuName} className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-border-dark bg-dark-800 p-1 shadow-2xl">
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              title={item.title}
              onClick={() => { setOpen(false); item.run(); }}
              className={`block w-full rounded-md px-3 py-1.5 text-left text-xs ${item.danger ? 'text-text-secondary hover:text-accent-red hover:bg-accent-red/10' : 'text-text-secondary hover:text-white hover:bg-dark-700'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
