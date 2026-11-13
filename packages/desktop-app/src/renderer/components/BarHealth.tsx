import React from 'react';
import { DeviceStatusDTO } from '../../shared/dtos';
import { BarInputsChart } from './BarInputsChart';

/**
 * The bar's health (Settings › Desk devices, once a bar is set up; it was
 * Developer's until the 2.0 candidate, the user's choice 2026-11-13): the
 * inputs the bar sends, as a chart of the last minute, and the figures that
 * came before every measured hang of firmware 1.2.4 -- the upload median,
 * screen closes, skipped requests, the longest queue.
 */
export const BarHealth: React.FC<{ status: DeviceStatusDTO }> = ({ status }) => {
  const health = status.displayHealth;

  const figures: ReadonlyArray<[string, string, boolean]> = [
    ['Upload time (median)', health.uploadMedianMs === null ? 'No uploads yet' : `${health.uploadMedianMs} ms`, health.latencyWarning],
    ['Screen closes, last hour', String(health.screenClosesLastHour), false],
    ['Requests not needed (skipped)', String(health.requestsSkipped), false],
    ['Longest request queue', String(health.maxQueueLength), false],
    ['Ping', status.connected ? `${status.webSocketPingMs} ms` : 'Not connected', false]
  ];

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-xs font-semibold text-text-primary">Inputs from the bar</p>
        <BarInputsChart />
      </div>
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
    </div>
  );
};
