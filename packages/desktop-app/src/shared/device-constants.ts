/**
 * Address the BUSY Bar answers on over its USB Ethernet link.
 *
 * Fixed by the device, not a preference. It lives in `shared` because the
 * onboarding wizard needs to display it and the renderer must not import from
 * `src/main`, where the driver's copy lives.
 */
export const DEFAULT_USB_IP = '10.0.4.20';
