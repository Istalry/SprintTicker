const http = require('http');
const zlib = require('zlib');

/**
 * Checks a real BUSY Bar against the contract this app relies on, and reports
 * which of firmware 1.2.3's additions it actually accepts.
 *
 * The unit suite cannot do any of this: it mocks the driver, so it proves what
 * we send and nothing about what the device does with it. Every hardware
 * defect in this repository's history was found by running the app and reading
 * a console, which is a slow way to answer "did the firmware change under us".
 *
 *   node scripts/busybar-probe.js              # against 10.0.4.20 over USB
 *   BUSYBAR_IP=10.0.4.20 node scripts/busybar-probe.js
 *
 * **Close SprintTicker first.** It holds the display at priority 95, and this
 * probe draws at the same priority; with the app running you will get 409s that
 * mean "the app owns the display", not "the device refused".
 *
 * Safety, because parts of this API are unforgiving:
 *
 * - It uses its own `application_name`, so the DELETE calls can never remove
 *   elements belonging to the running app.
 * - It sends **no `rectangle` elements at all.** A solid fill takes exactly one
 *   colour and a gradient exactly two, and the wrong count reboots the device.
 *   Nothing here is worth that risk, so the probe sticks to `image` and `text`.
 * - It does not touch the RTC, the updater, storage, or any setting.
 * - It removes what it drew before it exits, including on failure.
 */

const IP = process.env.BUSYBAR_IP || '10.0.4.20';
const APP = 'sprintticker_probe';
const PRIORITY = 95; // The app must be >= 95 to hold the display at all.
const TIMEOUT_MS = 4000;

const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail });
  const tag = { pass: '  PASS ', fail: '  FAIL ', info: '  INFO ', skip: '  N/A  ' }[status];
  console.log(`${tag} ${name}${detail ? ' -- ' + detail : ''}`);
}

/** One request to the device, with a timeout. A hung socket must not hang the probe. */
function request(method, path, { body, contentType } = {}) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: IP,
        port: 80,
        method,
        path,
        headers: payload
          ? { 'Content-Type': contentType || 'application/json', 'Content-Length': payload.length }
          : {}
      },
      res => {
        let raw = '';
        res.on('data', c => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      }
    );
    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error(`timed out after ${TIMEOUT_MS}ms`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Builds a real PNG of the front matrix's dimensions.
 *
 * Deliberately 72x16 rather than a 1x1 token: payload size is a thing the
 * device has an opinion about (413 is permanent), so the probe should upload
 * what the app uploads.
 */
function makePng(width = 72, height = 16) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const p = rowStart + 1 + x * 4;
      const lit = (x + y) % 8 === 0;
      raw[p] = lit ? 0xe3 : 0x00;
      raw[p + 1] = lit ? 0xa3 : 0x00;
      raw[p + 2] = lit ? 0x40 : 0x00;
      raw[p + 3] = 0xff;
    }
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

async function cleanup() {
  try {
    await request('DELETE', `/api/display/draw?application_name=${APP}`);
    await request('DELETE', `/api/assets/upload?application_name=${APP}`);
  } catch {
    // Best effort: the probe has already reported what matters, and a failed
    // cleanup must not mask it. The elements carry a timeout anyway.
  }
}

