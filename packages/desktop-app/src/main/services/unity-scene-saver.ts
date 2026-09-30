/**
 * Asks every open Unity Editor to save its scenes, for the end-of-day wrap-up.
 *
 * The plugin's `BusyBarSceneSaveListener` binds the first free port from 8081
 * upwards, so a second Editor lands on 8082 and so on; the range is the
 * plugin's, and the two must change together.
 */
export const UNITY_SCENE_SAVE_PORTS: readonly number[] = [8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089];

/** Long enough for an Editor mid-import to answer, short enough not to stall the wrap-up. */
export const UNITY_SCENE_SAVE_TIMEOUT_MS = 1500;

/** Resolves true when at least one Editor saved. Never rejects. */
export type UnitySceneSaver = () => Promise<boolean>;

/**
 * Builds the saver over a `fetch`.
 *
 * Injectable because the real one reaches whatever is listening on the
 * developer's own machine: a test that ran the wrap-up with the default saved
 * the scenes of any Editor that happened to be open.
 */
export function createUnitySceneSaver(fetchImpl?: typeof fetch): UnitySceneSaver {
  return async () => {
    const request = fetchImpl ?? fetch;
    const answers = await Promise.all(
      UNITY_SCENE_SAVE_PORTS.map(async port => {
        try {
          const response = await request(`http://localhost:${port}/sprintticker/save-scenes/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(UNITY_SCENE_SAVE_TIMEOUT_MS)
          });
          return response.ok;
        } catch {
          // Nothing listening on this port is the normal case: one Editor
          // open, or none. Not an error to report.
          return false;
        }
      })
    );
    return answers.some(Boolean);
  };
}
