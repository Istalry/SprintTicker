/**
 * Address the BUSY Bar answers on over its USB Ethernet link.
 *
 * Fixed by the device, not a preference. It lives in `shared` because the
 * onboarding wizard needs to display it and the renderer must not import from
 * `src/main`, where the driver's copy lives.
 */
export const DEFAULT_USB_IP = '10.0.4.20';

/**
 * The `application_name` every draw, asset upload and delete is filed under on
 * the device.
 *
 * Shared because it must be identical in all four: the renderer draws under it,
 * the animation player uploads under it, and quit calls `clearDisplay` and
 * `deleteAppAssets` with it. A copy that drifts leaves assets stranded on the
 * hardware with nothing able to address them.
 *
 * Must match the device's `^[a-zA-Z0-9._-]+$` rule -- no spaces, no path
 * separators.
 */
export const DEVICE_APPLICATION_NAME = 'sprintticker';
