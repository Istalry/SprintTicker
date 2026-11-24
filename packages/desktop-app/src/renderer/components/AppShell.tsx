import React, { useEffect, useState } from 'react';
import { Clock, FolderGit2, History, Moon, PictureInPicture2, Settings, Zap } from 'lucide-react';
import { DeviceStatusDTO } from '../../shared/dtos';
import { HardwareDisplayEmulator } from './HardwareDisplayEmulator';
import { ModeChip } from './ModeChip';
import { StatusPanel } from './StatusPanel';
import { SettingsGroupId } from '../views/Settings/settings-groups';

/** The four places (S4–S24). Nothing appears or disappears without a bar. */
export type Place = 'today' | 'tasks' | 'history' | 'settings';

export const PLACES: readonly { id: Place; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'today', label: 'Today', icon: Clock },
  { id: 'tasks', label: 'Tasks', icon: FolderGit2 },
  { id: 'history', label: 'History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings }
];

interface AppShellProps {
  place: Place;
  onNavigate: (place: Place) => void;
  device: DeviceStatusDTO;
  /** Interruptions not placed on a task yet: the ⚡ count beside Today. */
  toPlace: number;
  onEndDay: () => void;
  onOpenSettings: (group: SettingsGroupId) => void;
  children: React.ReactNode;
}

/**
 * The window's frame: the header (S5) and the side list of the four places.
 * Still no router -- the place is a state, as the tab was.
 */
export const AppShell: React.FC<AppShellProps> = ({ place, onNavigate, device, toPlace, onEndDay, onOpenSettings, children }) => {
  const hasBar = device.enabled;
  const [isMiniOpen, setIsMiniOpen] = useState<boolean>(false);

  // Followed rather than toggled locally: the mini timer also closes from its
  // own button and opens from the tray.
  useEffect(() => {
    if (!window.electronAPI?.onMiniWindowVisibility) return undefined;
    window.electronAPI.isMiniWindowOpen()
      .then(setIsMiniOpen)
      .catch(err => console.warn('[AppShell] Could not read the mini timer state:', err));
    return window.electronAPI.onMiniWindowVisibility(setIsMiniOpen);
  }, []);

  const main = PLACES.filter(p => p.id !== 'settings');
  const settings = PLACES.find(p => p.id === 'settings')!;

  return (
    <div className="flex flex-col h-screen bg-dark-900 text-text-primary">
      {/*
        The header is one row at every window size, down to the 900px minimum:
        the LED preview in the middle absorbs the slack (`flex-1 min-w-0`) and
        the groups either side are `shrink-0`. `overflow-x-clip` is the
        backstop: whatever else happens, nothing escapes the window sideways.
        Never `overflow-hidden`: it clipped the Status panel and the Mode
        menu, which drop below the header, and made the header a scroll
        container -- the panel's focus scrolled it 90 px and the window
        looked broken (2.0.1, a user's report). `clip` cannot be scrolled.
      */}
      <header className="flex items-center gap-4 overflow-x-clip px-6 py-2.5 bg-dark-800 border-b border-border-dark select-none">
        <h1 className="text-lg font-bold tracking-tight text-white shrink-0">SprintTicker</h1>

        <div className="flex-1 min-w-0">
          {hasBar && <HardwareDisplayEmulator />}
        </div>

        <div className="flex items-center gap-2 text-sm shrink-0">
          <ModeChip />
          {/*
            Each control keeps a `title` covering whatever its label drops at a
            breakpoint: at the narrowest size these are icons, and a tooltip is
            all that is left.
          */}
          <button
            type="button"
            onClick={() => {
              window.electronAPI?.toggleMiniWindow?.()
                .catch(err => console.warn('[AppShell] Could not toggle the mini timer:', err));
            }}
            title={isMiniOpen ? 'Close the mini timer' : 'Open the mini timer: an always-on-top timer'}
            aria-label={isMiniOpen ? 'Close the mini timer' : 'Mini timer'}
            aria-pressed={isMiniOpen}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-semibold text-xs transition-colors shrink-0 ${
              isMiniOpen ? 'bg-select text-text-primary border-focus/40' : 'bg-dark-700 hover:bg-dark-600 text-text-secondary border-border-dark'
            }`}
          >
            <PictureInPicture2 className="w-3.5 h-3.5 shrink-0" />
            {/* The breakpoints were measured with the bar's preview in the header;
                without it there is room for the words (C20). */}
            <span className={`${hasBar ? 'hidden hdr-md:inline' : 'inline'} whitespace-nowrap`}>Mini timer</span>
          </button>

          <button
            type="button"
            onClick={onEndDay}
            title="End my day: check today's time and send it"
            aria-label="End my day"
            className="flex items-center gap-1.5 bg-dark-700 hover:bg-dark-600 text-text-primary px-3 py-1.5 rounded-md border border-border-dark font-semibold text-xs transition-colors shrink-0"
          >
            <Moon className="w-3.5 h-3.5 shrink-0" />
            <span className={`${hasBar ? 'hidden hdr-sm:inline' : 'inline'} whitespace-nowrap`}>End my day</span>
          </button>

          <StatusPanel device={device} onOpenSettings={onOpenSettings} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-56 bg-dark-800 border-r border-border-dark flex flex-col p-4">
          <nav aria-label="Places" className="flex flex-1 flex-col">
            <div className="space-y-1">
              {main.map(item => (
                <PlaceButton
                  key={item.id}
                  item={item}
                  active={place === item.id}
                  onClick={() => onNavigate(item.id)}
                  badge={item.id === 'today' && toPlace > 0 ? toPlace : undefined}
                />
              ))}
            </div>
            <div className="mt-auto">
              <PlaceButton item={settings} active={place === 'settings'} onClick={() => onNavigate('settings')} />
            </div>
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto p-6 bg-dark-900">{children}</main>
      </div>
    </div>
  );
};

const PlaceButton: React.FC<{
  item: (typeof PLACES)[number];
  active: boolean;
  onClick: () => void;
  badge?: number;
}> = ({ item, active, onClick, badge }) => {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
        active ? 'bg-select text-text-primary' : 'text-text-secondary hover:bg-dark-700 hover:text-text-primary'
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1 text-left">{item.label}</span>
      {badge !== undefined && (
        <span
          className="flex items-center gap-0.5 rounded bg-accent-amber/15 px-1.5 py-0.5 text-xs font-semibold text-accent-amber"
          // No title here: jsdom, and some screen readers, then take it for
          // the badge's name instead of its text.
        >
          <Zap aria-hidden="true" className="w-3 h-3" />
          <span aria-hidden="true">{badge}</span><span className="sr-only">, {badge} to place</span>
        </span>
      )}
    </button>
  );
};
