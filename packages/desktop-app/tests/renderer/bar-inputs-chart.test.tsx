import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { BarInputsChart, BAR_INPUTS_WINDOW_MS } from '../../src/renderer/components/BarInputsChart';
import { DeviceSettings } from '../../src/renderer/views/Settings/DeviceSettings';
import { SettingSwitch } from '../../src/renderer/components/SettingRow';
import type { BarInputDTO } from '../../src/shared/bar-input';
import { installElectronApi } from './electron-api-mock';

const input = (over: Partial<BarInputDTO> = {}): BarInputDTO => ({
  input: 'pause', turn: null, key: 'start', outcome: 'PAUSE_SESSION', atMs: Date.now(), ...over
});

/**
 * The bar's inputs as a chart (Settings › Desk devices, the user's request
 * of 2026-11-13): every input of the last minute on its lane, filled when it
 * did something and hollow when it did nothing.
 */
describe('the chart of the bar\'s inputs', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Render_NothingYet_SaysPressAKey', () => {
    installElectronApi();
    render(<BarInputsChart />);

    expect(screen.getByText('Nothing in the last minute. Press a key on the bar.')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Inputs from the bar in the last minute: 0' })).toBeTruthy();
  });

  it('Input_APause_AMarkNamedForWhatItDid', () => {
    const bridge = installElectronApi();
    render(<BarInputsChart />);

    act(() => bridge.emit('onBarInput', input()));

    const chart = screen.getByRole('group', { name: 'Inputs from the bar in the last minute: 1' });
    expect(within(chart).getByRole('img', { name: /Pause: Pause$/ })).toBeTruthy();
  });

  it('Input_ABackThatDidNothing_IsShownHollow', () => {
    // Back reached no action handler, so the old list never showed it: a
    // trial could not tell an ignored press from one that never arrived.
    const bridge = installElectronApi();
    render(<BarInputsChart />);

    act(() => bridge.emit('onBarInput', input({ input: 'back', key: 'back', outcome: 'NONE' })));

    const mark = screen.getByRole('img', { name: /Back: Nothing$/ });
    expect(mark.getAttribute('class')).toMatch(/fill-dark-900/);
  });

  it('Input_ATurnLeft_SaysItsWay', () => {
    const bridge = installElectronApi();
    render(<BarInputsChart />);

    act(() => bridge.emit('onBarInput', input({ input: 'turn', turn: -1, key: 'rotate_left', outcome: 'OPEN_MENU' })));

    expect(screen.getByRole('img', { name: /Turn left: Menu opened$/ })).toBeTruthy();
  });

  it('Hover_AMark_TooltipSaysWhatItDid', () => {
    const bridge = installElectronApi();
    render(<BarInputsChart />);
    act(() => bridge.emit('onBarInput', input({ input: 'click', key: 'ok', outcome: 'START_INTERRUPTION' })));

    fireEvent.mouseEnter(screen.getByRole('img', { name: /Click: Interrupt$/ }));

    expect(screen.getByRole('tooltip').textContent).toMatch(/Interrupt · Click/);
  });

  it('AMinutePasses_TheMarkLeavesTheChart_TheListKeepsIt', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const bridge = installElectronApi();
    render(<BarInputsChart />);
    act(() => bridge.emit('onBarInput', input()));

    act(() => { vi.advanceTimersByTime(BAR_INPUTS_WINDOW_MS + 2000); });

    expect(screen.queryByRole('img', { name: /Pause/ })).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Inputs from the bar' })).getByText(/→ Pause/)).toBeTruthy();
  });
});

describe('Bar health in Desk devices', () => {
  it('DeskDevices_WithABar_BarHealthOpensOnTheChart', async () => {
    installElectronApi();
    render(<DeviceSettings />);

    const row = await screen.findByRole('group', { name: 'Bar health' });
    fireEvent.click(within(row).getByRole('button', { name: 'Open…' }));

    expect(screen.getByRole('group', { name: /Inputs from the bar in the last minute/ })).toBeTruthy();
  });
});

describe('SettingSwitch', () => {
  it('Render_TheHiddenCheckboxIsHeldInsideTheSwitch', () => {
    // `sr-only` is absolute: with no positioned parent the checkbox sat where
    // it would be on an unscrolled page, and the focus a click gives it
    // scrolled the whole window, sliding the app off the top (2.0 candidate,
    // 2026-11-13). jsdom has no layout, so the rule is held here.
    render(<SettingSwitch label="Show developer tools" checked={false} onChange={() => undefined} />);

    const label = screen.getByRole('switch', { name: 'Show developer tools' }).closest('label');
    expect(label?.className.split(' ')).toContain('relative');
  });
});
