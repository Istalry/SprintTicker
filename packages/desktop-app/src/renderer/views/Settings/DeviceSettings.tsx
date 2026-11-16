import React, { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useDeviceStatus } from '../../hooks/useDeviceStatus';
import { useNotificationListenerStatus, useNotificationSettings } from '../../hooks/useNotificationSettings';
import { ColorThemeId, DeviceConfigDTO, DeviceStatusDTO } from '../../../shared/dtos';
import { DeskDetectionDTO } from '../../../shared/first-run';
import { COLOR_THEMES, DEFAULT_COLOR_THEME } from '../../../shared/color-theme';
import { DEFAULT_DEVICE_CONFIG, DEFAULT_USB_IP, isValidDeviceHost } from '../../../shared/device-constants';
import { NotificationAppRules } from '../../components/NotificationAppRules';
import { BarHealth } from '../../components/BarHealth';
import { BarControls } from '../../components/BarControls';
import { PriorityRulesView } from '../Priority/PriorityRulesView';
import { ipcErrorMessage } from '../../utils/formatters';
import { useAnnounce } from '../../components/LiveAnnouncer';
import {
  SETTING_SELECT_CLASS, SettingButton, SettingProblem, SettingRow, SettingSwitch, SettingsList
} from '../../components/SettingRow';

/** How often the deck's line is read again: a plugin installed meanwhile turns it green. */
export const DECK_STATUS_POLL_MS = 3000;
/** How long a notification stays on the bar, in seconds; a stored one outside the list shows as itself. */
const NOTIFICATION_SECONDS = [3, 5, 10, 15, 20, 30, 60];
/** How often Windows' notifications are read, in seconds. */
const POLL_SECONDS = [1, 2, 3, 5, 10];
const DECK_KEYS = 'Session, Interrupt, and the answer keys A, B and C';

const withStored = (choices: readonly number[], stored: number): number[] =>
  choices.includes(stored) ? [...choices] : [...choices, stored].sort((a, b) => a - b);

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The bar's line: where it answers, and what it reports. */
function barLine(status: DeviceStatusDTO): { title: string; description: string } {
  if (!status.connected) {
    return {
      title: `Not answering at ${status.ipAddress}`,
      description: 'SprintTicker keeps trying. Check the cable, or the address under Connection.'
    };
  }
  const facts = [`Firmware ${status.firmwareVersion}`, `battery ${status.batteryPercent} %`];
  if (status.frontBrightness !== null) facts.push(`brightness ${status.frontBrightness} %`);
  return {
    // "Not the USB default" is all the driver can tell: a proxied bar on USB
    // reads as an address too, so the address is what is said.
    title: status.connectionType === 'usb' ? 'Connected on USB' : `Connected at ${status.ipAddress}`,
    description: facts.join(' · ')
  };
}

/**
 * Settings · Desk devices (S22): the BUSY Bar and the Stream Deck, each a
 * block of rows. Without a bar its block is one line with Add, and nothing
 * else on the page changes.
 */
export const DeviceSettings: React.FC = () => {
  const deviceStatus = useDeviceStatus();
  const [config, setConfig] = useState<DeviceConfigDTO | null>(null);
  const [barProblem, setBarProblem] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.getDeviceConfig?.()
      .then(setConfig, (err: unknown) => setBarProblem(`Could not read the bar's settings: ${ipcErrorMessage(err)}`));
  }, []);

  /** Saves the bar's settings; a refusal is said under the bar's line and nothing changes here. */
  const saveConfig = async (next: DeviceConfigDTO): Promise<boolean> => {
    setBarProblem(null);
    try {
      await window.electronAPI.setDeviceConfig(next);
      setConfig(next);
      return true;
    } catch (err) {
      setBarProblem(ipcErrorMessage(err));
      return false;
    }
  };

  return (
    <div className="space-y-6">
      <section aria-labelledby="desk-bar" className="space-y-2">
        <h3 id="desk-bar" className="text-xs font-semibold uppercase tracking-wide text-text-secondary">BUSY Bar</h3>
        {deviceStatus.enabled ? (
          <BarBlock status={deviceStatus} config={config} problem={barProblem} onSave={saveConfig} />
        ) : (
          <SettingsList label="BUSY Bar">
            <SettingRow
              title="No bar on this computer"
              description="SprintTicker works without one. Add brings your bar back, with the address and token you used before."
              control={
                <SettingButton tone="primary" disabled={!config} onClick={() => { if (config) void saveConfig({ ...config, enabled: true }); }}>
                  Add
                </SettingButton>
              }
            >
              {barProblem && <SettingProblem>{barProblem}</SettingProblem>}
            </SettingRow>
          </SettingsList>
        )}
      </section>

      <section aria-labelledby="desk-deck" className="space-y-2">
        <h3 id="desk-deck" className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Stream Deck</h3>
        <DeckBlock />
      </section>
    </div>
  );
};

