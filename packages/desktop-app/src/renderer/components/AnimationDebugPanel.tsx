import React, { useState } from 'react';
import {
  Play,
  Sparkles,
  MessageSquare,
  Flame,
  Waves,
  CheckCircle2,
  Clock,
  Utensils,
  Moon,
  Pause,
  AlertOctagon,
  Square
} from 'lucide-react';
import { HardwareDisplayStateDTO, BitmapIconId, DisplayElementDTO } from '../../shared/dtos';
import { getBitmapById } from '../../shared/pixel-bitmaps';

/**
 * Interactive Animation & Visual Debug Panel.
 * Allows testing of all hardware display templates, micro-animations, 16x16 icon masks,
 * confetti particle bursts, progress bars, lunch/away alerts, and task states.
 */
export const AnimationDebugPanel: React.FC = () => {
  const [customText, setCustomText] = useState<string>('Custom Animated Marquee Text');
  const [selectedIcon, setSelectedIcon] = useState<BitmapIconId>('slack');
  const [scrollRate, setScrollRate] = useState<number>(60);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [debugTimer, setDebugTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const dispatchState = (
    frontElements: DisplayElementDTO[],
    backElements: DisplayElementDTO[],
    ledColorHex: string = '#10B981FF',
    ledMode: 'SOLID' | 'BREATHING' | 'PULSE_ALERT' | 'FLASH_BURST' | 'CONFETTI_EXPLOSION' = 'SOLID',
    msg?: string
  ) => {
    if (debugTimer) {
      clearTimeout(debugTimer);
    }

    const state: HardwareDisplayStateDTO = {
      frontElements,
      backElements,
      ledColorHex,
      ledMode,
      colorTheme: 'emerald',
      rearOledMode: 'DIAGNOSTICS'
    };

    window.dispatchEvent(new CustomEvent('debug-display-update', { detail: state }));
    if (msg) showStatus(msg);

    const timer = setTimeout(() => {
      if (window.electronAPI && window.electronAPI.getDisplayState) {
        window.electronAPI.getDisplayState().then((origState) => {
          if (origState) {
            window.dispatchEvent(new CustomEvent('debug-display-update', { detail: origState }));
          }
        });
      }
    }, 10000);

    setDebugTimer(timer);
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
        title: '[SLACK] Alice',
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
        title: '[DISCORD] Build notification',
        body: 'Bob: Build deployment completed successfully',
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
        title: '[GMAIL] Urgent Email',
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

  const triggerEodPrompt = () => {
    dispatchState(
      [
        { type: 'bitmap', iconId: 'clock', bitmapData: getBitmapById('clock'), x: 0, y: 0 },
        { type: 'text', font: 'bold', x: 16, y: 0, color: '#A855F7FF', text: 'EOD WRAP-UP' },
        { type: 'text', font: 'small', x: 16, y: 8, width: 56, color: '#FFFFFFFF', text: 'Press Wheel or Click UI to Start', scroll_rate: 60 }
      ],
      [{ type: 'text', font: 'tiny', x: 0, y: 0, color: '#A855F7FF', text: 'CEREMONY PROMPT: EOD WRAP-UP' }],
      '#A855F7FF',
      'PULSE_ALERT',
      'Dispatched EOD Ceremony Prompt (PULSE_ALERT Glow)'
    );
  };

  const triggerStandupTask = () => {
    dispatchState(
      [
        { type: 'bitmap', iconId: 'clock', bitmapData: getBitmapById('clock'), x: 0, y: 0 },
        { type: 'text', font: 'bold', x: 16, y: 0, color: '#3B82F6FF', text: 'STAND-UP' },
        { type: 'text', font: 'small', x: 16, y: 8, width: 56, color: '#FFFFFFFF', text: 'Daily Meeting Starting', scroll_rate: 60 }
      ],
      [{ type: 'text', font: 'tiny', x: 0, y: 0, color: '#3B82F6FF', text: 'CEREMONY PROMPT: STAND-UP' }],
      '#3B82F6FF',
      'PULSE_ALERT',
      'Dispatched Standup Prompt Visually'
    );
  };

  const triggerWave = () => dispatchState(
    [
      { type: 'bitmap', iconId: 'wave', bitmapData: getBitmapById('wave'), x: 0, y: 0 },
      { type: 'text', font: 'small', x: 16, y: 0, width: 56, color: '#38BDF8FF', text: 'TIDE' },
      { type: 'text', font: 'small', x: 16, y: 8, width: 56, color: '#38BDF8FF', text: '5:18AM | LOW' }
    ],
    [{ type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: 'REFERENCE: GREAT WAVE VIEW' }],
    '#38BDF8FF',
    'SOLID',
    'Dispatched Great Wave View'
  );

  // 3. Unity & Build Animations
  const triggerCompilation = (progress: number = 80) => dispatchState(
    [
      { type: 'bitmap', iconId: 'compiling', bitmapData: getBitmapById('compiling'), x: 0, y: 0 },
      { type: 'text', font: 'small', x: 16, y: 0, width: 56, color: '#3B82F6FF', text: `UNITY: ${progress}%` },
      { type: 'rectangle', x: 16, y: 11, width: 56, height: 4, fill: '#1E293BFF' },
      { type: 'rectangle', x: 16, y: 11, width: Math.floor((progress * 56) / 100), height: 4, fill: '#3B82F6FF' },
      { type: 'rectangle', x: 16 + Math.floor((progress * 56) / 100) - 1, y: 10, width: 2, height: 6, fill: '#FFFFFFFF' }
    ],
    [{ type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: `Compiling MyFantasyGame (${progress}%)` }],
    '#3B82F6FF',
    'FLASH_BURST',
    `Dispatched Unity Compilation (${progress}%)`
  );

  const triggerUnityError = () => dispatchState(
    [
      { type: 'bitmap', iconId: 'error', bitmapData: getBitmapById('error'), x: 0, y: 0 },
      { type: 'text', font: 'small', x: 16, y: 0, width: 56, color: '#EF4444FF', text: 'UNITY ERROR!' },
      { type: 'text', font: 'small', x: 16, y: 8, width: 56, color: '#FFFFFFFF', text: 'NullReferenceException: Object ref', scroll_rate: 60 }
    ],
    [{ type: 'text', font: 'tiny', x: 0, y: 0, color: '#EF4444FF', text: 'EXCEPTION: NullReferenceException' }],
    '#EF4444FF',
    'PULSE_ALERT',
    'Dispatched Unity Exception Alert'
  );

  const triggerPlayMode = () => dispatchState(
    [
      { type: 'bitmap', iconId: 'playmode', bitmapData: getBitmapById('playmode'), x: 0, y: 0 },
      { type: 'text', font: 'bold', x: 16, y: 0, width: 56, color: '#FF0000FF', text: 'ON AIR' },
      { type: 'text', font: 'small', x: 16, y: 8, width: 56, color: '#3B82F6FF', text: 'MyFantasyGame' }
    ],
    [{ type: 'text', font: 'tiny', x: 0, y: 0, color: '#FF0000FF', text: 'UNITY PLAY MODE ACTIVE' }],
    '#FF0000FF',
    'PULSE_ALERT',
    'Dispatched Unity Play Mode ON AIR'
  );

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

  const triggerCustomMarquee = () => dispatchState(
    [
      { type: 'bitmap', iconId: selectedIcon, bitmapData: getBitmapById(selectedIcon), x: 0, y: 0 },
      { type: 'text', font: 'small', x: 16, y: 0, width: 56, color: '#AAFF00FF', text: 'CUSTOM MARQUEE' },
      { type: 'text', font: 'small', x: 16, y: 8, width: 56, color: '#FFFFFFFF', text: customText, scroll_rate: scrollRate }
    ],
    [{ type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: `CUSTOM MARQUEE (${selectedIcon.toUpperCase()})` }],
    '#AAFF00FF',
    'SOLID',
    `Dispatched Custom Marquee: "${customText}"`
  );

  return (
    <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-6 font-mono text-xs">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-accent-purple" />
            <span>DISPLAY VISUALS & ANIMATION DEBUGGER</span>
          </h3>
          <p className="text-xs text-text-secondary mt-0.5">
            Test all 16×16 icon masks, 56×16 scrolling marquee text, lunch/away states, confetti explosions, and build progress.
          </p>
        </div>

        {statusMessage && (
          <div className="bg-accent-purple/20 text-accent-purple px-3 py-1 rounded-lg text-xs font-mono border border-accent-purple/40 animate-fade-in font-bold">
            {statusMessage}
          </div>
        )}
      </div>

      {/* Preset Action Buttons Grid */}
      <div className="space-y-4">
        {/* Category A: Messaging Notifications */}
        <div>
          <div className="text-[10px] text-text-secondary uppercase mb-2">1. Messaging Alerts (16×16 Icons + Masked Text)</div>
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
          <div className="text-[10px] text-text-secondary uppercase mb-2">2. Task Session States & Confetti</div>
          <div className="grid grid-cols-4 gap-2">
            <button onClick={triggerResume} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Play className="w-3.5 h-3.5 text-accent-green" />
              <span>Track / Resume</span>
            </button>
            <button onClick={triggerPause} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Pause className="w-3.5 h-3.5 text-accent-gold" />
              <span>Pause Task</span>
            </button>
            <button onClick={triggerConfetti} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
              <span>Confetti Burst 🎉</span>
            </button>
            <button onClick={triggerConfetti} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Square className="w-3.5 h-3.5 text-accent-red" />
              <span>Stop Task</span>
            </button>
          </div>
        </div>

        {/* Category C: Unity Telemetry & Errors */}
        <div>
          <div className="text-[10px] text-text-secondary uppercase mb-2">3. Unity Telemetry, Build Progress & Errors</div>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => triggerCompilation(80)} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Flame className="w-3.5 h-3.5 text-accent-blue" />
              <span>Compiling (80%)</span>
            </button>
            <button onClick={triggerUnityError} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <AlertOctagon className="w-3.5 h-3.5 text-accent-red" />
              <span>Unity Exception</span>
            </button>
            <button onClick={triggerPlayMode} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Play className="w-3.5 h-3.5 text-accent-red" />
              <span>Play Mode ON AIR</span>
            </button>
          </div>
        </div>

        {/* Category D: System & Schedule Modes */}
        <div>
          <div className="text-[10px] text-text-secondary uppercase mb-2">4. System & Schedule Modes</div>
          <div className="grid grid-cols-4 gap-2">
            <button onClick={triggerLunch} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Utensils className="w-3.5 h-3.5 text-accent-gold" />
              <span>Lunch Break</span>
            </button>
            <button onClick={triggerAway} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Moon className="w-3.5 h-3.5 text-accent-purple" />
              <span>Away Mode</span>
            </button>
            <button onClick={triggerEodPrompt} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Moon className="w-3.5 h-3.5 text-accent-purple" />
              <span>EOD Prompt</span>
            </button>
            <button onClick={triggerStandupTask} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />
              <span>Daily Standup</span>
            </button>
            <button onClick={triggerWave} className="p-2.5 bg-dark-900 hover:bg-dark-700 text-white rounded border border-border-dark text-left flex items-center space-x-2">
              <Waves className="w-3.5 h-3.5 text-accent-cyan" />
              <span>Great Wave</span>
            </button>
          </div>
        </div>
      </div>

      {/* Live Custom Text Playground Controls */}
      <div className="bg-dark-900 p-4 rounded-lg border border-border-dark space-y-4">
        <div className="font-bold text-white uppercase tracking-wider text-[11px] flex items-center space-x-2">
          <Clock className="w-3.5 h-3.5 text-accent-gold" />
          <span>Live Marquee Playground</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1">
            <label className="text-text-secondary text-[10px]">Custom Scrolling Text:</label>
            <input
              type="text"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              className="w-full bg-dark-800 text-white px-3 py-1.5 rounded border border-border-dark focus:outline-none text-xs"
              placeholder="Enter marquee message..."
            />
          </div>

          <div className="space-y-1">
            <label className="text-text-secondary text-[10px]">Icon Selection:</label>
            <select
              value={selectedIcon}
              onChange={(e) => setSelectedIcon(e.target.value as BitmapIconId)}
              className="w-full bg-dark-800 text-white px-2 py-1.5 rounded border border-border-dark focus:outline-none text-xs"
            >
              <option value="slack">Slack (16×16)</option>
              <option value="discord">Discord (16×16)</option>
              <option value="gmail">Gmail (16×16)</option>
              <option value="antigravity">Antigravity (16×16)</option>
              <option value="battery">Battery (16×16)</option>
              <option value="windows">Windows (16×16)</option>
              <option value="bell">Bell (16×16)</option>
              <option value="unity">Unity (16×16)</option>
              <option value="checkmark">Checkmark (16×16)</option>
              <option value="playmode">Playmode (16×16)</option>
              <option value="compiling">Compiling (16×16)</option>
              <option value="error">Error (16×16)</option>
              <option value="burger">Burger (16×16)</option>
              <option value="clock">Clock (16×16)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center space-x-3">
            <label className="text-text-secondary text-[10px]">Scroll Speed (px/s):</label>
            <input
              type="range"
              min="0"
              max="120"
              value={scrollRate}
              onChange={(e) => setScrollRate(Number(e.target.value))}
              className="w-32"
            />
            <span className="text-accent-blue font-bold">{scrollRate}</span>
          </div>

          <button
            onClick={triggerCustomMarquee}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-accent-blue hover:bg-blue-600 text-white rounded font-bold transition-all text-xs"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Dispatch Custom</span>
          </button>
        </div>
      </div>

    </div>
  );
};

export default AnimationDebugPanel;
