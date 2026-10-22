import { defineConfig } from 'vite';

/**
 * Bundles the plugin into one ES module that Stream Deck's own Node.js runs:
 * the SDK, `ws` under it, and the app's shared protocol all go in, so the
 * installed plugin needs no node_modules.
 */
export default defineConfig({
  build: {
    ssr: 'src/plugin.ts',
    outDir: 'io.github.istalry.sprintticker.sdPlugin/bin',
    emptyOutDir: true,
    target: 'node24',
    // Readable when a user sends the plugin's log and a stack trace in it.
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      // ws loads these native speed-ups if it finds them, and does without.
      external: ['bufferutil', 'utf-8-validate'],
      output: { entryFileNames: 'plugin.js', format: 'es' }
    }
  },
  ssr: { noExternal: true, target: 'node' }
});