const BarBlock: React.FC<{
  status: DeviceStatusDTO;
  config: DeviceConfigDTO | null;
  problem: string | null;
  onSave: (next: DeviceConfigDTO) => Promise<boolean>;
}> = ({ status, config, problem, onSave }) => {
  const [colorTheme, setColorTheme] = useState<ColorThemeId>(DEFAULT_COLOR_THEME);
  const [colorProblem, setColorProblem] = useState<string | null>(null);
  const [showApps, setShowApps] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const notifications = useNotificationSettings();
  const listener = useNotificationListenerStatus();

  // The stored colour, so the list opens on it rather than on the first entry.
  useEffect(() => {
    window.electronAPI?.getColorTheme?.().then(setColorTheme, err => console.error('[DeviceSettings] getColorTheme failed:', err));
  }, []);

  const line = barLine(status);
  const { settings } = notifications;
  const known = settings.sourceRules.length;
  const needsAccess = settings.enableListener && listener !== null && !listener.isListening;
  const notificationsSay = !settings.enableListener
    ? 'Off: nothing from Windows reaches the bar.'
    : needsAccess
      ? `Windows access needed, then choose which apps show: ${plural(known, 'app')} known.`
      : `Choose which apps show: ${plural(known, 'app')} known.`;

  return (
    <SettingsList label="The bar">
      <SettingRow
        title={line.title}
        description={line.description}
        control={
          <SettingButton tone="ghost" title="Stops dialling the bar and hides its screens. Add it back here at any time."
            disabled={!config} onClick={() => { if (config) void onSave({ ...config, enabled: false }); }}>
            Use without a bar
          </SettingButton>
        }
      >
        {problem && <SettingProblem>{problem}</SettingProblem>}
      </SettingRow>

      <SettingRow
        title="Task key color"
        description="The color of the task key on the bar."
        control={
          <select
            aria-label="Task key color"
            value={colorTheme}
            onChange={e => {
              const next = e.target.value as ColorThemeId;
              const previous = colorTheme;
              setColorTheme(next);
              setColorProblem(null);
              window.electronAPI.setColorTheme(next).catch((err: unknown) => {
                setColorTheme(previous);
                setColorProblem(`Not changed: ${ipcErrorMessage(err)}`);
              });
            }}
            className={SETTING_SELECT_CLASS}
          >
            {COLOR_THEMES.map(theme => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
          </select>
        }
      >
        {colorProblem && <SettingProblem>{colorProblem}</SettingProblem>}
      </SettingRow>

      <SettingRow
        title="When nothing runs"
        description={config?.showIdleClockFallback === false
          ? "SprintTicker keeps its own idle screen on the bar."
          : 'The bar shows its own clock. A question ("Back to MG-12?") or NOTHING TIMING in working hours stays on it until answered.'}
        control={
          <SettingSwitch
            label="Show the bar's own clock when nothing runs"
            checked={config?.showIdleClockFallback ?? DEFAULT_DEVICE_CONFIG.showIdleClockFallback}
            disabled={!config}
            onChange={on => { if (config) void onSave({ ...config, showIdleClockFallback: on }); }}
          />
        }
      />

      <SettingRow
        title="Windows notifications on the bar"
        description={notificationsSay}
        control={
          <>
            {needsAccess && (
              <SettingButton tone="primary" onClick={() => { void window.electronAPI.openNotificationSettings(); }}>
                Grant access
              </SettingButton>
            )}
            {settings.enableListener && (
              <SettingButton aria-expanded={showApps} onClick={() => setShowApps(v => !v)}>Choose apps…</SettingButton>
            )}
            <SettingSwitch
              label="Show Windows notifications on the bar"
              checked={settings.enableListener}
              onChange={on => notifications.setSettings(prev => ({ ...prev, enableListener: on }))}
            />
          </>
        }
      >
        {settings.enableListener && showApps && <NotificationAppRules store={notifications} />}
        {notifications.saveStatus === 'error' && <SettingProblem>Could not save the notification settings.</SettingProblem>}
      </SettingRow>

      <SettingRow
        title="What the bar shows first"
        description="When two things want it: a call, a message, your timer. Levels and arrows, per mode."
        control={<SettingButton aria-expanded={showRules} onClick={() => setShowRules(v => !v)}>{showRules ? 'Close' : 'Open…'}</SettingButton>}
      >
        {showRules && <PriorityRulesView embedded />}
      </SettingRow>

      <SettingRow
        title="Bar controls"
        description="What Pause, the wheel and Back do, and how to mark a task done from the bar."
        control={<SettingButton aria-expanded={showControls} onClick={() => setShowControls(v => !v)}>{showControls ? 'Close' : 'Show…'}</SettingButton>}
      >
        {showControls && <BarControls />}
      </SettingRow>

      <SettingRow
        title="Bar health"
        description="The inputs the bar sends, live, and how quickly it answers."
        control={<SettingButton aria-expanded={showHealth} onClick={() => setShowHealth(v => !v)}>{showHealth ? 'Close' : 'Open…'}</SettingButton>}
      >
        {showHealth && <BarHealth status={status} />}
      </SettingRow>

      <SettingRow
        title="Connection"
        description={`Address ${config?.ipAddress ?? '…'}${config?.apiToken ? ', with a token' : ''}. How long a notification stays, and how often Windows is read.`}
        control={<SettingButton aria-expanded={showConnection} onClick={() => setShowConnection(v => !v)}>{showConnection ? 'Close' : 'Change…'}</SettingButton>}
      >
        {showConnection && config && (
          <ConnectionFields
            config={config}
            onSave={onSave}
            notificationSeconds={settings.notificationTimeoutSeconds || 10}
            pollSeconds={settings.pollingIntervalSeconds || 2}
            onTimings={change => notifications.setSettings(prev => ({ ...prev, ...change }))}
          />
        )}
      </SettingRow>
    </SettingsList>
  );
};

const fieldClass = 'w-full rounded-lg border bg-dark-900 px-2.5 py-1.5 text-sm text-text-primary focus:outline-none focus:border-focus';

/**
 * The address and token are a draft, applied on Save and reconnect: saving
 * per keystroke would tear down and redial the bar once per character.
 */
const ConnectionFields: React.FC<{
  config: DeviceConfigDTO;
  onSave: (next: DeviceConfigDTO) => Promise<boolean>;
  notificationSeconds: number;
  pollSeconds: number;
  onTimings: (change: { notificationTimeoutSeconds?: number; pollingIntervalSeconds?: number }) => void;
}> = ({ config, onSave, notificationSeconds, pollSeconds, onTimings }) => {
  const [address, setAddress] = useState(config.ipAddress);
  const [token, setToken] = useState(config.apiToken);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  useAnnounce(saved, saved ?? '');

  const addressValid = isValidDeviceHost(address.trim());
  const dirty = address.trim() !== config.ipAddress || token !== config.apiToken;

  const apply = async () => {
    setApplying(true);
    setSaved(null);
    const next = { ...config, ipAddress: address.trim(), apiToken: token };
    // Deliberately not "Connected": this resolves once the setting is saved
    // and the redial started. Whether the bar answered is the line above.
    if (await onSave(next)) setSaved(`Saved. Now dialling ${next.ipAddress}: the line above says when the bar answers.`);
    setApplying(false);
  };

  return (
    <div className="space-y-3 rounded-lg border border-border-dark bg-dark-900/60 p-3">
      <p className="text-[11px] text-text-secondary">
        Over USB the bar answers on <span className="font-mono">{DEFAULT_USB_IP}</span>. Change it for a bar on Wi-Fi, or one
        reached through a proxy when the USB network will not start.
      </p>
      <label className="block text-[11px] text-text-secondary">
        Address
        <input
          type="text"
          value={address}
          spellCheck={false}
          onChange={e => { setAddress(e.target.value); setSaved(null); }}
          placeholder={DEFAULT_USB_IP}
          aria-invalid={address.length > 0 && !addressValid}
          aria-describedby={address.length > 0 && !addressValid ? 'device-address-error' : undefined}
          className={`${fieldClass} mt-1 font-mono ${address.length > 0 && !addressValid ? 'border-accent-red' : 'border-border-field'}`}
        />
      </label>
      {address.length > 0 && !addressValid && (
        <div id="device-address-error">
          <SettingProblem>An IPv4 address or a host name only: no http://, port or path.</SettingProblem>
        </div>
      )}
      <label htmlFor="device-token" className="block text-[11px] text-text-secondary">
        Token, for a bar on Wi-Fi with access protection; empty over USB
      </label>
      <div>
        <span className="mt-1 flex items-center gap-2">
          <input
            id="device-token"
            type={tokenVisible ? 'text' : 'password'}
            value={token}
            spellCheck={false}
            autoComplete="off"
            onChange={e => { setToken(e.target.value); setSaved(null); }}
            className={`${fieldClass} border-border-field font-mono`}
          />
          <button type="button" onClick={() => setTokenVisible(v => !v)} aria-label={tokenVisible ? 'Hide token' : 'Show token'}
            className="rounded border border-border-dark p-1.5 text-text-secondary hover:text-text-primary">
            {tokenVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SettingButton tone="primary" disabled={!dirty || !addressValid || applying} onClick={() => { void apply(); }}>
          {applying ? 'Reconnecting…' : 'Save and reconnect'}
        </SettingButton>
        {address.trim() !== DEFAULT_USB_IP && (
          <SettingButton tone="ghost" onClick={() => { setAddress(DEFAULT_USB_IP); setSaved(null); }}>Back to USB default</SettingButton>
        )}
      </div>
      {saved && <p className="text-[11px] text-accent-green">{saved}</p>}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border-dark pt-3 text-[11px] text-text-secondary">
        <label className="flex items-center gap-2">
          A notification stays
          <select aria-label="How long a notification stays" value={notificationSeconds}
            onChange={e => onTimings({ notificationTimeoutSeconds: Number(e.target.value) })} className={SETTING_SELECT_CLASS}>
            {withStored(NOTIFICATION_SECONDS, notificationSeconds).map(s => <option key={s} value={s}>{s} s</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Windows is read every
          <select aria-label="How often Windows is read" value={pollSeconds}
            onChange={e => onTimings({ pollingIntervalSeconds: Number(e.target.value) })} className={SETTING_SELECT_CLASS}>
            {withStored(POLL_SECONDS, pollSeconds).map(s => <option key={s} value={s}>{s} s</option>)}
          </select>
        </label>
      </div>
    </div>
  );
};

/** The deck's block: one line, read again every few seconds so an install shows. */
const DeckBlock: React.FC = () => {
  const [desk, setDesk] = useState<DeskDetectionDTO | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useAnnounce(note, note ?? '');

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.detectDesk) return undefined;
    let live = true;
    const read = () => {
      api.detectDesk()
        .then(value => { if (live) setDesk(value); })
        .catch(err => console.warn('[DeviceSettings] Could not look for the deck:', err));
    };
    read();
    const timer = setInterval(read, DECK_STATUS_POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, []);

  const install = () => {
    setNote(null);
    window.electronAPI.installDeckPlugin()
      .then(opened => setNote(opened
        ? 'Stream Deck asks to install it. Accept, and this line says Connected.'
        : 'The plugin is not in this build: get it from the release page.'))
      .catch((err: unknown) => setNote(`Could not open the plugin: ${ipcErrorMessage(err)}`));
  };

  const deck = desk?.deck;
  const row = deck?.connected
    ? { title: `Connected · ${plural(deck.count, 'deck')}`, description: `The SprintTicker plugin. Keys: ${DECK_KEYS}.`, button: 'Install the plugin again', tone: 'default' as const }
    : deck?.installed
      ? { title: 'Plugin not connected', description: `Stream Deck is installed. Install the plugin, then place its keys: ${DECK_KEYS}.`, button: 'Install the plugin', tone: 'primary' as const }
      : { title: 'No Stream Deck on this computer', description: "With Elgato's Stream Deck app, keys start, stop and interrupt in one press.", button: 'Add', tone: 'primary' as const };

  return (
    <SettingsList label="Stream Deck">
      <SettingRow
        title={desk ? row.title : 'Looking for Stream Deck…'}
        description={desk ? row.description : ''}
        control={desk ? <SettingButton tone={row.tone} onClick={install}>{row.button}</SettingButton> : undefined}
      >
        {note && <p className="text-[11px] text-text-secondary">{note}</p>}
      </SettingRow>
    </SettingsList>
  );
};
