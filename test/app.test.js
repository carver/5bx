/*
 * The real app, booted from index.html and driven the way a phone drives it:
 * taps and the hardware back button.
 *
 * test/router.test.js covers the routing rules against stub views; this file
 * exists to catch the app being wired up to ignore them.
 *
 * Needs jsdom, so it skips itself when jsdom is missing — unless CI sets
 * REQUIRE_DOM_TESTS=1.
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadJsdom, installDom, repoPath, until, quiet } from './helpers/env.js';

const JSDOM = await loadJsdom();

if (!JSDOM && process.env.REQUIRE_DOM_TESTS === '1') {
  throw new Error(
    'REQUIRE_DOM_TESTS=1 but jsdom is not installed. Run `npm ci`.');
}

const skip = JSDOM ? false : 'jsdom is not installed — run `npm install`';

describe('app navigation', { skip }, () => {
  let window; let root;

  const text = () => root.textContent;
  const tap = (re) => {
    const button = [...root.querySelectorAll('button')]
      .find((b) => re.test(b.textContent));
    assert.ok(button, `no button matching ${re} on the ${view()} screen`);
    button.click();
  };
  const view = () => window.document.body.dataset.view;
  /* The back button. History navigation is asynchronous, so both helpers
   * wait: one for the screen to change, one to confirm it doesn't. */
  const backTo = async (expected) => {
    window.history.back();
    await until(() => view() === expected, `the ${expected} screen`);
  };
  const backStayingOn = async (expected) => {
    window.history.back();
    await quiet();
    assert.equal(view(), expected);
  };

  before(async () => {
    window = installDom(JSDOM, readFileSync(repoPath('index.html'), 'utf8'));
    root = window.document.getElementById('app');
    window.addEventListener('error', (event) => {
      assert.fail(`uncaught error in app code: ${event.message}`);
    });
    await import('../js/app.js'); // boots on Home
  });

  test('back from Progress returns to Home, ready for the next workout',
    async () => {
      assert.equal(view(), 'home');

      tap(/Progress/);
      assert.equal(view(), 'history');
      assert.match(text(), /Last 9 weeks/);

      await backTo('home');
      assert.match(text(), /Start workout/);
    });

  test('back walks out of nested screens one at a time', async () => {
    tap(/Progress/);
    tap(/Settings/);
    assert.equal(view(), 'settings');

    await backTo('history'); // back from Settings returns to Progress
    await backTo('home');

    // Home is the root entry: back here belongs to Android, which minimises
    // the app. Nothing of ours may swallow it.
    await backStayingOn('home');
  });

  test('back during a workout goes through the same confirm as Quit',
    async () => {
      tap(/Start workout/);
      assert.equal(view(), 'workout');

      await backTo('home'); // no confirm before the first exercise

      // Now answer one exercise, so there is a session to lose.
      tap(/Start workout/);
      tap(/^Start$/);
      tap(/End exercise/);
      tap(/^Yes$/);
      assert.match(text(), /Exercise 2 of 5/);

      window.confirm = () => false;
      globalThis.confirm = window.confirm;
      await backStayingOn('workout'); // a declined confirm stays put
      assert.match(text(), /Exercise 2 of 5/);

      window.confirm = () => true;
      globalThis.confirm = window.confirm;
      await backTo('home');
      assert.equal(window.document.body.dataset.keepAwake, 'false',
        'leaving via back must release the screen wake lock');
    });
});
