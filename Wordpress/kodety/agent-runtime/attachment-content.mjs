/** Shared, bounded document/image validation for server and WebContainer.
 * Pure byte processing: never reads files, executes macros, or follows links. */
import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 2_000_000;

function normalizeDocumentText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, MAX_ATTACHMENT_TEXT_CHARS);
}

function decodePlainText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const source = buffer.subarray(2, buffer.length - ((buffer.length - 2) % 2));
    const littleEndian = Buffer.allocUnsafe(source.length);
    for (let offset = 0; offset < source.length; offset += 2) {
      littleEndian[offset] = source[offset + 1];
      littleEndian[offset + 1] = source[offset];
    }
    return littleEndian.toString('utf16le');
  }
  const source = buffer.subarray(buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(source);
  } catch {
    return new TextDecoder('windows-1252').decode(source);
  }
}

function decodeXmlText(value) {
  return value.replace(/&#x([0-9a-f]+);|&#([0-9]+);|&(amp|lt|gt|quot|apos);/gi, (match, hex, decimal, named) => {
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[String(named).toLowerCase()] || match;
  });
}

function textFromWordXml(xml) {
  const structured = xml
    .replace(/<w:tab\b[^>]*\/?\s*>/gi, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/w:tc\s*>/gi, '\t')
    .replace(/<\/w:(?:p|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return normalizeDocumentText(decodeXmlText(structured));
}

function zipCentralEntries(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw Object.assign(new Error('The DOCX central directory is missing.'), { status: 400 });
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries > 10000 || centralOffset + centralSize > buffer.length) {
    throw Object.assign(new Error('The DOCX archive is invalid.'), { status: 400 });
  }
  const found = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw Object.assign(new Error('The DOCX file table is invalid.'), { status: 400 });
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    if (nameEnd > buffer.length) throw Object.assign(new Error('The DOCX entry name is invalid.'), { status: 400 });
    const name = buffer.subarray(cursor + 46, nameEnd).toString((flags & 0x800) ? 'utf8' : 'latin1').replaceAll('\\', '/');
    if (!name.includes('\0') && !name.startsWith('/') && !name.split('/').includes('..')) {
      found.set(name, { flags, compression, compressedSize, uncompressedSize, localOffset });
    }
    cursor = nameEnd + extraLength + commentLength;
  }
  return found;
}

function unzipEntry(buffer, entry, remainingLimit) {
  if ((entry.flags & 0x1) !== 0) throw Object.assign(new Error('Encrypted DOCX files are not supported.'), { status: 400 });
  if (![0, 8].includes(entry.compression)) throw Object.assign(new Error('The DOCX uses an unsupported compression method.'), { status: 400 });
  if (entry.uncompressedSize > remainingLimit || entry.uncompressedSize > 8 * 1024 * 1024) {
    throw Object.assign(new Error('The expanded DOCX content is too large.'), { status: 413 });
  }
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw Object.assign(new Error('The DOCX entry is invalid.'), { status: 400 });
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) throw Object.assign(new Error('The DOCX entry is truncated.'), { status: 400 });
  const source = buffer.subarray(dataStart, dataEnd);
  const output = entry.compression === 0
    ? Buffer.from(source)
    : inflateRawSync(source, { maxOutputLength: Math.min(remainingLimit, 8 * 1024 * 1024) });
  if (output.length !== entry.uncompressedSize || output.length > remainingLimit) {
    throw Object.assign(new Error('The DOCX expanded size is invalid.'), { status: 400 });
  }
  return output;
}

function extractDocxText(buffer) {
  const entries = zipCentralEntries(buffer);
  const names = [...entries.keys()].filter((name) => (
    name === 'word/document.xml'
    || /^word\/(?:header|footer)\d+\.xml$/i.test(name)
    || ['word/footnotes.xml', 'word/endnotes.xml', 'word/comments.xml'].includes(name)
  ));
  if (!names.includes('word/document.xml')) {
    throw Object.assign(new Error('The DOCX does not contain word/document.xml.'), { status: 400 });
  }
  names.sort((left, right) => (left === 'word/document.xml' ? -1 : right === 'word/document.xml' ? 1 : left.localeCompare(right)));
  let remaining = 12 * 1024 * 1024;
  const sections = [];
  for (const name of names) {
    const xml = unzipEntry(buffer, entries.get(name), remaining);
    remaining -= xml.length;
    const text = textFromWordXml(xml.toString('utf8'));
    if (text) sections.push(text);
  }
  const result = normalizeDocumentText(sections.join('\n\n'));
  if (!result) throw Object.assign(new Error('No readable text was found in the DOCX.'), { status: 400 });
  return result;
}

