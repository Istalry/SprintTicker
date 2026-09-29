import { EASING_HINTS, EASING_LABELS, EASINGS, evaluateTrack, Keyframe, TRACK_LIMITS, TrackProp, Tracks, setKey } from '../model/motion';
import { GlowLayer, SpriteLayer, TextLayer } from '../model/scene';
import { button, clear, h, select } from './dom';
import { Store } from './store';

/**
 * The keyframe editor for one layer: a row per animatable property showing its
 * value at the playhead, and the keys that produce it.
 *
 * Editing a value on a property that already has keys sets a key at the
 * playhead ("auto-key"), which is how every animation tool behaves and how a
 * fall is built: go to frame 0, set y; go to frame 17, set y. Editing x or y
 * with no keys moves the layer itself, so placing a still layer needs no
 * keyframes at all.
 */

export type MovingLayer = SpriteLayer | TextLayer | GlowLayer;

const LABELS: Record<TrackProp, string> = {
  x: 'X',
  y: 'Y',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  opacity: 'Opacity'
};

const STEPS: Record<TrackProp, number> = { x: 0.25, y: 0.25, scaleX: 0.05, scaleY: 0.05, opacity: 0.05 };

export function tracksFor(layer: MovingLayer): readonly TrackProp[] {
  return layer.type === 'text' ? (['x', 'y', 'opacity'] as const) : (['x', 'y', 'scaleX', 'scaleY', 'opacity'] as const);
}

function baseValue(layer: MovingLayer, prop: TrackProp): number {
  if (prop === 'x') return layer.x;
  if (prop === 'y') return layer.y;
  return 1;
}

function format(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

export function mountMotionEditor(root: HTMLElement, store: Store, layer: MovingLayer, origin: string): () => void {
  const tracks: Tracks = layer.tracks;

  function commit(edit: () => void): void {
    store.commit(edit, origin);
    render();
  }

  function valueRow(prop: TrackProp): HTMLElement {
    const keys = tracks[prop] ?? [];
    const frame = store.frame;
    const current = evaluateTrack(keys, frame, baseValue(layer, prop));
    const limits = TRACK_LIMITS[prop];
    const hasKeyHere = keys.some(k => k.frame === frame);

    const input = h('input', {
      type: 'number',
      step: STEPS[prop],
      min: limits.min,
      max: limits.max,
      value: format(current)
    });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      const value = Math.min(limits.max, Math.max(limits.min, v));
      commit(() => {
        if (keys.length === 0 && (prop === 'x' || prop === 'y')) {
          // No motion yet: this places the layer.
          (layer as { x: number; y: number })[prop] = value;
        } else {
          tracks[prop] = setKey(tracks[prop] ?? [], frame, value);
        }
      });
    });

    const toggle = button(
      hasKeyHere ? '◆' : '◇',
      () =>
        commit(() => {
          if (hasKeyHere) {
            tracks[prop] = keys.filter(k => k.frame !== frame);
            if (tracks[prop]!.length === 0) delete tracks[prop];
          } else {
            tracks[prop] = setKey(tracks[prop] ?? [], frame, current);
          }
        }),
      {
        class: `icon key${hasKeyHere ? ' on' : ''}`,
        title: hasKeyHere ? `Remove the ${LABELS[prop]} key at frame ${frame + 1}` : `Key ${LABELS[prop]} at frame ${frame + 1}`
      }
    );

    return h('div', { class: 'motion-row' }, h('span', { class: 'label' }, LABELS[prop]), input, toggle, keyList(prop, keys));
  }

  function keyList(prop: TrackProp, keys: Keyframe[]): HTMLElement {
    const list = h('div', { class: 'keys-list' });
    for (const key of keys) {
      const easeSelect = select(
        key.ease,
        EASINGS.map(e => ({ value: e, label: EASING_LABELS[e] })),
        v => commit(() => void (key.ease = v))
      );
      easeSelect.title = `How the value leaves this key. ${EASING_HINTS[key.ease]}`;
      list.append(
        h(
          'div',
          { class: `key-item${key.frame === store.frame ? ' here' : ''}` },
          button(`${key.frame + 1}`, () => store.setFrame(key.frame), { class: 'link', title: 'Go to this frame' }),
          h('span', { class: 'hint' }, `= ${format(key.value)}`),
          easeSelect,
          button(
            '✕',
            () =>
              commit(() => {
                tracks[prop] = keys.filter(k => k !== key);
                if (tracks[prop]!.length === 0) delete tracks[prop];
              }),
            { class: 'icon danger', title: 'Delete this key' }
          )
        )
      );
    }
    return list;
  }

  function render(): void {
    clear(root);
    root.append(
      h('h3', {}, 'Motion'),
      h(
        'p',
        { class: 'hint' },
        '◇ keys a value at the playhead; once a property has keys, editing it keys it. The ease is how the value leaves its key: ease in for a fall, ease out for a landing, overshoot for a squash recovering.'
      )
    );
    for (const prop of tracksFor(layer)) root.append(valueRow(prop));
  }

  const unsubscribe = store.subscribe(({ reason }) => {
    // The values shown are the values at the playhead. During playback they
    // would rebuild sixty times a second for nothing anyone can edit.
    if (reason === 'frame' && !store.playing) render();
  });
  render();
  return unsubscribe;
}
