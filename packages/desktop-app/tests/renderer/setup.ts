import { beforeEach, vi } from 'vitest';
import { installElectronApi } from './electron-api-mock';

/**
 * The browser pieces jsdom does not have, stubbed to the least that lets a
 * view mount. None of them is what these tests are about.
 */

// jsdom has no layout, so nothing would ever resize anyway.
class StillResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', StillResizeObserver);

// jsdom implements no canvas and says so on stderr for every call. The
// components already cope with a missing context -- a window can lose it -- so
// answering null exercises a real path rather than faking a canvas.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

// A fresh bridge for every test, so a test that changes an answer cannot leak
// it into the next.
beforeEach(() => {
  installElectronApi();
});