function compoundSector(buffer, sector, sectorSize) {
  const offset = (sector + 1) * sectorSize;
  if (!Number.isInteger(sector) || sector < 0 || offset < 0 || offset + sectorSize > buffer.length) {
    throw Object.assign(new Error('The DOC sector table is invalid.'), { status: 400 });
  }
  return buffer.subarray(offset, offset + sectorSize);
}

function compoundChain(buffer, allocation, start, sectorSize, maxBytes) {
  const END = 0xfffffffe;
  const FREE = 0xffffffff;
  const parts = [];
  const seen = new Set();
  let sector = start >>> 0;
  let total = 0;
  while (sector !== END && sector !== FREE) {
    if (seen.has(sector) || sector >= allocation.length || parts.length > 100000) {
      throw Object.assign(new Error('The DOC contains an invalid sector chain.'), { status: 400 });
    }
    seen.add(sector);
    const part = compoundSector(buffer, sector, sectorSize);
    total += part.length;
    if (total > maxBytes) throw Object.assign(new Error('The expanded DOC stream is too large.'), { status: 413 });
    parts.push(part);
    sector = allocation[sector] >>> 0;
  }
  return Buffer.concat(parts, total);
}

function parseCompoundDocument(buffer) {
  const signature = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  if (buffer.length < 512 || !buffer.subarray(0, 8).equals(signature) || buffer.readUInt16LE(0x1c) !== 0xfffe) {
    throw Object.assign(new Error('The legacy DOC header is invalid.'), { status: 400 });
  }
  const sectorSize = 2 ** buffer.readUInt16LE(0x1e);
  const miniSectorSize = 2 ** buffer.readUInt16LE(0x20);
  if (![512, 4096].includes(sectorSize) || miniSectorSize !== 64) {
    throw Object.assign(new Error('The DOC uses unsupported sector sizes.'), { status: 400 });
  }
  const fatSectorCount = buffer.readUInt32LE(0x2c);
  const firstDirectorySector = buffer.readUInt32LE(0x30);
  const miniCutoff = buffer.readUInt32LE(0x38);
  const firstMiniFatSector = buffer.readUInt32LE(0x3c);
  const miniFatSectorCount = buffer.readUInt32LE(0x40);
  let nextDifatSector = buffer.readUInt32LE(0x44);
  const difatSectorCount = buffer.readUInt32LE(0x48);
  const difat = [];
  for (let index = 0; index < 109; index += 1) {
    const sector = buffer.readUInt32LE(0x4c + index * 4);
    if (sector !== 0xffffffff) difat.push(sector);
  }
  const difatSeen = new Set();
  for (let index = 0; index < difatSectorCount && nextDifatSector !== 0xfffffffe; index += 1) {
    if (difatSeen.has(nextDifatSector)) throw Object.assign(new Error('The DOC DIFAT chain is invalid.'), { status: 400 });
    difatSeen.add(nextDifatSector);
    const sector = compoundSector(buffer, nextDifatSector, sectorSize);
    const entries = (sectorSize / 4) - 1;
    for (let position = 0; position < entries; position += 1) {
      const value = sector.readUInt32LE(position * 4);
      if (value !== 0xffffffff) difat.push(value);
    }
    nextDifatSector = sector.readUInt32LE(entries * 4);
  }
  if (fatSectorCount < 1 || fatSectorCount > difat.length || fatSectorCount > 65536) {
    throw Object.assign(new Error('The DOC FAT table is invalid.'), { status: 400 });
  }
  const fat = [];
  for (const fatSector of difat.slice(0, fatSectorCount)) {
    const sector = compoundSector(buffer, fatSector, sectorSize);
    for (let offset = 0; offset < sector.length; offset += 4) fat.push(sector.readUInt32LE(offset));
  }
  const directoryBuffer = compoundChain(buffer, fat, firstDirectorySector, sectorSize, Math.min(buffer.length * 2, 32 * 1024 * 1024));
  const entries = [];
  for (let offset = 0; offset + 128 <= directoryBuffer.length; offset += 128) {
    const nameBytes = directoryBuffer.readUInt16LE(offset + 64);
    const type = directoryBuffer[offset + 66];
    if (nameBytes < 2 || nameBytes > 64 || ![1, 2, 5].includes(type)) continue;
    const name = directoryBuffer.subarray(offset, offset + nameBytes - 2).toString('utf16le');
    const sizeBig = directoryBuffer.readBigUInt64LE(offset + 120);
    if (sizeBig > BigInt(MAX_ATTACHMENT_BYTES * 4)) continue;
    entries.push({
      name,
      type,
      start: directoryBuffer.readUInt32LE(offset + 116),
      size: Number(sizeBig),
    });
  }
  const root = entries.find((entry) => entry.type === 5);
  if (!root) throw Object.assign(new Error('The DOC root stream is missing.'), { status: 400 });
  const miniFatBuffer = miniFatSectorCount > 0
    ? compoundChain(buffer, fat, firstMiniFatSector, sectorSize, Math.min(miniFatSectorCount * sectorSize, 16 * 1024 * 1024))
    : Buffer.alloc(0);
  const miniFat = [];
  for (let offset = 0; offset + 4 <= miniFatBuffer.length; offset += 4) miniFat.push(miniFatBuffer.readUInt32LE(offset));
  const miniStream = root.size > 0
    ? compoundChain(buffer, fat, root.start, sectorSize, Math.min(Math.max(root.size, sectorSize), 32 * 1024 * 1024)).subarray(0, root.size)
    : Buffer.alloc(0);

  const readStream = (name) => {
    const entry = entries.find((candidate) => candidate.type === 2 && candidate.name === name);
    if (!entry || entry.size < 1) return null;
    if (entry.size >= miniCutoff) {
      return compoundChain(buffer, fat, entry.start, sectorSize, Math.min(entry.size + sectorSize, 32 * 1024 * 1024)).subarray(0, entry.size);
    }
    const parts = [];
    const seen = new Set();
    let miniSector = entry.start >>> 0;
    let total = 0;
    while (miniSector !== 0xfffffffe && miniSector !== 0xffffffff) {
      if (seen.has(miniSector) || miniSector >= miniFat.length || parts.length > 100000) {
        throw Object.assign(new Error('The DOC mini stream is invalid.'), { status: 400 });
      }
      seen.add(miniSector);
      const start = miniSector * miniSectorSize;
      if (start + miniSectorSize > miniStream.length) throw Object.assign(new Error('The DOC mini stream is truncated.'), { status: 400 });
      parts.push(miniStream.subarray(start, start + miniSectorSize));
      total += miniSectorSize;
      if (total > MAX_ATTACHMENT_BYTES * 4) throw Object.assign(new Error('The DOC mini stream is too large.'), { status: 413 });
      miniSector = miniFat[miniSector] >>> 0;
    }
    return Buffer.concat(parts, total).subarray(0, entry.size);
  };
  return { readStream };
}

