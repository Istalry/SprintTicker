import { defineConfig } from 'vite';

/**
 * Bundles the command into one ES module the app's own executable runs under
 * `ELECTRON_RUN_AS_NODE` (AGENT-INTERFACE.md §7): the shared protocol goes
 * in, and nothing else is needed -- Node's own `fetch` and `readline` do the
 * rest -- so the installed copy needs no node_modules.
 */
export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    emptyOutDir: true,
    // Electron 44's Node, which runs it in the installed app.
    target: 'node24',
    minify: false,
    sourcemap: false,
    rolldownOptions: {
      output: { entryFileNames: 'sprintticker.mjs', format: 'es' }
    }
  },
  ssr: { noExternal: true, target: 'node' }
});
