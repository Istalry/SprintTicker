import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isValidDeviceHost,
  redactTokenInUrl,
  DEFAULT_DEVICE_CONFIG,
  DEFAULT_USB_IP
} from '../src/shared/device-constants';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';

/**
 * The device address stopped being a constant.
 *
 * It was hardcoded on the premise that the bar always answers on
 * `10.0.4.20` over USB -- true of the device, but not of the address the *app*
 * has to dial. A bar on Wi-Fi holds a DHCP lease, and a bar reached through a
 * local proxy (the working recovery when Windows' inbox CDC-NCM driver refuses
 * to start the interface) answers somewhere else entirely.
 */
describe('device address configuration', () => {
  describe('isValidDeviceHost', () => {
    it('IsValidDeviceHost_Ipv4AndHostnames_Accepts', () => {
      for (const host of [
        DEFAULT_USB_IP,
        '10.0.4.21', // the proxy address this feature exists for
        '192.168.1.100',
        '0.0.0.0',
        '255.255.255.255',
        'busybar.local',
        'busy-bar',
        'BusyBar.LAN'
      ]) {
        expect(isValidDeviceHost(host), host).toBe(true);
      }
    });

    it('IsValidDeviceHost_SurroundingWhitespace_AcceptsBecauseItIsTrimmed', () => {
      // Pasted addresses carry whitespace far more often than not, and
      // rejecting `' 10.0.4.21 '` teaches the user nothing except to look for
      // an invisible character.
      expect(isValidDeviceHost('  10.0.4.21  ')).toBe(true);
    });

    it('IsValidDeviceHost_AnythingThatCouldRetargetTheUrl_Rejects', () => {
      // The value is concatenated into `http://${host}/api/...`. Every one of
      // these silently sends device traffic somewhere other than the device,
      // which is a far worse outcome than a rejected input.
      for (const host of [
        'http://10.0.4.21', //  scheme
        '10.0.4.21/api', //     path
        '10.0.4.21:8080', //    port
        'evil.test\\10.0.4.21', // backslash -- the case a blocklist regex lost
        'user@10.0.4.21', //    credentials
        '10.0.4.21?x=1', //     query
        '10.0.4.21#frag', //    fragment
        '10.0.4 .21', //        inner whitespace
        '[::1]' //              bracketed IPv6, which the URL builder cannot form
      ]) {
        expect(isValidDeviceHost(host), host).toBe(false);
      }
    });

    it('IsValidDeviceHost_EmptyOrOverlong_Rejects', () => {
      expect(isValidDeviceHost('')).toBe(false);
      expect(isValidDeviceHost('   ')).toBe(false);
      expect(isValidDeviceHost(`${'a'.repeat(254)}`)).toBe(false);
    });

    it('IsValidDeviceHost_OutOfRangeOrMalformedOctets_Rejects', () => {
      // `10.0.4.999` reaching the driver would not fail loudly -- it is a
      // syntactically fine hostname that simply never resolves.
      for (const host of ['10.0.4.999', '256.0.0.1', '10.0.4.', '10.0.4.-1', '-busybar', 'bar-']) {
        expect(isValidDeviceHost(host), host).toBe(false);
      }
    });
  });

  describe('redactTokenInUrl', () => {
    it('RedactTokenInUrl_StateStreamUrlWithToken_RemovesTheSecret', () => {
      // The driver logs the StateStream URL, console output is captured into
      // the diagnostics bundle, and users attach that bundle to bug reports.
      // Without this the token is mailed to whoever reads it.
      const redacted = redactTokenInUrl('ws://192.168.1.5/api/status/ws?x-api-token=s3cret');

      expect(redacted).toBe('ws://192.168.1.5/api/status/ws?x-api-token=***');
      expect(redacted).not.toContain('s3cret');
    });

    it('RedactTokenInUrl_NoToken_LeavesUrlUntouched', () => {
      const url = `ws://${DEFAULT_USB_IP}/api/status/ws`;
      expect(redactTokenInUrl(url)).toBe(url);
    });
  });

  describe('DEFAULT_DEVICE_CONFIG', () => {
    it('DefaultDeviceConfig_OnFirstRun_SeedsTheUsbAddressAndNoToken', () => {
      // One copy, read by both the startup path and the IPC handler. Two
      // defaults that disagree is a bug this codebase has already shipped.
      expect(DEFAULT_DEVICE_CONFIG.ipAddress).toBe(DEFAULT_USB_IP);
      expect(DEFAULT_DEVICE_CONFIG.apiToken).toBe('');
      expect(DEFAULT_DEVICE_CONFIG.showIdleClockFallback).toBe(true);
    });
  });

  describe('BusyBarDriver.reconfigure', () => {
    let driver: BusyBarDriver | null = null;

    afterEach(() => {
      driver?.disconnect();
      driver = null;
      vi.unstubAllGlobals();
    });

    it('Reconfigure_NewAddress_RepointsTheDriverAndReportsIt', async () => {
      driver = new BusyBarDriver({ ipAddress: DEFAULT_USB_IP, forceMock: true });
      await driver.connect();

      await driver.reconfigure({ ipAddress: '10.0.4.21', apiToken: '' });

      expect(driver.getIpAddress()).toBe('10.0.4.21');
      expect(driver.getDeviceStatus().ipAddress).toBe('10.0.4.21');
    });

    it('Reconfigure_NewToken_AppliesItToSubsequentRequests', async () => {
      driver = new BusyBarDriver({ ipAddress: DEFAULT_USB_IP, forceMock: true });
      await driver.connect();

      await driver.reconfigure({ ipAddress: DEFAULT_USB_IP, apiToken: 'wifi-token' });

      expect(driver.getApiToken()).toBe('wifi-token');
    });

    it('Reconfigure_EmptyAddress_ThrowsRatherThanDiallingNowhere', async () => {
      driver = new BusyBarDriver({ ipAddress: DEFAULT_USB_IP, forceMock: true });
      await driver.connect();

      await expect(driver.reconfigure({ ipAddress: '   ', apiToken: '' })).rejects.toThrow();
      // The previous target survives a rejected change -- a failed edit must
      // not leave the driver pointing at nothing.
      expect(driver.getIpAddress()).toBe(DEFAULT_USB_IP);
    });

    it('Reconfigure_UnreachableAddress_ReturnsFalseButKeepsTheSetting', async () => {
      // A false here means "saved, and it did not answer", which is a real
      // answer the user needs -- not a failure to apply the setting. Losing the
      // typed value on a failed connection would make a bar that is merely
      // asleep indistinguishable from a typo.
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
      driver = new BusyBarDriver({ ipAddress: DEFAULT_USB_IP, forceMock: false });

      const connected = await driver.reconfigure({ ipAddress: '10.0.4.99', apiToken: '' });

      expect(connected).toBe(false);
      expect(driver.getIpAddress()).toBe('10.0.4.99');
      expect(driver.getDeviceStatus().connected).toBe(false);
    });

    it('Reconfigure_AddressChanged_ReportsWifiConnectionTypeOffTheDefault', async () => {
      // Documented rather than asserted as correct: HTTP over USB Ethernet and
      // HTTP over Wi-Fi are indistinguishable from the driver, so anything that
      // is not the default USB address reads as `wifi` -- including a proxy
      // that is physically on USB. The address beside it is the true part.
      driver = new BusyBarDriver({ ipAddress: DEFAULT_USB_IP, forceMock: true });
      await driver.connect();
      expect(driver.getDeviceStatus().connectionType).toBe('usb');

      await driver.reconfigure({ ipAddress: '10.0.4.21', apiToken: '' });
      expect(driver.getDeviceStatus().connectionType).toBe('wifi');
    });
  });
});
