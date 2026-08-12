# Contributing

## Ground rules

The app ships **zero runtime dependencies** and has **no build step**. What is
in the repo is exactly what the browser gets. Two consequences:

- Don't add a runtime dependency, bundler, transpiler, or CSS framework. A test
  in `test/static.test.js` enforces the first of these.
- Every asset path must be **relative** (`./js/app.js`, not `/js/app.js`), because
  GitHub Pages serves project sites from `https://user.github.io/<repo>/`. This
  is also enforced by a test.

`jsdom` is the single dependency, it is dev-only, and it is only used by
`test/dom.test.js`.

## Running things

```sh
npm test            # full suite (246 tests)
npm run verify      # quick sanity check on js/config.js
npm run stamp       # re-stamp the app version after changing a shipped file
npm run serve       # static server on http://localhost:8000
```

`npm test` works on a bare checkout with nothing installed — the DOM suite
skips itself if `jsdom` is missing and the other ~211 tests still run. Run
`npm install` to get the DOM suite too.

ES modules don't load over `file://`, so use `npm run serve` rather than
opening `index.html` directly.

## After changing anything

1. **Edited `js/config.js`?** Run `npm run verify`. It checks the shape of every
   chart and, most usefully, that no rep target *decreases* as levels rise —
   which catches most transposition slips when retuning a column.
2. **Added or renamed a file under `js/` or `icons/`?** Add it to `SHELL_FILES`
   in `sw.js`, or the app breaks offline while still working in dev. There's a
   test for this.
3. **Changed any shipped file?** Run `npm run stamp`. It derives a version from
   the contents of everything the service worker caches and writes it into both
   `js/version.js` (shown in Settings → Version) and `CACHE_VERSION` in `sw.js`.

   This is not bookkeeping. The shell is served cache-first, and a browser only
   installs a new worker when `sw.js` differs byte-for-byte — so shipping a
   change without moving the version pins returning visitors to the old code
   *permanently*. Reloading, pull-to-refresh and the update banner are all
   powerless against it, and the deploy looks perfectly healthy from the
   outside. `npm test` fails when the stamp is stale, so CI catches a miss.

## Test layout

| File | Covers |
| ---- | ------ |
| `test/config.test.js` | Chart data, rep tables re-checked against the printed source, age table, level progression helpers |
| `test/state.test.js` | Days-at-level counting, the advance gate, streaks, persistence |
| `test/pace.test.js` | Exercise 5 pacing: jump-block schedule, step estimate, per-set counter |
| `test/static.test.js` | Deployment integrity: service worker cache list, manifest, relative paths, no runtime deps |
| `test/dom.test.js` | Renders every view and drives a full guided workout (needs `jsdom`) |

Tests use the built-in `node:test` runner — no framework. Each file runs in its
own process, so a test that mutates module state (the DOM suite shrinks
`TIMING_SECONDS` so a workout takes seconds instead of 11 minutes) can't leak
into the others.

Worth knowing about two deliberate testing choices:

- **`test/config.test.js` re-enters the rep tables in the printed order** (A+
  down to D-), the reverse of how `js/config.js` stores them. It's a real
  transcription check, not a restatement of the config.
- **`test/state.test.js` backdates timestamps** rather than waiting. The whole
  suite runs inside a millisecond or two, and `daysAtLevel()` counts sessions
  *strictly after* arriving at a level, so tests move `levelStartedTs` backwards
  instead of relying on real time passing.

## CI

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

- **`Test (Node 20 / 22 / 24)`** — `npm ci`, then the full suite plus
  `npm run verify`. `REQUIRE_DOM_TESTS=1` is set so a broken install fails
  loudly instead of silently skipping the DOM tests.
- **`Runs without dependencies`** — the suite with nothing installed, proving
  the app never picks up a runtime dependency by accident.

All four checks must pass before a pull request can be merged.
