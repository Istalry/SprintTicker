const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
 *
 * It also reads the panel back with `GET /api/screen?display=0` and writes each
 * frame out as a PNG, because several of the questions here are about *layout*
 * and a status code cannot answer those. A 200 says the device accepted a
 * countdown element; only the pixels say whether it fits beside a 16px icon.
 * Pass `--out <dir>` to choose where they land (default: a temp directory).
 */

const IP = process.env.BUSYBAR_IP || '10.0.4.20';
const APP = 'sprintticker_probe';
const PRIORITY = 95; // The app must be >= 95 to hold the display at all.
const TIMEOUT_MS = 4000;

const outFlag = process.argv.indexOf('--out');
const OUT_DIR =
  outFlag >= 0 && process.argv[outFlag + 1]
    ? process.argv[outFlag + 1]
    : fs.mkdtempSync(path.join(os.tmpdir(), 'busybar-probe-'));
fs.mkdirSync(OUT_DIR, { recursive: true });

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
        // Collected as Buffers, not by string concatenation: `GET /api/screen`
        // returns a BMP, and appending binary chunks to a string decodes them as
        // UTF-8 and silently mangles every byte above 0x7F.
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({ status: res.statusCode, body: buffer.toString('utf8'), buffer });
        });
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
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const lit = (x + y) % 8 === 0;
      rgba[p] = lit ? 0xe3 : 0x00;
      rgba[p + 1] = lit ? 0xa3 : 0x00;
      rgba[p + 2] = lit ? 0x40 : 0x00;
      rgba[p + 3] = 0xff;
    }
  }
  return encodePng(width, height, rgba);
}

/** Encodes tightly-packed RGBA into a PNG. Shared by the upload and the readback. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
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

const FRONT_WIDTH = 72;
const FRONT_HEIGHT = 16;

/**
 * Decodes whatever `GET /api/screen` hands back into RGBA.
 *
 * **The endpoint's own content type is wrong, and so is the spec.** It responds
 * `Content-Type: image/bmp` and `streaming.yaml` types the body as base64, but
 * on firmware 1.2.3 what actually arrives is base64-encoded *raw* pixels with
 * no BMP header at all: 4608 base64 characters decoding to 3456 bytes, which is
 * 72 x 16 x 3.
 *
 * Two things were measured rather than assumed, by drawing a pure red block at
 * the origin and reading the bytes back:
 *
 * - The channel order is **BGR**, not RGB -- red returned as `0000ff`. Getting
 *   this backwards still produces a plausible image, just with the colours
 *   swapped, which is exactly the sort of wrong answer that survives review.
 * - Rows are **top-down** with no padding, unlike BMP's bottom-up default.
 *
 * The BMP path below is kept anyway, in front, because the content type says
 * that is what it will one day be: if a firmware update starts sending a real
 * BMP this keeps working instead of silently misreading a header as pixels.
 */
function decodeFrame(res, width = FRONT_WIDTH, height = FRONT_HEIGHT) {
  if (res.buffer[0] === 0x42 && res.buffer[1] === 0x4d) return decodeBmp(res.buffer);

  const bytes = Buffer.from(res.body.trim(), 'base64');
  const expected = width * height * 3;
  if (bytes.length !== expected) {
    throw new Error(
      `unrecognised screen format: ${bytes.length} bytes, expected ${expected} ` +
        `(${width}x${height} BGR) or a BMP header`
    );
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = bytes[i * 3 + 2]; // R <- third byte
    rgba[i * 4 + 1] = bytes[i * 3 + 1];
    rgba[i * 4 + 2] = bytes[i * 3]; // B <- first byte
    rgba[i * 4 + 3] = 0xff;
  }
  return { width, height, rgba };
}

/**
 * Decodes a real BMP into RGBA, for the day the endpoint sends what it claims.
 *
 * Written by hand rather than pulled from npm because this script has no
 * dependencies and must not grow any: it is run against hardware, occasionally,
 * by whoever is holding the bar.
 *
 * Handles the three encodings a small embedded framebuffer plausibly emits --
 * 32bpp, 24bpp and 16bpp RGB565 -- and refuses anything else loudly rather than
 * returning a plausible-looking wrong image, which is the failure mode that
 * would quietly invalidate every measurement below.
 */
