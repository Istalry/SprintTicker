import { defineConfig } from 'vite';

/**
 * Builds the asset generator into `build/`, outside the plugin's folder, so
 * it can import the faces and the app's bitmaps as the plugin does and still
 * run under plain Node. It never ships.
 */
export default defineConfig({
  build: {
    ssr: 'src/assets/write-assets.ts',
    outDir: 'build',
    emptyOutDir: true,
    target: 'node24',
    minify: false,
    rolldownOptions: { output: { entryFileNames: 'write-assets.js', format: 'es' } }
  },
  ssr: { noExternal: true, target: 'node' }
});
