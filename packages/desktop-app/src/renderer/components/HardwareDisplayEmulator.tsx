import React, { useEffect, useRef, useState } from 'react';
import { HardwareDisplayStateDTO, DisplayElementDTO } from '../../shared/dtos';
import { PIXEL_FONT_5X7 } from '../../main/hardware/pixel-bitmaps';

/**
 * Physical Hardware Display Emulator Component.
 * Simulates physical 72x16 RGB LED front matrix display and 160x80 rear OLED screen
 * with 1:1 pixel-perfect diode rendering, realistic emissive LED bloom, and marquee scrolling.
 */
export const HardwareDisplayEmulator: React.FC = () => {
  const [displayState, setDisplayState] = useState<HardwareDisplayStateDTO | null>(null);
  const frontCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scrollOffsetRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

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

      const handleDebugUpdate = (e: Event) => {
        const customEvt = e as CustomEvent<HardwareDisplayStateDTO>;
        if (customEvt.detail) {
          setDisplayState(customEvt.detail);
        }
      };
      window.addEventListener('debug-display-update', handleDebugUpdate);

      return () => {
        unsubscribe();
        window.removeEventListener('debug-display-update', handleDebugUpdate);
      };
    }
  }, []);

  /**
   * Generates 1:1 72x16 matrix pixel color buffer with 16x16 icon support,
   * crisp 1:1 pixel typography, and dynamic animated confetti particles.
   */
  const createPixelBuffer = (state: HardwareDisplayStateDTO | null, scrollX: number): (string | null)[][] => {
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
        const fill = el.fill || '#3B82F6FF';
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
      } else if (el.type === 'text' && el.text) {
        const textColor = el.color || '#FFFFFFFF';
        const startX = el.scroll_rate ? el.x - Math.floor(scrollX % 140) : el.x;
        const maskMinX = el.x >= 16 ? 16 : 0;
        const textStr = el.text;

        // Razor-Sharp 1:1 Crisp Pixel Art Typography Rasterization
        for (let chIdx = 0; chIdx < textStr.length; chIdx++) {
          const char = textStr[chIdx];
          const bitmask = PIXEL_FONT_5X7[char.toUpperCase()] || PIXEL_FONT_5X7[' '];
          const charX = startX + chIdx * 6;

          for (let r = 0; r < 7; r++) {
            const rowBits = bitmask[r];
            for (let c = 0; c < 5; c++) {
              if (rowBits & (1 << (4 - c))) {
                const px = charX + c;
                const py = el.y + r;
                if (px >= maskMinX && px < 72 && py >= 0 && py < 16) {
                  buffer[py][px] = textColor;
                }
              }
            }
          }
        }
      }
    });

    // Dynamic Animated Confetti Explosion Particles
    if (state.ledMode === 'CONFETTI_EXPLOSION') {
      const confettiColors = ['#10B981FF', '#FBBF24FF', '#38BDF8FF', '#EC4899FF', '#AAFF00FF', '#F59E0BFF'];
      const frame = Math.floor(scrollX * 0.25);
      for (let i = 0; i < 18; i++) {
        const initialX = (i * 3 + 16) % 54 + 16;
        const speed = 1 + (i % 3);
        const fallY = (Math.floor(i * 2 + frame * speed)) % 16;
        const swayX = Math.floor(initialX + Math.sin(frame * 0.2 + i) * 2);
        if (swayX >= 16 && swayX < 72 && fallY >= 0 && fallY < 16) {
          buffer[fallY][swayX] = confettiColors[(i + frame) % confettiColors.length];
        }
      }
    }

    return buffer;
  };

  // Render LED Matrix Diodes onto Front Canvas
  useEffect(() => {
    const canvas = frontCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dotSize = 6; // 6px per LED diode (432x96 resolution)
    const gap = 1;
    const cellSize = dotSize + gap;
    canvas.width = 72 * cellSize + gap;
    canvas.height = 16 * cellSize + gap;

    let lastTime = performance.now();

    const renderLoop = (time: number) => {
      const delta = (time - lastTime) / 1000;
      lastTime = time;
      scrollOffsetRef.current += delta * 15;

      const pixelBuffer = createPixelBuffer(displayState, scrollOffsetRef.current);

      // Dark Matte Bezel Matrix Background
      ctx.fillStyle = '#06080A';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let r = 0; r < 16; r++) {
        for (let c = 0; c < 72; c++) {
          const x = gap + c * cellSize;
          const y = gap + r * cellSize;
          let pixelColor = pixelBuffer[r][c];

          // 🌟 2-Pixel Radius Ambient Gradient Edge Glow Engine (Outer 100%, Inner 50% opacity)
          const enableGlow = displayState?.enableEdgeGlow ?? true;
          const glowOpacity = displayState?.edgeGlowOpacity ?? 0.3;
          const glowMode = displayState?.edgeGlowMode || 'PULSE';

          const isOuterPerimeter = r === 0 || r === 15 || c === 0 || c === 71;
          const isInnerPerimeter = (r === 1 || r === 14) || (c === 1 || c === 70);

          if (!pixelColor && enableGlow && glowMode !== 'NONE' && (isOuterPerimeter || isInnerPerimeter) && glowOpacity > 0) {
            const glowHex = displayState?.ledColorHex || '#38BDF8';
            const radiusFactor = isOuterPerimeter ? 1.0 : 0.5; // Outer layer 100%, inner 2nd layer 50% opacity
            let alphaFactor = 1.0;

            if (glowMode === 'PULSE') {
              alphaFactor = 0.4 + 0.6 * Math.sin(time * 0.003);
            } else if (glowMode === 'BLINKING') {
              alphaFactor = (Math.floor(time / 250) % 2 === 0) ? 1.0 : 0.0;
            } else if (glowMode === 'ROTATING') {
              // 🔄 2-Pixel Perimeter Chaser Light travelling around outer screen borders
              let pIdx = 0;
              if (r === 0 || r === 1) pIdx = c; // Top edge: 0..71
              else if (c === 71 || c === 70) pIdx = 72 + r; // Right edge: 72..86
              else if (r === 15 || r === 14) pIdx = 87 + (71 - c); // Bottom edge: 87..158
              else if (c === 0 || c === 1) pIdx = 159 + (15 - r); // Left edge: 159..173

              const chaserHead = Math.floor((time * 0.05) % 174);
              const dist = (chaserHead - pIdx + 174) % 174;
              if (dist < 24) {
                alphaFactor = (1 - dist / 24);
              } else {
                alphaFactor = 0.0;
              }
            }

            const finalAlpha = Math.max(0, Math.min(1, glowOpacity * alphaFactor * radiusFactor));
            if (finalAlpha > 0.01) {
              pixelColor = glowHex;
              ctx.shadowColor = glowHex;
              ctx.shadowBlur = Math.round(3 * finalAlpha);
              ctx.fillStyle = glowHex;
              ctx.globalAlpha = finalAlpha;
              ctx.beginPath();
              ctx.arc(x + dotSize / 2, y + dotSize / 2, dotSize / 2, 0, Math.PI * 2);
              ctx.fill();
              ctx.globalAlpha = 1.0;
              ctx.shadowBlur = 0;
              continue;
            }
          }

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

      animFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animFrameRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [displayState]);

  // Render Rear 160x80 OLED Screen Canvas
  useEffect(() => {
    const canvas = backCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = 1.2;
    canvas.width = 160 * scale;
    canvas.height = 80 * scale;

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

  const enableEdgeGlow = displayState?.enableEdgeGlow ?? true;
  const edgeGlowOpacity = displayState?.edgeGlowOpacity ?? 0.3;
  const edgeGlowHex = displayState?.ledColorHex || '#38BDF8';
  const glowBoxShadow = enableEdgeGlow && edgeGlowOpacity > 0
    ? `0 0 16px rgba(${parseInt(edgeGlowHex.slice(1,3)||'38',16)}, ${parseInt(edgeGlowHex.slice(3,5)||'BD',16)}, ${parseInt(edgeGlowHex.slice(5,7)||'F8',16)}, ${edgeGlowOpacity})`
    : 'none';

  return (
    <div className="flex items-center space-x-4 bg-dark-900 px-4 py-2 rounded-xl border border-border-dark shadow-inner">
      <div className="flex items-center space-x-2">
        {/* Physical Status RGB LED Light Bar */}
        <div className="flex flex-col items-center">
          <div
            className={`w-3.5 h-3.5 rounded-full transition-all duration-300 shadow-md ${
              isAlert ? 'animate-pulse' : ''
            }`}
            style={{ backgroundColor: ledColor, boxShadow: `0 0 10px ${ledColor}` }}
            title={`Status LED (${displayState?.ledMode || 'SOLID'})`}
          />
          <span className="text-[9px] text-text-secondary mt-1 uppercase font-mono">RGB LED</span>
        </div>

        {/* High-Precision 72x16 RGB LED Matrix Display Preview with Screen Edge Glow */}
        <div className="flex flex-col items-center">
          <div
            className="border border-dark-700 rounded p-1.5 bg-black transition-all duration-300"
            style={{ boxShadow: glowBoxShadow }}
          >
            <canvas ref={frontCanvasRef} className="block rounded" title="Physical Front 72x16 RGB LED Matrix Display" />
          </div>
          <span className="text-[9px] text-text-secondary mt-1 uppercase font-mono">72×16 RGB LED Matrix</span>
        </div>
      </div>

      {/* Rear 160x80 OLED Diagnostics Screen Preview */}
      <div className="flex flex-col items-center border-l border-border-dark pl-4">
        <div className="border border-dark-700 rounded p-1.5 bg-black shadow-lg">
          <canvas ref={backCanvasRef} className="block rounded" title="Physical Rear 160x80 OLED Screen" />
        </div>
        <span className="text-[9px] text-text-secondary mt-1 uppercase font-mono">160×80 Rear OLED</span>
      </div>
    </div>
  );
};

