import React, { useState } from 'react';
import {
  Play,
  Sparkles,
  MessageSquare,
  CheckCircle2,
  Clock,
  Utensils,
  Moon,
  Pause,
  Square
} from 'lucide-react';
import { PreviewScreenId } from '../../shared/dtos';

/**
 * Interactive display debug panel.
 *
 * Every button here drives the real main-process path -- a simulated
 * notification, a user-mode change, or a rendered screen -- so what appears on
 * the bar and in the emulator is what the app would actually produce. It used
 * to hand-build display payloads and inject them into the emulator directly,
 * which made it a second, stale implementation of every layout.
 */
export const AnimationDebugPanel: React.FC = () => {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  /**
   * Draws one real screen on the device.
   *
   * This replaced eight hand-built preview payloads. They pushed
   * DisplayElementDTO[] straight into the emulator in a vocabulary main had
   * stopped emitting -- text elements at x=16 in a 56px field with a scroll
   * rate, against the renderer's rectangle strips at x=17 in 55px and no
   * scrolling at all. The panel a developer opens to check a layout was showing
   * a layout the device could not produce.
   */
  const preview = (screen: PreviewScreenId, msg: string) => {
    if (!window.electronAPI?.previewDisplayScreen) {
      showStatus('Error: electronAPI.previewDisplayScreen not available');
      return;
    }
    void window.electronAPI.previewDisplayScreen(screen).then(
      () => showStatus(msg),
      (err: unknown) => showStatus(`Preview failed: ${String(err)}`)
    );
  };

  const showStatus = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const triggerSlack = () => {
    if (window.electronAPI && window.electronAPI.simulateNotification) {
      window.electronAPI.simulateNotification({
        appId: 'slack',
        appName: 'Slack',
        title: 'Alice',
        body: 'PR #142 is ready for review!',
        iconId: 'slack'
      });
      showStatus('Real IPC: Simulated Slack Notification');
    }
  };

  const triggerSnippingTool = () => {
    if (window.electronAPI && window.electronAPI.simulateNotification) {
      window.electronAPI.simulateNotification({
        appId: 'Microsoft.ScreenSketch_8wekyb3d8bbwe!App',
        appName: 'Snipping Tool',
        title: 'Screenshot saved to clipboard',
        body: 'Select to view screenshot details',
        iconPath: 'C:\\Program Files\\WindowsApps\\Microsoft.ScreenSketch_11.2602.49.0_x64__8wekyb3d8bbwe\\Assets\\SnippingToolAppList.scale-200.png'
      });
      showStatus('Real IPC: Simulated Snipping Tool Notification');
    }
  };

  const triggerDiscord = () => {
    if (window.electronAPI && window.electronAPI.simulateNotification) {
      window.electronAPI.simulateNotification({
        appId: 'discord',
        appName: 'Discord',
        title: 'Bob',
        body: 'Build deployment completed successfully',
        iconId: 'discord'
      });
      showStatus('Real IPC: Simulated Discord Notification');
    }
  };

  const triggerGmail = () => {
    if (window.electronAPI && window.electronAPI.simulateNotification) {
      window.electronAPI.simulateNotification({
        appId: 'gmail',
        appName: 'Gmail',
        title: 'Urgent Email',
        body: 'Production Release v2.4 Status Update',
        iconId: 'gmail'
      });
      showStatus('Real IPC: Simulated Gmail Notification');
    }
  };

  // 2. Schedule & System Modes
  const triggerLunch = () => {
    if (window.electronAPI && window.electronAPI.setUserMode) {
      window.electronAPI.setUserMode('LUNCH');
      showStatus('Real IPC: Dispatched Lunch Break Mode (Auto-reverting in 10s)');
      setTimeout(() => {
        if (window.electronAPI && window.electronAPI.setUserMode) {
          window.electronAPI.setUserMode('WORK');
        }
      }, 10000);
    } else {
      showStatus('Error: electronAPI.setUserMode not available');
    }
  };

  const triggerAway = () => {
    if (window.electronAPI && window.electronAPI.setUserMode) {
      window.electronAPI.setUserMode('AWAY');
      showStatus('Real IPC: Dispatched Away Mode (Auto-reverting in 10s)');
      setTimeout(() => {
        if (window.electronAPI && window.electronAPI.setUserMode) {
          window.electronAPI.setUserMode('WORK');
        }
      }, 10000);
    } else {
      showStatus('Error: electronAPI.setUserMode not available');
    }
  };

  const triggerEodPrompt = () => preview('CEREMONY_EOD', 'Rendered EOD ceremony prompt');
  const triggerStandupTask = () => preview('CEREMONY_STANDUP', 'Rendered stand-up prompt');
  const triggerEodComplete = () => preview('EOD_COMPLETE', 'Rendered EOD complete');

  // 3. Picker and scene screens
  const triggerTaskSelection = () => preview('TASK_SELECTION', 'Rendered task selection');
  const triggerTaskLogged = () => preview('TASK_LOGGED', 'Rendered LOGGED scene');

  // 4. Task Session States & Confetti
  const triggerConfetti = () => {
    if (window.electronAPI && window.electronAPI.triggerConfettiBurst) {
      window.electronAPI.triggerConfettiBurst();
      showStatus('Real IPC: Triggered Confetti Burst');
    } else {
      showStatus('Error: electronAPI.triggerConfettiBurst not available');
    }
  };

  const triggerPause = () => {
    if (window.electronAPI && window.electronAPI.pauseSession) {
      window.electronAPI.pauseSession();
      showStatus('Real IPC: Paused active session');
    }
  };

  const triggerResume = () => {
    if (window.electronAPI && window.electronAPI.resumeSession) {
      window.electronAPI.resumeSession();
      showStatus('Real IPC: Resumed active session');
    }
  };

  return (
    <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-6 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-text-primary" />
            <span>DISPLAY VISUALS & ANIMATION DEBUGGER</span>
          </h3>
          <p className="text-xs text-text-secondary mt-0.5">
            Test all 16×16 icon masks, 56×16 scrolling marquee text, lunch/away states, confetti explosions, and build progress.
          </p>
        </div>

        {statusMessage && (
          <div className="bg-select text-text-primary px-3 py-1 rounded-lg text-xs border border-focus/40 animate- font-bold">
            {statusMessage}
          </div>
        )}
      </div>

      {/* Preset Action Buttons Grid */}
      <div className="space-y-4">
        {/* Category A: Messaging Notifications */}
        <div>
          <div className="text-[10px] text-text-secondary mb-2">1. Messaging Alerts (16×16 Icons + Masked Text)</div>
          <div className="grid grid-cols-4 gap-2">
            <button onClick={triggerSlack} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <MessageSquare className="w-3.5 h-3.5 text-[#36C5F0]" />
              <span>Slack Alert</span>
            </button>
            <button onClick={triggerDiscord} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <MessageSquare className="w-3.5 h-3.5 text-[#5865F2]" />
              <span>Discord Alert</span>
            </button>
            <button onClick={triggerGmail} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <MessageSquare className="w-3.5 h-3.5 text-[#EA4335]" />
              <span>Gmail Alert</span>
            </button>
            <button onClick={triggerSnippingTool} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <MessageSquare className="w-3.5 h-3.5 text-[#0078D7]" />
              <span>Snipping Tool</span>
            </button>
          </div>
        </div>

        {/* Category B: Task Session Controls */}
        <div>
          <div className="text-[10px] text-text-secondary mb-2">2. Task Session States & Confetti</div>
          <div className="grid grid-cols-4 gap-2">
            <button onClick={triggerResume} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Play className="w-3.5 h-3.5 text-accent-green" />
              <span>Track / Resume</span>
            </button>
            <button onClick={triggerPause} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Pause className="w-3.5 h-3.5 text-accent-amber" />
              <span>Pause Task</span>
            </button>
            <button onClick={triggerConfetti} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
              <span>Confetti Burst 🎉</span>
            </button>
            <button onClick={triggerTaskLogged} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Square className="w-3.5 h-3.5 text-accent-red" />
              <span>Stop Task (LOGGED)</span>
            </button>
          </div>
        </div>

        {/* Category C: System & Schedule Modes */}
        <div>
          <div className="text-[10px] text-text-secondary mb-2">3. System & Schedule Modes</div>
          <div className="grid grid-cols-4 gap-2">
            <button onClick={triggerLunch} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Utensils className="w-3.5 h-3.5 text-accent-amber" />
              <span>Lunch Break</span>
            </button>
            <button onClick={triggerAway} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Moon className="w-3.5 h-3.5 text-text-primary" />
              <span>Away Mode</span>
            </button>
            <button onClick={triggerEodPrompt} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Moon className="w-3.5 h-3.5 text-text-primary" />
              <span>EOD Prompt</span>
            </button>
            <button onClick={triggerStandupTask} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
              <span>Daily Standup</span>
            </button>
            <button onClick={triggerEodComplete} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
              <span>EOD Complete</span>
            </button>
            <button onClick={triggerTaskSelection} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Clock className="w-3.5 h-3.5 text-text-primary" />
              <span>Task Selection</span>
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};

export default AnimationDebugPanel;
