import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoSaveScheduler } from '../src/renderer/hooks/auto-save-scheduler';

/**
 * The Save buttons were removed in favour of auto-save, which moves the risk
 * from "the user forgets to save" to "the panel saves something the user never
 * typed".
 *
 * A settings panel mounts holding defaults and loads stored values
 * asynchronously. An effect that simply watches the values fires with the
 * defaults first, and writing those back is how auto-save destroys a
 * configuration. Everything below exists to pin that down.
 */
describe('AutoSaveScheduler', () => {
  let saves: Array<readonly unknown[]>;
  let statuses: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    saves = [];
    statuses = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function build(save?: (v: readonly unknown[]) => void | Promise<void>) {
    return new AutoSaveScheduler({
      save:
        save ??
        ((values: readonly unknown[]) => {
          saves.push(values);
        }),
      delayMs: 500,
      onStatusChange: s => statuses.push(s)
    });
  }

  it('Sync_NotLoadedYet_SavesNothingAndTakesNoBaseline', () => {
    const scheduler = build();

    scheduler.sync(['default'], false);
    vi.advanceTimersByTime(5000);

    expect(saves).toEqual([]);
    expect(scheduler.hasBaseline).toBe(false);
  });

  it('Sync_FirstLoadedValues_AreTreatedAsBaselineRatherThanSaved', () => {
    // Opening a panel must not write anything. For the provider panel this
    // would also reinitialise the provider and start a sync on every visit.
    const scheduler = build();

    scheduler.sync(['stored-domain'], true);
    vi.advanceTimersByTime(5000);

    expect(saves).toEqual([]);
    expect(scheduler.hasBaseline).toBe(true);
  });

  it('Sync_DefaultsThenLoadedValues_NeverPersistsTheDefaults', () => {
    // The exact mount sequence: defaults while loading, stored values after.
    const scheduler = build();

    scheduler.sync([''], false);
    scheduler.sync(['http://stored.example'], true);
    vi.advanceTimersByTime(5000);

    expect(saves).toEqual([]);
  });

  it('Sync_ValueChangedAfterLoad_SavesOnceAfterTheQuietPeriod', () => {
    const scheduler = build();
    scheduler.sync(['stored'], true);

    scheduler.sync(['edited'], true);
    expect(saves).toEqual([]);
    vi.advanceTimersByTime(500);

    expect(saves).toEqual([['edited']]);
  });

  it('Sync_RapidTyping_CollapsesToASingleSaveOfTheFinalValue', () => {
    // Typing a URL character by character must not be one write per keystroke,
    // and must not leave the provider configured with a half-typed address.
    const scheduler = build();
    scheduler.sync([''], true);

    for (const partial of ['h', 'ht', 'htt', 'http', 'http://x']) {
      scheduler.sync([partial], true);
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(500);

    expect(saves).toEqual([['http://x']]);
  });

  it('Sync_ValueEditedAndReturnedToTheOriginal_StillSavesTheFinalState', () => {
    // The baseline advances with each change, so A -> B -> A saves twice
    // rather than leaving the stored value out of step with the form.
    const scheduler = build();
    scheduler.sync(['a'], true);

    scheduler.sync(['b'], true);
    vi.advanceTimersByTime(500);
    scheduler.sync(['a'], true);
    vi.advanceTimersByTime(500);

    expect(saves).toEqual([['b'], ['a']]);
  });

  it('Sync_UnchangedValues_DoNotScheduleASave', () => {
    // React re-renders freely; an unchanged render must not write.
    const scheduler = build();
    scheduler.sync(['same'], true);

    scheduler.sync(['same'], true);
    scheduler.sync(['same'], true);
    vi.advanceTimersByTime(5000);

    expect(saves).toEqual([]);
  });

  it('Dispose_WithASavePending_CancelsIt', () => {
    // Navigating away mid-debounce must not write after unmount.
    const scheduler = build();
    scheduler.sync(['stored'], true);
    scheduler.sync(['edited'], true);

    scheduler.dispose();
    vi.advanceTimersByTime(5000);

    expect(saves).toEqual([]);
  });

  it('Flush_WithASavePending_PersistsImmediately', () => {
    const scheduler = build();
    scheduler.sync(['stored'], true);
    scheduler.sync(['edited'], true);

    scheduler.flush();

    expect(saves).toEqual([['edited']]);
  });

  it('Save_Rejects_ReportsErrorRatherThanSilentlyLosingTheEdit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scheduler = build(() => Promise.reject(new Error('disk full')));
    scheduler.sync(['stored'], true);
    scheduler.sync(['edited'], true);

    vi.advanceTimersByTime(500);
    await vi.waitFor(() => expect(scheduler.status).toBe('error'));

    // With no Save button there is nothing to retry, so this must be visible.
    expect(statuses).toContain('error');
  });

  it('Save_Throws_ReportsErrorRatherThanPropagating', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scheduler = build(() => {
      throw new Error('boom');
    });
    scheduler.sync(['stored'], true);
    scheduler.sync(['edited'], true);

    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(scheduler.status).toBe('error');
  });

  it('Sync_SuccessfulSave_ReportsPendingThenSavingThenSaved', async () => {
    const scheduler = build(() => Promise.resolve());
    scheduler.sync(['stored'], true);

    scheduler.sync(['edited'], true);
    expect(statuses).toEqual(['pending']);
    vi.advanceTimersByTime(500);
    await vi.waitFor(() => expect(scheduler.status).toBe('saved'));

    expect(statuses).toEqual(['pending', 'saving', 'saved']);
  });

  describe('surviving StrictMode', () => {
    // React StrictMode runs every effect setup, cleanup, setup on mount in
    // development. useAutoSave disposes the scheduler in its cleanup, and the
    // ref holding it survives that simulated unmount -- so the second setup
    // inherited a disposed scheduler and auto-save was silently dead in dev
    // for every settings panel. Nothing threw; the indicator just never left
    // idle. These pin the contract the hook now relies on.

    it('Sync_AfterDispose_IsIgnoredSoAHolderMustReplaceTheInstance', () => {
      const scheduler = build();
      scheduler.sync(['stored'], true);
      scheduler.dispose();

      scheduler.sync(['edited'], true);
      vi.advanceTimersByTime(5000);

      expect(saves).toEqual([]);
      expect(scheduler.isDisposed).toBe(true);
    });

    it('IsDisposed_LiveScheduler_IsFalseSoAHolderKeepsUsingIt', () => {
      expect(build().isDisposed).toBe(false);
    });

    it('Sync_ReplacementAfterDispose_SavesEditsAgain', () => {
      // The whole point: a holder that replaces a disposed scheduler gets a
      // working one, and the replacement takes its own baseline rather than
      // writing the values it was handed first.
      const first = build();
      first.sync(['stored'], true);
      first.dispose();

      const replacement = build();
      replacement.sync(['stored'], true);
      vi.advanceTimersByTime(5000);
      expect(saves).toEqual([]);

      replacement.sync(['edited'], true);
      vi.advanceTimersByTime(500);

      expect(saves).toEqual([['edited']]);
    });
  });
});
