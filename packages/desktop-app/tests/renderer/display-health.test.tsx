import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BarHealth } from '../../src/renderer/components/BarHealth';
import { CONNECTED_DEVICE, installElectronApi } from './electron-api-mock';

/**
 * Bar health shows the figures that came before every measured hang,
 * so a user looking at a frozen bar knows to export the logs first.
 */
describe('display health', () => {
  it('DeviceView_UploadsHealthy_ShowsTheFiguresWithoutAWarning', async () => {
    installElectronApi();
    render(<BarHealth status={{
      ...CONNECTED_DEVICE,
      displayHealth: { ...CONNECTED_DEVICE.displayHealth, uploadMedianMs: 42, screenClosesLastHour: 3, requestsSkipped: 7 }
    }} />);

    expect(await screen.findByText('42 ms')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.queryByText(/Uploads to the bar are slow/)).toBeNull();
  });

  it('DeviceView_UploadsSlow_WarnsToExportTheLogs', async () => {
    installElectronApi();
    render(<BarHealth status={{
      ...CONNECTED_DEVICE,
      displayHealth: { ...CONNECTED_DEVICE.displayHealth, uploadMedianMs: 410, latencyWarning: true }
    }} />);

    expect(await screen.findByText(/Uploads to the bar are slow/)).toBeTruthy();
    expect(screen.getByText('410 ms')).toBeTruthy();
  });

  it('DeviceView_NoUploadYet_SaysSoRatherThanZero', async () => {
    installElectronApi();
    render(<BarHealth status={CONNECTED_DEVICE} />);

    expect(await screen.findByText('No uploads yet')).toBeTruthy();
  });
});