function decodeBmp(buf) {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) {
    throw new Error('not a BMP (no "BM" signature)');
  }
  const dataOffset = buf.readUInt32LE(0x0a);
  const width = buf.readInt32LE(0x12);
  const rawHeight = buf.readInt32LE(0x16);
  const bpp = buf.readUInt16LE(0x1c);
  const compression = buf.readUInt32LE(0x1e);

  // A negative height means the rows are stored top-down instead of the
  // bottom-up BMP default. Getting this backwards flips the image, which would
  // silently move every y coordinate reported below.
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);

  if (compression !== 0 && compression !== 3) {
    throw new Error(`unsupported BMP compression ${compression}`);
  }
  if (bpp !== 16 && bpp !== 24 && bpp !== 32) {
    throw new Error(`unsupported BMP bit depth ${bpp}`);
  }

  const bytesPerPixel = bpp / 8;
  const rowStride = Math.floor((bpp * width + 31) / 32) * 4; // rows pad to 4 bytes
  const rgba = Buffer.alloc(width * height * 4);

  for (let row = 0; row < height; row++) {
    const y = topDown ? row : height - 1 - row;
    const src = dataOffset + row * rowStride;
    for (let x = 0; x < width; x++) {
      const s = src + x * bytesPerPixel;
      let r, g, b;
      if (bpp === 16) {
        const v = buf.readUInt16LE(s); // RGB565
        r = ((v >> 11) & 0x1f) * 255 / 31;
        g = ((v >> 5) & 0x3f) * 255 / 63;
        b = (v & 0x1f) * 255 / 31;
      } else {
        b = buf[s];
        g = buf[s + 1];
        r = buf[s + 2];
      }
      const d = (y * width + x) * 4;
      rgba[d] = Math.round(r);
      rgba[d + 1] = Math.round(g);
      rgba[d + 2] = Math.round(b);
      rgba[d + 3] = 0xff;
    }
  }
  return { width, height, rgba };
}

/**
 * The bounding box of everything lit on the panel.
 *
 * This is the actual measurement the countdown question turns on: BUSY Bar's
 * own guidance warns countdowns render tall, and "tall" has to become a number
 * before anyone can say whether it coexists with a 16px icon in a 16px panel.
 */
function inkBounds({ width, height, rgba }, threshold = 24) {
  let minX = width, minY = height, maxX = -1, maxY = -1, lit = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if (rgba[p] > threshold || rgba[p + 1] > threshold || rgba[p + 2] > threshold) {
        lit++;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, lit };
}

/** Reads the front panel back and writes it out as a PNG. Returns the decoded frame. */
async function captureScreen(label) {
  const res = await request('GET', '/api/screen?display=0');
  if (res.status !== 200) throw new Error(`GET /api/screen returned ${res.status}`);

  const frame = decodeFrame(res);
  const file = path.join(OUT_DIR, `${label}.png`);
  fs.writeFileSync(file, encodePng(frame.width, frame.height, frame.rgba));
  frame.file = file;
  return frame;
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** A filled block, so a readback shows an unambiguous rectangle of ink. */
function makeSolidPng(width, height, [r, g, b]) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 0xff;
  }
  return encodePng(width, height, rgba);
}

/** Removes everything this probe has drawn, so each capture starts from a clear panel. */
async function clearProbeElements() {
  await request('DELETE', `/api/display/draw?application_name=${APP}`);
  await sleep(250);
}

const ELAPSED_UNDER_TEST = 65; // 01:05, so the minutes field is non-zero

/**
 * A countdown asking the bar to show `ELAPSED_UNDER_TEST` seconds elapsed.
 *
 * `skewSeconds` is added because the element counts against the device's RTC,
 * not ours. Passing 0 here is what produced a bar reading 00:47 for a 65-second
 * request -- the element was fine; the clocks were not.
 */
