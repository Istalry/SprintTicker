import React, { useEffect, useState } from 'react';
import { DeviceStatusDTO } from '../../shared/dtos';
import { formatClockTime } from '../utils/formatters';

/** How many of the bar's inputs the console keeps. */
const INPUTS_KEPT = 20;

interface InputLine { time: string; key: string; action: string }

/**
 * The bar's health (S24, Developer): the figures that came before every
 * measured hang of firmware 1.2.4 -- the upload median, screen closes, skipped
 * requests, the longest queue -- and the inputs the bar sent, as they arrive.
 */
export const BarHealth: React.FC<{ status: DeviceStatusDTO }> = ({ status }) => {
  const [inputs, setInputs] = useState<InputLine[]>([]);
  const health = status.displayHealth;

  useEffect(() => {
    if (!window.electronAPI?.onHardwareInputEvent) return undefined;
    return window.electronAPI.onHardwareInputEvent(event => {
      const now = new Date();
      const time = `${formatClockTime(now)}.${String(now.getMilliseconds()).padStart(3, '0')}`;
      setInputs(prev => [...prev, { time, key: event.inputKey, action: event.actionAssigned }].slice(-INPUTS_KEPT));
    });
  }, []);

  const figures: ReadonlyArray<[string, string, boolean]> = [
    ['Upload time (median)', health.uploadMedianMs === null ? 'No uploads yet' : `${health.uploadMedianMs} ms`, health.latencyWarning],
    ['Screen closes, last hour', String(health.screenClosesLastHour), false],
    ['Requests not needed (skipped)', String(health.requestsSkipped), false],
    ['Longest request queue', String(health.maxQueueLength), false],
    ['Ping', status.connected ? `${status.webSocketPingMs} ms` : 'Not connected', false]
  ];

  return (
    <div className="space-y-3">
      {health.latencyWarning && (
        <p role="alert" className="text-xs text-accent-red">
          Uploads to the bar are slow. On firmware 1.2.4 they slowed like this before every freeze that was
          measured. If the bar stops answering, export the logs (Settings › Data) before restarting it.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
        {figures.map(([label, value, warn]) => (
          <div key={label} className="flex items-center justify-between border-b border-border-dark/60 py-1">
            <dt className="text-text-secondary">{label}</dt>
            <dd className={`font-mono ${warn ? 'text-accent-red' : 'text-text-primary'}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="mb-1 text-xs font-semibold text-text-primary">Inputs from the bar</p>
        <div aria-label="Inputs from the bar" className="h-32 space-y-0.5 overflow-y-auto rounded-lg border border-border-dark bg-dark-900 p-2 font-mono text-[11px]">
          {inputs.length === 0 ? (
            <p className="text-text-muted">Nothing yet. Press a key on the bar.</p>
          ) : inputs.map((line, i) => (
            <p key={i} className="text-text-primary">
              <span className="text-text-muted">{line.time}</span> {line.key.toUpperCase()}{' '}
              <span className="text-text-secondary">→ {line.action}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
};
