import { DisplayHealthDTO } from '../../shared/dtos';

/**
 * Median upload time at which the driver warns that the bar may be about to
 * hang.
 *
 * Measured on firmware 1.2.4 (2026-09-30): uploads ran at 24-53 ms on a
 * healthy bar and slowed to 300-600 ms before every hang, ahead of the bar
 * going silent. 250 sits clear of the first and under the second.
 */
export const DEVICE_LATENCY_WARNING_MS = 250;

/** Below this the warning is withdrawn: half the threshold, so a median hovering at 250 does not flap. */
export const DEVICE_LATENCY_RECOVERED_MS = DEVICE_LATENCY_WARNING_MS / 2;

/** Uploads the median is taken over: enough to ignore one slow request, few enough to move within a minute of frames. */
export const UPLOAD_LATENCY_WINDOW = 10;

/** Uploads needed before a median means anything. */
const MIN_UPLOADS_FOR_WARNING = 5;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Keeps the display figures that preceded every measured hang, for the
 * diagnostics bundle and one warning in the log.
 *
 * Observation only. Changing what the app sends on this signal -- fewer
 * redraws, no closes -- would need measuring on a real bar first, and is a
 * decision of its own.
 */
export class DisplayHealthMonitor {
  private readonly uploads: number[] = [];
  private readonly closes: number[] = [];
  private skipped = 0;
  private alreadyGone = 0;
  private maxQueue = 0;
  private warning = false;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** An upload's round trip, answered or not: a timeout is the strongest sign of all. */
  public recordUpload(elapsedMs: number): void {
    this.uploads.push(Math.max(0, Math.round(elapsedMs)));
    if (this.uploads.length > UPLOAD_LATENCY_WINDOW) this.uploads.shift();
    this.updateWarning();
  }

  public recordScreenClose(): void {
    this.closes.push(this.now());
    this.pruneCloses();
  }

  public recordSkipped(): void {
    this.skipped++;
  }

  public recordAlreadyGone(): void {
    this.alreadyGone++;
  }

  public recordQueueLength(length: number): void {
    this.maxQueue = Math.max(this.maxQueue, length);
  }

  public snapshot(): DisplayHealthDTO {
    this.pruneCloses();
    return {
      uploadMedianMs: this.median(),
      recentUploadMs: [...this.uploads],
      latencyWarning: this.warning,
      screenClosesLastHour: this.closes.length,
      requestsSkipped: this.skipped,
      removalsAlreadyGone: this.alreadyGone,
      maxQueueLength: this.maxQueue
    };
  }

  private updateWarning(): void {
    const median = this.median();
    if (median === null || this.uploads.length < MIN_UPLOADS_FOR_WARNING) return;
    if (!this.warning && median > DEVICE_LATENCY_WARNING_MS) {
      this.warning = true;
      this.pruneCloses();
      // Once per episode, with the figures that matter, so the next
      // diagnostics bundle shows the run-up to a hang rather than only the
      // timeouts after it.
      console.warn(
        `[BusyBarDriver] Display uploads are slow: median ${median} ms over the last ${this.uploads.length} ` +
          `(${this.uploads.join(', ')} ms), ${this.closes.length} screen close(s) in the last hour. ` +
          `Uploads slowed like this before every hang measured on firmware 1.2.4.`
      );
    } else if (this.warning && median < DEVICE_LATENCY_RECOVERED_MS) {
      this.warning = false;
      console.log(`[BusyBarDriver] Display uploads are back to normal: median ${median} ms.`);
    }
  }

  private median(): number | null {
    if (this.uploads.length === 0) return null;
    const sorted = [...this.uploads].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }

  private pruneCloses(): void {
    const cutoff = this.now() - HOUR_MS;
    while (this.closes.length > 0 && this.closes[0] < cutoff) this.closes.shift();
  }
}
