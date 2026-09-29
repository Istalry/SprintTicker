import './styles.css';
import { createPlate, createScene, createSprite, createText } from './model/scene';
import { mountInspector } from './ui/inspector';
import { mountLayersPanel } from './ui/layers-panel';
import { mountPreview } from './ui/preview';
import { mountSpriteEditor } from './ui/sprite-editor';
import { Store } from './ui/store';
import { mountToolbar } from './ui/toolbar';

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el;
}

/** A starting scene in the official layout, so the first screen is not empty. */
function starterScene() {
  const scene = createScene('untitled_72x16');
  scene.layers.push(createPlate(scene));
  const icon = createSprite(scene, 14);
  icon.x = 2;
  icon.y = 1;
  scene.layers.push(icon, createText(scene));
  return scene;
}

const store = new Store(starterScene());
const status = element('status');

function setStatus(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
}

mountToolbar(element('toolbar'), store, setStatus);
mountPreview(element('preview'), store);
mountLayersPanel(element('layers'), store);
mountInspector(element('inspector'), store);
mountSpriteEditor(element('sprite'), store, setStatus);

document.addEventListener('keydown', e => {
  const inField = (e.target as HTMLElement).closest('input, select, textarea') !== null;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !inField) {
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      store.undo();
    } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
      e.preventDefault();
      store.redo();
    }
    return;
  }
  if (inField) return;
  if (e.key === ' ') {
    e.preventDefault();
    store.setPlaying(!store.playing);
  } else if (e.key === ',') {
    store.setFrame(store.frame - 1);
  } else if (e.key === '.') {
    store.setFrame(store.frame + 1);
  }
});

window.addEventListener('beforeunload', e => {
  if (store.dirty) e.preventDefault();
});
