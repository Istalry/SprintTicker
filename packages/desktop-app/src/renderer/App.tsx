import React, { useEffect, useState } from 'react';
import { useSession } from './hooks/useSession';
import { useDeviceStatus } from './hooks/useDeviceStatus';
import { useWorklogs } from './hooks/useWorklogs';
import { useModals } from './hooks/useModals';
import { AppShell, Place } from './components/AppShell';
import { TaskPicker } from './components/TaskPicker';
import { pickTask } from './utils/pick-task';
import { CommandPalette } from './components/CommandPalette';
import type { PaletteAction } from './utils/palette-actions';
import { TodayView } from './views/Today/TodayView';
import { ProjectTaskManagerView } from './views/Tasks/ProjectTaskManagerView';
import { WorklogHistoryView } from './views/History/WorklogHistoryView';
import { SettingsPage } from './views/Settings/SettingsPage';
import { SettingsGroupId } from './views/Settings/settings-groups';
import { EndMyDayDialog } from './views/EOD/EndMyDayDialog';
import { WeekEndedNotice } from './components/WeekEndedNotice';
import { FirstRunDialog } from './components/FirstRun/FirstRunDialog';
import { ForgottenSessionModal } from './components/ForgottenSessionModal';
import { UpdateBanner } from './components/UpdateNotice';
import { UndoBar } from './components/UndoBar';
import { useToPlaceCount } from './hooks/useToPlaceCount';

/**
 * Ctrl+K opens and closes the command palette (S30), from anywhere in the
 * window. A listener on the window, not a global shortcut: the palette is
 * the window's, and a global chord would take Ctrl+K from every other app.
 */
