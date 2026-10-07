import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEVICE_LATENCY_RECOVERED_MS,
  DEVICE_LATENCY_WARNING_MS,
  DisplayHealthMonitor,
  UPLOAD_LATENCY_WINDOW
} from '../src/main/hardware/display-health';

describe('DisplayHealthMonitor', () => {
  let now: number;
  let monitor: DisplayHealthMonitor;
  let warn: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;

  const uploads = (...times: number[]): void => times.forEach(ms => monitor.recordUpload(ms));

  beforeEach(() => {
    now = 0;
    monitor = new DisplayHealthMonitor(() => now);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('Snapshot_NothingMeasured_ReportsNoMedianRatherThanZero', () => {
    expect(monitor.snapshot()).toEqual({
      uploadMedianMs: null, recentUploadMs: [], latencyWarning: false,
      screenClosesLastHour: 0, requestsSkipped: 0, removalsAlreadyGone: 0, maxQueueLength: 0
    });
  });

  it('RecordUpload_MoreThanTheWindow_KeepsOnlyTheMostRecent', () => {
    uploads(...Array.from({ length: UPLOAD_LATENCY_WINDOW + 3 }, (_, i) => i + 1));

    const { recentUploadMs } = monitor.snapshot();
    expect(recentUploadMs).toHaveLength(UPLOAD_LATENCY_WINDOW);
    expect(recentUploadMs[0]).toBe(4);
  });

  it('UploadMedianMs_OneSlowUpload_IsNotMovedByIt', () => {
    // One stalled request among healthy ones is noise, not a bar about to hang.
    uploads(40, 45, 50, 5000, 42);

    expect(monitor.snapshot().uploadMedianMs).toBe(45);
    expect(monitor.snapshot().latencyWarning).toBe(false);
  });

  it('LatencyWarning_MedianClimbsLikeBeforeAHang_WarnsOnceWithTheFigures', () => {
    monitor.recordScreenClose();
    uploads(320, 410, 380, 450, 600, 520);

    expect(monitor.snapshot().latencyWarning).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('median');
    expect(message).toContain('1 screen close(s) in the last hour');
  });

  it('LatencyWarning_TooFewUploads_StaysQuiet', () => {
    uploads(400, 500);

    expect(monitor.snapshot().latencyWarning).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it('LatencyWarning_JustUnderTheThreshold_DoesNotWarn', () => {
    uploads(...Array(6).fill(DEVICE_LATENCY_WARNING_MS));

    expect(monitor.snapshot().latencyWarning).toBe(false);
  });

  it('LatencyWarning_Recovered_IsWithdrawnOnlyWellBelowTheThreshold', () => {
    uploads(...Array(UPLOAD_LATENCY_WINDOW).fill(400));
    // Hovering just under the threshold must not flap the warning.
    uploads(...Array(UPLOAD_LATENCY_WINDOW).fill(DEVICE_LATENCY_WARNING_MS - 10));
    expect(monitor.snapshot().latencyWarning).toBe(true);

    uploads(...Array(UPLOAD_LATENCY_WINDOW).fill(DEVICE_LATENCY_RECOVERED_MS - 10));

    expect(monitor.snapshot().latencyWarning).toBe(false);
    expect(log.mock.calls.flat().join(' ')).toContain('back to normal');
  });

  it('LatencyWarning_SecondEpisode_WarnsAgain', () => {
    uploads(...Array(UPLOAD_LATENCY_WINDOW).fill(400));
    uploads(...Array(UPLOAD_LATENCY_WINDOW).fill(40));
    uploads(...Array(UPLOAD_LATENCY_WINDOW).fill(400));

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('ScreenClosesLastHour_OlderThanAnHour_AreNotCounted', () => {
    monitor.recordScreenClose();
    now += 30 * 60 * 1000;
    monitor.recordScreenClose();
    now += 31 * 60 * 1000;

    expect(monitor.snapshot().screenClosesLastHour).toBe(1);
  });

  it('Counters_SinceStart_Accumulate', () => {
    monitor.recordSkipped();
    monitor.recordSkipped();
    monitor.recordAlreadyGone();
    monitor.recordQueueLength(3);
    monitor.recordQueueLength(1);

    expect(monitor.snapshot()).toMatchObject({ requestsSkipped: 2, removalsAlreadyGone: 1, maxQueueLength: 3 });
  });
});
