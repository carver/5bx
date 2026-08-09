# 5BX

**A daily 5BX workout helper**

Use it here: https://carver.github.io/5bx/

The [RCAF 5BX](https://csclub.uwaterloo.ca/~rfburger/5bx-plan.pdf) system is great for quick daily
workouts. What's not so great is timing and tracking the data in the middle of working out.

This app runs a timer for each exercise, reminding you which one is next. It helps you pace
your running (in place) for the final leg. There's a minimal history view, too.

Finally, I swapped out the sit-ups for a bird-dog progression, which is a safer core exercise.

This is the end of the hand-written README. The rest was written by AI.

## The gist

A single-page guided workout app for a modified version of the RCAF **5BX Plan**:
6 charts × 12 levels, 5 exercises, 11 minutes a day.

Vanilla HTML/CSS/JS. No build step, no framework, no external dependencies, no
CDNs. Installable as a PWA and fully usable offline.

## The modification

Exercise 2 (originally sit-ups) is replaced by the **bird dog** progression on
charts 1–3:

| Chart | Exercise 2 |
| ----- | ---------- |
| 1 | Bird dog level 2a — arm reach only |
| 2 | Bird dog level 2b — leg only (`extension` variant by default) |
| 3 | Bird dog level 3 — combined opposite arm + leg |
| 4–6 | *Unmodified* — still the original 5BX sit-up variants |

**The bird-dog rep counts are guesses.** They were seeded by copying the
original sit-up rep column for the equivalent chart and level, on the reasoning
that both are roughly a one-minute moderate-effort core movement. Expect to tune
them — see *Editing the workout data* below.

Charts 4–6 are flagged in `js/config.js` with a `birdDogTodo` marker and a
`TODO` comment, since no bird-dog variant is defined for them yet.

**Rep counting convention:** for every alternating exercise (bird dogs and the
original alternate leg raise), **1 rep = one full alternating cycle** — one
side, then the other. This matches how the original plan counts its alternate
leg raise.

## Features

- **Guided mode** — walks through the 5 exercises one at a time. Each gets its
  own instructions, target, timer (2:00 / 1:00 / 1:00 / 1:00 / 6:00), and an
  explicit "did you hit the target?" checkpoint before moving on.
- **Audible + haptic cues** at the end of each exercise, synthesised with
  WebAudio so there are no sound files to download.
- **Live pacing estimate on every exercise** — a running "~N of target" count
  during the exercise, so you always know roughly where you should be without
  having to count reps in your head while your hands are shaking. Exercise 5
  (the stationary run) gets two readouts:

  ```
  ~317 of 400 steps        running total for the exercise
  ~17 of 75 · set 5 of 6   restarts at every break
  ```

  The per-set line matches counting 1–75 in your head and starting over. The
  last set is the remainder, not a full 75 (400 steps = 75×5 + 25, so 6 sets
  and 5 breaks — there is no break after the final step). That final-set size
  is also shown on the "did you complete the target?" checkpoint, alongside
  the 400-step total.

  Both exercise-5 readouts **freeze** during a jump block, since you aren't
  taking steps. Because those blocks come out of the same 6 minutes, the
  running cadence is scaled up so the estimate still lands exactly on the
  target at 6:00. Tune the assumed block duration with
  `CONFIG.intervalMovementSeconds`.
- **Progression** — a level is only offered when a session hit *every* target
  **and** you have logged sessions on enough distinct days at that level.
- **History** — day-at-level progress, streak, a 9-week calendar, and a step
  chart of your movement through the levels, scaled to the highest level
  you've actually reached so early progress doesn't read as a flat line.
- **Installable PWA** with an offline app shell, a configurable daily
  reminder, and a banner that offers a reload when a newer version has
  deployed (never mid-exercise — see `js/update.js`).
- **Dark mode** from `prefers-color-scheme`, with a manual override in Settings.
- **Large hit targets** throughout (≥48px, 68px+ for primary actions) with wide
  spacing between adjacent controls.

## Editing the workout data

Everything you'd want to tune lives in **`js/config.js`** and nothing else:

| What | Where |
| ---- | ----- |
| Rep/step targets | `CHARTS[n].reps`, keyed by level, ordered low → high |
| Exercise names & instructions | `CHARTS[n].exercises[i]` |
| Per-exercise durations | `TIMING_SECONDS` |
| Age → minimum days table | `MIN_DAYS_BY_AGE` |
| Chart 2 bird-dog wording | `CONFIG.birdDogChart2Variant` (`'extension'` or `'raise'`) |
| Assumed seconds per interval jump | `CONFIG.intervalMovementSeconds` (or `secondsEach` on one chart's `interval`) |
| Deconditioning thresholds | `DECONDITIONING` |

Each `reps` entry is a 5-element array positionally matching `exercises`. The
fifth number is a **step** count for the stationary run (one step = one
left-foot touchdown), not a rep count.

After editing, sanity-check your changes:

```sh
npm run verify     # or: node tools/verify-config.mjs
```

It checks the shape of every chart and, most usefully, that no rep target
*decreases* as levels rise — which catches most transposition slips when
retuning a column. Sample failure output:

```
FAIL  chart 1 B: 5 targets — [12,12,14,8]
FAIL  chart 1: C is not easier than C- — exercise 3
```

Finally, bump `CACHE_VERSION` in `sw.js` so returning visitors don't get served
the stale cached copy.

## Development

```sh
npm run serve      # static server on http://localhost:8000
npm test           # full test suite
npm run verify     # quick check on js/config.js
```

ES modules don't load over `file://`, so use the server rather than opening
`index.html` directly. Service workers and notifications need a secure context —
`localhost` counts, so no HTTPS setup is needed locally.

### Tests

242 tests on Node's built-in runner (`node:test`) — no test framework.

```
test/config.test.js   chart data, rep tables vs the printed source, age table
test/state.test.js    days-at-level, the advance gate, streaks, persistence
test/pace.test.js     exercise 5 pacing, jump blocks, per-set counter
test/static.test.js   service worker cache list, manifest, relative paths
test/dom.test.js      renders every view, drives a full workout (needs jsdom)
```

`npm test` works **on a bare checkout with nothing installed** — the DOM suite
skips itself and the other ~211 tests still run. Run `npm install` to enable it.

`jsdom` is the only dependency in the repo, it's dev-only, and the app itself
ships zero runtime dependencies — there's a test enforcing that. `package.json`
exists so Node treats the files as ES modules and to hold the test scripts;
nothing is bundled, transpiled, or built.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full layout and conventions.

### Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`:

| Check | What it does |
| ----- | ------------ |
| `Test (Node 22)` / `(Node 24)` | `npm ci`, full suite, then `npm run verify` |
| `Runs without dependencies` | The suite with nothing installed, proving no runtime dependency crept in |

#### Requiring the checks before merge

Workflows can't grant themselves this — it's a repo setting, and the checks must
have run at least once before GitHub will list them:

1. Push this repo and open one pull request so the checks appear.
2. **Settings → Rules → Rulesets → New ruleset → New branch ruleset**.
3. Name it (e.g. `main`), set **Enforcement status** to **Active**.
4. Under **Target branches**, add **Include default branch**.
5. Tick **Require a pull request before merging**.
6. Tick **Require status checks to pass**, then add all three:
   `Test (Node 22)`, `Test (Node 24)`,
   `Runs without dependencies`.
7. Tick **Require branches to be up to date before merging** so a green PR can't
   merge against a stale base.
8. **Create**.

Merging is then blocked until CI is green. (On older repos the equivalent lives
under **Settings → Branches → Add branch protection rule**.)

## Running locally

ES modules don't work over `file://`, so use any static server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Service workers and notifications require a secure context — `localhost`
counts, so local development works without HTTPS.

## Hosting on GitHub Pages

The repo is already structured to publish as-is: static files at the root, and
every asset reference is relative, so it works from a project subpath like
`https://username.github.io/5bx/`.

1. Push this repo to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose branch **`main`** and folder **`/ (root)`**, then **Save**.
5. Wait ~1 minute, then open `https://<username>.github.io/<repo-name>/`.

That's it — no build step and no workflow file needed.

To serve from `/docs` instead, move every file into a `docs/` directory and
pick **`/docs`** in step 4. Nothing else needs to change, because no path in
the app is absolute.

### Installing on Android

Open the Pages URL in Chrome, then **⋮ → Add to Home screen**. Enable the daily
reminder from **Settings** inside the app.

## Project layout

```
index.html          markup shell
styles.css          all styling
manifest.json       PWA manifest (relative start_url and scope)
sw.js               offline app shell + reminder wake-ups
icons/              icon.svg plus the minimum PNGs for installability
js/
  config.js         ALL workout data — the only file you need to edit
  state.js          localStorage persistence, progression rules
  app.js            entry point, routing, theme, SW registration
  workout.js        guided workout mode
  home.js           dashboard
  history.js        progress & history
  settings.js       settings
  notifications.js  daily reminder scheduling
  update.js         detects a newer deployed version, offers a reload
  pace.js           live rep/step pacing estimate for every exercise
  timer.js          wall-clock countdown, screen wake lock
  audio.js          WebAudio cue tones
  ui.js             small DOM helpers
test/               node:test suites (dev only)
tools/
  verify-config.mjs      dev-only config sanity check (not served)
  generate-badge-icon.mjs dev-only: rasterizes icon-badge.svg (not served)
.github/workflows/
  ci.yml            runs the suite on pull requests and pushes to main
```

`package.json`, `test/`, `tools/`, and `.github/` are development conveniences
and play no part in the deployed site — GitHub Pages just serves the static
files.

## Known limitation: reminder reliability

Android aggressively restricts background execution. The app schedules the
daily reminder three ways, best-available first:

1. **Notification Triggers** (`TimestampTrigger`) — genuinely OS-scheduled,
   but only available behind a flag/origin trial in Chrome.
2. **Periodic Background Sync** — the service worker gets woken roughly daily
   for installed PWAs, at a cadence Chrome decides based on how often you use
   the app.
3. **An in-page timer** — exact, but only while a tab is alive.

If the browser stays fully closed for a long stretch and neither (1) nor (2) is
available, the reminder can be late or skipped. That's a platform restriction,
not a bug in the app. This is documented in `js/notifications.js` and `sw.js`.

## Attribution

Exercise descriptions and rep tables are adapted from the Royal Canadian Air
Force [*5BX Plan for Physical Fitness*](https://csclub.uwaterloo.ca/~rfburger/5bx-plan.pdf) (1961).
The bird dog progression follows <https://nick-e.com/bird-dog/>.

Not medical advice.
