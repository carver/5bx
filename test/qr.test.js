/*
 * The QR encoder.
 *
 * A QR code is either exactly right or it does not scan, and "looks fine" is
 * worth nothing here, so the main check is a round trip: a decoder written
 * independently below reads each generated code back and must recover the
 * payload. That exercises every stage — format information, masking, the
 * zigzag placement, block de-interleaving — and it runs with nothing
 * installed.
 *
 * A round trip alone could still pass if the encoder and the decoder shared a
 * misreading of the spec, so qrcode-generator (a devDependency, and a separate
 * implementation) is used to close that gap: its output is fed through this
 * file's decoder too. A shared mistake would show up there immediately.
 *
 * The two implementations deliberately do NOT agree module-for-module.
 * qrcode-generator scores penalty rule 1 with a 3x3 neighbour count rather
 * than the spec's runs of five, so the two sometimes pick different masks.
 * Both are valid — the mask is recorded in the format information and affects
 * only how easily a code scans, never what it says.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { qrModules, qrSvg, MAX_BYTES } from '../js/qr.js';

/*
 * Dev-only, mirroring the jsdom arrangement in test/helpers/env.js: the suite
 * still runs with nothing installed, but CI sets REQUIRE_DOM_TESTS to turn a
 * missing dependency into a failure rather than a silent pass.
 */
const reference = await (async () => {
  try {
    return (await import('qrcode-generator')).default;
  } catch {
    return null;
  }
})();

const referenceSkip = reference || process.env.REQUIRE_DOM_TESTS
  ? false
  : 'qrcode-generator is not installed';

function referenceModules(text) {
  const code = reference(0, 'M');
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => code.isDark(r, c)));
}

/* ---------------------------------------------------------- the decoder */

/*
 * Written from the spec rather than from js/qr.js, and shaped differently on
 * purpose: function modules are identified by a predicate over coordinates,
 * where the encoder builds them by drawing. Two formulations of the same rule
 * are far more likely to disagree than to fail in the same direction.
 */

