import React, { useEffect, useRef, useState } from 'react';
import { HardwareDisplayStateDTO, DisplayElementDTO } from '../../shared/dtos';
import { DISPLAY_CONSTANTS } from '../../shared/render-constants';
import { computeMatrixDotSize, MATRIX_GAP, MATRIX_FRAME_CHROME } from './emulator-scaling';
import { useElementWidth } from '../hooks/useElementWidth';

/**
 * Physical Hardware Display Emulator Component.
 * Simulates physical 72x16 RGB LED front matrix display and 160x80 rear OLED screen
 * with 1:1 pixel-perfect diode rendering, realistic emissive LED bloom, and marquee scrolling.
 */
export const HardwareDisplayEmulator: React.FC = () => {
  const [displayState, setDisplayState] = useState<HardwareDisplayStateDTO | null>(null);
  const frontCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // The matrix is sized from the space the layout leaves for it, rather than
  // dictating the header's width as it used to. The measured element is the
  // slot the matrix sits in -- see useElementWidth on why it must not be an
  // ancestor of the canvas that the canvas itself can grow.
  const [matrixSlotRef, matrixSlotWidth] = useElementWidth<HTMLDivElement>();
  const dotSize = computeMatrixDotSize(matrixSlotWidth - MATRIX_FRAME_CHROME);

  useEffect(() => {
    // Fetch initial hardware display state
    if (window.electronAPI && window.electronAPI.getDisplayState) {
      window.electronAPI.getDisplayState().then((state) => {
        if (state) setDisplayState(state);
      }).catch(err => console.warn('[Emulator] Failed to fetch initial display state:', err));

      // Subscribe to real-time IPC display updates
      const unsubscribe = window.electronAPI.onDisplayStateUpdated((state) => {
        if (state) setDisplayState(state);
      });

      return () => {
        unsubscribe();
      };
    }
    // React accepts an undefined cleanup; state it explicitly for noImplicitReturns.
    return undefined;
  }, []);

  // Pre-load images from displayState
  useEffect(() => {
    if (!displayState) return;
    displayState.frontElements.forEach(el => {
      if (el.type === 'image' && el.data) {
        if (!imageCacheRef.current.has(el.data)) {
          const img = new Image();
          img.src = el.data;
          imageCacheRef.current.set(el.data, img);
        }
      }
    });
  }, [displayState]);

  /**
   * Builds the 72x16 colour buffer from what main actually sent.
   *
   * Only two element kinds reach here: 'rectangle', which is how
   * `canvasToEmulatorElements` ships a rasterised frame as one strip per colour
   * run, and 'bitmap'. There is deliberately no text branch -- main rasterises
   * text into pixels through PixelCanvas, and a second implementation here
   * disagreed with it on font metrics and drew layouts the device never
   * produced. Confetti likewise arrives as real pixels; the emulator used to
   * simulate its own particles on top of them.
   */
  const createPixelBuffer = (state: HardwareDisplayStateDTO | null): (string | null)[][] => {
    const buffer: (string | null)[][] = Array.from({ length: 16 }, () => Array(72).fill(null));
    if (!state) return buffer;

    state.frontElements.forEach((el: DisplayElementDTO) => {
      if (el.type === 'bitmap' && el.bitmapData) {
        const defaultColor = el.color || state.ledColorHex || '#10B981FF';
        el.bitmapData.forEach((row, rIdx) => {
          row.forEach((pixel, cIdx) => {
            const x = el.x + cIdx;
            const y = el.y + rIdx;
            if (x >= 0 && x < 72 && y >= 0 && y < 16 && pixel !== null && pixel !== 0 && pixel !== undefined) {
              buffer[y][x] = typeof pixel === 'string' ? pixel : defaultColor;
            }
          });
        });
      } else if (el.type === 'rectangle') {
        const fill = (el.fill_colors && el.fill_colors[0]) || el.fill || '#3B82F6FF';
        const w = el.width || 10;
        const h = el.height || 4;
        for (let r = 0; r < h; r++) {
          for (let c = 0; c < w; c++) {
            const x = el.x + c;
            const y = el.y + r;
            if (x >= 0 && x < 72 && y >= 0 && y < 16) {
              buffer[y][x] = fill;
            }
          }
        }
      }
    });

    return buffer;
  };

  // Render LED Matrix Diodes onto Front Canvas
  useEffect(() => {
    const canvas = frontCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gap = MATRIX_GAP;
    const cellSize = dotSize + gap;
    canvas.width = DISPLAY_CONSTANTS.FRONT_GRID_WIDTH * cellSize + gap;
    canvas.height = DISPLAY_CONSTANTS.FRONT_GRID_HEIGHT * cellSize + gap;

    const renderLoop = () => {
      const pixelBuffer = createPixelBuffer(displayState);

      // Dark Matte Bezel Matrix Background
      ctx.fillStyle = '#06080A';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let r = 0; r < 16; r++) {
        for (let c = 0; c < 72; c++) {
          const x = gap + c * cellSize;
          const y = gap + r * cellSize;
          const pixelColor = pixelBuffer[r][c];

          if (pixelColor) {
            // Lit LED Diode with Emissive Bloom
            ctx.shadowColor = pixelColor;
            ctx.shadowBlur = 4;
            ctx.fillStyle = pixelColor;
            ctx.beginPath();
            ctx.arc(x + dotSize / 2, y + dotSize / 2, dotSize / 2, 0, Math.PI * 2);
            ctx.fill();

            // Inner High-Brightness Diode Core
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#FFFFFFFF';
            ctx.beginPath();
            ctx.arc(x + dotSize / 2, y + dotSize / 2, dotSize / 4, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Dark Unlit LED Socket Well
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#11161C';
            ctx.beginPath();
            ctx.arc(x + dotSize / 2, y + dotSize / 2, dotSize / 2 - 0.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Draw loaded image overlays (e.g. PNG animations)
      if (displayState) {
        displayState.frontElements.forEach(el => {
          if (el.type === 'image' && el.data) {
            const img = imageCacheRef.current.get(el.data);
            if (img && img.complete) {
              // Draw image scaled to LED matrix grid
              ctx.shadowBlur = 0;
              ctx.globalAlpha = 1.0;
              // Ensure crisp pixel art rendering
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(img, gap + el.x * cellSize, gap + el.y * cellSize, img.width * cellSize, img.height * cellSize);
            }
          }
        });
      }

      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
    // dotSize belongs here: the canvas backing size is computed from it, so a
    // resize has to tear the render loop down and set it up again.
  }, [displayState, dotSize]);

  // Render Rear 160x80 OLED Screen Canvas
  useEffect(() => {
    const canvas = backCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = 1.2;
    canvas.width = DISPLAY_CONSTANTS.REAR_OLED_WIDTH * scale;
    canvas.height = DISPLAY_CONSTANTS.REAR_OLED_HEIGHT * scale;

    ctx.fillStyle = '#040608';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (!displayState) return;

    displayState.backElements.forEach((el: DisplayElementDTO) => {
      if (el.type === 'text' && el.text) {
        ctx.fillStyle = el.color || '#CCCCCC';
        ctx.font = el.font === 'bold' ? 'bold 11px sans-serif' : '9px monospace';
        ctx.fillText(el.text, el.x * scale + 4, (el.y + 12) * scale);
      }
    });
  }, [displayState]);

  const ledColor = displayState?.ledColorHex || '#10B981';
  const isAlert = displayState?.ledMode === 'PULSE_ALERT' || displayState?.ledMode === 'BREATHING';

  // Edge glow is decorative and not configurable: HardwareDisplayStateDTO has
  // never carried these fields, so the optional reads always fell through to
  // these same constants. Stated directly rather than implying a setting exists.
  const enableEdgeGlow = true;
  const edgeGlowOpacity = 0.3;
  const edgeGlowHex = displayState?.ledColorHex || '#38BDF8';
  const glowBoxShadow = enableEdgeGlow && edgeGlowOpacity > 0
    ? `0 0 16px rgba(${parseInt(edgeGlowHex.slice(1, 3) || '38', 16)}, ${parseInt(edgeGlowHex.slice(3, 5) || 'BD', 16)}, ${parseInt(edgeGlowHex.slice(5, 7) || 'F8', 16)}, ${edgeGlowOpacity})`
    : 'none';

  const handleKeyClick = (key: string) => {
    if (window.electronAPI?.injectRemoteKey) {
      window.electronAPI.injectRemoteKey(key).catch(err =>
        console.warn('[Emulator] Remote key injection error:', err)
      );
    }
  };

  return (
    <div className="flex items-center gap-4 min-w-0 bg-dark-900 px-4 py-2 rounded-xl border border-border-dark shadow-inner select-none">
      {/* The matrix and its status LED take the slack; everything to the right
          of them is fixed width and drops out at a breakpoint instead. */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {/* Physical Status RGB LED Light Bar */}
        <div className="flex flex-col items-center shrink-0">
          <div
            className={`w-3.5 h-3.5 rounded-full transition-all duration-300 shadow-md ${isAlert ? 'animate-pulse' : ''
              }`}
            style={{ backgroundColor: ledColor, boxShadow: `0 0 10px ${ledColor}` }}
            title={`Status LED (${displayState?.ledMode || 'SOLID'})`}
          />
          <span className="text-[9px] text-text-secondary mt-1 uppercase font-mono hidden hdr-md:block">RGB LED</span>
        </div>

        {/* High-Precision 72x16 RGB LED Matrix Display Preview with Screen Edge Glow */}
        <div ref={matrixSlotRef} className="flex flex-col items-center flex-1 min-w-0">
          <div
            className="border border-dark-700 rounded p-1.5 bg-black transition-all duration-300"
            style={{ boxShadow: glowBoxShadow }}
          >
            <canvas ref={frontCanvasRef} className="block rounded max-w-full" title="Physical Front 72x16 RGB LED Matrix Display" />
          </div>
          <span className="text-[9px] text-text-secondary mt-1 uppercase font-mono hidden hdr-md:block whitespace-nowrap">72×16 RGB LED Matrix</span>
        </div>
      </div>

      {/* Rear 160x80 OLED Diagnostics Screen Preview.
          First to go: it is preview-only in this build -- transmitFrame sends
          the front matrix and nothing else -- so it carries the least real
          information of anything in the header. */}
      <div className="hidden hdr-xl:flex flex-col items-center border-l border-border-dark pl-4 shrink-0">
        <div className="border border-dark-700 rounded p-1.5 bg-black shadow-lg">
          <canvas ref={backCanvasRef} className="block rounded" title="Physical Rear 160x80 OLED Screen" />
        </div>
        <span className="text-[9px] text-text-secondary mt-1 uppercase font-mono">160×80 Rear OLED</span>
      </div>

      {/* Interactive Physical Remote Control Pad.
          Hidden last rather than first, despite looking like decoration:
          injectRemoteKey exists nowhere else in the renderer, so this is the
          only way to exercise hardware input without a bar attached, which is
          the whole point of `pnpm dev:mock`. */}
      <div className="hidden hdr-lg:flex flex-col items-center border-l border-border-dark pl-4 space-y-1 font-mono shrink-0">
        <span className="text-[9px] text-text-secondary uppercase hidden hdr-xl:block">Remote Controls</span>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => handleKeyClick('up')}
            className="px-1.5 py-0.5 bg-dark-800 hover:bg-accent-blue/20 text-white hover:text-accent-blue rounded border border-border-dark text-[10px] font-bold transition-all active:scale-95"
            title="Wheel Scroll Up"
          >
            ▲
          </button>
          <button
            onClick={() => handleKeyClick('down')}
            className="px-1.5 py-0.5 bg-dark-800 hover:bg-accent-blue/20 text-white hover:text-accent-blue rounded border border-border-dark text-[10px] font-bold transition-all active:scale-95"
            title="Wheel Scroll Down"
          >
            ▼
          </button>
          <button
            onClick={() => handleKeyClick('ok')}
            className="px-2 py-0.5 bg-accent-blue/20 hover:bg-accent-blue/40 text-accent-blue rounded border border-accent-blue/40 text-[10px] font-bold transition-all active:scale-95"
            title="Wheel Click OK"
          >
            OK
          </button>
          <button
            onClick={() => handleKeyClick('back')}
            className="px-1.5 py-0.5 bg-dark-800 hover:bg-dark-700 text-text-secondary hover:text-white rounded border border-border-dark text-[10px] font-semibold transition-all active:scale-95"
            title="Back Button"
          >
            BACK
          </button>
          <button
            onClick={() => handleKeyClick('start')}
            className="px-1.5 py-0.5 bg-accent-green/20 hover:bg-accent-green/30 text-accent-green rounded border border-accent-green/30 text-[10px] font-bold transition-all active:scale-95"
            title="Start / Pause Session"
          >
            START
          </button>
        </div>
      </div>
    </div>
  );
};

