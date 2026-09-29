import { createPlate, createSprite, createText, Layer } from '../model/scene';
import { button, clear, h } from './dom';
import { Store } from './store';

const TYPE_ICONS: Record<Layer['type'], string> = { plate: '▭', sprite: '✦', text: 'T' };

/**
 * The layer list, top of the stack first -- the order a person reads a
 * composition in -- although the scene stores them bottom first, the order
 * they are drawn in.
 */
export function mountLayersPanel(root: HTMLElement, store: Store): void {
  const list = h('ul', { class: 'layers' });
  const addBar = h(
    'div',
    { class: 'row' },
    button('+ Plate', () => add(createPlate(store.scene))),
    button('+ Icon', () => add(createSprite(store.scene, Math.min(16, store.scene.height)))),
    button('+ Text', () => add(createText(store.scene)))
  );
  root.append(h('h2', {}, 'Layers'), addBar, list);

  function add(layer: Layer): void {
    store.commit(scene => {
      scene.layers.push(layer);
    });
    store.select(layer.id);
  }

  function move(id: string, delta: number): void {
    store.commit(scene => {
      const i = scene.layers.findIndex(l => l.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= scene.layers.length) return;
      [scene.layers[i], scene.layers[j]] = [scene.layers[j], scene.layers[i]];
    });
  }

  function remove(id: string): void {
    store.commit(scene => {
      scene.layers = scene.layers.filter(l => l.id !== id);
    });
    store.select(store.scene.layers.at(-1)?.id ?? null);
  }

  function render(): void {
    clear(list);
    const layers = [...store.scene.layers].reverse();
    if (layers.length === 0) list.append(h('li', { class: 'empty' }, 'No layers yet. A plate first, then an icon and text.'));
    for (const layer of layers) {
      const visible = h('input', { type: 'checkbox', checked: layer.visible, title: 'Visible' });
      visible.addEventListener('change', () =>
        store.commit(() => {
          layer.visible = visible.checked;
        })
      );
      list.append(
        h(
          'li',
          {
            class: layer.id === store.selectedLayerId ? 'selected' : '',
            onclick: (e: Event) => {
              // The row's own controls act on the layer; only a click on the
              // row itself selects it. Otherwise deleting a layer would
              // re-select it on the way up.
              if ((e.target as HTMLElement).closest('button, input')) return;
              store.select(layer.id);
            }
          },
          visible,
          h('span', { class: 'type' }, TYPE_ICONS[layer.type]),
          h('span', { class: 'name' }, layer.name),
          button('↑', () => move(layer.id, 1), { title: 'Bring forward', class: 'icon' }),
          button('↓', () => move(layer.id, -1), { title: 'Send backward', class: 'icon' }),
          button('✕', () => remove(layer.id), { title: 'Delete layer', class: 'icon danger' })
        )
      );
    }
  }

  store.subscribe(({ reason }) => {
    if (reason === 'scene' || reason === 'selection') render();
  });
  render();
}
