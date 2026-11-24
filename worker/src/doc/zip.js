/**
 * A minimal ZIP writer, because a .docx is a ZIP of XML and the Workers
 * runtime has no zip library.
 *
 * Entries are STORED, not deflated. A deflate pass would need CompressionStream
 * and make every call async for the sake of a few kilobytes on a document that
 * is already going out as an email attachment. Word, Pages, LibreOffice and
 * Google Docs all open a stored .docx without complaint; the format permits it.
 */
const enc = new TextEncoder();

/** CRC-32, table built once at module load. */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {Array<{name: string, data: string|Uint8Array}>} files
 * @returns {Uint8Array}
 */
export function zip(files) {
  const entries = files.map((f) => ({
    name: enc.encode(f.name),
    data: typeof f.data === "string" ? enc.encode(f.data) : f.data,
  }));
  for (const e of entries) e.crc = crc32(e.data);

  let size = 0;
  for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length;
  size += 22;

  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  let p = 0;
  const u16 = (v) => { view.setUint16(p, v, true); p += 2; };
  const u32 = (v) => { view.setUint32(p, v, true); p += 4; };
  const raw = (b) => { out.set(b, p); p += b.length; };

  for (const e of entries) {
    e.offset = p;
    u32(0x04034b50);
    u16(20); u16(0); u16(0);        // version, flags, method 0 = stored
    // A fixed 1980-01-01 rather than "now": the output is then byte-identical
    // for identical input, which is what lets the tests assert on it. Zero is
    // NOT usable here - it encodes month 0, which some readers reject.
    u16(0); u16(33);
    u32(e.crc); u32(e.data.length); u32(e.data.length);
    u16(e.name.length); u16(0);
    raw(e.name); raw(e.data);
  }

  const dirStart = p;
  for (const e of entries) {
    u32(0x02014b50);
    u16(20); u16(20); u16(0); u16(0);
    u16(0); u16(33);
    u32(e.crc); u32(e.data.length); u32(e.data.length);
    u16(e.name.length); u16(0); u16(0); u16(0); u16(0);
    u32(0);
    u32(e.offset);
    raw(e.name);
  }

  // Captured BEFORE the EOCD is written: `p` advances as each field goes in,
  // so computing the directory size from it inline overstates it by however
  // much of the EOCD has already been written.
  const dirEnd = p;
  u32(0x06054b50);
  u16(0); u16(0); u16(entries.length); u16(entries.length);
  u32(dirEnd - dirStart); u32(dirStart); u16(0);

  return out.subarray(0, p);
}
