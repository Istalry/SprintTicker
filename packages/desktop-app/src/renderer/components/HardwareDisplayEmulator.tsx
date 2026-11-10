import React, { useEffect, useRef, useState } from 'react';
import { HardwareDisplayStateDTO, DisplayElementDTO } from '../../shared/dtos';
import { DISPLAY_CONSTANTS } from '../../shared/render-constants';
import { computeMatrixDotSize, MATRIX_GAP, MATRIX_FRAME_CHROME } from './emulator-scaling';
import { useElementWidth } from '../hooks/useElementWidth';
import { compositeImage, DecodedImage, ledCoreAlpha, ledLuminance } from './emulator-pixels';

/**
 * Physical Hardware Display Emulator Component.
 * Simulates the physical 72x16 RGB LED front matrix with 1:1 pixel-perfect
 * diode rendering, emissive LED bloom and marquee scrolling.
 *
 * Front only. The rear 160x80 display is the firmware's, which mirrors the
 * front there; a preview of the rear used to sit here, drawing diagnostics the
 * app never sent to the bar.
 */
export const HardwareDisplayEmulator: React.FC = () => {
  const [displayState, setDisplayState] = useState<HardwareDisplayStateDTO | null>(null);
  const frontCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  // Decoded once per data URL: the render loop runs every animation frame.
  const imageCacheRef = useRef<Map<string, DecodedImage | null>>(new Map());

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

  // Decode the images in displayState into pixels; null until decoded.
  useEffect(() => {
    if (!displayState) return;
    const cache = imageCacheRef.current;
    // Animation frames arrive at 60 fps, each a new data URL: keep only the
    // ones on screen now, or the cache grows for as long as a scene plays.
    const current = new Set(displayState.frontElements.filter(el => el.type === 'image' && el.data).map(el => el.data as string));
    for (const key of [...cache.keys()]) if (!current.has(key)) cache.delete(key);
    for (const data of current) {
      if (cache.has(data)) continue;
      cache.set(data, null);
      const img = new Image();
      img.onload = () => {
        const off = document.createElement('canvas');
        off.width = img.width;
        off.height = img.height;
        const offCtx = off.getContext('2d');
        if (!offCtx || !cache.has(data)) return;
        offCtx.drawImage(img, 0, 0);
        cache.set(data, { width: img.width, height: img.height, rgba: offCtx.getImageData(0, 0, img.width, img.height).data });
      };
      img.src = data;
    }
  }, [displayState]);

  /**
   * Builds the 72x16 colour buffer from what main actually sent.
   *
   * Three element kinds reach here: 'rectangle', which is how
   * `canvasToEmulatorElements` ships a rasterised frame as one strip per colour
   * run, 'bitmap', and 'image' -- an animation's frames, which light LEDs
   * like the rest (see `compositeImage`). There is deliberately no text branch -- main rasterises
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
    // Images last, over the rest, as the device stacks them: an animated
    // icon's moving frames over its still one.
    state.frontElements.forEach((el: DisplayElementDTO) => {
      if (el.type !== 'image' || !el.data) return;
      const decoded = imageCacheRef.current.get(el.data);
      if (decoded) compositeImage(buffer, decoded, el.x, el.y);
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
            // Lit LED Diode with Emissive Bloom, as bright as its colour: a
            // dim pixel is a dim LED, not a white one.
            ctx.shadowColor = pixelColor;
            ctx.shadowBlur = 4 * ledLuminance(pixelColor);
            ctx.fillStyle = pixelColor;
            ctx.beginPath();
            ctx.arc(x + dotSize / 2, y + dotSize / 2, dotSize / 2, 0, Math.PI * 2);
            ctx.fill();

            // Inner High-Brightness Diode Core, for the bright colours only
            ctx.shadowBlur = 0;
            const core = ledCoreAlpha(pixelColor);
            if (core > 0) {
              ctx.globalAlpha = core;
              ctx.fillStyle = '#FFFFFFFF';
              ctx.beginPath();
              ctx.arc(x + dotSize / 2, y + dotSize / 2, dotSize / 4, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = 1;
            }
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

      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
    // dotSize belongs here: the canvas backing size is computed from it, so a
    // resize has to tear the render loop down and set it up again.
  }, [displayState, dotSize]);

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
          <span className="text-[9px] text-text-secondary mt-1 hidden hdr-md:block">RGB LED</span>
        </div>

        {/* High-Precision 72x16 RGB LED Matrix Display Preview with Screen Edge Glow.
            The remote pad that sat to its right is BarRemotePad, in Settings,
            Developer: it acts on the real session, so it is not a header control. */}
        <div ref={matrixSlotRef} className="flex flex-col items-center flex-1 min-w-0">
          <div
            className="border border-dark-700 rounded p-1.5 bg-black transition-all duration-300"
            style={{ boxShadow: glowBoxShadow }}
          >
            <canvas ref={frontCanvasRef} className="block rounded max-w-full" title="Physical Front 72x16 RGB LED Matrix Display" />
          </div>
          <span className="text-[9px] text-text-secondary mt-1 hidden hdr-md:block whitespace-nowrap">on your BUSY Bar</span>
        </div>
      </div>

    </div>
  );
};

