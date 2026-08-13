/*
 * Routing: which view is showing, and how the browser's history moves between
 * them.
 *
 * These are the tests for the hardware back button on Android. Installed as a
 * PWA there is no browser chrome, so back is the *only* way out of a screen
 * other than an on-screen button — and if the app never puts anything on the
 * session history, back drops straight out to the launcher instead.
 *
 * Views are injected as plain recorder functions: the router's job is choosing
 * and unmounting views, not drawing them (test/dom.test.js covers the drawing).
 *
 * Like test/dom.test.js this needs jsdom, so it skips itself when jsdom is
 * missing — unless CI sets REQUIRE_DOM_TESTS=1.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { loadJsdom, until, quiet } from './helpers/env.js';

const JSDOM = await loadJsdom();

if (!JSDOM && process.env.REQUIRE_DOM_TESTS === '1') {
  throw new Error(
    'REQUIRE_DOM_TESTS=1 but jsdom is not installed. Run `npm ci`.');
}

const skip = JSDOM ? false : 'jsdom is not installed — run `npm install`';

const { createRouter } = skip ? {} : await import('../js/router.js');

/**
 * A router over recorder views, on a window with its own fresh session
 * history. `rendered` is the running list of views the router has shown.
 */
function harness(overrides = {}) {
  // A project-subpath URL, matching how the app is actually served on Pages.
  const { window } = new JSDOM('<body></body>',
    { url: 'https://example.github.io/5bx/' });
  const rendered = [];
  const record = (name) => () => { rendered.push(name); };
  const views = {
    home: record('home'),
    history: record('history'),
    settings: record('settings'),
    workout: record('workout'),
    ...overrides,
  };
  return { window, rendered, router: createRouter({ views, window }) };
}

describe('router', { skip }, () => {
  test('the back button returns to the previous view', async () => {
    const { window, router, rendered } = harness();
    router.start();
    router.go('history');
    assert.deepEqual(rendered, ['home', 'history']);

    window.history.back();
    await until(() => router.showing === 'home', 'back to land on Home');

    assert.deepEqual(rendered, ['home', 'history', 'home'],
      'back from Progress must land on Home, not leave the app');
  });

  test('an on-screen Back tap pops the entry it is leaving', async () => {
    const { window, router, rendered } = harness();
    router.start();
    router.go('history');

    router.go('home'); // the Progress screen's own "Back" button
    await until(() => router.showing === 'home', 'the Home screen');
    assert.deepEqual(rendered, ['home', 'history', 'home']);

    // Home is the root again, so the next back press falls out to the
    // launcher. Stacking a second Home entry instead would send the user
    // *forward* into Progress when they pressed back.
    window.history.back();
    await quiet();
    assert.deepEqual(rendered, ['home', 'history', 'home'],
      'back at Home must leave the app, not re-enter Progress');
  });

  test('a view can refuse to be left', async () => {
    // The workout guards its exit behind a confirm(); back must respect that
    // rather than silently binning a half-finished session.
    let quitting = false;
    const { window, router, rendered } = harness({
      workout: () => {
        rendered.push('workout');
        return {
          confirmLeave: () => quitting,
          teardown: () => { rendered.push('workout torn down'); },
        };
      },
    });
    router.start();
    router.go('workout');

    window.history.back();
    await quiet();
    assert.deepEqual(rendered, ['home', 'workout'],
      'a declined quit must leave the workout on screen');

    quitting = true;
    window.history.back();
    await until(() => router.showing === 'home', 'the workout to be left');
    assert.deepEqual(rendered, ['home', 'workout', 'workout torn down', 'home'],
      'a second back press, once allowed, exits and cleans up');
  });
});
