import { describe, it, expect, vi } from 'vitest';
import type { UndoStateDTO } from '../src/shared/dtos';
import { describeUndoToast, UndoToasts } from '../src/main/windows/undo-toasts';
import { UndoService } from '../src/main/services/undo-service';

/** An action taken with the window hidden says it can be undone (P12c, S26). */
describe('UndoToasts', () => {
  function over(onScreen: boolean) {
    let now = 1_000_000;
    let fire: (() => void) | null = null;
    const undo = new UndoService(() => now, {
      setTimeout: run => { fire = run; return 1; },
      clearTimeout: () => { fire = null; }
    }, 10_000);
    const toasts = { show: vi.fn(() => true) };
    const screen = { on: onScreen };
    const service = new UndoToasts({
      onUndoChanged: listener => undo.onChanged(listener),
      isDashboardOnScreen: () => screen.on,
      toasts,
      seconds: 10
    });
    service.start();
    const offer = (label = 'Stopped MG-12 · 1h 24m', kind: UndoStateDTO['kind'] = 'stop') =>
      undo.offer({ kind, label, undo: () => true });
    return { undo, toasts, screen, service, offer, tick: (ms: number) => { now += ms; }, expire: () => fire?.() };
  }

  it('Offer_DashboardHidden_ToastsItAndItsClickOpensUndo', () => {
    const { toasts, offer } = over(false);

    offer();

    expect(toasts.show).toHaveBeenCalledWith({
      title: 'Stopped MG-12 · 1h 24m',
      body: 'Sent in 10 s. Click within 10 s to undo.',
      route: 'undo'
    });
  });

  it('Offer_DashboardOnScreen_NoToast_TheUndoBarSaysIt', () => {
    const { toasts, offer } = over(true);

    offer();

    expect(toasts.show).not.toHaveBeenCalled();
  });

  it('UndoneOrEnded_NoSecondToast', () => {
    const { undo, toasts, offer, expire } = over(false);

    offer();
    undo.run();
    offer('Stopped PF-2 · 37m');
    expire();

    // One per offer: the undo and the end of the window are not news.
    expect(toasts.show).toHaveBeenCalledTimes(2);
  });

  it('TwoOffers_ToastsEach', () => {
    const { toasts, offer, tick } = over(false);

    offer('Stopped MG-12 · 1h 24m');
    tick(1000);
    offer('Discarded PF-2 · 5m', 'discard');

    expect(toasts.show).toHaveBeenCalledTimes(2);
    expect(toasts.show).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'Nothing kept or sent. Click within 10 s to undo.' }));
  });

  it('Stopped_NoMoreToasts', () => {
    const { toasts, offer, service } = over(false);

    service.stop();
    offer();

    expect(toasts.show).not.toHaveBeenCalled();
  });

  it.each([
    ['stop', 'Sent in 10 s. Click within 10 s to undo.'],
    ['end-day', 'Sent in 10 s. Click within 10 s to undo.'],
    ['discard', 'Nothing kept or sent. Click within 10 s to undo.'],
    ['keep-off', 'Click within 10 s to undo.']
  ] as const)('DescribeUndoToast_%s', (kind, body) => {
    expect(describeUndoToast({ kind, label: 'L' }, 10)).toEqual({ title: 'L', body, route: 'undo' });
  });
});