function countdownElement(extra = {}, skewSeconds = 0) {
  return {
    id: 'probe_cd',
    type: 'countdown',
    // Unix seconds, and the spec really does want it as a *string*.
    timestamp: String(Math.floor(Date.now() / 1000 + skewSeconds) - ELAPSED_UNDER_TEST),
    direction: 'time_since',
    show_hours: 'when_non_zero',
    color: '#FFFFFFFF',
    x: 0,
    y: 0,
    display: 'front',
    timeout: 30,
    ...extra
  };
}

async function drawElements(elements) {
  return request('POST', '/api/display/draw', {
    body: { application_name: APP, priority: PRIORITY, elements }
  });
}

/**
 * How far the device's RTC is from this machine's clock.
 *
 * This is not trivia. A countdown element counts against the *device's* own
 * clock, so a timestamp computed here is displayed with the skew added to it --
 * the probe asked for 65 seconds elapsed and the bar drew 47. Read-only: it
 * reports the skew and does not set the clock, because silently rewriting the
 * user's device time is not a probe's business.
 */
async function probeClockSkew() {
  try {
    const t0 = Date.now();
    const res = await request('GET', '/api/time');
    const t1 = Date.now();
    const parsed = JSON.parse(res.body);
    const deviceMs = Date.parse(parsed.timestamp);
    if (Number.isNaN(deviceMs)) throw new Error(`unparseable timestamp ${parsed.timestamp}`);

    const skew = (deviceMs - (t0 + t1) / 2) / 1000;
    const abs = Math.abs(skew);
    record(
      'Device RTC vs this machine',
      abs <= 2 ? 'pass' : 'info',
      `${skew >= 0 ? '+' : ''}${skew.toFixed(1)}s (round trip ${t1 - t0}ms)` +
        (abs > 2 ? ' -- a countdown driven from host time would be wrong by this much' : '')
    );
    return skew;
  } catch (err) {
    record('Device RTC vs this machine', 'fail', err.message);
    return null;
  }
}

