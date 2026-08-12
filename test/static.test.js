/*
 * Deployment integrity — the checks that catch a broken GitHub Pages deploy
 * rather than broken logic. All of these have a real failure mode:
 *
 *  - a new js/ module not added to the service worker's cache list means the
 *    app breaks offline, but works fine in dev
 *  - an absolute path works on a user site (user.github.io) and 404s on a
 *    project site (user.github.io/5bx/)
 *  - a missing manifest icon silently kills installability
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { repoPath } from './helpers/env.js';

const read = (...parts) => readFileSync(repoPath(...parts), 'utf8');

const swSource = read('sw.js');
const shellFiles = swSource
  .match(/const SHELL_FILES = \[([\s\S]*?)\];/)[1]
  .match(/'([^']+)'/g)
  .map((quoted) => quoted.slice(1, -1));

describe('service worker app shell', () => {
  test('every cached path exists on disk', () => {
    for (const path of shellFiles) {
      if (path === './') continue;
      assert.ok(existsSync(repoPath(path)), `cached but missing: ${path}`);
    }
  });

  test('every shipped file is cached', () => {
    const shipped = [
      './index.html', './styles.css', './manifest.json',
      ...readdirSync(repoPath('js')).map((n) => `./js/${n}`),
      ...readdirSync(repoPath('icons')).map((n) => `./icons/${n}`),
    ];
    for (const path of shipped) {
      assert.ok(shellFiles.includes(path),
        `${path} is served but not in SHELL_FILES — it would break offline`);
    }
  });

  test('the cache name is versioned', () => {
    assert.match(swSource, /const CACHE_VERSION = '[^']+'/);
  });

  /*
   * The one that actually bites. Everything below the navigation handler is
   * served cache-first out of `5bx-shell-${CACHE_VERSION}`, and the browser
   * only installs a new worker when sw.js changes byte-for-byte. Ship a change
   * to any other file without moving the version and returning visitors are
   * pinned to the old code permanently: reloading, pull-to-refresh and the
   * update banner are all powerless, because from the browser's side nothing
   * changed. It looks exactly like a healthy deploy. Hence: derive the version
   * from the content and fail here when the committed stamp is stale.
   */
  test('the version stamp matches the shipped files', async () => {
    const { contentHash, committedVersion, hashOf } =
      await import('../tools/stamp-version.mjs');
    const committed = committedVersion();
    assert.ok(committed, 'js/version.js has no APP_VERSION — run `npm run stamp`');
    assert.equal(hashOf(committed), contentHash(),
      'a shipped file changed without re-stamping — run `npm run stamp`. ' +
      'Without it the service worker keeps serving the old cached copy.');
  });

  test('the cache version and the app version are the same string', async () => {
    const { committedVersion } = await import('../tools/stamp-version.mjs');
    assert.match(swSource,
      new RegExp(`const CACHE_VERSION = '${committedVersion()}';`),
      'sw.js and js/version.js disagree — run `npm run stamp`');
  });

  test('the KV cache is not swept by the shell cleanup', () => {
    // Deleting it on activate would wipe the reminder settings on every deploy.
    assert.match(swSource, /startsWith\('5bx-shell-'\)/);
  });
});

describe('reminder date keys', () => {
  // js/notifications.js's in-page timer and sw.js's periodicsync handler
  // both dedupe "did today's reminder already fire?" against the same
  // shared KV entry, so they MUST agree on what "today" means. sw.js can
  // only use its own local-date helper (a service worker has no page module
  // graph to import from), so js/notifications.js has to match it by hand —
  // toISOString() gives the UTC date, which drifts from the local one for
  // part of the day in most timezones and silently reintroduces a duplicate
  // evening notification.
  test('the page-timer dedup key is not UTC-derived', () => {
    const notifSource = read('js/notifications.js');
    assert.doesNotMatch(notifSource, /toISOString\(\)\.slice\(0,\s*10\)/,
      'a UTC-based date key here will disagree with sw.js\'s local-date key ' +
      '(see localDateKey in sw.js) for part of the day in most timezones');
  });
});

