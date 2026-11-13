import React from 'react';

const KEYS: readonly { key: string; label: string; title: string }[] = [
  // The bar's own names for its inputs are the keys; the labels are what each
  // does since P14b: the click interrupts, Back does nothing, Pause is yes.
  { key: 'up', label: '▲', title: 'Turn the wheel up' },
  { key: 'down', label: '▼', title: 'Turn the wheel down' },
  { key: 'ok', label: 'Click', title: 'Click the wheel' },
  { key: 'back', label: 'Back', title: 'Back (does nothing)' },
  { key: 'start', label: 'Pause', title: 'Pause' }
];

/**
 * The bar's keys, as if pressed on the bar (S24, Developer). It used to sit
 * in the header beside the LED preview, on every user's screen.
 *
 * `injectRemoteKey` is called nowhere else in the renderer, so this is the
 * only way to exercise hardware input without a bar attached -- the point of
 * `pnpm dev:mock`. A press acts on the real session, as the bar's would.
 */
export const BarRemotePad: React.FC = () => {
  const press = (key: string): void => {
    window.electronAPI?.injectRemoteKey?.(key)
      .catch(err => console.warn('[BarRemotePad] Remote key injection error:', err));
  };

  return (
    <div className="flex items-center gap-1.5">
      {KEYS.map(k => (
        <button
          key={k.key}
          type="button"
          onClick={() => press(k.key)}
          title={k.title}
          className="rounded border border-border-dark bg-dark-900 px-2.5 py-1 text-xs font-semibold text-text-primary transition-all hover:bg-dark-600 active:scale-95"
        >
          {k.label}
        </button>
      ))}
    </div>
  );
};
