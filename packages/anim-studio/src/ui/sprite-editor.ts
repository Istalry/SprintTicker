import { nextPaletteKey, Sprite, SpriteFrame, SpriteLayer, TRANSPARENT } from '../model/scene';
import { button, clear, colorInput, h, numberInput } from './dom';
import { Store, Tool } from './store';

/**
 * The pixel editor for an icon layer: a drawing grid, the frame strip and the
 * palette.
 *
 * The icon is the part of a scene that has to move -- a plate and a line of
 * text are set once -- so this is where most of the drawing happens.
 */

const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'pencil', label: '✎ Pencil', key: 'b' },
  { tool: 'eraser', label: '⌫ Eraser', key: 'e' },
  { tool: 'fill', label: '▧ Fill', key: 'g' },
  { tool: 'eyedropper', label: '⊙ Pick', key: 'i' }
];

/** Largest cell size, for small sprites; wide ones get less so they fit. */
const MAX_CELL = 22;
const GRID_WIDTH_PX = 480;
const ONION_ALPHA = 0.3;

function setPixel(frame: SpriteFrame, x: number, y: number, key: string): void {
  const row = frame.rows[y];
  if (row[x] === key) return;
  frame.rows[y] = row.slice(0, x) + key + row.slice(x + 1);
}

/** 4-way flood fill, the only kind that makes sense on a pixel grid. */
export function floodFill(frame: SpriteFrame, x: number, y: number, key: string): void {
  const target = frame.rows[y]?.[x];
  if (target === undefined || target === key) return;
  const height = frame.rows.length;
  const width = frame.rows[0].length;
  const stack: [number, number][] = [[x, y]];
  while (stack.length > 0) {
    const [px, py] = stack.pop()!;
    if (px < 0 || py < 0 || px >= width || py >= height || frame.rows[py][px] !== target) continue;
    setPixel(frame, px, py, key);
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
}

/** The scene frame at which sprite frame `index` first appears. */
function sceneFrameOf(sprite: Sprite, index: number): number {
  return sprite.frames.slice(0, index).reduce((sum, f) => sum + f.duration, 0);
}

function paintFrame(ctx: CanvasRenderingContext2D, sprite: Sprite, frame: SpriteFrame, cell: number, alpha = 1): void {
  ctx.globalAlpha = alpha;
  frame.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const colour = sprite.palette[row[x]];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  });
  ctx.globalAlpha = 1;
}

/**
 * Turns an imported image into sprite frames: one frame if it is the sprite's
 * size, several if it is a horizontal strip of them. Every distinct opaque
 * colour becomes a palette entry; pixels under half alpha become transparent.
 */
