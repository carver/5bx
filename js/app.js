/* Entry point: view routing, theme, service worker registration. */

import * as store from './state.js';
import { renderHome } from './home.js';
import { renderWorkout } from './workout.js';
import { renderHistory } from './history.js';
import { renderSettings } from './settings.js';
import { syncReminder } from './notifications.js';
import { watchForUpdate } from './update.js';
import { createRouter } from './router.js';

const root = document.getElementById('app');

// Views render synchronously; renderWorkout returns its own cleanup and the
// confirm that guards quitting a session part-way through.
const { go, start } = createRouter({
  views: {
    home: () => renderHome(root, { onStart: () => go('workout'), onNav: go }),
    workout: () => renderWorkout(root, { onExit: () => go('home') }),
    history: () => renderHistory(root, { onNav: go }),
    settings: () => renderSettings(root, { onNav: go, applyTheme }),
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

/* -------------------------------------------------------------------- boot */

applyTheme();
start();
syncReminder(store.getSettings());
