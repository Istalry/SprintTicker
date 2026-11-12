import React, { useEffect, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { DeviceConfigDTO } from '../../../shared/dtos';
import { DEFAULT_DEVICE_CONFIG, isValidDeviceHost } from '../../../shared/device-constants';
import { DeskDetectionDTO } from '../../../shared/first-run';
import { StepFrame, choiceCard, fieldClass, primaryButton, secondaryButton } from './StepFrame';
import { ipcErrorMessage } from '../../utils/formatters';

const warn = (what: string) => (err: unknown) => console.warn(`[FirstRun] ${what} failed:`, err);

/** How often S2 looks again for a deck while the plugin is being installed. */
export const DECK_POLL_MS = 2000;

/**
 * S2, what's on your desk? The bar and the Stream Deck, both optional. Only
 * a device that was found starts ticked; nothing found is said in one line.
 * Continue writes the bar's choice -- unticked is the no-bar mode, reversible
 * in Settings › Desk devices. The deck has nothing to save: the plugin
 * finds the app on its own.
 */
export const YourDeskStep: React.FC<{ onBack: () => void; onNext: () => void }> = ({ onBack, onNext }) => {
  const [found, setFound] = useState<DeskDetectionDTO | null>(null);
  const [saved, setSaved] = useState<DeviceConfigDTO>(DEFAULT_DEVICE_CONFIG);
  const [bar, setBar] = useState(false);
  const [deck, setDeck] = useState(false);
  const [wifi, setWifi] = useState(false);
  const [address, setAddress] = useState('');
  const [deckConnected, setDeckConnected] = useState(false);
  const [pluginNote, setPluginNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    let live = true;
    api.detectDesk()
      .then(desk => {
        if (!live || !desk) return;
        setFound(desk);
        setBar(desk.bar.found);
        setDeck(desk.deck.installed || desk.deck.connected);
        setDeckConnected(desk.deck.connected);
      })
      .catch(warn('Looking for devices'));
    api.getDeviceConfig()
      .then(config => { if (live) setSaved(config); })
      .catch(warn('Reading the bar settings'));
    return () => { live = false; };
  }, []);

  // While the plugin is being installed, the line turns green once a deck
  // connects to the app's socket.
  useEffect(() => {
    if (!deck || deckConnected) return undefined;
    const timer = setInterval(() => {
      window.electronAPI.detectDesk()
        .then(desk => { if (desk?.deck.connected) setDeckConnected(true); })
        .catch(warn('Looking for the deck'));
    }, DECK_POLL_MS);
    return () => clearInterval(timer);
  }, [deck, deckConnected]);

  const installPlugin = () => {
    setPluginNote(null);
    window.electronAPI.installDeckPlugin()
      .then(opened => setPluginNote(opened
        ? 'Stream Deck asks to install it. Accept, and this line turns green.'
        : 'The plugin is not in this build: get it from the release page, or in Settings › Desk devices later.'))
      .catch(err => setPluginNote(`Could not open the plugin: ${ipcErrorMessage(err)}`));
  };

  const addressValid = !wifi || isValidDeviceHost(address.trim());

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next: DeviceConfigDTO = {
        ...saved,
        enabled: bar,
        ...(bar && wifi ? { ipAddress: address.trim() } : {})
      };
      // Only when it changed: saving re-dials the bar.
      const changed = next.enabled !== (saved.enabled !== false) || next.ipAddress !== saved.ipAddress;
      if (changed && !(await window.electronAPI.setDeviceConfig(next))) throw new Error('the bar setting was not saved');
      onNext();
    } catch (err) {
      setError(`Not saved: ${ipcErrorMessage(err)}. You can change it in Settings › Desk devices.`);
    } finally {
      setSaving(false);
    }
  };

  const barLine = found?.bar.found
    ? `One was found on ${found.bar.connectionType === 'wifi' ? `your network, at ${found.bar.address}` : 'USB'}, so it is ticked.`
    : 'None was found on USB.';
  const deckLine = deckConnected
    ? null
    : found?.deck.installed
      ? 'Stream Deck is installed on this computer.'
      : 'Not found on this computer.';
  const neither = !bar && !deck;

  return (
    <StepFrame
      step={2}
      title="What's on your desk?"
      intro="Optional extras: a display that shows your timer at a glance, and keys that start, stop and interrupt in one press. SprintTicker works fully without them."
      error={error}
      footer={
        <>
          <button type="button" className={secondaryButton} onClick={onBack}>Back</button>
          <span className="flex-1" />
          <button type="button" className={primaryButton} disabled={saving || !addressValid} onClick={() => void save()}>
            Continue
          </button>
        </>
      }
    >
      <div className={choiceCard(bar)}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={bar} onChange={e => setBar(e.target.checked)} />
          <span>
            <span className="block text-sm font-semibold text-white">A BUSY Bar</span>
            <span className="block text-xs text-text-secondary">
              A small LED display for your desk that shows your task and time. {barLine}
            </span>
          </span>
        </label>
        {bar && !found?.bar.found && (
          <div className="mt-2 pl-7 space-y-2">
            {!wifi ? (
              <button type="button" className="text-xs text-text-primary underline hover:text-white" onClick={() => setWifi(true)}>
                Mine is on Wi-Fi
              </button>
            ) : (
              <label className="block text-xs text-text-secondary">
                Its address on your network
                <input className={`${fieldClass} mt-1`} value={address} onChange={e => setAddress(e.target.value)} placeholder="192.168.1.42" />
                {!addressValid && address.trim() !== '' && (
                  <span role="alert" className="block mt-1 text-accent-red">An address is letters, digits, dots and dashes only.</span>
                )}
              </label>
            )}
          </div>
        )}
      </div>

      <div className={choiceCard(deck)}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={deck} onChange={e => setDeck(e.target.checked)} />
          <span>
            <span className="block text-sm font-semibold text-white">A Stream Deck</span>
            <span className="block text-xs text-text-secondary">
              {`Elgato's programmable keys.${deckLine ? ` ${deckLine}` : ''}`}
            </span>
          </span>
        </label>
        {deck && (
          <div className="mt-2 pl-7 space-y-1">
            {deckConnected ? (
              <span role="status" className="flex items-center gap-1.5 text-xs text-accent-green">
                <CircleCheck className="w-4 h-4" aria-hidden="true" /> A deck is connected: its keys drive SprintTicker.
              </span>
            ) : (
              <button type="button" className={secondaryButton} onClick={installPlugin}>Install the plugin</button>
            )}
            {pluginNote && !deckConnected && <p className="text-xs text-text-secondary">{pluginNote}</p>}
          </div>
        )}
      </div>

      <div className={choiceCard(neither)}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={neither}
            onChange={e => {
              if (!e.target.checked) return;
              setBar(false);
              setDeck(false);
            }}
          />
          <span>
            <span className="block text-sm font-semibold text-white">I have neither</span>
            <span className="block text-xs text-text-secondary">Nothing to set up. Add one later, in Settings › Desk devices.</span>
          </span>
        </label>
      </div>
    </StepFrame>
  );
};
