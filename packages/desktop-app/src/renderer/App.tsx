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
import { EodWrapUpModal } from './views/EOD/EodWrapUpModal';
import { StandupPromptModal } from './views/Standup/StandupPromptModal';
import { WeekEndedNotice } from './components/WeekEndedNotice';
import { OnboardingWizardModal } from './components/OnboardingWizardModal';
import { ResumeAfterLunchPrompt } from './components/ResumeAfterLunchPrompt';
import { ForgottenSessionModal } from './components/ForgottenSessionModal';
import { ToastNotification, ToastMessage } from './components/ToastNotification';
import { UpdateBanner } from './components/UpdateNotice';
import { UndoBar } from './components/UndoBar';

/**
 * Interruptions not placed on a task yet, for the ⚡ count beside Today. Read
 * again whenever main says the worklogs changed: placing one, or a new one
 * ending, changes the count.
 */
function useToPlaceCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getInterruptionsToPlace) return undefined;
    let live = true;
    const read = () => {
      api.getInterruptionsToPlace()
        .then(waiting => { if (live) setCount(waiting.length); })
        .catch(err => console.warn('[App] Could not read the interruptions to place:', err));
    };
    read();
    // Main sends the list itself when one ends or is placed.
    const off = api.onInterruptionsUpdated?.(waiting => { if (live) setCount(waiting.length); });
    return () => {
      live = false;
      off?.();
    };
  }, []);
  return count;
}

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
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const { session, pause, resume, complete, discard, startTask, interrupt, back, stopInterruption } = useSession();
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

  /** A palette action, run as the window's own control for it runs it. */
  const runAction = (id: PaletteAction['id']): void => {
    const warn = (what: string) => (err: unknown) => console.warn(`[App] ${what} failed:`, err);
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
        return <WorklogHistoryView />;
      case 'settings':
        return (
          <SettingsPage
            group={settingsGroup}
            onGroupChange={setSettingsGroup}
            hasBar={hasBar}
            onRunSetup={modals.onboarding.show}
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
            onBack={() => { back().catch(err => console.warn('[App] Back failed:', err)); }}
            onStopInterruption={() => { stopInterruption().catch(err => console.warn('[App] Stopping the interruption failed:', err)); }}
            onOpenPicker={modals.picker.show}
            onPrevious={task => { startTask(task.id, false, task.title).catch(err => console.warn('[App] Previous task failed:', err)); }}
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
        takeAlongOf={modals.picker.mode !== 'assign' && session?.interruption
          ? { title: session.interruption.title, seconds: session.elapsedSeconds }
          : null}
        onPick={picked => { void pickTask(modals.picker.mode, session, picked, startTask); }}
      />

      <CommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        session={session}
        toPlace={toPlace}
        onAction={runAction}
        onPickTask={task => { void pickTask('start', session, { task, takeAlong: false }, startTask); }}
      />

      <StandupPromptModal
        isOpen={modals.standup.open}
        onClose={async () => {
          modals.standup.close();
          if (window.electronAPI?.cancelStandupPrompt) {
            await window.electronAPI.cancelStandupPrompt();
          }
        }}
        onSnooze={async (minutes) => {
          modals.standup.close();
          if (window.electronAPI?.snoozeCeremony) {
            await window.electronAPI.snoozeCeremony('STANDUP', minutes);
          }
        }}
        onJoin={async () => {
          modals.standup.close();
          await window.electronAPI?.joinStandup?.();
        }}
      />

      <EodWrapUpModal
        isOpen={modals.eod.open}
        onClose={async () => {
          modals.eod.close();
          if (window.electronAPI?.cancelEodWrapUp) {
            await window.electronAPI.cancelEodWrapUp();
          }
        }}
        onSnooze={async (minutes) => {
          modals.eod.close();
          if (window.electronAPI?.snoozeCeremony) {
            await window.electronAPI.snoozeCeremony('EOD', minutes);
          }
        }}
        onConfirmEod={async () => {
          await complete('Finalized during End-of-Day Wrap-Up');
        }}
      />

      <ResumeAfterLunchPrompt />
      <WeekEndedNotice onOpenHistory={() => setPlace('history')} />
      <ForgottenSessionModal />

      <OnboardingWizardModal isOpen={modals.onboarding.open} onClose={modals.onboarding.close} />

      <UndoBar />

      <ToastNotification toasts={toasts} onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))} />
    </>
  );
};

export default App;