function usePaletteKey(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(current => !current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return [open, setOpen];
}

export const App: React.FC = () => {
  const [place, setPlace] = useState<Place>('today');
  const [settingsGroup, setSettingsGroup] = useState<SettingsGroupId>('general');
  // Check my week asked for by the week's notice: History remounts on each (`n`).
  const [weekCheck, setWeekCheck] = useState<{ monday: string; n: number } | null>(null);

  const { session, pause, resume, complete, discard, startTask, startOwnWork, interrupt, back, stopInterruption } = useSession();
  const device = useDeviceStatus();
  const hasBar = device.enabled;
  const { worklogs } = useWorklogs();
  const modals = useModals(session !== null);
  const toPlace = useToPlaceCount();
  const [paletteOpen, setPaletteOpen] = usePaletteKey();

  const openSettings = (group: SettingsGroupId): void => {
    setSettingsGroup(group);
    setPlace('settings');
  };

  const warn = (what: string) => (err: unknown) => console.warn(`[App] ${what} failed:`, err);

  // Main opening the window on a place (P12): Account is Settings', every
  // other opens on Today -- End my day's dialog is useModals', the Undo
  // button's focus the Undo bar's.
  useEffect(() => window.electronAPI?.onOpenRoute?.(route => {
    if (route === 'account') {
      setSettingsGroup('account');
      setPlace('settings');
      return;
    }
    setPlace('today');
  }), []);

  /** A palette action, run as the window's own control for it runs it. */
  const runAction = (id: PaletteAction['id']): void => {
    if (id.startsWith('settings:')) {
      openSettings(id.slice('settings:'.length) as SettingsGroupId);
      return;
    }
    switch (id) {
      case 'start':
      case 'switch':
        modals.picker.show('start');
        return;
      case 'assign':
        modals.picker.show('assign');
        return;
      case 'previous':
        window.electronAPI.getPreviousTask()
          .then(task => task ? startTask(task.id, false, task.title) : undefined)
          .catch(warn('Going back to the previous task'));
        return;
      case 'pause':
        pause().catch(warn('Pause'));
        return;
      case 'resume':
        resume().catch(warn('Resume'));
        return;
      case 'stop':
        // One click, as Today's Stop: the task stays open, Undo for 10 s.
        (session?.interruption ? stopInterruption() : complete(undefined, false)).catch(warn('Stop'));
        return;
      case 'interrupt':
      case 'another':
        interrupt().catch(warn('Interrupt'));
        return;
      case 'back':
        back().catch(warn('Back'));
        return;
      case 'place':
        // Where the interruptions to place are listed, with Place all.
        setPlace('history');
        return;
      case 'end-day':
        modals.eod.show();
        return;
      case 'mini':
        window.electronAPI.toggleMiniWindow().catch(warn('The mini timer'));
        return;
      case 'go-today':
        setPlace('today');
        return;
      case 'go-tasks':
        setPlace('tasks');
        return;
      case 'go-history':
        setPlace('history');
        return;
      default:
        return;
    }
  };

  const renderPlace = () => {
    switch (place) {
      case 'tasks':
        return <ProjectTaskManagerView />;
      case 'history':
        return <WorklogHistoryView key={weekCheck?.n ?? 0} checkWeekOf={weekCheck?.monday} />;
      case 'settings':
        return (
          <SettingsPage
            group={settingsGroup}
            onGroupChange={setSettingsGroup}
            hasBar={hasBar}
            onRunSetup={modals.firstRun.show}
          />
        );
      case 'today':
      default:
        return (
          <TodayView
            session={session}
            worklogs={worklogs}
            onPause={pause}
            onResume={resume}
            onComplete={complete}
            onDiscard={() => discard().catch(err => console.warn('[App] Discarding the session failed:', err))}
            onInterrupt={() => { interrupt().catch(err => console.warn('[App] Interrupt failed:', err)); }}
            onStopInterruption={() => { stopInterruption().catch(err => console.warn('[App] Stopping the interruption failed:', err)); }}
            onOpenPicker={modals.picker.show}
            onPrevious={task => { startTask(task.id, false, task.title).catch(err => console.warn('[App] Previous task failed:', err)); }}
            device={device}
            onOpenSettings={openSettings}
          />
        );
    }
  };

  return (
    <>
      <AppShell
        place={place}
        onNavigate={setPlace}
        device={device}
        toPlace={toPlace}
        onEndDay={modals.eod.show}
        onOpenSettings={openSettings}
      >
        <UpdateBanner />
        {renderPlace()}
      </AppShell>

      <TaskPicker
        isOpen={modals.picker.open}
        onClose={modals.picker.close}
        mode={modals.picker.mode === 'assign' ? 'assign' : session ? 'switch' : 'start'}
        runningTaskId={session?.taskId ?? null}
        onPick={picked => { void pickTask(modals.picker.mode, session, picked, startTask, startOwnWork); }}
      />

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        session={session}
        toPlace={toPlace}
        onAction={runAction}
        onPickTask={task => { void pickTask('start', session, { task, takeAlong: false }, startTask); }}
      />

      <EndMyDayDialog
        isOpen={modals.eod.open}
        onClose={() => {
          modals.eod.close();
          window.electronAPI.cancelEodWrapUp().catch(warn('Closing End my day'));
        }}
        onLater={minutes => {
          modals.eod.close();
          window.electronAPI.snoozeCeremony('EOD', minutes).catch(warn('Later'));
        }}
        // Main stopped the session itself (stopForWrapUp), with Undo.
        onEnded={modals.eod.close}
        onCheckGaps={() => {
          modals.eod.close();
          setPlace('history');
        }}
      />

      <WeekEndedNotice
        onCheckWeek={monday => {
          setWeekCheck(previous => ({ monday, n: (previous?.n ?? 0) + 1 }));
          setPlace('history');
        }}
      />
      <ForgottenSessionModal />

      <FirstRunDialog
        isOpen={modals.firstRun.open}
        onClose={modals.firstRun.close}
        onStartFirstTask={() => {
          modals.firstRun.close();
          setPlace('today');
          modals.picker.show('start');
        }}
      />

      <UndoBar />

    </>
  );
};

export default App;
