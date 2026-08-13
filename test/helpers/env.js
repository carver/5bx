/*
 * Shared test setup.
 *
 * The app itself has zero dependencies and never runs in Node — these helpers
 * exist only so the browser modules can be imported and exercised by the test
 * runner.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const repoPath = (...parts) => join(REPO_ROOT, ...parts);

/**
 * js/state.js persists through localStorage, which doesn't exist in Node.
 * Call before importing any app module that touches storage.
 */
export function installLocalStorage() {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };
  return mem;
}

/**
 * jsdom is a devDependency, so the DOM suite is skippable: the rest of the
 * tests must stay runnable with nothing installed.
 *
 * @returns {Promise<Function|null>} the JSDOM constructor, or null
 */
export async function loadJsdom() {
  try {
    return (await import('jsdom')).JSDOM;
  } catch {
    return null;
  }
}

/**
 * Build a jsdom window from the real index.html and expose the globals the
 * app expects. Must run BEFORE importing any app module: several read from
 * `document` at module scope.
 *
 * @param {Function} JSDOM
 * @param {string} html contents of index.html
 * @returns {object} the jsdom window
 */
export function installDom(JSDOM, html) {
  // A project-subpath URL, matching how the app is actually served on Pages.
  const dom = new JSDOM(html, { url: 'https://example.github.io/5bx/' });
  const { window } = dom;

  globalThis.window = window;
  globalThis.document = window.document;
  // navigator is a getter-only global in modern Node, so it needs defineProperty.
  Object.defineProperty(globalThis, 'navigator', {
    value: window.navigator, configurable: true, writable: true,
  });
  globalThis.Blob = window.Blob;
  globalThis.URL = window.URL;

  // jsdom leaves these unimplemented; the app only needs them not to throw.
  window.confirm = () => true;
  window.alert = () => {};
  globalThis.confirm = window.confirm;
  globalThis.alert = window.alert;
  window.matchMedia = () => ({ matches: false, addEventListener() {} });

  // In a browser, window properties ARE globals; jsdom needs both set.
  window.Notification = {
    permission: 'default',
    requestPermission: async () => 'default',
  };
  globalThis.Notification = window.Notification;
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(null), register: async () => {} },
    configurable: true,
  });

  installLocalStorage();
  return window;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until `predicate()` holds, then return.
 *
 * History navigation is asynchronous — jsdom fires popstate on a later task,
 * exactly as a browser does. Test files run in parallel processes, so a fixed
 * sleep long enough on an idle machine can be too short on a busy one; wait
 * for the state you actually care about instead.
 *
 * @param {Function} predicate
 * @param {string} what described in the timeout message
 */
export async function until(predicate, what, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

/**
 * Let anything queued run, for asserting that nothing happened. A fixed wait
 * is unavoidable here — there is no event to wait for — so it is generous.
 */
export const quiet = () => sleep(100);
