import { inflateRawSync } from 'node:zlib';

/**
 * The files of a zip, by name: enough of the format to read a
 * `.streamDeckProfile`, which is one -- stored or deflated entries, read
 * from the central directory. A test helper, so no zip library is added.
 */
export function readZip(buffer: Buffer): Map<string, Buffer> {
  const END_SIGNATURE = 0x06054b50;
  const CENTRAL_SIGNATURE = 0x02014b50;
  let end = -1;
  // The end record is 22 bytes, followed by a comment of up to 64 KB.
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === END_SIGNATURE) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip: no end of central directory.');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw new Error('Not a zip: a broken central directory.');
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    // The data follows the local header, whose name and extra fields have their own lengths.
    const dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(dataAt, dataAt + compressed);
    if (!name.endsWith('/')) {
      if (method === 0) files.set(name, Buffer.from(data));
      else if (method === 8) files.set(name, inflateRawSync(data));
      else throw new Error(`${name}: compression method ${method} is not read here.`);
    }
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
