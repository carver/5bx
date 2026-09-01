/* Entry point: view routing, theme, service worker registration. */

import * as store from './state.js';
import { renderHome } from './home.js';
import { renderWorkout } from './workout.js';
import { renderHistory } from './history.js';
import { renderSettings } from './settings.js';
import { syncReminder } from './notifications.js';
import { watchForUpdate } from './update.js';
import { createRouter } from './router.js';
import { createSyncClient, joinIdFromHash } from './sync.js';
import { createBackup } from './backup.js';

const root = document.getElementById('app');

const sync = createSyncClient();
const backup = createBackup({ store, sync });

// Views render synchronously; renderWorkout returns its own cleanup and the
// confirm that guards quitting a session part-way through.
const { go, start } = createRouter({
  views: {
    home: () => renderHome(root, { onStart: () => go('workout'), onNav: go }),
    workout: () => renderWorkout(root, { onExit: () => go('home') }),
    history: () => renderHistory(root, { onNav: go }),
    settings: () => renderSettings(root, { onNav: go, applyTheme, backup }),
  },
});

/* ------------------------------------------------------------------ theme */

/*
 * prefers-color-scheme in CSS does all the real work; this only stamps an
 * explicit override onto <html> when the user has picked one in Settings.
 */
function applyTheme() {
  const { theme } = store.getSettings();
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;

  const dark = theme === 'dark' || (theme === 'system' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', dark ? '#12161c' : '#f6f7f9');
}

window.matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', applyTheme);

/* --------------------------------------------------------------------- PWA */

/*
 * Relative registration path keeps the scope at the app directory, which is
 * what GitHub Pages project sites need (https://user.github.io/repo/).
 * Registering '/sw.js' would 404 there.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => watchForUpdate(registration))
      .catch((err) => console.warn('5BX: service worker registration failed.', err));
  });
}

/* ---------------------------------------------------------------- pairing */

/*
 * A pairing link opens the app at `#join/<id>`. Read it before the router
 * starts, and strip it from the address bar straight away so a refresh cannot
 * replay the join, then let the ordinary sync do the actual work.
 *
 * There is no "this will overwrite your data" prompt, because it will not:
 * joining merges (js/merge.js), so a phone that has already logged a few
 * workouts keeps them alongside whatever arrives.
 */
const joinId = joinIdFromHash(window.location.hash);
if (joinId) {
  sync.joinSave(joinId);
  window.history.replaceState(null, '',
    window.location.pathname + window.location.search);
}

/* -------------------------------------------------------------------- boot */

applyTheme();
start();
syncReminder(store.getSettings());
backup.start();

if (joinId) {
  // Land on Progress once the history arrives: seeing the streak and the
  // calendar filled in is the only real confirmation that pairing worked.
  backup.syncNow().then((result) => {
    if (result.status === 'ok') go('history');
    else alert(`Could not fetch that backup: ${result.error?.message ?? 'unknown error'}`);
  });
}
