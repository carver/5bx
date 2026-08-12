/*
 * End-to-end rendering tests: every view renders, and a full guided workout is
 * driven from the first Start tap to the level-up screen.
 *
 * These need a DOM, so jsdom is a devDependency. It is NOT required to run the
 * rest of the suite — if it isn't installed these tests skip with a message
 * rather than failing, so `node --test` works on a bare checkout.
 *
 * The workout tests shrink TIMING_SECONDS so a run takes ~2s instead of 11
 * minutes. That mutation is process-local; `node --test` gives each test file
 * its own process, so it cannot leak into the other suites.
 */

import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadJsdom, installDom, repoPath, sleep } from './helpers/env.js';

const JSDOM = await loadJsdom();

/*
 * Locally a missing jsdom just skips this file. In CI that would silently drop
 * ~30 tests if an install step broke, so CI sets REQUIRE_DOM_TESTS=1 to turn a
 * missing jsdom into a hard failure instead.
 */
if (!JSDOM && process.env.REQUIRE_DOM_TESTS === '1') {
  throw new Error(
    'REQUIRE_DOM_TESTS=1 but jsdom is not installed. Run `npm ci`.');
}

const skip = JSDOM ? false : 'jsdom is not installed — run `npm install`';

describe('DOM', { skip }, () => {
  let window; let root; let cfg; let store;
  let renderHome; let renderWorkout; let renderHistory; let renderSettings;
  let notify; let update;

  const buttons = () => [...root.querySelectorAll('button')];
  const button = (re) => buttons().find((b) => re.test(b.textContent));
  const text = () => root.textContent;

  /** Run one exercise: Start, wait for the timer, answer the checkpoint. */
  async function doExercise(answerYes = true) {
    button(/^Start$/).click();
    await sleep(320);
    button(answerYes ? /^Yes$/ : /^No$/).click();
  }

  before(async () => {
    window = installDom(JSDOM, readFileSync(repoPath('index.html'), 'utf8'));
    root = window.document.getElementById('app');

    // Import only after the DOM globals exist — several modules read from
    // `document` at module scope.
    cfg = await import('../js/config.js');
    store = await import('../js/state.js');
    ({ renderHome } = await import('../js/home.js'));
    ({ renderWorkout } = await import('../js/workout.js'));
    ({ renderHistory } = await import('../js/history.js'));
    ({ renderSettings } = await import('../js/settings.js'));
    notify = await import('../js/notifications.js');
    update = await import('../js/update.js');

    window.addEventListener('error', (event) => {
      assert.fail(`uncaught error in app code: ${event.message}`);
    });
  });

  /* --------------------------------------------------------------- views */

  describe('home', () => {
    before(() => {
      store.resetAll();
      store.updateSettings({ age: 30 }); // 4 days per level
      renderHome(root, { onStart() {}, onNav() {} });
    });

    test('shows the current level and day counter', () => {
      assert.match(text(), /Chart 1 · D-/);
      assert.match(text(), /Day 0 of 4/);
    });

    test('previews all five exercises', () => {
      assert.equal(root.querySelectorAll('.preview li').length, 5);
      assert.match(text(), /Bird dog/);
    });

    test('offers a start button', () => {
      assert.ok(button(/Start workout/));
    });

    test('renders no stray null or undefined text', () => {
      // Node.append() stringifies non-nodes, so a conditional child that
      // evaluates to null used to render the literal word "null".
      assert.doesNotMatch(text(), /\bnull\b|\bundefined\b/);
    });
  });

  describe('deconditioning warning', () => {
    test('appears after a long lay-off and hides otherwise', () => {
      store.resetAll();
      store.getSessions().push({
        ts: Date.now() - 90 * 86_400_000, date: '2026-05-06', chartId: 1,
        levelIndex: 0, results: [true, true, true, true, true], completed: true,
      });
      renderHome(root, { onStart() {}, onNav() {} });
      assert.match(text(), /restart at Chart 1, D-/);
      assert.doesNotMatch(text(), /\bnull\b/);

      store.getSessions().length = 0;
      renderHome(root, { onStart() {}, onNav() {} });
      assert.doesNotMatch(text(), /restart at Chart 1, D-/);
    });
  });

  describe('history', () => {
    before(() => {
      store.resetAll();
      renderHistory(root, { onNav() {} });
    });

    test('renders the calendar grid', () => {
      assert.equal(root.querySelectorAll('.calendar .cell').length, 63);
    });

    test('renders the level sparkline', () => {
      assert.ok(root.querySelector('svg.sparkline path'));
    });

    test('handles an empty history', () => {
      assert.match(text(), /No sessions yet/);
    });

    test('sparkline treads are as wide as the time spent at the level', () => {
      // A level held for a minute, then one held for 6 of the last 8 days.
      const day = 86_400_000;
      const now = Date.now();
      store.resetAll();
      const log = store.getLevelLog();
      log.length = 0;
      log.push(
        { ts: now - 8 * day, date: '', chartId: 1, levelIndex: 0, reason: 'start' },
        { ts: now - 8 * day + 60_000, date: '', chartId: 1, levelIndex: 1, reason: 'manual' },
        { ts: now - 2 * day, date: '', chartId: 1, levelIndex: 2, reason: 'advance' },
      );
      renderHistory(root, { onNav() {} });

      // Each `H x` in the step path ends one tread; widths are the gaps.
      const d = root.querySelector('svg.sparkline path').getAttribute('d');
      const xs = [...d.matchAll(/[MH] ([\d.]+)/g)].map((m) => Number(m[1]));
      const treads = xs.slice(1).map((x, i) => x - xs[i]);
      const total = treads.reduce((a, b) => a + b, 0);

      assert.ok(treads[0] < 1, `skipped level should be a sliver, got ${treads[0]}`);
      // 6 of 8 days, then 2 of 8 — within a pixel of the true proportions.
      assert.ok(Math.abs(treads[1] / total - 6 / 8) < 0.01, `got ${treads[1]}`);
      assert.ok(Math.abs(treads[2] / total - 2 / 8) < 0.01, `got ${treads[2]}`);
    });
  });

  describe('settings', () => {
    before(() => {
      store.resetAll();
      store.updateSettings({ age: 30 });
      renderSettings(root, { onNav() {}, applyTheme() {} });
    });

    test('shows the minimum derived from age', () => {
      assert.match(text(), /Age 30 → 4 days/);
    });

    test('offers chart, level and theme selects', () => {
      assert.ok(root.querySelectorAll('select').length >= 3);
    });

    test('explains reminders before requesting permission', () => {
      assert.match(text(), /Daily reminder/);
      assert.match(text(), /asks your browser for/);
    });
  });

  /* ------------------------------------------------------------- workout */

  describe('guided workout', () => {
    let exited;

    before(() => {
      // ~0.05s per exercise keeps the whole run near two seconds.
      cfg.TIMING_SECONDS.forEach((_, i) => { cfg.TIMING_SECONDS[i] = 0.05; });
    });

    test('walks all five exercises and logs a completed session', async () => {
      store.resetAll();
      store.updateSettings({ age: 30 });
      exited = false;
      renderWorkout(root, { onExit: () => { exited = true; } });

      const chart = cfg.getChart(1);
      for (let i = 0; i < 5; i += 1) {
        assert.match(text(), new RegExp(`Exercise ${i + 1} of 5`));
        assert.ok(text().includes(chart.exercises[i].name));
        assert.ok(text().includes(String(chart.reps['D-'][i])));
        assert.ok(button(/^Start$/), `exercise ${i + 1} start button`);

        button(/^Start$/).click();
        assert.ok(root.querySelector('.clock'));
        assert.ok(button(/Pause/));
        assert.ok(button(/Restart/));

        await sleep(320);
        assert.match(text(), /Did you complete the target\?/);
        button(/^Yes$/).click();
      }

      assert.match(text(), /Session complete/);
      assert.equal(root.querySelectorAll('.result-list li').length, 5);
      assert.equal(store.getSessions().length, 1);
      assert.equal(store.getSessions()[0].completed, true);
      assert.equal(store.daysAtLevel(), 1);
    });

    test('withholds the advance until the minimum days are met', () => {
      assert.match(text(), /stick with this level for 3 more days/);
      assert.equal(button(/Advance to/), undefined);
      button(/^Done$/).click();
      assert.equal(exited, true);
    });

    test('offers the advance once the minimum is met', async () => {
      store.getProgress().levelStartedTs = Date.now() - 10 * 86_400_000;
      for (let d = 1; d <= 3; d += 1) {
        const when = new Date(Date.now() - d * 86_400_000);
        store.getSessions().push({
          ts: when.getTime(), date: store.todayKey(when), chartId: 1,
          levelIndex: 0, results: [true, true, true, true, true],
          completed: true,
        });
      }

      renderWorkout(root, { onExit() {} });
      for (let i = 0; i < 5; i += 1) await doExercise(true);

      assert.ok(button(/Advance to Chart 1 D/), text().slice(-260));
      button(/Advance to/).click();
      assert.match(text(), /Level up/);
      assert.equal(store.getProgress().levelIndex, 1);
      assert.equal(store.daysAtLevel(), 0, 'day counter resets on advance');
    });

    test('a partial session logs but never offers an advance', async () => {
      store.getSessions().length = 0;
      store.getProgress().levelStartedTs = Date.now() - 10 * 86_400_000;

      renderWorkout(root, { onExit() {} });
      for (let i = 0; i < 5; i += 1) await doExercise(i !== 2);

      assert.match(text(), /Session logged/);
      assert.match(text(), /1 target missed/);
      assert.equal(button(/Advance to/), undefined);
      assert.equal(store.getSessions().at(-1).completed, false);
      assert.equal(store.daysAtLevel(), 1, 'a partial day still counts');
    });
  });

  /* --------------------------------------------------- exercise 5 pacing */

  describe('exercise 5 pacing', () => {
    let samples;

    before(async () => {
      // Chart 1 D- is 100 steps: one jump block, so 75 + 25 = 2 sets.
      // Compress exercise 5 to 4s with a 0.5s block so a real break happens.
      cfg.getChart(1).exercises[4].interval.secondsEach = 0.05;
      cfg.TIMING_SECONDS[4] = 4;

      store.resetAll();
      store.setPosition(1, 0, 'manual');
      renderWorkout(root, { onExit() {} });
      for (let i = 0; i < 4; i += 1) await doExercise(true);

      assert.match(text(), /Exercise 5 of 5/);
      assert.match(text(), /step estimate pauses for about 1s/);

      button(/^Start$/).click();
      samples = [];
      for (let i = 0; i < 20; i += 1) {
        await sleep(180);
        const steps = root.querySelector('.steps');
        if (!steps) break;
        const set = root.querySelector('.set-steps');
        const banner = root.querySelector('.banner');
        const parsed = set.textContent
          .match(/~(\d+) of (\d+) . set (\d+) of (\d+)/);
        samples.push({
          steps: Number(steps.textContent.match(/~(\d+)/)[1]),
          frozen: steps.classList.contains('frozen'),
          bannerVisible: !banner.hidden,
          setSteps: Number(parsed[1]),
          setTarget: Number(parsed[2]),
          setIndex: Number(parsed[3]),
          setCount: Number(parsed[4]),
          setFrozen: set.classList.contains('frozen'),
        });
      }
      assert.ok(samples.length > 5, 'not enough samples captured');
    });

    test('a jump block actually occurred', () => {
      assert.ok(samples.some((s) => s.frozen));
    });

    test('the running total freezes for the whole block', () => {
      const frozen = samples.filter((s) => s.frozen);
      assert.equal(new Set(frozen.map((s) => s.steps)).size, 1,
        JSON.stringify(frozen.map((s) => s.steps)));
    });

    test('the banner is visible exactly while frozen', () => {
      for (const s of samples) assert.equal(s.bannerVisible, s.frozen);
    });

    test('the per-set line freezes in step with the total', () => {
      for (const s of samples) assert.equal(s.setFrozen, s.frozen);
    });

    test('the per-set count holds full during the block', () => {
      for (const s of samples.filter((x) => x.frozen)) {
        assert.equal(s.setSteps, s.setTarget);
      }
    });

    test('the per-set count restarts after the break', () => {
      assert.ok(samples.some((s, i) => i > 0 && s.setSteps < samples[i - 1].setSteps),
        JSON.stringify(samples.map((s) => s.setSteps)));
      assert.ok(samples.some((s) => s.setIndex > 1));
    });

    test('the running total keeps climbing across the reset', () => {
      for (const [i, s] of samples.entries()) {
        if (i > 0) assert.ok(s.steps >= samples[i - 1].steps);
      }
      assert.ok(samples.at(-1).steps > samples[0].steps);
    });

    test('100 steps is reported as 2 sets', () => {
      assert.equal(samples[0].setCount, 2);
      assert.equal(samples[0].setTarget, 75);
    });

    test('the per-set count never exceeds its target', () => {
      for (const s of samples) assert.ok(s.setSteps <= s.setTarget);
    });
  });

  /* ------------------------------------------------------- notifications */

  describe('reminders', () => {
    test('next occurrence rolls to tomorrow once the time has passed', () => {
      const due = notify.nextOccurrence('07:00',
        new Date('2026-08-04T09:00:00'));
      assert.equal(due.getDate(), 5);
      assert.equal(due.getHours(), 7);
    });

    test('next occurrence stays today when still ahead', () => {
      const due = notify.nextOccurrence('23:30',
        new Date('2026-08-04T09:00:00'));
      assert.equal(due.getDate(), 4);
      assert.equal(due.getHours(), 23);
    });

    test('syncing survives a missing service worker', async () => {
      await notify.syncReminder(store.getSettings());
    });
  });

  /* --------------------------------------------------------- update banner */

  describe('update banner', () => {
    /** A minimal stand-in for navigator.serviceWorker: just an EventTarget
     *  with a `controller` field, which is all watchForUpdate() reads. */
    function fakeServiceWorkerContainer(controller) {
      const target = new window.EventTarget();
      target.controller = controller;
      return target;
    }

    function installFakeServiceWorker(controller) {
      const fake = fakeServiceWorkerContainer(controller);
      Object.defineProperty(window.navigator, 'serviceWorker', {
        value: fake, configurable: true,
      });
      return fake;
    }

    // The preceding "exercise 5 pacing" suite leaves a run's countdown mid-
    // flight without ever reaching its checkpoint, so keepAwake can still be
    // 'true' on entry here — reset it before every test, not just after,
    // rather than depending on suite ordering.
    beforeEach(() => {
      document.body.dataset.keepAwake = 'false';
    });

    afterEach(() => {
      document.body.querySelectorAll('.update-banner')
        .forEach((b) => b.remove());
    });

    test('shows once a new worker takes over a page that was already controlled', () => {
      const fake = installFakeServiceWorker({ /* had a controller at load */ });
      update.watchForUpdate({ update: async () => {} });
      fake.dispatchEvent(new window.Event('controllerchange'));
      assert.ok(document.body.querySelector('.update-banner'),
        'expected an update banner after controllerchange');
    });

    test('does not show for the very first install (no prior controller)', () => {
      const fake = installFakeServiceWorker(null);
      update.watchForUpdate({ update: async () => {} });
      fake.dispatchEvent(new window.Event('controllerchange'));
      assert.equal(document.body.querySelector('.update-banner'), null,
        'the first-ever activation is not an update — must stay silent');
    });

    test('does not interrupt an in-progress exercise', () => {
      document.body.dataset.keepAwake = 'true';
      const fake = installFakeServiceWorker({});
      update.watchForUpdate({ update: async () => {} });
      fake.dispatchEvent(new window.Event('controllerchange'));
      assert.equal(document.body.querySelector('.update-banner'), null,
        'must not show a tap target next to exercise controls mid-workout');
    });

    test('Reload and Not now are both present and only one is a reload', () => {
      const fake = installFakeServiceWorker({});
      update.watchForUpdate({ update: async () => {} });
      fake.dispatchEvent(new window.Event('controllerchange'));
      const buttons = [...document.querySelectorAll('.update-banner button')]
        .map((b) => b.textContent);
      assert.deepEqual(buttons.sort(), ['Not now', 'Reload']);
    });
  });
});
