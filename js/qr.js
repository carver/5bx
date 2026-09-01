/*
 * A QR code encoder, in byte mode at error-correction level M.
 *
 * This exists so a pairing link can be handed to another phone by pointing its
 * camera at the screen. Only encoding is needed: the receiving phone's camera
 * app decodes a URL-shaped code straight into "open this link", so there is no
 * scanner to write.
 *
 * Scoped deliberately narrowly. Byte mode alone (numeric and alphanumeric
 * modes would pack a link more tightly, but a link is not made of digits), one
 * error-correction level, and versions 1 to 10, which is up to 213 bytes.
 * Roughly three times the longest link this app can produce. Everything here
 * follows ISO/IEC 18004; the section names are kept in the comments because
 * this is the kind of code that is unreadable without them.
 */

/** Longest payload that fits, in UTF-8 bytes: version 10 at level M. */
export const MAX_BYTES = 213;

/*
 * Per version: error-correction codewords per block, then the blocks in each
 * of the (at most two) groups and how many data codewords each holds. Table 9
 * of the spec, level M only. Data capacity is derived from this rather than
 * tabulated again, so the two can never disagree.
 */
const BLOCK_LAYOUT = [
  { ecPerBlock: 10, groups: [[1, 16]] },                 // version 1
  { ecPerBlock: 16, groups: [[1, 28]] },
  { ecPerBlock: 26, groups: [[1, 44]] },
  { ecPerBlock: 18, groups: [[2, 32]] },
  { ecPerBlock: 24, groups: [[2, 43]] },
  { ecPerBlock: 16, groups: [[4, 27]] },
  { ecPerBlock: 18, groups: [[4, 31]] },
  { ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  { ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  { ecPerBlock: 26, groups: [[4, 43], [1, 44]] },        // version 10
];

/** Row/column centres of the alignment patterns, per version (Annex E). */
const ALIGNMENT_CENTRES = [
  [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];

/** Unused bits left over after the data region is filled, per version. */
const REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

const BYTE_MODE = 0b0100;
const PAD_BYTES = [0xec, 0x11];

/*
 * Level M is 0b00 in the format information, which is not the same as its
 * index in any "L, M, Q, H" ordering. Worth stating, since getting it wrong
 * produces a code that looks perfect and scans as the wrong ECC level.
 */
const ECC_LEVEL_M = 0b00;
const FORMAT_GENERATOR = 0b101_0011_0111;
const FORMAT_MASK = 0b101_0100_0001_0010;
const VERSION_GENERATOR = 0b1_1111_0010_0101;

/* ------------------------------------------------------------ public API */

/**
 * Encode `text` as a QR code.
 *
 * @param {string} text payload, up to MAX_BYTES once UTF-8 encoded
 * @returns {boolean[][]} rows of modules, true meaning dark, with no quiet zone
 */
export function qrModules(text) {
  const payload = new TextEncoder().encode(text);
  if (payload.length === 0) throw new Error('Cannot encode an empty payload.');
  if (payload.length > MAX_BYTES) {
    throw new Error(`Payload too long: ${payload.length} bytes, maximum is ${MAX_BYTES}.`);
  }

  const version = smallestVersionFor(payload.length);
  const codewords = interleave(version, dataCodewords(version, payload));

  const { modules, reserved } = functionPatterns(version);
  placeData(modules, reserved, codewords, REMAINDER_BITS[version - 1]);

  const mask = bestMask(modules, reserved);
  applyMask(modules, reserved, mask);
  placeFormatInfo(modules, mask);

  return modules;
}

/**
 * Render `text` as a standalone SVG, sized entirely by CSS.
 *
 * The light background is painted rather than left transparent: an inverted
 * code (dark modules on a dark page) does not scan, so this must not inherit
 * the app's dark theme.
 *
 * @param {string} text payload, up to MAX_BYTES once UTF-8 encoded
 * @param {{label?: string}} options accessible name for the image
 * @returns {string} SVG markup
 */
export function qrSvg(text, { label = 'QR code' } = {}) {
  const modules = qrModules(text);
  // Four modules on every side, the minimum quiet zone the spec requires for
  // a scanner to find the code's edges.
  const margin = 4;
  const extent = modules.length + margin * 2;

  let path = '';
  modules.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (dark) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" `
    + `shape-rendering="crispEdges" role="img" aria-label="${escapeAttribute(label)}">`
    + `<rect width="${extent}" height="${extent}" fill="#fff"/>`
    + `<path d="${path}" fill="#000"/></svg>`;
}

/* -------------------------------------------------------------- encoding */

function capacityBytes(version) {
  const bits = dataCapacityCodewords(version) * 8 - 4 - countBits(version);
  return Math.floor(bits / 8);
}

function dataCapacityCodewords(version) {
  return BLOCK_LAYOUT[version - 1].groups
    .reduce((total, [blocks, perBlock]) => total + blocks * perBlock, 0);
}

/** The character-count indicator widens at version 10 (Table 3). */
function countBits(version) {
  return version <= 9 ? 8 : 16;
}

function smallestVersionFor(byteLength) {
  const version = BLOCK_LAYOUT.findIndex((_, i) => capacityBytes(i + 1) >= byteLength) + 1;
  if (version === 0) throw new Error(`Payload too long: ${byteLength} bytes.`);
  return version;
}

/*
 * Mode indicator, character count, the payload itself, then a terminator and
 * padding out to the version's data capacity. The alternating 0xEC/0x11 pad is
 * prescribed by the spec, not arbitrary filler.
 */
function dataCodewords(version, payload) {
  const capacity = dataCapacityCodewords(version);
  const bits = new BitWriter();

  bits.write(BYTE_MODE, 4);
  bits.write(payload.length, countBits(version));
  for (const byte of payload) bits.write(byte, 8);

  bits.write(0, Math.min(4, capacity * 8 - bits.length));
  bits.write(0, (8 - (bits.length % 8)) % 8);

  const codewords = bits.bytes();
  // The pad always begins at 0xEC, however many data codewords precede it.
  for (let i = 0; codewords.length < capacity; i += 1) {
    codewords.push(PAD_BYTES[i % PAD_BYTES.length]);
  }
  return codewords;
}

class BitWriter {
  #bits = [];

  write(value, width) {
    for (let i = width - 1; i >= 0; i -= 1) this.#bits.push((value >> i) & 1);
  }

  get length() {
    return this.#bits.length;
  }

  bytes() {
    const out = [];
    for (let i = 0; i < this.#bits.length; i += 8) {
      out.push(this.#bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
    }
    return out;
  }
}

/*
 * The data is split into blocks, each gets its own error-correction codewords,
 * and the blocks are then interleaved. Interleaving is what makes the code
 * survive a scratch or a thumb: damage concentrated in one place on the symbol
 * is spread across every block rather than destroying one block outright.
 */
function interleave(version, codewords) {
  const { ecPerBlock, groups } = BLOCK_LAYOUT[version - 1];

  const blocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i += 1) {
      const data = codewords.slice(offset, offset + size);
      offset += size;
      blocks.push({ data, ec: errorCorrection(data, ecPerBlock) });
    }
  }

  const out = [];
  const longestBlock = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < longestBlock; i += 1) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of blocks) out.push(block.ec[i]);
  }
  return out;
}

