/**
 * A small zip writer (deflate, no zip64) built on node:zlib, for the data export: files are added one by one and
 * the archive comes out as a stream of chunks, so only one file at a time is held in memory.
 */
import { crc32, deflateRawSync } from "node:zlib";

interface Entry {
  name: Buffer;
  crc: number;
  size: number;
  compressed: number;
  offset: number;
  time: number;
  date: number;
}

/** MS-DOS time and date of a moment (the zip format's), in UTC. */
function dosTime(d: Date) {
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((Math.max(1980, d.getUTCFullYear()) - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

export class ZipWriter {
  #entries: Entry[] = [];
  #offset = 0;
  #names = new Set<string>();

  /** A file of the archive: its local header and compressed content. Names are made unique and kept relative. */
  file(name: string, content: Buffer | string, modified = new Date()): Buffer[] {
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    // Relative, without "." or ".." steps, so that unzipping never writes outside its folder.
    const path = this.#unique(name.replace(/\\/g, "/").split("/").filter((s) => s && s !== ".").map((s) => (s === ".." ? "_" : s)).join("/"));
    const nameBuf = Buffer.from(path, "utf8");
    const compressed = deflateRawSync(data);
    const { time, date } = dosTime(modified);
    const entry: Entry = { name: nameBuf, crc: crc32(data), size: data.length, compressed: compressed.length, offset: this.#offset, time, date };
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0800, 6); // names in UTF-8
    header.writeUInt16LE(8, 8); // deflate
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(entry.crc, 14);
    header.writeUInt32LE(entry.compressed, 18);
    header.writeUInt32LE(entry.size, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    this.#entries.push(entry);
    this.#offset += header.length + nameBuf.length + compressed.length;
    if (this.#offset > 0xffffffff) throw new Error("archive too large");
    return [header, nameBuf, compressed];
  }

  /** The central directory, which ends the archive. */
  end(): Buffer[] {
    const parts: Buffer[] = [];
    let size = 0;
    for (const e of this.#entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(0x02014b50, 0);
      h.writeUInt16LE(20, 4); // made by
      h.writeUInt16LE(20, 6); // version needed
      h.writeUInt16LE(0x0800, 8);
      h.writeUInt16LE(8, 10);
      h.writeUInt16LE(e.time, 12);
      h.writeUInt16LE(e.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressed, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42);
      parts.push(h, e.name);
      size += h.length + e.name.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.#entries.length, 8);
    end.writeUInt16LE(this.#entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(this.#offset, 16);
    parts.push(end);
    return parts;
  }

  #unique(path: string) {
    let candidate = path || "file";
    for (let i = 2; this.#names.has(candidate); i++) candidate = path.replace(/(\.[^./]*)?$/, ` (${i})$1`);
    this.#names.add(candidate);
    return candidate;
  }
}
