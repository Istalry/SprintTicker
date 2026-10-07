/**
 * An animation that shows nothing: one transparent 16x16 frame, `argb8888`.
 *
 * It is what an animated element is replaced with instead of being removed.
 * On firmware 1.2.4, removing a playing animation by id hangs the bar now and
 * then -- a probe soak of the gear icon froze it on the 30th and the 59th
 * removal, the app on the 13th -- while drawing another animation under the
 * same id survived 200 swaps, and closing the screen with only animations on
 * it survived 100 (`pnpm probe:busybar --teardown-soak --park`, 2026-10-07).
 * So an icon or a scene that has to go is replaced by this, and leaves the
 * panel only when the screen closes.
 *
 * The bytes are `Animations/blank_16x16/blank_16x16/blank_16x16.anim`,
 * compiled by the firmware's `seq2anim.py` and held here so the driver needs
 * no file to hand. `blank-animation.test.ts` holds the two equal.
 */
export const BLANK_ANIMATION_FILE = 'blank_16x16.anim';

export const BLANK_ANIMATION_BYTES: Buffer = Buffer.from(
  'YmljeWNsZTAAEBACARMAABUAAAAXAAAAAQAAAAEAAAABAAAAAAAAAAAAAAA5AAAAAWRlZmF1bHQAAQETAH8AAAAAfwAAAACCAAAAAAAAAAA=',
  'base64'
);
