import { DeviceConfigDTO } from './dtos';

/**
 * Address the BUSY Bar answers on over its USB Ethernet link.
 *
 * The **default**, not a constant of nature. This was documented for a long
 * time as fixed by the device and therefore correct to hardcode -- and over a
 * healthy USB link it is what the bar uses. But the address the *app* must dial
 * is not always the address the bar holds:
 *
 * - Over Wi-Fi the bar takes a DHCP lease and is somewhere else entirely.
 * - When Windows' inbox CDC-NCM driver refuses to start the interface (a real
 *   failure, seen on 25H2 / Intel 700-series xHCI), the working recovery is to
 *   pass the device through to another stack and proxy it back on a *different*
 *   address. A bar reachable only at `10.0.4.21` is still a bar.
 *
 * So this seeds `DeviceConfigDTO.ipAddress` on first run and nothing more.
 * Read the configured value, never this, when talking to hardware.
 *
 * It lives in `shared` because the onboarding wizard needs to display it and
 * the renderer must not import from `src/main`, where the driver's copy lives.
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

/**
 * Stacking order of the layers the app draws on the front panel.
 *
 * The whole screen is one full-panel PNG, `px_matrix_img`, with every icon's
 * static pixels already in it. An animated icon is a separate `animation`
 * element at x=0 drawn *above* it, so the static icon underneath is what shows
 * whenever the animation is not there -- refused, not yet uploaded, or removed.
 *
 * A full-panel scene (lunch, away, meeting, task done) goes *below* the frame.
 * That is what lets the screen change without ever being emptied: the scene is
 * drawn hidden under the current frame, then the frame is removed to reveal
 * it; on the way back the next frame covers the scene before the scene is
 * removed. Emptying the element set closes the device's screen, and on
 * firmware 1.2.4 closing it after an image and an animation have shared it
 * hangs the bar -- see `FRONT_ELEMENT_IDS`.
 *
 * Numbers rather than draw order, because draw order does not decide it:
 * without `z_index`, the image composites above an animation whichever of the
 * two arrived first. With it, the icon stays on top through any number of
 * frame redraws. Measured on firmware 1.2.4 (`pnpm probe:busybar --compositing`).
 * 0 is the schema's minimum.
 */
export const FRONT_LAYER_Z = {
  SCENE: 0,
  FRAME: 1,
  ICON: 2
} as const;

/**
 * The ids of the elements the app draws on the front panel, one per layer.
 *
 * Shared because the driver, the animation player and the icon animator each
 * remove elements the others drew, and a removal by an id that drifted from
 * the draw answers 400 -- which reads as "already gone" and hides the element
 * that is in fact still there.
 */
export const FRONT_ELEMENT_IDS = {
  SCENE: 'hardware_anim',
  FRAME: 'px_matrix_img',
  ICON: 'icon_anim'
} as const;

/**
 * Whether `value` is usable as the device's host part of a URL.
 *
 * Accepts a dotted IPv4 address or a DNS/mDNS hostname, because both are real:
 * over USB the bar is at a fixed IPv4 address, over Wi-Fi it may be reachable
 * by name, and a host that proxies it can be either. Rejects anything carrying
 * a scheme, port, path, credentials or whitespace -- those get concatenated
 * straight into `http://${host}/api/...`, where a stray `/` or `@` silently
 * retargets every request at a different origin.
 *
 * Deliberately not a strict RFC hostname check. The cost of being slightly
 * permissive is a request that fails and says so; the cost of being strict is
 * refusing an address that would have worked.
 */
export function isValidDeviceHost(value: string): boolean {
  const host = value.trim();
  if (host.length === 0 || host.length > 253) return false;
  // An allow-list rather than a list of forbidden characters, deliberately.
  // A blocklist has to enumerate every character that could retarget the URL --
  // `/`, `\`, `@`, `:`, `?`, `#` -- inside a character class where several of
  // them need escaping, and one that goes missing is a hole nothing reports.
  // Only these characters appear in an IPv4 address or a hostname anyway.
  if (!/^[A-Za-z0-9.-]+$/.test(host)) return false;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    return ipv4.slice(1).every(octet => {
      const n = Number(octet);
      return n >= 0 && n <= 255 && String(n) === String(Number(octet));
    });
  }

  // Hostname: labels of alphanumerics and hyphens, not starting or ending in one.
  return host
    .split('.')
    .every(label => /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
}

/**
 * A URL with any `x-api-token` query parameter replaced by `***`.
 *
 * The StateStream WebSocket takes the token in the query string, and the
 * driver logs the URL it is connecting to. Console output is captured verbatim
 * into the diagnostics bundle a user attaches to a bug report, so logging the
 * raw URL would mail the token to whoever reads it.
 */
export function redactTokenInUrl(url: string): string {
  return url.replace(/([?&]x-api-token=)[^&]*/gi, '$1***');
}

/**
 * Settings key and seed value for the persisted device configuration.
 *
 * One copy, because there are two readers -- the startup path in
 * `main/index.ts` and the `GET_DEVICE_CONFIG` handler -- and a default that
 * disagrees between them is the duplicated-constant failure this codebase has
 * already shipped twice: nothing errors, and which value wins depends on which
 * code path ran first.
 */
export const DEVICE_CONFIG_SETTING_KEY = 'device_config';

export const DEFAULT_DEVICE_CONFIG: DeviceConfigDTO = {
  enabled: true,
  showIdleClockFallback: true,
  ipAddress: DEFAULT_USB_IP,
  apiToken: ''
};
