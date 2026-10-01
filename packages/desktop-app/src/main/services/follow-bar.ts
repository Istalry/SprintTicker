import { DeviceStatusDTO, ArgumentNullException } from '../../shared/dtos';

/** The slice of `BusyBarDriver` this needs, so a test can hand it a fake. */
export interface BarStatusSource {
  isEnabled(): boolean;
  on(event: 'statusChanged', listener: (status: DeviceStatusDTO) => void): unknown;
}

/**
 * Runs a service only while there is a bar, starting and stopping it as
 * no-bar mode is turned off and on.
 *
 * For services whose whole purpose is the bar -- the Windows notification
 * listener polls Windows' notification database every couple of seconds to
 * mirror it there, which without a bar is cost for nothing. Keyed on the
 * transition, not on every status: the driver reports status on every ping.
 */
export function followBar(
  driver: BarStatusSource,
  start: () => void,
  stop: () => void,
  name: string
): void {
  if (!driver) throw new ArgumentNullException('driver');

  let running = driver.isEnabled();
  if (running) {
    start();
  } else {
    console.log(`[Main] No BUSY Bar: ${name} paused.`);
  }

  driver.on('statusChanged', status => {
    if (status.enabled === running) return;
    running = status.enabled;
    if (running) {
      start();
    } else {
      stop();
      console.log(`[Main] No BUSY Bar: ${name} paused.`);
    }
  });
}
