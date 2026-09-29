const http = require('http');
const zlib = require('zlib');

/**
 * The few device calls the development tools share: the probe and the
 * animation studio's bar preview.
 *
 * Extracted from `scripts/busybar-probe.js` rather than written a second time.
 * Two copies of "how to talk to the bar" would drift the way the app's
 * notification defaults once did, and each hardware trap recorded in CLAUDE.md
 * §4 would have to be learned twice.
 *
 * Dependency-free CommonJS like the rest of `scripts/`. It is **not** the app's
 * driver and must not become one: the app's device code lives in
 * `BusyBarDriver`, which has the connection state, retries and error contract
 * the app depends on. This is for tools that run for a minute and exit.
 *
 * The host is passed to `http.request` as a host, never concatenated into a
 * URL, but callers that take it from a user must still validate it first --
 * the studio uses the app's own `isValidDeviceHost`.
 */

const DEFAULT_TIMEOUT_MS = 4000;

/**
 * A client for one bar.
 *
 * `token` is sent as `x-api-token` when set: a bar reached over Wi-Fi usually
 * requires one, and one reached over USB does not.
 */
function createDeviceClient({ host, token = '', timeoutMs = DEFAULT_TIMEOUT_MS }) {
  if (!host) throw new Error('createDeviceClient requires a host.');

  /** One request, with a timeout. A hung socket must not hang the tool. */
  function request(method, path, { body, contentType, timeoutMs: perCall = timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const payload =
        body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
      const headers = payload
        ? { 'Content-Type': contentType || 'application/json', 'Content-Length': payload.length }
        : {};
      if (token) headers['x-api-token'] = token;

      const req = http.request({ host, port: 80, method, path, headers }, res => {
        // Collected as Buffers, not by string concatenation: `GET /api/screen`
        // returns binary, and appending binary chunks to a string decodes them
        // as UTF-8 and silently mangles every byte above 0x7F.
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({ status: res.statusCode, body: buffer.toString('utf8'), buffer });
        });
      });
      req.on('error', reject);
      req.setTimeout(perCall, () => {
        req.destroy();
        reject(new Error(`timed out after ${perCall}ms`));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  return { host, request };
}

/** Encodes tightly-packed RGBA into a PNG. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(
      raw,
      rowStart + 1,
      y * width * 4,
      (y + 1) * width * 4
    );
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

module.exports = { createDeviceClient, encodePng, crc32, DEFAULT_TIMEOUT_MS };
