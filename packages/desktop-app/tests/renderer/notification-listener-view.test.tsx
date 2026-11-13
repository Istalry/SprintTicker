import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NotificationListenerView } from '../../src/renderer/views/Notifications/NotificationListenerView';
import { AUTO_SAVE_DELAY_MS } from '../../src/renderer/hooks/auto-save-scheduler';
import { installElectronApi } from './electron-api-mock';

/** Settings · Developer's notification listener (S24), after P16d moved the apps to Desk devices. */
describe('the notification listener view', () => {
  it('Render_StatusAndLogs_NoAppList', async () => {
    installElectronApi();
    render(<NotificationListenerView />);

    expect(await screen.findByText('Active (Listening)')).toBeTruthy();
    expect(screen.getByText('NOTIFICATION LISTENER DEBUG LOGS')).toBeTruthy();
    expect(screen.queryByText(/Per-Source Notification Priority Rules/)).toBeNull();
  });

  it('AddCustomSource_ById_SavedWithTheOtherApps', async () => {
    const bridge = installElectronApi();
    render(<NotificationListenerView />);
    await screen.findByText('Active (Listening)');

    fireEvent.change(screen.getByPlaceholderText('App ID (e.g. chrome, outlook)'), { target: { value: 'Outlook' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));

    await waitFor(() => expect(bridge.api.saveNotificationSettings).toHaveBeenCalledWith(expect.objectContaining({
      sourceRules: expect.arrayContaining([expect.objectContaining({ appId: 'outlook', appName: 'Outlook' }), expect.objectContaining({ appId: 'slack' })])
    })), { timeout: AUTO_SAVE_DELAY_MS * 3 });
  });
});