async function probeCountdown() {
  // 0. The countdown counts against the device clock, so measure the offset
  //    first: without it, a wrong-looking countdown reads as a broken element.
  const skew = await probeClockSkew();

  // 1. Does it draw at all, and how tall is it?
  let solo = null;
  try {
    await clearProbeElements();
    const res = await drawElements([countdownElement({}, skew ?? 0)]);
    if (res.status < 200 || res.status >= 300) {
      record('Countdown element accepted', 'info', `${res.status} ${res.body.slice(0, 90)}`);
      return;
    }
    record('Countdown element accepted', 'pass', `${res.status}`);
  } catch (err) {
    record('Countdown element accepted', 'fail', err.message);
    return;
  }

  try {
    await sleep(400);
    solo = await captureScreen('countdown-alone');
    const box = inkBounds(solo);
    record(
      'Countdown rendered size',
      box ? 'info' : 'fail',
      box
        ? `${box.width}x${box.height}px at (${box.x},${box.y}) -- panel is ${solo.width}x${solo.height}. ${solo.file}`
        : `nothing lit on the panel -- accepted but not drawn. ${solo.file}`
    );
  } catch (err) {
    // Reported under its own name: the draw above already passed, and folding a
    // readback failure into that result would misreport which half broke.
    record('Countdown rendered size', 'fail', err.message);
    return;
  }

  // 2. Does it tick? Two captures a couple of seconds apart must differ.
  //    `direction: time_since` is documented to count up, which is what a
  //    session tracker needs, but documented is not measured.
  try {
    await sleep(2100);
    const later = await captureScreen('countdown-2s-later');
    const changed = !later.rgba.equals(solo.rgba);
    record(
      'Countdown ticks on its own',
      changed ? 'pass' : 'info',
      changed
        ? `frame changed after 2s with no redraw from us -- ${later.file}`
        : `frame identical after 2s; it may be static. ${later.file}`
    );
  } catch (err) {
    record('Countdown ticks on its own', 'fail', err.message);
  }

  // 3. The layout question: does it coexist with a 16px app icon?
  //    This is what decides whether ROADMAP section 4 is a layout exercise or
  //    a rewrite, and it is invisible from a status code.
  try {
    await request('POST', `/api/assets/upload?application_name=${APP}&file=probe_icon.png`, {
      body: makeSolidPng(16, 16, [0xe3, 0xa3, 0x40]),
      contentType: 'image/png'
    });
    await clearProbeElements();
    const res = await drawElements([
      { id: 'probe_icon', type: 'image', x: 0, y: 0, display: 'front', path: 'probe_icon.png', timeout: 30 },
      countdownElement({ x: 17, y: 0 }, skew ?? 0)
    ]);
    if (res.status < 200 || res.status >= 300) {
      record('Countdown beside a 16px icon', 'info', `${res.status} ${res.body.slice(0, 90)}`);
    } else {
      await sleep(400);
      const frame = await captureScreen('countdown-with-icon');
      // The icon occupies x 0..15. Anything lit from x=16 rightwards is the
      // countdown, so its own extent can be measured with the icon in place.
      const right = inkBounds({
        width: frame.width - 16,
        height: frame.height,
        rgba: cropColumns(frame, 16)
      });
      record(
        'Countdown beside a 16px icon',
        right ? 'pass' : 'fail',
        right
          ? `countdown occupies ${right.width}x${right.height}px of the ${frame.width - 16}px field. ${frame.file}`
          : `nothing drawn right of the icon. ${frame.file}`
      );
    }
  } catch (err) {
    record('Countdown beside a 16px icon', 'fail', err.message);
  }

  // 4. Does z_index actually resolve overlap, or is it merely accepted?
  //    The previous run proved the field is accepted on a draw. That is not the
  //    same as two overlapping elements compositing in the stated order, and
  //    the stated order is what section 4 would be designed around.
  try {
    await request('POST', `/api/assets/upload?application_name=${APP}&file=probe_red.png`, {
      body: makeSolidPng(24, 12, [0xff, 0x20, 0x20]),
      contentType: 'image/png'
    });
    await request('POST', `/api/assets/upload?application_name=${APP}&file=probe_blue.png`, {
      body: makeSolidPng(24, 12, [0x20, 0x40, 0xff]),
      contentType: 'image/png'
    });

    const overlap = (redZ, blueZ) => [
      { id: 'ov_red', type: 'image', x: 10, y: 2, display: 'front', path: 'probe_red.png', timeout: 30, z_index: redZ },
      { id: 'ov_blue', type: 'image', x: 18, y: 2, display: 'front', path: 'probe_blue.png', timeout: 30, z_index: blueZ }
    ];

    await clearProbeElements();
    await drawElements(overlap(1, 2));
    await sleep(400);
    const blueOnTop = await captureScreen('zindex-blue-on-top');

    await clearProbeElements();
    await drawElements(overlap(2, 1));
    await sleep(400);
    const redOnTop = await captureScreen('zindex-red-on-top');

    const differs = !blueOnTop.rgba.equals(redOnTop.rgba);
    record(
      'z_index changes what is drawn on top',
      differs ? 'pass' : 'info',
      differs
        ? `swapping z_index changed the overlap. ${blueOnTop.file} / ${redOnTop.file}`
        : `identical frames -- z_index is accepted but does not reorder. ${blueOnTop.file}`
    );
  } catch (err) {
    record('z_index changes what is drawn on top', 'fail', err.message);
  }
}

/** Everything from column `from` rightwards, tightly packed. */
function cropColumns({ width, height, rgba }, from) {
  const w = width - from;
  const out = Buffer.alloc(w * height * 4);
  for (let y = 0; y < height; y++) {
    rgba.copy(out, y * w * 4, (y * width + from) * 4, (y * width + width) * 4);
  }
  return out;
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

  // --- ROADMAP section 4: is the native countdown usable? ------------------
  // The device has a countdown element, which would let the bar tick a timer
  // with no frame uploads at all -- today every visible second costs an asset
  // upload plus a draw, which is why the timer shows HH:MM and not seconds.
  // Two things are unknown and neither is answerable from a status code:
  // the element has no `font` field, and BUSY Bar's own guidance warns
  // countdowns render tall. So these checks read the panel back and measure.
  if (!displayOwned) {
    await probeCountdown();
  } else {
    record('Countdown element', 'skip', 'display owned; re-run with the app closed');
  }

  await cleanup();

  const failed = results.filter(r => r.status === 'fail');
  console.log('');
  console.log(`Captured frames: ${OUT_DIR}`);
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
