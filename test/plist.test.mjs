import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parsePlistFile, readPlistValue } from '../src/plist.mjs';

// A binary Info.plist is the only source of the bundle identifier an install acts on, and it
// had no test at all: a damaged file used to return a plausible-looking string instead of
// failing, which produced an install that could not be verified.
function binaryPlists(objects, top = 0) {
  const header = Buffer.from('bplist00', 'latin1');
  const body = Buffer.concat(objects);
  const offsets = [];
  let offset = header.length;
  for (const object of objects) { offsets.push(offset); offset += object.length; }
  const offsetSize = offsets.some(value => value > 255) ? 2 : 1;
  const table = Buffer.alloc(offsets.length * offsetSize);
  offsets.forEach((value, index) => offsetSize === 1 ? table.writeUInt8(value, index) : table.writeUInt16BE(value, index * 2));
  const trailer = Buffer.alloc(32);
  trailer.writeUInt8(offsetSize, 6);
  trailer.writeUInt8(1, 7);
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(BigInt(top), 16);
  trailer.writeBigUInt64BE(BigInt(header.length + body.length), 24);
  return Buffer.concat([header, body, table, trailer]);
}
// A count of 15 or more is written as 0x?f followed by an integer object whose low nibble n
// means 2^n bytes; two-digit lengths therefore start with 0x10.
const counted = (kind, length) => length <= 14 ? Buffer.from([(kind << 4) | length]) : Buffer.from([(kind << 4) | 0x0f, 0x10, length]);
const ascii = value => Buffer.concat([counted(0x5, value.length), Buffer.from(value, 'latin1')]);
const utf16 = value => {
  const bytes = Buffer.from(value, 'utf16le').swap16();
  return Buffer.concat([counted(0x6, value.length), bytes]);
};
const dict = entries => Buffer.from([0xd0 | entries.length, ...entries.flat()]);
const uid = value => Buffer.from([0x80, value]);

const directory = await mkdtemp(join(tmpdir(), 'poki-plist-'));
test.after(() => rm(directory, { recursive: true, force: true }));

test('reads a bundle identifier out of the binary form', async () => {
  const file = join(directory, 'Info.plist');
  // object 0: {CFBundleIdentifier: "com.example.fixture"}; 1: the key; 2: the value
  await writeFile(file, binaryPlists([dict([[1, 2]]), ascii('CFBundleIdentifier'), ascii('com.example.fixture')]));
  assert.equal(await readPlistValue(file, 'CFBundleIdentifier'), 'com.example.fixture');
});

test('reads a UID as the number it stores', async () => {
  const file = join(directory, 'uid.plist');
  await writeFile(file, binaryPlists([uid(7)]));
  assert.equal(await parsePlistFile(file), 7, 'a one byte UID of 7 must not be read as a wider number');
});

test('a damaged file fails instead of returning a plausible string', async () => {
  const file = join(directory, 'broken.plist');
  // The dictionary points at an object that does not exist.
  await writeFile(file, binaryPlists([dict([[1, 9]]), ascii('CFBundleIdentifier')]));
  await assert.rejects(() => parsePlistFile(file), /does not exist/);
  // And a file whose trailer no longer describes the table.
  await writeFile(file, binaryPlists([dict([[1, 2]]), ascii('CFBundleIdentifier'), ascii('com.example.fixture')]).subarray(0, 40));
  await assert.rejects(() => parsePlistFile(file), /Truncated|out of bounds/);
});

test('a bundle identifier with characters a real one cannot contain is refused', async () => {
  const file = join(directory, 'odd.plist');
  await writeFile(file, binaryPlists([dict([[1, 2]]), ascii('CFBundleIdentifier'), utf16('灬楳')]));
  await assert.rejects(() => readPlistValue(file, 'CFBundleIdentifier'), /unusable/);
});