/* -------------------------------------------- Reed-Solomon over GF(2^8) */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    // Multiply by the primitive element, reducing modulo the field's
    // primitive polynomial x^8 + x^4 + x^3 + x^2 + 1.
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

/** Product of (x - a^0)(x - a^1)...(x - a^(count-1)), as coefficients. */
function generatorPolynomial(count) {
  let poly = [1];
  for (let i = 0; i < count; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    poly.forEach((coefficient, j) => {
      next[j] ^= coefficient;
      next[j + 1] ^= coefficient === 0 ? 0 : EXP[LOG[coefficient] + i];
    });
    poly = next;
  }
  return poly;
}

/** The remainder of the message polynomial divided by the generator. */
function errorCorrection(data, count) {
  const generator = generatorPolynomial(count);
  const remainder = new Uint8Array(data.length + count);
  remainder.set(data);

  for (let i = 0; i < data.length; i += 1) {
    const lead = remainder[i];
    if (lead === 0) continue;
    const scale = LOG[lead];
    // generator[0] is always 1, so this zeroes remainder[i] as it goes.
    generator.forEach((coefficient, j) => {
      remainder[i + j] ^= coefficient === 0 ? 0 : EXP[LOG[coefficient] + scale];
    });
  }
  return [...remainder.slice(data.length)];
}

