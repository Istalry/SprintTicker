import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { AD_HOC_TITLE_MAX_CHARS } from '../../shared/interruption';

interface InlineRenameProps {
  /** The name shown, and the field's start. */
  title: string;
  /**
   * What the field belongs to -- a session, a task. A change closes a field
   * opened on the previous one, so a name typed for one never lands on another.
   */
  ownerId: string;
  /** Saves a new name; the caller reads it back however it reads the title. */
  onRename: (name: string) => Promise<unknown>;
  /** For the title as text, and for the input while it is renamed. */
  className: string;
  inputClassName: string;
  /**
   * Opens with the field, for a Rename chosen from a menu: read once, when it
   * mounts, so the caller asks again by changing the component's key.
   */
  startEditing?: boolean;
}

/**
 * A name that is renamed in place: ad-hoc work, which the user names --
 * an interruption is named for the time it started until they do.
 *
 * Enter or leaving the field saves, Escape keeps the name, and an unchanged
 * or empty name saves nothing.
 */
export const InlineRename: React.FC<InlineRenameProps> = ({ title, ownerId, onRename, className, inputClassName, startEditing = false }) => {
  const [editing, setEditing] = useState<{ ownerId: string; text: string } | null>(() => (startEditing ? { ownerId, text: title } : null));
  const open = editing && editing.ownerId === ownerId ? editing : null;

  const save = () => {
    if (!open) return;
    setEditing(null);
    const name = open.text.trim();
    if (!name || name === title) return;
    onRename(name).catch(err => console.warn('[InlineRename] Renaming failed:', err));
  };

  if (open) {
    return (
      <input
        type="text"
        aria-label="Name this work"
        autoFocus
        maxLength={AD_HOC_TITLE_MAX_CHARS}
        value={open.text}
        onChange={e => setEditing({ ownerId, text: e.target.value })}
        onKeyDown={e => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(null);
          // The task picker and the dialogs listen on the window.
          e.stopPropagation();
        }}
        onBlur={save}
        className={inputClassName}
      />
    );
  }

  return (
    <button
      type="button"
      title="Name this work"
      aria-label={`Rename ${title}`}
      onClick={() => setEditing({ ownerId, text: title })}
      className={`${className} group inline-flex items-center gap-1.5 text-left max-w-full hover:text-text-primary`}
    >
      <span className="truncate">{title}</span>
      <Pencil className="w-3.5 h-3.5 shrink-0 opacity-50 group-hover:opacity-100" />
    </button>
  );
};
