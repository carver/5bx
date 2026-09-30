/*
 * tools/preview.mjs and its scenarios. The scenarios drive real views, so they
 * run here under jsdom to catch one falling behind a view it depends on.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';

import { loadJsdom, installDom, repoPath } from './helpers/env.js';
import { serve, PREVIEW_PATH } from '../tools/preview.mjs';

const JSDOM = await loadJsdom();

if (!JSDOM && process.env.REQUIRE_DOM_TESTS === '1') {
  throw new Error('REQUIRE_DOM_TESTS=1 but jsdom is not installed. Run `npm ci`.');
}

describe('preview server', () => {
  let server; let base;

  before(async () => {
    server = await serve(0);
    base = `http://localhost:${server.address().port}`;
  });

  after(() => server.close());

  test('serves the scenario runner in place of the app entry point', async () => {
    const res = await fetch(`${base}${PREVIEW_PATH}?scenario=summary`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /preview-scenarios\.js/);
    assert.doesNotMatch(html, /src="\.\/js\/app\.js"/);
  });

  test('serves the app itself unchanged', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(await res.text(), readFileSync(repoPath('index.html'), 'utf8'));
  });

  test('serves modules with a JavaScript type', async () => {
    const res = await fetch(`${base}/js/state.js`);
    assert.equal(res.headers.get('content-type'), 'text/javascript');
  });

  /* Raw requests: fetch() would normalize the path before sending it. */
  const rawStatus = (path) => new Promise((resolve, reject) => {
    request({ port: server.address().port, path }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject).end();
  });

  test('refuses paths outside the repo', async () => {
    assert.equal(await rawStatus('/..%2f..%2fetc%2fpasswd'), 403);
    assert.equal(await rawStatus('/js/..%2f..%2fpackage.json'), 403);
  });
});

describe('preview scenarios', { skip: JSDOM ? false : 'jsdom is not installed' }, () => {
  let root; let scenarios;

  before(async () => {
    const window = installDom(JSDOM, readFileSync(repoPath('index.html'), 'utf8'));
    root = window.document.getElementById('app');
    ({ scenarios } = await import('../tools/preview-scenarios.js'));
  });

  test('summary lands on a partial session whose flip unlocks the advance', async () => {
    await scenarios.summary(root);
    assert.match(root.textContent, /Session logged/);
    root.querySelectorAll('.result-flip')[2].click();
    assert.match(root.textContent, /Advance to/);
  });

  test('history shows a week of sessions', async () => {
    await scenarios.history(root);
    assert.equal(root.querySelectorAll('.session-entry').length, 7);
    assert.match(root.textContent, /6\s*full sessions/);
  });
});