async function main() {
  console.log(`\nBUSY Bar probe -- ${IP}\n`);
  console.log('Close SprintTicker before running this, or expect 409s that only');
  console.log('mean the app is holding the display.\n');

  // --- reachability, and which firmware we are actually testing -------------
  let firmware = 'unknown';
  try {
    const status = await request('GET', '/api/status');
    if (status.status !== 200) {
      record('Device reachable', 'fail', `GET /api/status returned ${status.status}`);
      return;
    }
    record('Device reachable', 'pass', `GET /api/status 200`);
    try {
      const fw = await request('GET', '/api/status/firmware');
      const parsed = JSON.parse(fw.body);
      firmware = parsed.version || parsed.firmware || JSON.stringify(parsed).slice(0, 60);
    } catch {
      // Not fatal: the version is context for the report, not a check.
    }
    record('Firmware version', 'info', firmware);
  } catch (err) {
    record('Device reachable', 'fail', `${err.message}. Is the bar plugged in over USB?`);
    return;
  }

  const png = makePng();

  // --- the contract the app depends on today -------------------------------
  try {
    const up = await request(
      'POST',
      `/api/assets/upload?application_name=${APP}&file=probe_frame.png`,
      { body: png, contentType: 'image/png' }
    );
    record(
      'Asset upload (72x16 PNG)',
      up.status >= 200 && up.status < 300 ? 'pass' : 'fail',
      `${up.status} ${up.body.slice(0, 80)}`
    );
  } catch (err) {
    record('Asset upload (72x16 PNG)', 'fail', err.message);
  }

  const drawImage = (extra = {}) => ({
    application_name: APP,
    priority: PRIORITY,
    elements: [
      {
        id: 'probe_img',
        type: 'image',
        x: 0,
        y: 0,
        display: 'front',
        path: 'probe_frame.png',
        timeout: 20,
        ...extra
      }
    ]
  });

  let displayOwned = false;
  try {
    const draw = await request('POST', '/api/display/draw', { body: drawImage() });
    if (draw.status === 409) {
      displayOwned = true;
      record('Draw image at priority 95', 'info', '409 -- something else owns the display (close the app)');
    } else {
      record(
        'Draw image at priority 95',
        draw.status >= 200 && draw.status < 300 ? 'pass' : 'fail',
        `${draw.status} ${draw.body.slice(0, 80)}`
      );
    }
  } catch (err) {
    record('Draw image at priority 95', 'fail', err.message);
  }

  // --- what 1.2.3 added ----------------------------------------------------
  // A 400 here is a meaningful answer, not a failure: it means this firmware
  // does not know the field, so the feature is not available to build on.
  try {
    const z = await request('POST', '/api/display/draw', { body: drawImage({ z_index: 10 }) });
    if (z.status === 409) {
      record('z_index accepted', 'skip', 'display owned; re-run with the app closed');
    } else if (z.status >= 200 && z.status < 300) {
      record('z_index accepted', 'pass', 'compositing is available -- see ROADMAP section 4');
    } else {
      record('z_index accepted', 'info', `${z.status} -- not supported on this firmware`);
    }
  } catch (err) {
    record('z_index accepted', 'fail', err.message);
  }

  try {
    const del = await request('DELETE', '/api/display/draw', {
      body: { application_name: APP, element_ids: ['probe_img'] }
    });
    record(
      'Selective removal (element_ids)',
      del.status >= 200 && del.status < 300 ? 'pass' : 'info',
      `${del.status}${del.status >= 400 ? ' -- not supported on this firmware' : ''}`
    );
  } catch (err) {
    record('Selective removal (element_ids)', 'fail', err.message);
  }

  try {
    const sub = await request(
      'POST',
      `/api/assets/upload?application_name=${APP}&file=${encodeURIComponent('probe/nested.png')}`,
      { body: png, contentType: 'image/png' }
    );
    record(
      'Asset upload into a subdirectory',
      sub.status >= 200 && sub.status < 300 ? 'pass' : 'info',
      `${sub.status}${sub.status >= 400 ? ' -- not supported on this firmware' : ''}`
    );
  } catch (err) {
    record('Asset upload into a subdirectory', 'fail', err.message);
  }

  await cleanup();

  const failed = results.filter(r => r.status === 'fail');
  console.log('');
  if (displayOwned) {
    console.log('Some checks were inconclusive because the display was owned by another');
    console.log('application. Close SprintTicker and run again for a full answer.\n');
  }
  if (failed.length) {
    console.log(`${failed.length} check(s) failed -- the contract this app relies on has moved.\n`);
    process.exitCode = 1;
  } else {
    console.log('The contract this app relies on still holds.\n');
  }
}

main().catch(async err => {
  console.error(`\n[probe] Unexpected failure: ${err.message}\n`);
  await cleanup();
  process.exitCode = 1;
});
