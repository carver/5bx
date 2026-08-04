# 5BX

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
- **Exercise 5 interval cues** — the "every 75 steps, do 10 *X*" break is cued
  from the clock, pacing the target step count across the 6 minutes, so you
  don't have to watch the screen or tap a counter while running in place.
- **Progression** — a level is only offered when a session hit *every* target
  **and** you have logged sessions on enough distinct days at that level.
- **History** — day-at-level progress, streak, a 9-week calendar, and a step
  chart of your movement through the levels.
- **Installable PWA** with an offline app shell and a configurable daily
  reminder.
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
| Deconditioning thresholds | `DECONDITIONING` |

Each `reps` entry is a 5-element array positionally matching `exercises`. The
fifth number is a **step** count for the stationary run (one step = one
left-foot touchdown), not a rep count.

After editing, sanity-check your changes:

```sh
node tools/verify-config.mjs     # or: npm run verify
```

It checks the shape of every chart and, most usefully, that no rep target
*decreases* as levels rise — which catches most transposition slips when
retuning a column. Sample failure output:

```
FAIL  chart 1 B: 5 targets — [12,12,14,8]
FAIL  chart 1: C is not easier than C- — exercise 3
```

The verifier has zero dependencies and never runs in the browser. `package.json`
exists only so Node treats the `.js` files as ES modules — there is nothing to
install and nothing to build.

Finally, bump `CACHE_VERSION` in `sw.js` so returning visitors don't get served
the stale cached copy.

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
  timer.js          wall-clock countdown, screen wake lock
  audio.js          WebAudio cue tones
  ui.js             small DOM helpers
tools/
  verify-config.mjs dev-only config sanity check (not served)
```

`package.json` and `tools/` are development conveniences and play no part in
the deployed site — GitHub Pages just serves the static files.

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
Force *5BX Plan for Physical Fitness* (1961). The bird dog progression follows
<https://nick-e.com/bird-dog/>.

Not medical advice.
