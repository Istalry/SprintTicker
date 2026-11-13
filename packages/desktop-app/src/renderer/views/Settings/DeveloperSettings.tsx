import React, { useState } from 'react';
import { useDeviceStatus } from '../../hooks/useDeviceStatus';
import { BarRemotePad } from '../../components/BarRemotePad';
import { AnimationDebugPanel } from '../../components/AnimationDebugPanel';
import { TestNotifications } from '../../components/TestNotifications';
import { BarHealth } from '../../components/BarHealth';
import { NotificationListenerView } from '../Notifications/NotificationListenerView';
import { SettingButton, SettingRow, SettingsList } from '../../components/SettingRow';

type Tool = 'remote' | 'debugger' | 'tests' | 'listener' | 'health';

/**
 * Settings · Developer (S24), once switched on in General: what used to be
 * on every user's screen, one row each, opened one at a time. Each says
 * plainly when it acts on the real timer. Without a bar, only the tools that
 * need none.
 */
export const DeveloperSettings: React.FC = () => {
  const status = useDeviceStatus();
  const [open, setOpen] = useState<Tool | null>(null);
  const hasBar = status.enabled;

  const row = (tool: Tool, title: string, description: string, body: React.ReactNode) => (
    <SettingRow
      title={title}
      description={description}
      control={
        <SettingButton aria-expanded={open === tool} aria-label={`${open === tool ? 'Close' : 'Open'} ${title}`}
          onClick={() => setOpen(open === tool ? null : tool)}>
          {open === tool ? 'Close' : 'Open'}
        </SettingButton>
      }
    >
      {open === tool && body}
    </SettingRow>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary">
        These tools act on the real app: the bar remote presses real keys, and the display debugger&apos;s Pause,
        Stop, Lunch and Away act on your real timer and mode.
      </p>
      <SettingsList label="Developer">
        {row('remote', 'Bar remote', '▲ ▼ OK BACK START, as if pressed on the bar. Acts on your real timer.', <BarRemotePad />)}
        {hasBar && row('debugger', 'Display debugger', 'Plays every scene and screen. Pause, Stop, Lunch and Away act on your real timer.', <AnimationDebugPanel />)}
        {hasBar && row('tests', 'Test notifications', 'Fake Slack, Discord, battery and screenshot notifications.', <TestNotifications />)}
        {hasBar && row('listener', 'Notification listener', 'Capture strategy, database access, logs, apps added by their id.', <NotificationListenerView />)}
        {hasBar && row('health', 'Bar health', 'Latency, upload times, screen closes, the inputs the bar sends.', <BarHealth status={status} />)}
      </SettingsList>
    </div>
  );
};