describe('relative paths', () => {
  const sourceFiles = [
    'index.html', 'styles.css', 'sw.js', 'manifest.json',
    ...readdirSync(repoPath('js')).map((n) => `js/${n}`),
  ];

  test('no absolute asset references anywhere', () => {
    // A leading slash resolves to the domain root, which is wrong on a
    // GitHub Pages project site served from /<repo>/.
    const patterns = [
      /(?:src|href)="\//,
      /from\s+['"]\//,
      /import\(['"]\//,
      /register\(['"]\//,
      /url\(\s*['"]?\//,
    ];
    for (const file of sourceFiles) {
      const contents = read(file);
      for (const pattern of patterns) {
        assert.ok(!pattern.test(contents),
          `${file} contains an absolute path matching ${pattern}`);
      }
    }
  });

  test('the service worker registers relatively', () => {
    assert.match(read('js/app.js'), /register\('\.\/sw\.js'\)/);
  });
});

describe('manifest', () => {
  const manifest = JSON.parse(read('manifest.json'));

  test('parses and declares a standalone app', () => {
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.name);
    assert.ok(manifest.short_name);
  });

  test('start_url and scope are relative', () => {
    assert.equal(manifest.start_url, './');
    assert.equal(manifest.scope, './');
  });

  test('every icon file exists', () => {
    for (const icon of manifest.icons) {
      assert.ok(existsSync(repoPath(icon.src)), `missing icon: ${icon.src}`);
    }
  });

  test('has the sizes Chrome needs to offer installation', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    assert.ok(sizes.includes('192x192'), 'a 192x192 icon is required');
    assert.ok(sizes.includes('512x512'), 'a 512x512 icon is required');
    assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'),
      'a maskable icon is required for a clean Android launcher icon');
  });

  test('index.html links the manifest', () => {
    assert.match(read('index.html'), /rel="manifest" href="\.\/manifest\.json"/);
  });
});

describe('icons', () => {
  /** Minimal PNG header reader — avoids pulling in an image library. */
  function pngSize(path) {
    const bytes = readFileSync(repoPath(path));
    assert.deepEqual([...bytes.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${path} is not a PNG`);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  test('PNG icons are valid and correctly sized', () => {
    assert.deepEqual(pngSize('icons/icon-192.png'), { width: 192, height: 192 });
    assert.deepEqual(pngSize('icons/icon-512.png'), { width: 512, height: 512 });
    assert.deepEqual(pngSize('icons/icon-maskable-512.png'),
      { width: 512, height: 512 });
    assert.deepEqual(pngSize('icons/icon-badge-96.png'), { width: 96, height: 96 });
  });

  test('the SVG icon is well-formed enough to parse', () => {
    const svg = read('icons/icon.svg');
    assert.match(svg, /<svg[^>]+viewBox="0 0 512 512"/);
    assert.match(svg, /<\/svg>\s*$/);
  });

  test('the badge icon has real transparency', () => {
    // Android's notification badge/status-bar icon uses ONLY the alpha
    // channel — every opaque pixel becomes a solid flat color. A badge PNG
    // with no transparent pixels at all renders as a solid block (the "white
    // square in notification areas" bug), so this specifically must NOT be
    // the same fully-opaque file as the app icon.
    const bytes = readFileSync(repoPath('icons/icon-badge-96.png'));
    assert.equal(bytes[25], 6, 'must be PNG color type 6 (RGBA) — no alpha channel means no silhouette');
  });

  test('notifications never use the opaque app icon as the badge', () => {
    // badge must point at the transparent silhouette, not icon-192 — see
    // "the badge icon has real transparency" above for why.
    for (const file of ['js/notifications.js', 'sw.js']) {
      const contents = read(file);
      const badgeLines = contents.split('\n').filter((l) => l.includes('badge:'));
      assert.ok(badgeLines.length > 0, `${file} has no badge: usage to check`);
      for (const line of badgeLines) {
        assert.match(line, /icon-badge-96\.png/, `${file}: ${line.trim()}`);
      }
    }
  });
});

describe('no runtime dependencies', () => {
  test('the app itself imports nothing external', () => {
    for (const name of readdirSync(repoPath('js'))) {
      const contents = read('js', name);
      const imports = [...contents.matchAll(/from\s+['"]([^'"]+)['"]/g)]
        .map((m) => m[1]);
      for (const specifier of imports) {
        assert.ok(specifier.startsWith('./') || specifier.startsWith('../'),
          `js/${name} imports "${specifier}" — the app must stay dependency-free`);
      }
    }
  });

  test('package.json declares no runtime dependencies', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.dependencies, undefined,
      'runtime dependencies would have to be vendored or bundled');
  });

  test('index.html loads no external resources', () => {
    const html = read('index.html');
    assert.ok(!/https?:\/\//.test(html.replace(/<!--[\s\S]*?-->/g, '')),
      'index.html must not reference any external origin');
  });
});

describe('config verifier', () => {
  test('tools/verify-config.mjs passes on the committed config', () => {
    // Runs the same script a contributor would after editing rep tables.
    const output = execFileSync(process.execPath,
      [repoPath('tools', 'verify-config.mjs')],
      { encoding: 'utf8', cwd: repoPath() });
    assert.match(output, /config\.js looks good/);
  });
});