/* ------------------------------------------------------ function patterns */

function sizeOf(version) {
  return version * 4 + 17;
}

/*
 * Everything a scanner needs to locate and orient the symbol, before any data
 * is placed. `reserved` marks the modules that must not be masked or written
 * over; it is what tells the data placement where the holes are.
 */
function functionPatterns(version) {
  const size = sizeOf(version);
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (r, c, dark) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = dark;
    reserved[r][c] = true;
  };

  // Finder patterns and their separators, in three corners. The fourth corner
  // is deliberately empty: its absence is how a scanner tells which way up the
  // symbol is.
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const onRing = (r === 0 || r === 6) ? c >= 0 && c <= 6 : (c === 0 || c === 6) && r >= 0 && r <= 6;
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        set(top + r, left + c, onRing || inCore);
      }
    }
  }

  // Alignment patterns at every pairing of the version's centres, except the
  // three that would land on a finder.
  const centres = ALIGNMENT_CENTRES[version - 1];
  for (const row of centres) {
    for (const col of centres) {
      const onFinder = (row === 6 && col === 6)
        || (row === 6 && col === size - 7) || (row === size - 7 && col === 6);
      if (onFinder) continue;
      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          set(row + r, col + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
        }
      }
    }
  }

  // Timing patterns: the alternating run that lets a scanner count modules.
  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // The one module the spec fixes as always dark.
  set(size - 8, 8, true);

  // Format information is written after masking, but its cells must be held
  // back now so data placement skips them.
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      set(8, i, false);
      set(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i += 1) set(8, size - 1 - i, false);
  // Seven, not eight: the eighth module down that column is the fixed dark
  // module set just above, which is not part of the format information.
  for (let i = 0; i < 7; i += 1) set(size - 1 - i, 8, false);

  if (version >= 7) placeVersionInfo(set, version, size);

  return { modules, reserved };
}

/** Versions 7 and up carry their number twice, BCH-protected (Annex D). */
function placeVersionInfo(set, version, size) {
  const bits = bchEncode(version, VERSION_GENERATOR, 12);
  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >> i) & 1) === 1;
    set(Math.floor(i / 3), (i % 3) + size - 11, dark);
    set((i % 3) + size - 11, Math.floor(i / 3), dark);
  }
}

/*
 * The format information is a 5-bit value (level and mask) expanded to 15 bits
 * by a BCH code and then XORed with a fixed mask, so that an all-zero format —
 * level M with mask 0 — still contains dark modules and cannot be mistaken for
 * a blank region.
 */
function placeFormatInfo(modules, mask) {
  const value = (ECC_LEVEL_M << 3) | mask;
  const bits = bchEncode(value, FORMAT_GENERATOR, 10) ^ FORMAT_MASK;
  const size = modules.length;

  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >> i) & 1) === 1;

    // The copy beside the top-left finder, which steps over the timing row.
    if (i < 6) modules[i][8] = dark;
    else if (i < 8) modules[i + 1][8] = dark;
    else modules[size - 15 + i][8] = dark;

    // The second copy, split between the other two finders, so a symbol with
    // one damaged corner is still readable. Column 6 is skipped: that is the
    // timing pattern, which runs straight through this row.
    if (i < 8) modules[8][size - 1 - i] = dark;
    else if (i === 8) modules[8][7] = dark;
    else modules[8][14 - i] = dark;
  }
}

/** Append `width` zero bits, then reduce modulo `generator`. */
function bchEncode(value, generator, width) {
  let remainder = value << width;
  const generatorBits = bitLength(generator);
  while (bitLength(remainder) >= generatorBits) {
    remainder ^= generator << (bitLength(remainder) - generatorBits);
  }
  return (value << width) | remainder;
}

