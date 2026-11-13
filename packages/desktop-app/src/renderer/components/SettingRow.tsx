import React, { useId } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Settings as rows (redesign P16, S19-S24): a page of rows, each a name, one
 * sentence and a control at the right, in the words of the glossary. The
 * one layout for every group; the old cards' titles and their "Changes save
 * automatically" go.
 */

/** The rows of one page, divided by hairlines, on one raised surface. */
export const SettingsList: React.FC<{ label?: string; children: React.ReactNode }> = ({ label, children }) => (
  <div aria-label={label} className="divide-y divide-border-dark rounded-xl border border-border-dark bg-dark-800 px-5">
    {children}
  </div>
);

interface SettingRowProps {
  /** The setting's name, which the search in `settings-groups.ts` finds. */
  title: string;
  /** One sentence: what it does, in the user's words. */
  description?: React.ReactNode;
  /** At the right: a switch, a menu, a button or two. */
  control?: React.ReactNode;
  /** Under the row: what went wrong, or a value too long for the right. */
  children?: React.ReactNode;
}

/** One setting. A group named by its title, so a test or a screen reader finds the row by its name. */
export const SettingRow: React.FC<SettingRowProps> = ({ title, description, control, children }) => {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="py-3">
      <div className="flex items-center justify-between gap-5">
        <div className="min-w-0">
          <div id={id} className="text-[13.5px] font-semibold text-text-primary">{title}</div>
          {description && <div className="text-xs leading-relaxed text-text-secondary">{description}</div>}
        </div>
        {control && <div className="flex shrink-0 items-center gap-2">{control}</div>}
      </div>
      {children && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
};

interface SettingSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What it switches, for a screen reader: the row's name is not enough when a row has two. */
  label: string;
  disabled?: boolean;
}

/**
 * On or off, said in words beside the switch as the mockups draw it. A native
 * checkbox with the switch role underneath, so the keyboard, the label and
 * the tests work as they do on any checkbox.
 */
export const SettingSwitch: React.FC<SettingSwitchProps> = ({ checked, onChange, label, disabled }) => (
  // `relative` holds the hidden checkbox (`sr-only` is absolute) inside the
  // switch. Without it the checkbox sat where it would be on an unscrolled
  // page, and the focus a click gives it scrolled the whole window to reach
  // it: the shell slid up off the top, black below (2.0 candidate, 2026-11-13).
  <label className={`relative inline-flex items-center gap-2 text-xs text-text-secondary ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
    <span aria-hidden="true">{checked ? 'On' : 'Off'}</span>
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={e => onChange(e.target.checked)}
      className="peer sr-only"
    />
    <span
      aria-hidden="true"
      className={
        'relative h-[19px] w-[34px] shrink-0 rounded-full border border-border-dark bg-dark-700 transition-colors ' +
        'peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:outline peer-focus-visible:outline-2 ' +
        'peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus ' +
        "after:absolute after:left-[2px] after:top-[2px] after:h-[13px] after:w-[13px] after:rounded-full after:bg-text-muted after:transition-transform after:content-[''] " +
        'peer-checked:after:translate-x-[15px] peer-checked:after:bg-dark-900'
      }
    />
  </label>
);

type ButtonTone = 'default' | 'ghost' | 'primary' | 'danger';

const TONES: Record<ButtonTone, string> = {
  default: 'border-border-dark bg-dark-700 text-text-primary hover:bg-dark-600',
  ghost: 'border-border-dark bg-transparent text-text-primary hover:bg-dark-700',
  primary: 'border-primary bg-primary text-dark-900 hover:bg-primary/90',
  danger: 'border-accent-red/40 bg-accent-red/10 text-accent-red hover:bg-accent-red/20'
};

interface SettingButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ButtonTone;
  ref?: React.Ref<HTMLButtonElement>;
}

/** A small button at a row's right, as the mockups' `.btn.s`. */
export const SettingButton: React.FC<SettingButtonProps> = ({
  tone = 'default',
  className = '',
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${TONES[tone]} ${className}`}
    {...rest}
  />
);

/** A menu at a row's right, as the mockups' `.sel2`. */
export const SETTING_SELECT_CLASS =
  'rounded-lg border border-border-field bg-dark-700 px-2.5 py-1 text-xs text-text-primary disabled:opacity-50';

/** Under a row: a change the app could not make, in amber, never as though it worked. */
export const SettingProblem: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p role="alert" className="flex items-center gap-1.5 text-xs text-accent-amber">
    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
    <span>{children}</span>
  </p>
);
