import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');

/**
 * Mounts the studio's API (`server/api.ts`) on the dev server.
 *
 * The API is loaded through the dev server rather than imported here, so this
 * file imports nothing from the workspace. A config that pulls in TypeScript
 * from `server/`, `src/` and the desktop app is what Vite's native config
 * loader -- planned to become the default -- cannot load, and it warned about
 * every one of those imports on each start.
 */
function studioApi(): Plugin {
  return {
    name: 'anim-studio-api',
    configureServer(server) {
      type Api = import('./server/api').StudioApi;
      const api: Promise<Api> = server
        .ssrLoadModule('/server/api.ts')
        .then(mod => (mod as typeof import('./server/api')).createStudioApi({
          repoRoot,
          scenesDir: path.join(here, 'scenes'),
          animationsDir: path.join(repoRoot, 'Animations')
        }));

      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next();
          return;
        }
        api.then(a => a.handle(req, res, next)).catch((err: unknown) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: `the studio API failed to load: ${String(err)}` }));
        });
      });

      server.httpServer?.on('close', () => {
        // Best effort: the preview element carries its own timeout, so a
        // failure here only means it stays on the bar until that runs out.
        api
          .then(a => a.close())
          .catch((err: unknown) => console.warn(`[anim-studio] could not clear the bar preview: ${String(err)}`));
      });
    }
  };
}

export default defineConfig({
  root: here,
  server: {
    // Loopback only: the API writes into the repository and drives hardware.
    host: '127.0.0.1',
    port: 5180,
    fs: {
      // The studio imports the app's fonts and shared constants in place.
      allow: [repoRoot]
    }
  },
  plugins: [studioApi()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