const DATA_CODEWORDS = [16, 28, 44, 64, 86, 108, 124, 154, 182, 216];
const BLOCK_SIZES = [
  [16], [28], [44], [32, 32], [43, 43], [27, 27, 27, 27], [31, 31, 31, 31],
  [38, 38, 39, 39], [36, 36, 36, 37, 37], [43, 43, 43, 43, 44],
];
const ALIGNMENT = [
  [], [6, 18], [6, 22], [6, 26], [6, 30],
  [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
];
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

function isFunctionModule(version, size, r, c) {
  // The three finders, each with its separator and its slice of the format
  // information, occupy a 9x9 corner (8 wide where there is no format arm).
  if (r < 9 && c < 9) return true;
  if (r < 9 && c >= size - 8) return true;
  if (r >= size - 8 && c < 9) return true;

  if (r === 6 || c === 6) return true;

  if (version >= 7) {
    if (r < 6 && c >= size - 11 && c < size - 8) return true;
    if (c < 6 && r >= size - 11 && r < size - 8) return true;
  }

  for (const centreRow of ALIGNMENT[version - 1]) {
    for (const centreCol of ALIGNMENT[version - 1]) {
      const onFinder = (centreRow === 6 && centreCol === 6)
        || (centreRow === 6 && centreCol === size - 7)
        || (centreRow === size - 7 && centreCol === 6);
      if (onFinder) continue;
      if (Math.abs(r - centreRow) <= 2 && Math.abs(c - centreCol) <= 2) return true;
    }
  }
  return false;
}

function readFormat(modules) {
  const size = modules.length;
  let bits = 0;
  for (let i = 0; i < 15; i += 1) {
    const row = i < 6 ? i : i < 8 ? i + 1 : size - 15 + i;
    if (modules[row][8]) bits |= 1 << i;
  }
  const value = (bits ^ 0b101_0100_0001_0010) >> 10;
  return { eccLevel: value >> 3, mask: value & 0b111 };
}

/** Reads a code back, returning its payload and the choices it records. */
function decode(modules) {
  const size = modules.length;
  const version = (size - 17) / 4;
  const { eccLevel, mask } = readFormat(modules);
  const unmasked = (r, c) => modules[r][c] !== MASKS[mask](r, c);

  const bits = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (!isFunctionModule(version, size, row, col)) bits.push(unmasked(row, col) ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const stream = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    stream.push(bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }

  // Undo the interleave: the blocks were emitted a codeword at a time, round
  // robin, with the shortest blocks dropping out first.
  const sizes = BLOCK_SIZES[version - 1];
  const blocks = sizes.map(() => []);
  let taken = 0;
  for (let i = 0; i < Math.max(...sizes); i += 1) {
    sizes.forEach((blockSize, b) => {
      if (i < blockSize) blocks[b].push(stream[taken++]);
    });
  }
  const codewords = blocks.flat();
  assert.equal(codewords.length, DATA_CODEWORDS[version - 1], 'de-interleaved codeword count');

  const read = (offset, width) => {
    let value = 0;
    for (let i = 0; i < width; i += 1) {
      const bit = offset + i;
      value = (value << 1) | ((codewords[bit >> 3] >> (7 - (bit & 7))) & 1);
    }
    return value;
  };

  const mode = read(0, 4);
  const countWidth = version <= 9 ? 8 : 16;
  const length = read(4, countWidth);
  const payload = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) payload[i] = read(4 + countWidth + i * 8, 8);

  return { version, eccLevel, mask, mode, text: new TextDecoder().decode(payload) };
}

/* ------------------------------------------------------------- the tests */

const seeded = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

function randomText(rng, length) {
  let text = '';
  for (let i = 0; i < length; i += 1) text += String.fromCharCode(32 + Math.floor(rng() * 95));
  return text;
}

describe('round trip', () => {
  test('recovers a payload of every length up to the maximum', () => {
    for (let length = 1; length <= MAX_BYTES; length += 1) {
      const text = 'x'.repeat(length);
      assert.equal(decode(qrModules(text)).text, text, `length ${length}`);
    }
  });

  test('recovers random payloads across the printable range', () => {
    const rng = seeded(7);
    for (let round = 0; round < 300; round += 1) {
      const text = randomText(rng, 1 + Math.floor(rng() * MAX_BYTES));
      assert.equal(decode(qrModules(text)).text, text, JSON.stringify(text));
    }
  });

  test('recovers realistic pairing links', () => {
    for (let i = 0; i < 50; i += 1) {
      const link = `https://carver.github.io/5bx/#join/${crypto.randomUUID()}`;
      assert.equal(decode(qrModules(link)).text, link, link);
    }
  });

  test('recovers multi-byte characters', () => {
    for (const text of ['héllo', '日本語', '🏋️‍♀️ 5BX', 'naïve café — dash']) {
      assert.equal(decode(qrModules(text)).text, text, text);
    }
  });

  test('records byte mode at error-correction level M', () => {
    const { mode, eccLevel, mask } = decode(qrModules('https://carver.github.io/5bx/'));
    assert.equal(mode, 0b0100, 'byte mode indicator');
    assert.equal(eccLevel, 0b00, 'level M');
    assert.ok(mask >= 0 && mask <= 7, `mask ${mask} is one of the eight`);
  });

  test('picks the smallest version that fits', () => {
    // One byte past a version's capacity must step up exactly one version.
    for (let length = 2; length <= MAX_BYTES; length += 1) {
      const smaller = decode(qrModules('x'.repeat(length - 1))).version;
      const larger = decode(qrModules('x'.repeat(length))).version;
      assert.ok(larger - smaller <= 1, `length ${length} jumped ${smaller} to ${larger}`);
      assert.ok(larger >= smaller, `length ${length} shrank`);
    }
  });
});

describe('structure', () => {
  const modules = qrModules('https://carver.github.io/5bx/');
  const size = modules.length;

  test('is square, odd-sided, and a legal version', () => {
    assert.ok(modules.every((row) => row.length === size));
    assert.equal((size - 17) % 4, 0);
    assert.ok((size - 17) / 4 >= 1 && (size - 17) / 4 <= 10);
  });

  test('carries a finder pattern in each of the three corners', () => {
    for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let r = 0; r < 7; r += 1) {
        for (let c = 0; c < 7; c += 1) {
          const onRing = r === 0 || r === 6 || c === 0 || c === 6;
          const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          assert.equal(modules[top + r][left + c], onRing || inCore,
            `finder at ${top},${left} module ${r},${c}`);
        }
      }
    }
  });

  test('leaves the fourth corner empty, which is how a scanner finds "up"', () => {
    for (let r = size - 7; r < size; r += 1) {
      for (let c = size - 7; c < size; c += 1) {
        const onRing = r === size - 7 || r === size - 1 || c === size - 7 || c === size - 1;
        // A finder there would be a solid ring; assert it is not one.
        if (onRing && !modules[r][c]) return;
      }
    }
    assert.fail('the bottom-right corner looks like a finder pattern');
  });

  test('separates each finder from the data with a light border', () => {
    for (let i = 0; i < 8; i += 1) {
      assert.equal(modules[7][i], false);
      assert.equal(modules[i][7], false);
      assert.equal(modules[size - 8][i], false);
      assert.equal(modules[i][size - 8], false);
    }
  });

  test('alternates the timing patterns', () => {
    for (let i = 8; i < size - 8; i += 1) {
      assert.equal(modules[6][i], i % 2 === 0, `column ${i} of the timing row`);
      assert.equal(modules[i][6], i % 2 === 0, `row ${i} of the timing column`);
    }
  });

  test('sets the dark module the spec requires', () => {
    assert.equal(modules[size - 8][8], true);
  });

  test('writes both copies of the format information identically', () => {
    // The second copy is what a code with one damaged corner is read from, so
    // a decoder that only ever consults the first would not notice it rotting.
    const vertical = readFormat(modules);
    let bits = 0;
    for (let i = 0; i < 15; i += 1) {
      const col = i < 8 ? size - 1 - i : i === 8 ? 7 : 14 - i;
      if (modules[8][col]) bits |= 1 << i;
    }
    const value = (bits ^ 0b101_0100_0001_0010) >> 10;
    assert.deepEqual({ eccLevel: value >> 3, mask: value & 0b111 }, vertical);
  });
});

