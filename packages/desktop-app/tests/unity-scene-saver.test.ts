import { describe, it, expect, vi } from 'vitest';
import { createUnitySceneSaver, UNITY_SCENE_SAVE_PORTS } from '../src/main/services/unity-scene-saver';

describe('createUnitySceneSaver', () => {
  const answering = (ports: number[], ok = true) =>
    vi.fn(async (url: string) => {
      const port = Number(new URL(url).port);
      if (!ports.includes(port)) throw new TypeError('fetch failed');
      return { ok } as Response;
    });

  it('Save_EveryPluginPort_IsAsked', async () => {
    // A second Editor binds the next free port, so asking only 8081 would
    // leave every other open project unsaved.
    const fetchImpl = answering([]);

    await createUnitySceneSaver(fetchImpl)();

    expect(fetchImpl.mock.calls.map(([url]) => Number(new URL(url).port))).toEqual([...UNITY_SCENE_SAVE_PORTS]);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:8081/sprintticker/save-scenes/');
  });

  it('Save_OneEditorAnswers_IsTrue', async () => {
    await expect(createUnitySceneSaver(answering([8083]))()).resolves.toBe(true);
  });

  it('Save_NoEditorOpen_IsFalseNotAnError', async () => {
    await expect(createUnitySceneSaver(answering([]))()).resolves.toBe(false);
  });

  it('Save_EditorRefuses_IsFalse', async () => {
    await expect(createUnitySceneSaver(answering([8081], false))()).resolves.toBe(false);
  });
});
