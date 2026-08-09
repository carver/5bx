/*
 * Detects a newer deployed version and offers a manual reload.
 *
 * sw.js calls self.skipWaiting() + clients.claim(), so a new version
 * activates and takes over every open tab automatically — no "waiting"
 * worker to prompt the user about. That's fine for the cached shell, but
 * this tab's JS modules are already loaded into memory and keep running the
 * old code regardless; only an actual page reload picks up the new ones. So
 * "the app updates itself" really means "the app updates itself the next
 * time you happen to reload it" unless something tells you a reload is
 * worth doing.
 *
 * `controllerchange` fires once whenever navigator.serviceWorker.controller
 * changes — including the very first time a service worker ever claims a
 * previously-uncontrolled page. That first firing is normal startup, not an
 * update, so it only counts as "a new version is available" when this page
 * was already being controlled by *some* worker at load time.
 *
 * Never auto-reloads: a workout in progress lives only in memory, and an
 * unannounced reload mid-exercise would silently drop it. The banner also
 * holds off appearing at all while an exercise is actively running (see
 * `document.body.dataset.keepAwake`, set in workout.js) so it can't land a
 * surprise tap target next to the exercise controls.
 */

import { el } from './ui.js';

// Chrome only rechecks sw.js for a new version on navigation, and throttles
// that to roughly once every 24h. Nudging registration.update() ourselves —
// on focus, and on this interval for tabs left open — means a deployed
// update gets noticed well inside a day instead of possibly waiting for one.
const RECHECK_INTERVAL_MS = 60 * 60 * 1000;
const SAFE_TO_SHOW_POLL_MS = 5000;

export function watchForUpdate(registration) {
  if (!registration || !('serviceWorker' in navigator)) return;

  const hadControllerAtLoad = !!navigator.serviceWorker.controller;
  let notified = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtLoad || notified) return;
    notified = true;
    presentWhenSafe();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      registration.update().catch(() => {});
    }
  });
  // unref (Node only — browsers' setInterval return value has no such
  // method) so a lingering interval can't keep a test runner's process
  // alive; harmless in the browser, where nothing is waiting to exit.
  const handle = setInterval(() => registration.update().catch(() => {}),
    RECHECK_INTERVAL_MS);
  handle.unref?.();
}

function presentWhenSafe() {
  const tick = () => {
    if (document.body.dataset.keepAwake === 'true') {
      setTimeout(tick, SAFE_TO_SHOW_POLL_MS);
      return;
    }
    showBanner();
  };
  tick();
}

function showBanner() {
  const banner = el('div.update-banner',
    { role: 'status' },
    el('span.update-banner-text', {}, 'An update is available.'),
    el('div.update-banner-actions',
      {},
      el('button.btn.btn-primary', {
        type: 'button',
        onclick: () => window.location.reload(),
      }, 'Reload'),
      el('button.btn.btn-quiet', {
        type: 'button',
        onclick: () => banner.remove(),
      }, 'Not now'),
    ),
  );
  document.body.append(banner);
}