describe('capacity', () => {
  test('encodes a payload of exactly the maximum length', () => {
    assert.equal(decode(qrModules('a'.repeat(MAX_BYTES))).text, 'a'.repeat(MAX_BYTES));
  });

  test('refuses one byte more', () => {
    assert.throws(() => qrModules('a'.repeat(MAX_BYTES + 1)), /too long/i);
  });

  test('counts UTF-8 bytes, not characters', () => {
    // 60 characters, 240 bytes: a code that measured length in UTF-16 units
    // would see 120 and happily overflow its own data block.
    assert.throws(() => qrModules('🏋'.repeat(60)), /too long/i);
  });

  test('rejects an empty payload rather than emitting a scannable blank', () => {
    assert.throws(() => qrModules(''), /empty/i);
  });
});

describe('SVG rendering', () => {
  const svg = qrSvg('https://carver.github.io/5bx/');

  test('is scalable rather than fixed to a pixel size', () => {
    assert.match(svg, /viewBox="0 0 \d+ \d+"/);
    assert.doesNotMatch(svg, /width="\d+px"/);
  });

  test('surrounds the code with the quiet zone scanners need', () => {
    const size = qrModules('https://carver.github.io/5bx/').length;
    const [, viewBox] = svg.match(/viewBox="0 0 (\d+)/);
    assert.equal(Number(viewBox), size + 8, 'four modules of margin on each side');
  });

  test('paints a light background, so it scans on a dark theme', () => {
    assert.match(svg, /<rect[^>]+fill="#fff"/);
  });

  test('contains no script or external reference', () => {
    assert.doesNotMatch(svg, /<script|href=|xlink|<image/i);
  });

  test('escapes the accessible label rather than injecting it', () => {
    const nasty = qrSvg('5BX', { label: 'a "quoted" <tag> & more' });
    assert.match(nasty, /aria-label="a &quot;quoted&quot; &lt;tag> &amp; more"/);
  });
});

describe('against an independent implementation', () => {
  test('reads back a code this project did not generate', { skip: referenceSkip }, () => {
    // The check that stops the encoder and the decoder agreeing on a shared
    // misreading of the spec: these matrices come from other code entirely.
    for (let length = 1; length <= MAX_BYTES; length += 1) {
      const text = 'x'.repeat(length);
      assert.equal(decode(referenceModules(text)).text, text, `length ${length}`);
    }
  });

  test('reads back random codes it did not generate', { skip: referenceSkip }, () => {
    const rng = seeded(11);
    for (let round = 0; round < 200; round += 1) {
      const text = randomText(rng, 1 + Math.floor(rng() * MAX_BYTES));
      assert.equal(decode(referenceModules(text)).text, text, JSON.stringify(text));
    }
  });

  test('agrees on the version chosen for every length', { skip: referenceSkip }, () => {
    for (let length = 1; length <= MAX_BYTES; length += 1) {
      const text = 'x'.repeat(length);
      assert.equal(qrModules(text).length, referenceModules(text).length, `length ${length}`);
    }
  });

  test('agrees module-for-module whenever the mask choice agrees', { skip: referenceSkip }, () => {
    // Where the two penalty rules happen to land on the same mask, everything
    // else — encoding, error correction, interleaving, placement — must match
    // exactly. That covers every version and both block-group layouts.
    const versionsCompared = new Set();
    for (let length = 1; length <= MAX_BYTES; length += 1) {
      const text = 'x'.repeat(length);
      const mine = qrModules(text);
      const theirs = referenceModules(text);
      if (decode(mine).mask !== decode(theirs).mask) continue;

      versionsCompared.add(decode(mine).version);
      assert.deepEqual(mine, theirs, `length ${length}`);
    }
    assert.deepEqual([...versionsCompared].sort((a, b) => a - b),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'every version was compared exactly');
  });
});
