import React, { useEffect, useState } from 'react';
import { useSession } from './hooks/useSession';
import { useDeviceStatus } from './hooks/useDeviceStatus';
import { useTasks } from './hooks/useTasks';
import { useWorklogs } from './hooks/useWorklogs';
import { useModals } from './hooks/useModals';
import { AppShell, Place } from './components/AppShell';
import { TaskSelectionModal } from './components/TaskSelectionModal';
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

export const App: React.FC = () => {
  const [place, setPlace] = useState<Place>('today');
  const [settingsGroup, setSettingsGroup] = useState<SettingsGroupId>('general');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const { session, pause, resume, complete, discard, startTask, interrupt, back, stopInterruption } = useSession();
  const device = useDeviceStatus();
  const hasBar = device.enabled;
  const { projects } = useTasks();
  const { worklogs } = useWorklogs();
  const modals = useModals(session !== null);
  const toPlace = useToPlaceCount();

  const openSettings = (group: SettingsGroupId): void => {
    setSettingsGroup(group);
    setPlace('settings');
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

      <TaskSelectionModal
        isOpen={modals.picker.open}
        onClose={modals.picker.close}
        projects={projects}
        mode={modals.picker.mode}
        onSelectTask={(taskId, isAdHoc, title) => {
          if (modals.picker.mode === 'assign') {
            window.electronAPI.assignSession(taskId).catch(err => console.warn('[App] Assigning the session failed:', err));
            return;
          }
          startTask(taskId, isAdHoc, title);
        }}
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
