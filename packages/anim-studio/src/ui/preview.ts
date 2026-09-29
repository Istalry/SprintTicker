import { renderFrame } from '../render/compositor';
import { Raster } from '../render/raster';
import { button, h } from './dom';
import { Store } from './store';

/**
 * The preview: the panel as LEDs, the panel at its real pixel size, and the
 * timeline that drives both.
 *
 * The LED view draws each pixel as a lit dot with dark gaps, because a flat
 * zoomed bitmap is misleading on exactly the questions that matter here --
 * whether a 1px outline reads, whether two colours are distinguishable once
 * they are separate points of light.
 */

/** Screen pixels per LED in the zoomed view. */
const LED_PITCH = 12;
/** The dot's size within its pitch; the rest is the gap between LEDs. */
const LED_SIZE = 9;

export function drawLeds(ctx: CanvasRenderingContext2D, raster: Raster, pitch = LED_PITCH, size = LED_SIZE): void {
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, raster.width * pitch, raster.height * pitch);
  const inset = (pitch - size) / 2;
  for (let y = 0; y < raster.height; y++) {
    for (let x = 0; x < raster.width; x++) {
      const [r, g, b] = raster.get(x, y);
      // An unlit LED is not invisible: it is a dark dot on a darker panel.
      ctx.fillStyle = r + g + b === 0 ? '#141414' : `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.roundRect(x * pitch + inset, y * pitch + inset, size, size, size / 3);
      ctx.fill();
    }
  }
}

export function drawPixels(ctx: CanvasRenderingContext2D, raster: Raster): void {
  const image = ctx.createImageData(raster.width, raster.height);
  image.data.set(raster.data);
  ctx.putImageData(image, 0, 0);
}

export function mountPreview(root: HTMLElement, store: Store): void {
  const leds = h('canvas', { class: 'leds' });
  const actual = h('canvas', { class: 'actual', title: 'Actual size' });
  const scrubber = h('input', { type: 'range', min: 0, step: 1, class: 'scrubber' });
  const frameLabel = h('span', { class: 'frame-label' });
  const playButton = button('Play', () => store.setPlaying(!store.playing), { class: 'primary' });

  const timeline = h(
    'div',
    { class: 'timeline' },
    button('⏮', () => store.setFrame(0), { title: 'First frame' }),
    button('◀', () => store.setFrame(store.frame - 1), { title: 'Previous frame (,)' }),
    playButton,
    button('▶', () => store.setFrame(store.frame + 1), { title: 'Next frame (.)' }),
    scrubber,
    frameLabel
  );
  root.append(h('div', { class: 'screens' }, leds, actual), timeline);

  scrubber.addEventListener('input', () => {
    store.setPlaying(false);
    store.setFrame(Number(scrubber.value));
  });

  const ledCtx = leds.getContext('2d');
  const actualCtx = actual.getContext('2d');
  if (!ledCtx || !actualCtx) throw new Error('canvas 2d is unavailable');

  function draw(): void {
    const { scene, frame } = store;
    if (leds.width !== scene.width * LED_PITCH || leds.height !== scene.height * LED_PITCH) {
      leds.width = scene.width * LED_PITCH;
      leds.height = scene.height * LED_PITCH;
      actual.width = scene.width;
      actual.height = scene.height;
      actual.style.setProperty('--w', String(scene.width));
    }
    const raster = renderFrame(scene, frame);
    drawLeds(ledCtx!, raster);
    drawPixels(actualCtx!, raster);

    scrubber.max = String(scene.frameCount - 1);
    scrubber.value = String(frame);
    const seconds = (frame / scene.fps).toFixed(2);
    frameLabel.textContent = `${frame + 1} / ${scene.frameCount}  ·  ${seconds}s`;
    playButton.textContent = store.playing ? 'Pause' : 'Play';
  }

  // Playback runs off the wall clock rather than one frame per animation
  // tick, so a 30 fps scene plays at 30 fps on a 144 Hz monitor too.
  let startedAt = 0;
  let startFrame = 0;
  function tick(now: number): void {
    if (!store.playing) return;
    const elapsed = (now - startedAt) / 1000;
    const frame = (startFrame + Math.floor(elapsed * store.scene.fps)) % store.scene.frameCount;
    store.setFrame(frame);
    requestAnimationFrame(tick);
  }

  store.subscribe(({ reason }) => {
    if (reason === 'playback' && store.playing) {
      startedAt = performance.now();
      startFrame = store.frame;
      requestAnimationFrame(tick);
    }
    if (reason === 'scene' || reason === 'frame' || reason === 'playback' || reason === 'selection') draw();
  });
  draw();
}