function printableDocFallback(buffer) {
  const runs = [];
  let unicode = '';
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    const code = buffer.readUInt16LE(offset);
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xfffd && ![0xffff, 0xfffe].includes(code))) {
      unicode += String.fromCharCode(code);
    } else {
      if (unicode.trim().length >= 12) runs.push(unicode);
      unicode = '';
    }
  }
  if (unicode.trim().length >= 12) runs.push(unicode);
  const ascii = buffer.toString('latin1').match(/[\x20-\x7e\r\n\t]{20,}/g) || [];
  return normalizeDocumentText([...runs, ...ascii].join('\n'));
}

function extractLegacyDocText(buffer) {
  try {
    const compound = parseCompoundDocument(buffer);
    const word = compound.readStream('WordDocument');
    if (!word || word.length < 64) throw new Error('WordDocument stream missing.');
    const flags = word.readUInt16LE(0x0a);
    const table = compound.readStream((flags & 0x0200) !== 0 ? '1Table' : '0Table');
    if (!table) throw new Error('DOC table stream missing.');
    let fib = 0x20;
    const csw = word.readUInt16LE(fib);
    fib += 2 + csw * 2;
    if (fib + 2 > word.length) throw new Error('DOC FIB is truncated.');
    const cslw = word.readUInt16LE(fib);
    fib += 2 + cslw * 4;
    if (fib + 2 > word.length) throw new Error('DOC FIB fields are truncated.');
    const pairCount = word.readUInt16LE(fib);
    fib += 2;
    if (pairCount <= 32 || fib + (33 * 8) > word.length) throw new Error('DOC CLX pointer is missing.');
    const fcClx = word.readUInt32LE(fib + 32 * 8);
    const lcbClx = word.readUInt32LE(fib + 32 * 8 + 4);
    if (lcbClx < 5 || fcClx + lcbClx > table.length) throw new Error('DOC CLX range is invalid.');
    let cursor = fcClx;
    const clxEnd = fcClx + lcbClx;
    while (cursor < clxEnd && table[cursor] === 0x01) {
      if (cursor + 3 > clxEnd) throw new Error('DOC property block is truncated.');
      cursor += 3 + table.readUInt16LE(cursor + 1);
    }
    if (cursor + 5 > clxEnd || table[cursor] !== 0x02) throw new Error('DOC piece table is missing.');
    const plcSize = table.readUInt32LE(cursor + 1);
    const plc = cursor + 5;
    if (plcSize < 16 || plc + plcSize > clxEnd || (plcSize - 4) % 12 !== 0) throw new Error('DOC piece table is invalid.');
    const pieceCount = (plcSize - 4) / 12;
    const pcd = plc + (pieceCount + 1) * 4;
    const decoder = new TextDecoder('windows-1252');
    const chunks = [];
    for (let index = 0; index < pieceCount; index += 1) {
      const cpStart = table.readUInt32LE(plc + index * 4);
      const cpEnd = table.readUInt32LE(plc + (index + 1) * 4);
      const characters = cpEnd - cpStart;
      if (characters < 1 || characters > MAX_ATTACHMENT_TEXT_CHARS) continue;
      const rawFc = table.readUInt32LE(pcd + index * 8 + 2);
      const compressed = (rawFc & 0x40000000) !== 0;
      const fileOffset = compressed ? ((rawFc & 0x3fffffff) >>> 1) : (rawFc & 0x3fffffff);
      const byteLength = compressed ? characters : characters * 2;
      if (fileOffset + byteLength > word.length) continue;
      chunks.push(compressed
        ? decoder.decode(word.subarray(fileOffset, fileOffset + byteLength))
        : word.subarray(fileOffset, fileOffset + byteLength).toString('utf16le'));
    }
    const extracted = normalizeDocumentText(chunks.join('').replace(/\u0007/g, '\t').replace(/\r/g, '\n'));
    if (extracted) return extracted;
  } catch {
    // Fall through to a conservative printable-text recovery for unusual DOC variants.
  }
  const fallback = printableDocFallback(buffer);
  if (!fallback) throw Object.assign(new Error('No readable text was found in the legacy DOC.'), { status: 400 });
  return fallback;
}

