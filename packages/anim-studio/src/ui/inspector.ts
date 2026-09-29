import {
  FONT_IDS,
  Layer,
  MAX_FPS,
  MAX_FRAMES,
  MIN_FPS,
  PLATE_MOTIONS,
  PlateLayer,
  Scene,
  SCENE_ID_PATTERN,
  SCENE_SIZES,
  SpriteLayer,
  TEXT_ALIGNS,
  TEXT_EFFECTS,
  TextLayer
} from '../model/scene';
import { FONT_LABELS, measure, SCENE_FONTS } from '../render/text';
import { button, clear, colorInput, field, h, numberInput, select } from './dom';
import { Store } from './store';

const ORIGIN = 'inspector';

/** Coordinates may start off-panel so a layer can slide in; mirrors the parser. */
const COORD_LIMIT = 256;

/** What each effect's `period` means, since it is not the same unit for all. */
const PERIOD_HINTS: Record<string, string> = {
  typewriter: 'frames per letter',
  scroll: 'frames per pixel',
  none: 'unused'
};

export function mountInspector(root: HTMLElement, store: Store): void {
  const sceneSection = h('section');
  const layerSection = h('section');
  root.append(sceneSection, layerSection);

  /** Applies an edit to the selected layer without rebuilding this panel. */
  function edit<T extends Layer>(layer: T, change: (layer: T) => void): void {
    store.commit(() => change(layer), ORIGIN);
  }

  function renderScene(): void {
    clear(sceneSection);
    const { scene } = store;

    const id = h('input', { type: 'text', value: scene.id, spellcheck: false });
    id.addEventListener('change', () => {
      const value = id.value.trim().toLowerCase();
      if (!SCENE_ID_PATTERN.test(value)) {
        id.classList.add('invalid');
        id.title = 'Lowercase letters, digits, - and _ only. It becomes a folder and a file name on the device.';
        return;
      }
      id.classList.remove('invalid');
      store.commit(s => {
        s.id = value;
      }, ORIGIN);
    });

    const sizeKey = `${scene.width}x${scene.height}`;
    const size = select(
      sizeKey,
      SCENE_SIZES.map(s => ({ value: `${s.width}x${s.height}`, label: s.label })),
      value => {
        const [w, hgt] = value.split('x').map(Number);
        store.commit(s => {
          s.width = w;
          s.height = hgt;
        });
      }
    );

    const seconds = h('span', { class: 'hint' }, `${(scene.frameCount / scene.fps).toFixed(2)} s`);
    sceneSection.append(
      h('h2', {}, 'Scene'),
      field('Id', id),
      field('Size', size),
      field(
        'FPS',
        numberInput(scene.fps, {
          min: MIN_FPS,
          max: MAX_FPS,
          onCommit: v => store.commit(s => void (s.fps = v))
        })
      ),
      field(
        'Frames',
        h(
          'span',
          { class: 'inline' },
          numberInput(scene.frameCount, {
            min: 1,
            max: MAX_FRAMES,
            onCommit: v => store.commit(s => void (s.frameCount = v))
          }),
          seconds
        )
      )
    );
  }

  function renderLayer(): void {
    clear(layerSection);
    const layer = store.selectedLayer;
    if (!layer) return;

    const name = h('input', { type: 'text', value: layer.name });
    name.addEventListener('change', () => store.commit(() => void (layer.name = name.value), 'rename'));

    layerSection.append(h('h2', {}, `${layer.type[0].toUpperCase()}${layer.type.slice(1)} layer`), field('Name', name));
    const pos = (key: 'x' | 'y') =>
      numberInput(layer[key], { min: -COORD_LIMIT, max: COORD_LIMIT, onCommit: v => edit(layer, l => void (l[key] = v)) });
    layerSection.append(field('X', pos('x')), field('Y', pos('y')));

    if (layer.type === 'plate') renderPlate(layer, store.scene);
    if (layer.type === 'sprite') renderSprite(layer);
    if (layer.type === 'text') renderText(layer);
  }

  function renderPlate(layer: PlateLayer, scene: Scene): void {
    const outlineOn = h('input', { type: 'checkbox', checked: layer.outline !== null });
    const outlineColour = colorInput(layer.outline ?? '#FFFFFF', v => edit(layer, l => void (l.outline = v)));
    outlineColour.disabled = layer.outline === null;
    outlineOn.addEventListener('change', () => {
      outlineColour.disabled = !outlineOn.checked;
      edit(layer, l => void (l.outline = outlineOn.checked ? outlineColour.value.toUpperCase() : null));
    });

    layerSection.append(
      field('Width', numberInput(layer.width, { min: 1, max: scene.width, onCommit: v => edit(layer, l => void (l.width = v)) })),
      field('Height', numberInput(layer.height, { min: 1, max: scene.height, onCommit: v => edit(layer, l => void (l.height = v)) })),
      field('Radius', numberInput(layer.radius, { min: 0, max: 8, onCommit: v => edit(layer, l => void (l.radius = v)) })),
      field(
        'Gradient',
        h(
          'span',
          { class: 'inline' },
          colorInput(layer.colorA, v => edit(layer, l => void (l.colorA = v))),
          colorInput(layer.colorB, v => edit(layer, l => void (l.colorB = v))),
          select(layer.direction, ['horizontal', 'vertical'] as const, v => edit(layer, l => void (l.direction = v)))
        )
      ),
      field('Outline', h('span', { class: 'inline' }, outlineOn, outlineColour)),
      field('Motion', select(layer.motion, PLATE_MOTIONS, v => edit(layer, l => void (l.motion = v)))),
      field('Period', numberInput(layer.period, { min: 1, max: MAX_FRAMES, onCommit: v => edit(layer, l => void (l.period = v)) }))
    );
  }

  function renderSprite(layer: SpriteLayer): void {
    const { sprite } = layer;
    const resize = (width: number, height: number): void => {
      store.commit(() => {
        // Crops or pads with transparency, anchored top-left, so enlarging a
        // sprite never moves what is already drawn.
        for (const frame of sprite.frames) {
          const rows = frame.rows.slice(0, height).map(r => r.slice(0, width).padEnd(width, '.'));
          while (rows.length < height) rows.push('.'.repeat(width));
          frame.rows = rows;
        }
        sprite.width = width;
        sprite.height = height;
      });
    };
    layerSection.append(
      field('Width', numberInput(sprite.width, { min: 1, max: 72, onCommit: v => resize(v, sprite.height) })),
      field('Height', numberInput(sprite.height, { min: 1, max: 16, onCommit: v => resize(sprite.width, v) })),
      field(
        'Loop from',
        numberInput(layer.loopFrom + 1, {
          min: 1,
          max: sprite.frames.length,
          onCommit: v => edit(layer, l => void (l.loopFrom = v - 1))
        })
      ),
      h(
        'p',
        { class: 'hint' },
        'Frames before "loop from" play once; the rest repeat. Draw the icon in the sprite editor below the preview.'
      )
    );
  }

  function renderText(layer: TextLayer): void {
    const font = SCENE_FONTS[layer.font];
    const warning = h('p', { class: 'hint warn' });
    const text = h('input', { type: 'text', value: layer.text, spellcheck: false });

    const check = (value: string): void => {
      const missing = [...new Set([...value].filter(c => !font.glyphs[c] && !font.glyphs[c.toUpperCase()]))];
      warning.textContent = missing.length ? `Not in this font, drawn as "?": ${missing.join(' ')}` : '';
      widthHint.textContent = `${measure(value, font)} px wide, box ${layer.width} px`;
    };
    const widthHint = h('span', { class: 'hint' });
    text.addEventListener('input', () => check(text.value));
    text.addEventListener('change', () => edit(layer, l => void (l.text = text.value)));

    const periodHint = PERIOD_HINTS[layer.effect] ?? 'frames per cycle';
    layerSection.append(
      field('Text', text),
      warning,
      field('Font', select(layer.font, FONT_IDS.map(f => ({ value: f, label: FONT_LABELS[f] })), v => {
        store.commit(() => void (layer.font = v));
      })),
      field('Colour', colorInput(layer.color, v => edit(layer, l => void (l.color = v)))),
      field(
        'Box width',
        h(
          'span',
          { class: 'inline' },
          numberInput(layer.width, { min: 1, max: 72, onCommit: v => store.commit(() => void (layer.width = v)) }),
          button('Fit', () => store.commit(() => void (layer.width = Math.max(1, measure(layer.text, font)))), {
            title: 'Shrink the box to the text'
          })
        )
      ),
      widthHint,
      field('Align', select(layer.align, TEXT_ALIGNS, v => edit(layer, l => void (l.align = v)))),
      field('Effect', select(layer.effect, TEXT_EFFECTS, v => store.commit(() => void (layer.effect = v)))),
      field(
        'Period',
        h(
          'span',
          { class: 'inline' },
          numberInput(layer.period, { min: 1, max: MAX_FRAMES, onCommit: v => edit(layer, l => void (l.period = v)) }),
          h('span', { class: 'hint' }, periodHint)
        )
      )
    );
    check(layer.text);
  }

  store.subscribe(({ reason, origin }) => {
    if (reason === 'selection') {
      renderScene();
      renderLayer();
    }
    // An edit made here already shows in the controls, and rebuilding them
    // would take the focus away from the field being tabbed into.
    if (reason === 'scene' && origin !== ORIGIN) {
      renderScene();
      renderLayer();
    }
  });
  renderScene();
  renderLayer();
}
