import { createPlate, createScene, createSprite, createText, SCENE_ID_PATTERN } from '../model/scene';
import * as api from './api';
import { button, h } from './dom';
import { Store } from './store';

/**
 * Scene files, export, and the bar preview.
 *
 * Every action here awaits the server and reports what it said, including a
 * refusal -- the device's answers in particular are the thing worth reading.
 */

const HOST_KEY = 'anim-studio.host';

function readSetting(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    // Storage can be disabled; the field then simply starts empty.
    return '';
  }
}

function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Remembering the host is a convenience, not something to fail over.
  }
}

export function mountToolbar(root: HTMLElement, store: Store, setStatus: (msg: string, error?: boolean) => void): void {
  const sceneList = h('select', { title: 'Open a saved scene' });
  const title = h('span', { class: 'title' });
  const compile = h('input', { type: 'checkbox', checked: true });
  const host = h('input', { type: 'text', placeholder: 'bar address', value: readSetting(HOST_KEY), spellcheck: false, size: 12 });
  // Never persisted: the token is a secret, and localStorage is plain text on disk.
  const token = h('input', { type: 'password', placeholder: 'token (if any)', size: 10, autocomplete: 'off' });
  const undo = button('↶', () => store.undo(), { title: 'Undo (Ctrl+Z)' });
  const redo = button('↷', () => store.redo(), { title: 'Redo (Ctrl+Y)' });

  let busy = false;
  /** Runs one server action at a time, with the result in the status line. */
  async function run(label: string, action: () => Promise<string>): Promise<void> {
    if (busy) return;
    busy = true;
    root.classList.add('busy');
    setStatus(`${label}…`);
    try {
      setStatus(await action());
    } catch (err) {
      setStatus(`${label} failed: ${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      busy = false;
      root.classList.remove('busy');
    }
  }

  async function refreshList(selected?: string): Promise<void> {
    const ids = await api.listScenes();
    sceneList.replaceChildren(h('option', { value: '' }, ids.length ? 'Open…' : 'No saved scenes'));
    for (const id of ids) sceneList.append(h('option', { value: id, selected: id === selected }, id));
  }

  function confirmDiscard(): boolean {
    return !store.dirty || confirm('Discard the unsaved changes to this scene?');
  }

  sceneList.addEventListener('change', () => {
    const id = sceneList.value;
    if (!id) return;
    if (!confirmDiscard()) {
      sceneList.value = '';
      return;
    }
    void run('Opening', async () => {
      store.load(await api.loadScene(id));
      return `Opened ${id}.`;
    });
  });

  function newScene(): void {
    if (!confirmDiscard()) return;
    const id = prompt('Scene id (lowercase, digits, - and _). It becomes the folder under Animations/.', 'my_scene_72x16');
    if (id === null) return;
    if (!SCENE_ID_PATTERN.test(id)) {
      setStatus(`"${id}" is not a valid id.`, true);
      return;
    }
    const size = id.includes('16x16') ? 16 : 72;
    // Starts in the official layout -- plate, icon on the left, text on the
    // right -- because that is what nearly every scene here is.
    const scene = createScene(id, size, 16);
    scene.layers.push(createPlate(scene));
    if (size > 16) {
      scene.layers.push(createSprite(scene, 14));
      scene.layers[1].x = 2;
      scene.layers[1].y = 1;
      scene.layers.push(createText(scene));
    } else {
      scene.layers.push(createSprite(scene, 16));
    }
    store.load(scene);
    store.dirty = true;
    store.emit('file');
    setStatus(`New scene ${id}. Save it to keep it.`);
  }

  root.append(
    h('span', { class: 'brand' }, 'Anim Studio'),
    button('New', newScene),
    sceneList,
    button('Save', () =>
      void run('Saving', async () => {
        await api.saveScene(store.scene);
        store.markSaved();
        await refreshList(store.scene.id);
        return `Saved scenes/${store.scene.id}.scene.json.`;
      }), { class: 'primary', title: 'Save (Ctrl+S)' }
    ),
    undo,
    redo,
    title,
    h('span', { class: 'spacer' }),
    h('label', { class: 'check', title: 'Also build the .anim with seq2anim (needs Python)' }, compile, '.anim'),
    button('Export', () =>
      void run('Exporting', async () => {
        const result = await api.exportScene(store.scene, compile.checked);
        const anim = result.animBytes === null ? '' : `, ${(result.animBytes / 1024).toFixed(0)} KB .anim`;
        return `Exported ${result.frames} frames to ${result.dir}${anim}.`;
      })
    ),
    h('span', { class: 'sep' }),
    host,
    token,
    button('▶ On bar', () =>
      void run('Sending to the bar', async () => {
        writeSetting(HOST_KEY, host.value.trim());
        const result = await api.previewOnBar(store.scene, host.value.trim(), token.value);
        // The bar's refusal arrives as an answer, not an error; shown as one.
        if (result.status >= 300) throw new Error(result.message);
        return `${result.message} (${(result.bytes / 1024).toFixed(0)} KB)`;
      }), { title: 'Compile and play this scene on a real bar' }
    ),
    button('■ Stop', () =>
      void run('Stopping', async () => {
        return api.stopBarPreview(host.value.trim(), token.value);
      })
    )
  );

  function update(): void {
    title.textContent = `${store.scene.id}${store.dirty ? ' •' : ''}`;
    undo.disabled = !store.canUndo;
    redo.disabled = !store.canRedo;
  }

  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === 's') {
      e.preventDefault();
      (root.querySelector('button.primary') as HTMLButtonElement | null)?.click();
    }
  });

  store.subscribe(({ reason }) => {
    if (reason !== 'frame') update();
  });
  update();

  void run('Loading', async () => {
    await refreshList();
    const defaults = await api.barDefaults();
    if (!host.value) host.value = defaults.host;
    if (defaults.hasEnvToken) token.placeholder = 'token from BUSYBAR_TOKEN';
    return 'Ready.';
  });
}