export function framesFromImage(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  sprite: Sprite
): { frames: SpriteFrame[]; palette: Record<string, string> } {
  if (imageHeight !== sprite.height || imageWidth % sprite.width !== 0) {
    throw new Error(
      `The image is ${imageWidth}×${imageHeight}; it must be ${sprite.width}×${sprite.height}, ` +
        `or a strip of frames that size side by side.`
    );
  }
  const palette = { ...sprite.palette };
  const byColour = new Map(Object.entries(palette).map(([k, v]) => [v.toUpperCase(), k]));
  const scratch: Sprite = { ...sprite, palette };

  const keyFor = (r: number, g: number, b: number): string => {
    const hex = `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
    let key = byColour.get(hex);
    if (key === undefined) {
      const next = nextPaletteKey(scratch);
      if (next === null) throw new Error('The image has more colours than a palette can hold (62).');
      key = next;
      palette[key] = hex;
      byColour.set(hex, key);
    }
    return key;
  };

  const frames: SpriteFrame[] = [];
  for (let f = 0; f < imageWidth / sprite.width; f++) {
    const rows: string[] = [];
    for (let y = 0; y < sprite.height; y++) {
      let row = '';
      for (let x = 0; x < sprite.width; x++) {
        const p = (y * imageWidth + f * sprite.width + x) * 4;
        row += data[p + 3] < 128 ? TRANSPARENT : keyFor(data[p], data[p + 1], data[p + 2]);
      }
      rows.push(row);
    }
    frames.push({ duration: 6, rows });
  }
  return { frames, palette };
}

export function mountSpriteEditor(root: HTMLElement, store: Store, setStatus: (msg: string, error?: boolean) => void): void {
  const grid = h('canvas', { class: 'sprite-grid' });
  const tools = h('div', { class: 'row tools' });
  const palette = h('div', { class: 'palette' });
  const strip = h('div', { class: 'strip' });
  const frameControls = h('div', { class: 'row' });
  const fileInput = h('input', { type: 'file', accept: 'image/png', hidden: true });
  const body = h('div', { class: 'sprite-body' }, h('div', {}, tools, grid), h('div', { class: 'side' }, palette));
  root.append(h('h2', {}, 'Icon'), body, frameControls, strip, fileInput);

  const ctx = grid.getContext('2d');
  if (!ctx) throw new Error('canvas 2d is unavailable');

  let cell = MAX_CELL;

  const current = (): { layer: SpriteLayer; frame: SpriteFrame } | null => {
    const layer = store.selectedSprite;
    if (!layer) return null;
    return { layer, frame: layer.sprite.frames[store.spriteFrame] };
  };

  // ─── drawing ────────────────────────────────────────────────────────────────

  function drawGrid(): void {
    const sel = current();
    if (!sel) return;
    const { sprite } = sel.layer;
    cell = Math.max(4, Math.min(MAX_CELL, Math.floor(GRID_WIDTH_PX / sprite.width)));
    grid.width = sprite.width * cell;
    grid.height = sprite.height * cell;

    // A checkerboard, so transparent reads as transparent and not as black.
    for (let y = 0; y < sprite.height; y++) {
      for (let x = 0; x < sprite.width; x++) {
        ctx!.fillStyle = (x + y) % 2 === 0 ? '#1d1d22' : '#26262c';
        ctx!.fillRect(x * cell, y * cell, cell, cell);
      }
    }
    if (store.onionSkin && store.spriteFrame > 0) {
      paintFrame(ctx!, sprite, sprite.frames[store.spriteFrame - 1], cell, ONION_ALPHA);
    }
    paintFrame(ctx!, sprite, sel.frame, cell);

    ctx!.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx!.lineWidth = 1;
    for (let x = 1; x < sprite.width; x++) {
      ctx!.beginPath();
      ctx!.moveTo(x * cell + 0.5, 0);
      ctx!.lineTo(x * cell + 0.5, grid.height);
      ctx!.stroke();
    }
    for (let y = 1; y < sprite.height; y++) {
      ctx!.beginPath();
      ctx!.moveTo(0, y * cell + 0.5);
      ctx!.lineTo(grid.width, y * cell + 0.5);
      ctx!.stroke();
    }
  }

  function cellAt(e: PointerEvent): [number, number] | null {
    const rect = grid.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * grid.width / cell);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * grid.height / cell);
    const sel = current();
    if (!sel || x < 0 || y < 0 || x >= sel.layer.sprite.width || y >= sel.layer.sprite.height) return null;
    return [x, y];
  }

  function apply(e: PointerEvent): void {
    const at = cellAt(e);
    const sel = current();
    if (!at || !sel) return;
    const [x, y] = at;
    if (store.tool === 'eyedropper') {
      const key = sel.frame.rows[y][x];
      if (key !== TRANSPARENT) store.setColorKey(key);
      store.setTool('pencil');
      return;
    }
    const key = store.tool === 'eraser' || e.buttons === 2 ? TRANSPARENT : store.colorKey;
    if (store.tool === 'fill') {
      store.mutate(() => floodFill(sel.frame, x, y, key), 'sprite');
      return;
    }
    if (sel.frame.rows[y][x] !== key) store.mutate(() => setPixel(sel.frame, x, y, key), 'sprite');
  }

  let painting = false;
  grid.addEventListener('contextmenu', e => e.preventDefault());
  grid.addEventListener('pointerdown', e => {
    if (!current()) return;
    grid.setPointerCapture(e.pointerId);
    painting = true;
    store.beginTransient();
    apply(e);
  });
  grid.addEventListener('pointermove', e => {
    if (painting && (store.tool === 'pencil' || store.tool === 'eraser')) apply(e);
  });
  const endStroke = (): void => {
    if (!painting) return;
    painting = false;
    store.endTransient();
  };
  grid.addEventListener('pointerup', endStroke);
  grid.addEventListener('pointercancel', endStroke);

  // ─── tools and palette ──────────────────────────────────────────────────────

  function renderTools(): void {
    clear(tools);
    for (const t of TOOLS) {
      tools.append(
        button(t.label, () => store.setTool(t.tool), {
          class: store.tool === t.tool ? 'active' : '',
          title: `${t.label} (${t.key.toUpperCase()})`
        })
      );
    }
    const onion = h('input', { type: 'checkbox', checked: store.onionSkin });
    onion.addEventListener('change', () => store.setOnionSkin(onion.checked));
    tools.append(h('label', { class: 'check' }, onion, 'Onion skin'));
  }

  function renderPalette(): void {
    clear(palette);
    const sel = current();
    if (!sel) return;
    const { sprite } = sel.layer;
    const used = new Set(sprite.frames.flatMap(f => f.rows.join('')));

    const swatches = h('div', { class: 'swatches' });
    for (const [key, colour] of Object.entries(sprite.palette)) {
      swatches.append(
        h('button', {
          type: 'button',
          class: `swatch${key === store.colorKey ? ' active' : ''}`,
          style: `background:${colour}`,
          title: `${key}  ${colour}${used.has(key) ? '' : '  (unused)'}`,
          onclick: () => {
            store.setColorKey(key);
            if (store.tool === 'eraser' || store.tool === 'eyedropper') store.setTool('pencil');
          }
        })
      );
    }

    const selected = sprite.palette[store.colorKey];
    const edit = selected
      ? colorInput(selected, v =>
          store.commit(() => {
            sprite.palette[store.colorKey] = v;
          })
        )
      : null;
    const addColour = colorInput('#FFFFFF', v => {
      const key = nextPaletteKey(sprite);
      if (key === null) {
        setStatus('The palette is full (62 colours).', true);
        return;
      }
      store.commit(() => {
        sprite.palette[key] = v;
      });
      store.setColorKey(key);
    });
    const removeUnused = button('Drop unused', () =>
      store.commit(() => {
        for (const key of Object.keys(sprite.palette)) if (!used.has(key)) delete sprite.palette[key];
      })
    );

    palette.append(
      h('h3', {}, 'Palette'),
      swatches,
      edit ? h('label', { class: 'field' }, h('span', {}, 'Selected'), edit) : '',
      h('label', { class: 'field' }, h('span', {}, 'Add'), addColour),
      removeUnused,
      h('p', { class: 'hint' }, 'Right-click erases. Pixels left empty are transparent.')
    );
  }

  // ─── frames ─────────────────────────────────────────────────────────────────

  function frameEdit(change: (sprite: Sprite, index: number) => number): void {
    const sel = current();
    if (!sel) return;
    let next = store.spriteFrame;
    store.commit(() => {
      next = change(sel.layer.sprite, store.spriteFrame);
      // Keep the loop point on a frame that still exists.
      sel.layer.loopFrom = Math.min(sel.layer.loopFrom, sel.layer.sprite.frames.length - 1);
    });
    selectFrame(next);
  }

  function selectFrame(index: number): void {
    store.setSpriteFrame(index);
    const sel = current();
    // Moving the playhead with the edited frame keeps the preview showing the
    // frame being drawn, in context with the plate and the text.
    if (sel) store.setFrame(sceneFrameOf(sel.layer.sprite, store.spriteFrame));
  }

  function renderFrameControls(): void {
    clear(frameControls);
    const sel = current();
    if (!sel) return;
    const { sprite } = sel.layer;
    const blank = (): SpriteFrame => ({
      duration: sel.frame.duration,
      rows: Array.from({ length: sprite.height }, () => TRANSPARENT.repeat(sprite.width))
    });
    frameControls.append(
      button('+ Blank', () => frameEdit((s, i) => (s.frames.splice(i + 1, 0, blank()), i + 1))),
      button('⧉ Duplicate', () =>
        frameEdit((s, i) => (s.frames.splice(i + 1, 0, { duration: s.frames[i].duration, rows: [...s.frames[i].rows] }), i + 1))
      ),
      button('◀ Move', () =>
        frameEdit((s, i) => {
          if (i === 0) return i;
          [s.frames[i - 1], s.frames[i]] = [s.frames[i], s.frames[i - 1]];
          return i - 1;
        })
      ),
      button('Move ▶', () =>
        frameEdit((s, i) => {
          if (i === s.frames.length - 1) return i;
          [s.frames[i + 1], s.frames[i]] = [s.frames[i], s.frames[i + 1]];
          return i + 1;
        })
      ),
      button(
        '✕ Delete',
        () =>
          frameEdit((s, i) => {
            if (s.frames.length === 1) return i;
            s.frames.splice(i, 1);
            return Math.min(i, s.frames.length - 1);
          }),
        { class: 'danger', disabled: sprite.frames.length === 1 }
      ),
      h(
        'label',
        { class: 'field compact' },
        h('span', {}, 'Hold'),
        numberInput(sel.frame.duration, {
          min: 1,
          max: 600,
          onCommit: v => store.commit(() => void (sel.frame.duration = v))
        }),
        h('span', { class: 'hint' }, 'frames')
      ),
      button('Loop from here', () => store.commit(() => void (sel.layer.loopFrom = store.spriteFrame)), {
        title: 'Frames before this one play once; this one onward repeats.'
      }),
      button('Import PNG…', () => fileInput.click(), { title: 'One frame, or a horizontal strip of frames' })
    );
  }

  function renderStrip(): void {
    clear(strip);
    const sel = current();
    if (!sel) return;
    const { sprite } = sel.layer;
    const thumbCell = Math.max(2, Math.floor(48 / Math.max(sprite.width, sprite.height)));
    sprite.frames.forEach((frame, i) => {
      const thumb = h('canvas', { width: sprite.width * thumbCell, height: sprite.height * thumbCell });
      const tctx = thumb.getContext('2d');
      if (tctx) {
        tctx.fillStyle = '#000';
        tctx.fillRect(0, 0, thumb.width, thumb.height);
        paintFrame(tctx, sprite, frame, thumbCell);
      }
      const classes = ['thumb'];
      if (i === store.spriteFrame) classes.push('active');
      if (i === sel.layer.loopFrom) classes.push('loop-start');
      strip.append(
        h(
          'button',
          { type: 'button', class: classes.join(' '), onclick: () => selectFrame(i), title: `Frame ${i + 1}, ${frame.duration} frames` },
          thumb,
          h('span', {}, `${i + 1}${i === sel.layer.loopFrom ? ' ↻' : ''} · ${frame.duration}`)
        )
      );
    });
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    const sel = current();
    if (!file || !sel) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = h('canvas', { width: img.width, height: img.height });
      const c = canvas.getContext('2d');
      if (!c) return;
      c.drawImage(img, 0, 0);
      try {
        const { frames, palette: merged } = framesFromImage(c.getImageData(0, 0, img.width, img.height).data, img.width, img.height, sel.layer.sprite);
        frameEdit((s, i) => {
          s.palette = merged;
          s.frames.splice(i + 1, 0, ...frames);
          return i + 1;
        });
        setStatus(`Imported ${frames.length} frame${frames.length === 1 ? '' : 's'} from ${file.name}.`);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : String(err), true);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus(`${file.name} could not be read as an image.`, true);
    };
    img.src = url;
  });

  function render(): void {
    const visible = current() !== null;
    root.hidden = !visible;
    if (!visible) return;
    const sel = current()!;
    if (sel.layer.sprite.palette[store.colorKey] === undefined) {
      store.colorKey = Object.keys(sel.layer.sprite.palette)[0] ?? 'a';
    }
    renderTools();
    drawGrid();
    renderPalette();
    renderFrameControls();
    renderStrip();
  }

  document.addEventListener('keydown', e => {
    if (!current() || (e.target as HTMLElement).closest('input, select, textarea') || e.ctrlKey || e.metaKey) return;
    const tool = TOOLS.find(t => t.key === e.key.toLowerCase());
    if (tool) store.setTool(tool.tool);
  });

  store.subscribe(({ reason, origin }) => {
    if (reason === 'frame' || reason === 'playback') return;
    // During a stroke only the grid and its thumbnail change; rebuilding the
    // panels on every pixel would make drawing stutter.
    if (reason === 'scene' && origin === 'sprite') {
      drawGrid();
      renderStrip();
      return;
    }
    render();
  });
  render();
}
