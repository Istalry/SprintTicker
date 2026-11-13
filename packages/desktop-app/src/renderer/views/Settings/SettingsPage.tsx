import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { AccountSettings } from './AccountSettings';
import { CeremoniesView } from '../Ceremonies/CeremoniesView';
import { DeviceDiagnosticsView } from '../Device/DeviceDiagnosticsView';
import { NotificationSettingsView } from '../Notifications/NotificationSettingsView';
import { PriorityRulesView } from '../Priority/PriorityRulesView';
import { CloseToTraySetting } from '../../components/CloseToTraySetting';
import { LaunchAtLoginSetting } from '../../components/LaunchAtLoginSetting';
import { ShortcutSettings } from '../../components/ShortcutSettings';
import { SettingButton, SettingRow, SettingsList, SettingSwitch } from '../../components/SettingRow';
import { UpdateCheckSetting } from '../../components/UpdateNotice';
import { BarRemotePad } from '../../components/BarRemotePad';
import {
  SETTINGS_GROUPS,
  SettingsGroupId,
  SHOW_DEVELOPER_KEY,
  searchSettings,
  visibleGroups
} from './settings-groups';

interface SettingsPageProps {
  group: SettingsGroupId;
  onGroupChange: (group: SettingsGroupId) => void;
  hasBar: boolean;
  onRunSetup: () => void;
}

export function readShowDeveloper(): boolean {
  try {
    return window.localStorage.getItem(SHOW_DEVELOPER_KEY) === 'true';
  } catch {
    // Storage refused (a locked-down profile): the tools stay hidden, which
    // is the default anyway.
    return false;
  }
}

/**
 * Settings, in six groups (S19–S24): a side list, a search box, one page per
 * group. Every card the app had moves here unchanged; the views that held
 * several subjects show the part that belongs to each group.
 */
export const SettingsPage: React.FC<SettingsPageProps> = ({ group, onGroupChange, hasBar, onRunSetup }) => {
  const [query, setQuery] = useState('');
  const [showDeveloper, setShowDeveloperState] = useState<boolean>(readShowDeveloper);

  const setShowDeveloper = (value: boolean): void => {
    setShowDeveloperState(value);
    try {
      window.localStorage.setItem(SHOW_DEVELOPER_KEY, String(value));
    } catch {
      // Not kept across restarts, but the choice still holds for this window.
    }
    if (!value && group === 'developer') onGroupChange('general');
  };

  const groups = visibleGroups(showDeveloper);
  const current = group === 'developer' && !showDeveloper ? 'general' : group;
  const results = searchSettings(query, showDeveloper);
  const title = SETTINGS_GROUPS.find(g => g.id === current)?.label ?? 'Settings';

  return (
    <div className="flex gap-6 max-w-6xl">
      <nav aria-label="Settings groups" className="w-52 shrink-0 space-y-3">
        <label className="flex items-center gap-2 rounded-lg border border-border-dark bg-dark-800 px-3 py-2 focus-within:border-focus">
          <Search className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </label>

        {query.trim() !== '' ? (
          <ul aria-label="Search results" className="space-y-0.5">
            {results.length === 0 && <li className="px-3 py-2 text-xs text-text-muted">No setting by that name.</li>}
            {results.map(entry => (
              <li key={`${entry.group}-${entry.label}`}>
                <button
                  type="button"
                  onClick={() => { onGroupChange(entry.group); setQuery(''); }}
                  className="w-full rounded-lg px-3 py-2 text-left text-xs text-text-primary hover:bg-dark-700"
                >
                  {entry.label}
                  <span className="block text-text-muted">{SETTINGS_GROUPS.find(g => g.id === entry.group)?.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-0.5">
            {groups.map(g => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => onGroupChange(g.id)}
                  aria-current={g.id === current ? 'page' : undefined}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    g.id === current ? 'bg-select text-text-primary' : 'text-text-secondary hover:bg-dark-700 hover:text-text-primary'
                  }`}
                >
                  {g.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <section aria-label={title} className="min-w-0 flex-1 space-y-6">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
        {current === 'general' && (
          <GeneralGroup showDeveloper={showDeveloper} onShowDeveloper={setShowDeveloper} onRunSetup={onRunSetup} />
        )}
        {current === 'account' && <AccountSettings hasBar={hasBar} />}
        {current === 'workday' && <CeremoniesView />}
        {current === 'devices' && <DevicesGroup hasBar={hasBar} />}
        {current === 'data' && <DeviceDiagnosticsView part="data" />}
        {current === 'developer' && <DeveloperGroup hasBar={hasBar} />}
      </section>
    </div>
  );
};

const Card: React.FC<{ title: string; children: React.ReactNode; description?: string }> = ({ title, description, children }) => (
  <div className="space-y-3 rounded-xl border border-border-dark bg-dark-800 p-5">
    <div>
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {description && <p className="text-xs text-text-secondary">{description}</p>}
    </div>
    {children}
  </div>
);

/** General (S19): one row per setting, in the mockup's order. */
const GeneralGroup: React.FC<{ showDeveloper: boolean; onShowDeveloper: (value: boolean) => void; onRunSetup: () => void }> = ({
  showDeveloper,
  onShowDeveloper,
  onRunSetup
}) => (
  <SettingsList label="General">
    <LaunchAtLoginSetting />
    <CloseToTraySetting />
    <ShortcutSettings />
    <UpdateCheckSetting />
    <SettingRow
      title="Set up again"
      description="The first-run questions: account, bar, your day."
      control={<SettingButton onClick={onRunSetup}>Run setup</SettingButton>}
    />
    <SettingRow
      title="Show developer tools"
      description="The display debugger, test notifications, logs: a Developer group below Data."
      control={<SettingSwitch label="Show developer tools" checked={showDeveloper} onChange={onShowDeveloper} />}
    />
  </SettingsList>
);

const DevicesGroup: React.FC<{ hasBar: boolean }> = ({ hasBar }) => (
  <>
    <DeviceDiagnosticsView part="devices" />
    {hasBar && (
      <>
        <details className="space-y-3">
          <summary className="cursor-pointer select-none text-sm font-semibold text-text-primary">Windows notifications on the bar</summary>
          <div className="mt-3">
            <NotificationSettingsView part="rules" />
          </div>
        </details>
        <details className="space-y-3">
          <summary className="cursor-pointer select-none text-sm font-semibold text-text-primary">What the bar shows first</summary>
          <div className="mt-3">
            <PriorityRulesView />
          </div>
        </details>
      </>
    )}
    <Card
      title="Stream Deck"
      description="The SprintTicker plugin for Elgato's Stream Deck talks to this app on its own once installed: Session, Interrupt and the answer keys. It comes with SprintTicker; Run setup, in General, installs it."
    >
      <span className="text-xs text-text-muted">Nothing to set here.</span>
    </Card>
  </>
);

const DeveloperGroup: React.FC<{ hasBar: boolean }> = ({ hasBar }) => (
  <>
    <p className="text-xs text-accent-amber">
      These tools act on the real app: the bar remote presses real keys, and the display debugger&apos;s Pause and
      Resume act on your real timer, its Lunch and Away on your real mode.
    </p>
    <Card title="Bar remote" description="▲ ▼ OK BACK START, as if pressed on the bar.">
      <BarRemotePad />
    </Card>
    <DeviceDiagnosticsView part="developer" />
    {hasBar && <NotificationSettingsView part="diagnostics" />}
  </>
);
