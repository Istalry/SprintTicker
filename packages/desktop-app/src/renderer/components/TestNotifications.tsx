import React, { useState } from 'react';
import { WindowsNotificationEventDTO } from '../../shared/dtos';
import { ipcErrorMessage } from '../utils/formatters';
import { SettingButton } from './SettingRow';
import { useAnnounce } from './LiveAnnouncer';

/**
 * Fake Windows notifications (S24, Developer), sent through the listener's
 * own path so the bar's banner, its icon and the priority rules all run as
 * for a real one. The Snipping Tool one names a real AUMID and icon path,
 * which is what exercises the icon resolver.
 */
const TESTS: ReadonlyArray<{ label: string; event: WindowsNotificationEventDTO }> = [
  { label: 'Discord', event: { appId: 'discord', appName: 'Discord', title: 'Alice', body: 'Hey, build pipeline deployed to production!' } },
  { label: 'Slack', event: { appId: 'slack', appName: 'Slack', title: 'Bob (Core Team)', body: 'Sprint planning review in 10 mins.' } },
  { label: 'Antigravity', event: { appId: 'antigravity', appName: 'Antigravity', title: 'Agentic AI', body: 'Refactoring & Vitest suite complete!' } },
  { label: 'Low battery', event: { appId: 'battery', appName: 'System Battery', title: 'Low Battery Alert', body: 'Battery level 15% - Connect charger!' } },
  {
    label: 'Screenshot',
    event: {
      appId: 'Microsoft.ScreenSketch_8wekyb3d8bbwe!App',
      appName: 'Snipping Tool',
      title: 'Screenshot saved to clipboard',
      body: 'Select to view screenshot details',
      iconPath: 'C:\\Program Files\\WindowsApps\\Microsoft.ScreenSketch_11.2602.49.0_x64__8wekyb3d8bbwe\\Assets\\SnippingToolAppList.scale-200.png'
    }
  }
];

export const TestNotifications: React.FC = () => {
  const [sent, setSent] = useState<string | null>(null);
  useAnnounce(sent, sent ?? '');

  const send = (label: string, event: WindowsNotificationEventDTO) => {
    setSent(null);
    window.electronAPI.simulateNotification(event)
      .then(() => setSent(`${label} sent: it shows on the bar if its app is not set to Don't show.`),
        (err: unknown) => setSent(`${label} not sent: ${ipcErrorMessage(err)}`));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {TESTS.map(({ label, event }) => (
          <SettingButton key={label} onClick={() => send(label, event)}>{label}</SettingButton>
        ))}
      </div>
      {sent && <p className="text-xs text-text-secondary">{sent}</p>}
    </div>
  );
};
