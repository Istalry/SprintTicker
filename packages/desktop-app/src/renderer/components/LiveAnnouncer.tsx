import React, { useEffect, useState } from 'react';

/**
 * One polite live region per window, always in the page (REVIEW-2026-11
 * A9, A10). A region mounted together with its text is skipped by most
 * screen readers, and a question main puts on Today must never take the
 * focus (CLAUDE.md §5) -- so without this, nothing announced it at all.
 *
 * `announce` changes the text; the same sentence twice is cleared first, or
 * the second would not be read.
 */
type Listener = (text: string) => void;
const listeners = new Set<Listener>();
let last = '';
/** Said before any region listened: a window opening on a waiting question. */
let pending: string | null = null;

/** How long the region stays empty before a repeated sentence is set again. */
const REPEAT_GAP_MS = 50;

export function announce(text: string): void {
  const sentence = text.trim();
  if (!sentence) return;
  if (sentence === last) {
    listeners.forEach(listener => listener(''));
    setTimeout(() => listeners.forEach(listener => listener(sentence)), REPEAT_GAP_MS);
    return;
  }
  last = sentence;
  if (listeners.size === 0) pending = sentence;
  listeners.forEach(listener => listener(sentence));
}

/**
 * Says `text` once each time `key` changes to a new value -- a prompt's id,
 * an undo's expiry -- and never on a redraw. Null says nothing.
 */
export function useAnnounce(key: string | null | undefined, text: string): void {
  useEffect(() => {
    if (key) announce(text);
    // The text is read when the key changes; a countdown in it must not re-announce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export const LiveAnnouncer: React.FC = () => {
  const [text, setText] = useState('');
  useEffect(() => {
    listeners.add(setText);
    // Set after the empty region is in the page, or it would be read as
    // mounted with its text, which most screen readers skip.
    const early = pending;
    pending = null;
    // Unless something newer was said meanwhile, which the region has.
    const timer = early ? setTimeout(() => { if (last === early) setText(early); }, REPEAT_GAP_MS) : undefined;
    return () => {
      if (timer) clearTimeout(timer);
      listeners.delete(setText);
    };
  }, []);
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="live-announcer">
      {text}
    </div>
  );
};
