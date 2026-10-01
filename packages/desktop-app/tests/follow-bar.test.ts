import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { followBar } from '../src/main/services/follow-bar';
import { DeviceStatusDTO, ArgumentNullException } from '../src/shared/dtos';

/**
 * The Windows notification listener polls every couple of seconds to mirror
 * notifications onto the bar; without one that is cost for nothing.
 */
describe('followBar', () => {
  const status = (enabled: boolean, connected = false): DeviceStatusDTO => ({
    enabled, connected, ipAddress: '10.0.4.20', connectionType: 'usb', frontBrightness: null,
    backBrightness: null, batteryPercent: 0, firmwareVersion: 'N/A', webSocketPingMs: 0, framesSent: 0, framesFailed: 0
  });

  const driverWith = (enabled: boolean) => Object.assign(new EventEmitter(), { isEnabled: () => enabled });

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('FollowBar_BarPresent_StartsAtOnce', () => {
    const start = vi.fn();

    followBar(driverWith(true), start, vi.fn(), 'mirroring');

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('FollowBar_NoBar_StaysStoppedUntilOneIsAdded', () => {
    const driver = driverWith(false);
    const start = vi.fn();
    followBar(driver, start, vi.fn(), 'mirroring');
    expect(start).not.toHaveBeenCalled();

    driver.emit('statusChanged', status(true));

    expect(start).toHaveBeenCalledTimes(1);
  });

  it('FollowBar_BarTurnedOff_StopsOnceAndIgnoresPings', () => {
    // The driver reports status on every ping; only the transition counts.
    const driver = driverWith(true);
    const start = vi.fn();
    const stop = vi.fn();
    followBar(driver, start, stop, 'mirroring');

    driver.emit('statusChanged', status(true, true));
    driver.emit('statusChanged', status(false));
    driver.emit('statusChanged', status(false));

    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('FollowBar_NoDriver_Throws', () => {
    expect(() => followBar(null as never, vi.fn(), vi.fn(), 'x')).toThrow(ArgumentNullException);
  });
});