function validateAttachmentMagic(record) {
  const { buffer, extension, kind } = record;
  if (kind === 'image') {
    const valid = (
      (extension === 'png' && buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      || (['jpg', 'jpeg'].includes(extension) && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
      || (extension === 'gif' && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii')))
      || (extension === 'webp' && buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP')
    );
    if (!valid) throw Object.assign(new Error('The attached image contents are invalid.'), { status: 400 });
  }
  const utf16Text = kind === 'text'
    && buffer.length >= 2
    && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff));
  if (kind === 'text' && buffer.includes(0) && !utf16Text) {
    throw Object.assign(new Error('The attached TXT contains binary data.'), { status: 400 });
  }
  if (kind === 'docx' && buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    throw Object.assign(new Error('The attached DOCX header is invalid.'), { status: 400 });
  }
  if (kind === 'doc' && !buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw Object.assign(new Error('The attached DOC header is invalid.'), { status: 400 });
  }
}

function attachmentText(record) {
  if (record.kind === 'text') return normalizeDocumentText(decodePlainText(record.buffer));
  if (record.kind === 'docx') return extractDocxText(record.buffer);
  if (record.kind === 'doc') return extractLegacyDocText(record.buffer);
  throw Object.assign(new Error('Images do not expose a text range.'), { status: 400 });
}

export { normalizeDocumentText, extractDocxText, extractLegacyDocText, validateAttachmentMagic, attachmentText };
