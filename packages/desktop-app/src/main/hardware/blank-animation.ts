import type { AnimFormat } from '../../shared/anim-format';

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
 * One file per `.anim` format, since a bar reads only its own
 * (`shared/anim-format.ts`), and a blank in the wrong one would leave the
 * firmware's load-error placeholder where the animation was. The bytes are
 * `Animations/blank_16x16/blank_16x16/blank_16x16.anim` and `.v1.anim`,
 * compiled by the firmware's `seq2anim.py` and `seq2anim_v1.py`, and held here
 * so the driver needs no file to hand. `blank-animation.test.ts` holds them
 * equal. The name on the device is the same for both.
 */
export const BLANK_ANIMATION_FILE = 'blank_16x16.anim';

export const BLANK_ANIMATION_BYTES: Readonly<Record<AnimFormat, Buffer>> = {
  0: Buffer.from(
    'YmljeWNsZTAAEBACARMAABUAAAAXAAAAAQAAAAEAAAABAAAAAAAAAAAAAAA5AAAAAWRlZmF1bHQAAQETAH8AAAAAfwAAAACCAAAAAAAAAAA=',
    'base64'
  ),
  1: Buffer.from(
    'YmljeWNsZTEAEBACAAATAAEAFAAAABgAAAABAAAAAQAAAAAAAAAAAAAANgAAAGRlZmF1bHQAEQAAEwB/AAAAAH8AAAAAggAAAAAAAAAA',
    'base64'
  )
};
