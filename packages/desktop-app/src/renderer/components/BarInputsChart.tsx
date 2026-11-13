import React, { useEffect, useState } from 'react';
import { BAR_INPUT_LANES, BarInputDTO, barInputDidNothing, barInputOutcomeWord } from '../../shared/bar-input';

/** The minute the chart shows, newest at the right. */
export const BAR_INPUTS_WINDOW_MS = 60_000;
/** How many inputs the list beneath keeps. */
const INPUTS_KEPT = 100;
/** How often the chart slides while it has something to show. */
const TICK_MS = 1000;

// The drawing, in viewBox units: it scales with the row, the dots with it.
const W = 560;
const LABEL_W = 48;
const PLOT_LEFT = LABEL_W + 8;
const PLOT_RIGHT = W - 10;
const LANE_H = 24;
const TOP = 8;
const AXIS_H = 18;
const H = TOP + BAR_INPUT_LANES.length * LANE_H + AXIS_H;
const DOT_R = 4.5;
const HIT_R = 11;

const laneY = (index: number): number => TOP + index * LANE_H + LANE_H / 2;
const xOf = (ageMs: number): number => PLOT_RIGHT - (ageMs / BAR_INPUTS_WINDOW_MS) * (PLOT_RIGHT - PLOT_LEFT);

/** To the millisecond, which tells Pause twice from two Pauses: 4:50:14.029 PM. */
function clock(atMs: number): string {
  return new Date(atMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

/** The input's name on the bar, with a turn's direction. */
function inputName(input: BarInputDTO): string {
  const lane = BAR_INPUT_LANES.find(l => l.input === input.input);
  if (input.input === 'turn') return input.turn === -1 ? 'Turn left' : 'Turn right';
  return lane?.label ?? input.key;
}

/**
 * The bar's inputs over the last minute, one lane per input (Settings ›
 * Desk devices). A filled mark did something, a hollow one arrived and did
 * nothing -- a Back, an answer held off while the screen settled -- so
 * "ignored" and "never arrived" look different. A turn is a triangle
 * pointing its way. No colour: in this window colour means running,
 * waiting or danger, and an input is none of them.
 */
export const BarInputsChart: React.FC = () => {
  const [inputs, setInputs] = useState<BarInputDTO[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [hovered, setHovered] = useState<BarInputDTO | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.onBarInput) return undefined;
    return window.electronAPI.onBarInput(input => {
      setInputs(prev => [...prev, input].slice(-INPUTS_KEPT));
      setNow(Date.now());
    });
  }, []);

  const recent = inputs.filter(i => now - i.atMs <= BAR_INPUTS_WINDOW_MS);

  // Slides only while there is something in the minute: an empty chart
  // redraws nothing.
  const sliding = recent.length > 0;
  useEffect(() => {
    if (!sliding) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [sliding]);

  const tip = hovered && recent.includes(hovered) ? hovered : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4 text-[11px] text-text-secondary" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" className="fill-text-primary" /></svg>
          did something
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.5" className="fill-dark-900 stroke-text-secondary" strokeWidth="1.5" /></svg>
          did nothing
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 1 L9 5 L2 9 Z" className="fill-text-primary" /></svg>
          turn, its way
        </span>
      </div>

      <div className="relative rounded-lg border border-border-dark bg-dark-900">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full"
          role="group"
          aria-label={`Inputs from the bar in the last minute: ${recent.length}`}
        >
          {BAR_INPUT_LANES.map((lane, index) => (
            <g key={lane.input}>
              <text x={LABEL_W} y={laneY(index) + 3.5} textAnchor="end" className="fill-text-secondary text-[11px]">{lane.label}</text>
              <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={laneY(index)} y2={laneY(index)} className="stroke-border-dark" strokeWidth="1" />
            </g>
          ))}

          {[60, 45, 30, 15, 0].map(seconds => (
            <text key={seconds} x={xOf(seconds * 1000)} y={H - 5} textAnchor={seconds === 0 ? 'end' : 'middle'} className="fill-text-muted text-[10px]">
              {seconds === 0 ? 'now' : seconds === 60 ? '60 s ago' : `${seconds} s`}
            </text>
          ))}

          {recent.length === 0 && (
            <text x={(PLOT_LEFT + PLOT_RIGHT) / 2} y={TOP + (BAR_INPUT_LANES.length * LANE_H) / 2 + 4} textAnchor="middle" className="fill-text-muted text-[12px]">
              Nothing in the last minute. Press a key on the bar.
            </text>
          )}

          {recent.map((input, i) => {
            const lane = BAR_INPUT_LANES.findIndex(l => l.input === input.input);
            if (lane < 0) return null;
            const x = xOf(now - input.atMs);
            const y = laneY(lane);
            const acted = !barInputDidNothing(input.outcome);
            const label = `${clock(input.atMs)}, ${inputName(input)}: ${barInputOutcomeWord(input.outcome)}`;
            const mark = input.input === 'turn'
              ? <path d={input.turn === -1 ? `M${x + 4} ${y - 5} L${x - 5} ${y} L${x + 4} ${y + 5} Z` : `M${x - 4} ${y - 5} L${x + 5} ${y} L${x - 4} ${y + 5} Z`} />
              : <circle cx={x} cy={y} r={acted ? DOT_R : DOT_R - 0.75} />;
            return (
              <g
                key={`${input.atMs}-${i}`}
                tabIndex={0}
                role="img"
                aria-label={label}
                onMouseEnter={() => setHovered(input)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(input)}
                onBlur={() => setHovered(null)}
                className={`focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus ${acted ? 'fill-text-primary stroke-dark-900' : 'fill-dark-900 stroke-text-secondary'}`}
                strokeWidth={acted ? 2 : 1.5}
              >
                <circle cx={x} cy={y} r={HIT_R} className="fill-transparent stroke-transparent" />
                {mark}
              </g>
            );
          })}
        </svg>

        {tip && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border-dark bg-dark-800 px-2 py-1 text-[11px] shadow-lg"
            style={{
              left: `${(xOf(now - tip.atMs) / W) * 100}%`,
              top: `${((laneY(BAR_INPUT_LANES.findIndex(l => l.input === tip.input)) - HIT_R) / H) * 100}%`
            }}
          >
            <span className="font-semibold text-text-primary">{barInputOutcomeWord(tip.outcome)}</span>
            <span className="text-text-secondary"> · {inputName(tip)} · {clock(tip.atMs)}</span>
          </div>
        )}
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-text-secondary hover:text-text-primary">As a list</summary>
        <ol aria-label="Inputs from the bar" className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border-dark bg-dark-900 p-2 font-mono text-[11px]">
          {inputs.length === 0 ? (
            <li className="text-text-muted">Nothing yet. Press a key on the bar.</li>
          ) : [...inputs].reverse().map((input, i) => (
            <li key={`${input.atMs}-${i}`} className="text-text-primary">
              <span className="text-text-muted">{clock(input.atMs)}</span> {inputName(input)}{' '}
              <span className="text-text-secondary">→ {barInputOutcomeWord(input.outcome)}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
};