function bitLength(value) {
  return 32 - Math.clz32(value);
}

/* -------------------------------------------------------- data placement */

/*
 * The payload snakes up and down the symbol in two-module-wide columns, from
 * the bottom-right corner leftwards, stepping over the function patterns and
 * over column 6 entirely, since that is the vertical timing pattern.
 */
function placeData(modules, reserved, codewords, remainderBits) {
  const size = modules.length;
  const bits = codewords.length * 8 + remainderBits;
  let bit = 0;
  let upward = true;

  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row][col]) continue;
        // Any leftover capacity past the codewords is filled with light
        // modules, which the mask then treats like any other data.
        modules[row][col] = bit < codewords.length * 8
          && ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1) === 1;
        if (bit < bits) bit += 1;
      }
    }
    upward = !upward;
  }
}

/* ---------------------------------------------------------------- masking */

/*
 * Masking flips a regular pattern of data modules so the finished symbol has
 * no large blank areas and nothing that imitates a finder pattern. Which of
 * the eight was used is recorded in the format information, so the choice
 * affects only how easily the code scans, never what it says.
 */
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(modules, reserved, mask) {
  const condition = MASKS[mask];
  modules.forEach((row, r) => {
    row.forEach((_, c) => {
      if (!reserved[r][c] && condition(r, c)) modules[r][c] = !modules[r][c];
    });
  });
}

/** The mask with the lowest penalty; ties go to the lowest-numbered mask. */
function bestMask(modules, reserved) {
  let best = 0;
  let bestPenalty = Infinity;

  for (let mask = 0; mask < MASKS.length; mask += 1) {
    applyMask(modules, reserved, mask);
    placeFormatInfo(modules, mask);
    const penalty = maskPenalty(modules);
    applyMask(modules, reserved, mask);

    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      best = mask;
    }
  }
  return best;
}

/*
 * The four penalty rules of section 7.8.3, scored against the whole symbol.
 * They exist to punish the things that make a code hard to read: long uniform
 * runs, solid blocks, sequences that mimic a finder pattern, and an overall
 * light/dark balance far from even.
 */
function maskPenalty(modules) {
  const size = modules.length;
  const at = (r, c) => modules[r][c];
  const column = (c) => modules.map((row) => row[c]);

  let penalty = 0;

  for (let i = 0; i < size; i += 1) {
    penalty += runPenalty(modules[i]) + runPenalty(column(i));
    penalty += finderLookalikes(modules[i]) + finderLookalikes(column(i));
  }

  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const block = [at(r, c), at(r, c + 1), at(r + 1, c), at(r + 1, c + 1)];
      if (block.every(Boolean) || !block.some(Boolean)) penalty += 3;
    }
  }

  const dark = modules.flat().filter(Boolean).length;
  const percent = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return penalty;
}

/** Rule 1: every run of five or more identical modules costs 3, plus 1 each beyond. */
function runPenalty(line) {
  let penalty = 0;
  let run = 1;
  for (let i = 1; i <= line.length; i += 1) {
    if (i < line.length && line[i] === line[i - 1]) {
      run += 1;
      continue;
    }
    if (run >= 5) penalty += 3 + (run - 5);
    run = 1;
  }
  return penalty;
}

/*
 * Rule 3: the 1:1:3:1:1 ratio of a finder pattern, next to four light modules,
 * appearing anywhere in the data would send a scanner looking for a corner
 * that is not there.
 */
const FINDER_LOOKALIKE = [true, false, true, true, true, false, true];
const LIGHT_RUN = [false, false, false, false];

function finderLookalikes(line) {
  const matchesAt = (pattern, start) =>
    start >= 0 && start + pattern.length <= line.length
    && pattern.every((value, i) => line[start + i] === value);

  let count = 0;
  for (let i = 0; i + FINDER_LOOKALIKE.length <= line.length; i += 1) {
    if (!matchesAt(FINDER_LOOKALIKE, i)) continue;
    if (matchesAt(LIGHT_RUN, i - LIGHT_RUN.length)
      || matchesAt(LIGHT_RUN, i + FINDER_LOOKALIKE.length)) count += 40;
  }
  return count;
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
