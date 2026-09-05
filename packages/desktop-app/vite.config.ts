import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * The renderer's Content-Security-Policy, injected into the built HTML only.
 *
 * It cannot be a static tag in index.html: the Vite dev server injects its own
 * inline module preamble and opens an HMR websocket, so a policy strict enough
 * to be worth having in production breaks `pnpm dev`. It also cannot be an
 * onHeadersReceived hook, because production loads the renderer over file://
 * and there are no response headers to attach it to.
 *
 * `default-src 'none'` means every directive below is an explicit allowance:
 *
 * - script-src 'self'      the bundle, nothing else. No 'unsafe-eval'.
 * - style-src 'unsafe-inline'  React writes `style` attributes, and
 *                          HardwareDisplayEmulator sizes its canvas that way.
 *                          Inline style attributes fall back to style-src, so
 *                          this is required and cannot be narrowed without
 *                          rewriting those components.
 * - img-src data: blob:    canvas readback for the display emulator.
 * - connect-src 'none'     the renderer talks to main over IPC and makes no
 *                          network requests of its own. Verified: no fetch,
 *                          XMLHttpRequest, WebSocket or Worker in src/renderer.
 *
 * `frame-ancestors` is deliberately absent. Chromium ignores it when delivered
 * in a meta element and logs a console warning on every launch saying so, and
 * there is nothing to protect: the renderer is loaded from file:// by this
 * application and cannot be framed by anyone.
 */
const RENDERER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'"
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'sprintticker-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `  <meta http-equiv="Content-Security-Policy" content="${RENDERER_CSP}" />\n  </head>`
      );
    }
  };
}

export default defineConfig({
  base: './',
  root: path.join(__dirname, 'src/renderer'),
  plugins: [react(), cspPlugin()],
  publicDir: path.join(__dirname, 'public'),
  build: {
    outDir: path.join(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(__dirname, 'src/renderer/index.html')
    }
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@main': path.resolve(__dirname, 'src/main')
    }
  },
  server: {
    port: 3000,
    strictPort: true
  }
});


