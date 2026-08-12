/* Settings view: age/minimum days, reminders, manual level, data management. */

import { CHARTS, LEVELS, minDaysForAge, DECONDITIONING } from './config.js';
import * as store from './state.js';
import { el, mount, plural } from './ui.js';
import * as notify from './notifications.js';
import { checkForUpdate } from './update.js';
import { APP_VERSION } from './version.js';

export function renderSettings(root, { onNav, applyTheme }) {
  const rerender = () => renderSettings(root, { onNav, applyTheme });
  const settings = store.getSettings();
  const progress = store.getProgress();

  mount(root,
    el('h1.view-title', {}, 'Settings'),

    /* ------------------------------------------------------ minimum days */
    el('section.card',
      {},
      el('h2.section-title', {}, 'Minimum days per level'),
      el('p.help', {},
        'The plan asks you to stay at each level for a minimum number of ' +
        'days, based on age, even if you are already hitting every target.'),

      field('Age', el('input.input', {
        type: 'number', min: '1', max: '120', inputmode: 'numeric',
        value: settings.age ?? '',
        placeholder: 'not set',
        onchange: (e) => {
          const value = parseInt(e.target.value, 10);
          store.updateSettings({ age: Number.isFinite(value) ? value : null });
          rerender();
        },
      })),
      el('p.help', {}, settings.age
        ? `Age ${settings.age} → ${plural(minDaysForAge(settings.age), 'day')} ` +
          'per level from the table.'
        : 'No age set — defaulting to ' +
          `${plural(minDaysForAge(null), 'day')} per level.`),

      field('Override', el('input.input', {
        type: 'number', min: '1', max: '365', inputmode: 'numeric',
        value: settings.minDaysOverride ?? '',
        placeholder: 'auto',
        onchange: (e) => {
          const value = parseInt(e.target.value, 10);
          store.updateSettings({
            minDaysOverride: Number.isFinite(value) && value > 0 ? value : null,
          });
          rerender();
        },
      })),
      el('p.help', {},
        `Currently requiring ${plural(store.requiredDays(), 'day')} at each ` +
        'level. Leave the override blank to use the age table.'),
    ),

    /* --------------------------------------------------------- reminders */
    reminderSection(settings, rerender),

    /* ------------------------------------------------------------- theme */
    el('section.card',
      {},
      el('h2.section-title', {}, 'Appearance'),
      el('p.help', {},
        'Follows your system light/dark setting unless you override it here.'),
      field('Theme', el('select.input', {
        onchange: (e) => {
          store.updateSettings({ theme: e.target.value });
          applyTheme();
        },
      },
        option('system', 'Match system', settings.theme),
        option('light', 'Light', settings.theme),
        option('dark', 'Dark', settings.theme),
      )),
    ),

    /* -------------------------------------------------- manual level jump */
    levelSection(progress, rerender),

    /* -------------------------------------------------------------- data */
    dataSection(rerender),

    /* ------------------------------------------------------------ version */
    versionSection(),

    el('nav.nav',
      {},
      el('button.btn.btn-secondary',
        { type: 'button', onclick: () => onNav('home') }, 'Back'),
      el('button.btn.btn-secondary',
        { type: 'button', onclick: () => onNav('history') }, 'Progress'),
    ),
  );
}

/* --------------------------------------------------------------- sections */

function reminderSection(settings, rerender) {
  const permission = notify.permissionState();
  const supported = permission !== 'unsupported';

  const section = el('section.card',
    {},
    el('h2.section-title', {}, 'Daily reminder'),
  );

  if (!supported) {
    section.append(el('p.help', {},
      'This browser does not support notifications.'));
    return section;
  }

  // Explain before asking. The browser's own prompt carries no context, and a
  // denied prompt is effectively permanent.
  section.append(el('p.help', {},
    'A once-a-day nudge at the time you choose, generated on this device — ' +
    'nothing is sent anywhere. Turning this on asks your browser for ' +
    'notification permission.'));

  if (permission === 'denied') {
    section.append(el('p.help.warn', {},
      'Notifications are blocked for this site. Re-enable them in your ' +
      'browser site settings, then come back.'));
  }

  section.append(
    field('Reminder', el('input.checkbox', {
      type: 'checkbox',
      checked: settings.reminderEnabled,
      disabled: permission === 'denied',
      onchange: async (e) => {
        if (e.target.checked) {
          const result = await notify.requestPermission();
          if (result !== 'granted') {
            store.updateSettings({ reminderEnabled: false });
            rerender();
            return;
          }
        }
        store.updateSettings({ reminderEnabled: e.target.checked });
        await notify.syncReminder(store.getSettings());
        rerender();
      },
    })),

    field('Time', el('input.input', {
      type: 'time',
      value: settings.reminderTime,
      onchange: async (e) => {
        store.updateSettings({ reminderTime: e.target.value || '07:00' });
        await notify.syncReminder(store.getSettings());
        rerender();
      },
    })),
  );

  if (settings.reminderEnabled && permission === 'granted') {
    const due = notify.nextOccurrence(settings.reminderTime);
    section.append(
      el('p.help', {},
        `Next reminder: ${due.toLocaleString(undefined, {
          weekday: 'short', hour: '2-digit', minute: '2-digit',
        })}.`),
      el('p.help', {},
        'Android may delay or skip reminders when the browser has been ' +
        'closed for a long time — a platform restriction, not something the ' +
        'app can work around.'),
      el('button.btn.btn-secondary', {
        type: 'button',
        onclick: () => notify.sendTestNotification(),
      }, 'Send a test notification'),
    );
  }

  return section;
}

function levelSection(progress, rerender) {
  let chartId = progress.chartId;
  let levelIndex = progress.levelIndex;

  return el('section.card',
    {},
    el('h2.section-title', {}, 'Jump to a level'),
    el('p.help', {},
      'Sets your chart and level directly and resets the days-at-level ' +
      `counter to zero. After a break longer than ` +
      `${DECONDITIONING.restartAfterDays} days (or ` +
      `${DECONDITIONING.restartAfterIllnessDays} after illness) the plan says ` +
      `to restart at Chart 1, D-. ${DECONDITIONING.note}`),

    field('Chart', el('select.input', {
      onchange: (e) => { chartId = Number(e.target.value); },
    }, CHARTS.map((c) => option(String(c.id), c.name, String(chartId))))),

    field('Level', el('select.input', {
      onchange: (e) => { levelIndex = Number(e.target.value); },
    }, LEVELS.map((name, i) =>
      option(String(i), name, String(levelIndex))))),

    el('button.btn.btn-secondary', {
      type: 'button',
      onclick: () => {
        if (confirm(`Move to Chart ${chartId} ${LEVELS[levelIndex]} and reset ` +
                    'the days-at-level counter?')) {
          store.setPosition(chartId, levelIndex, 'manual');
          rerender();
        }
      },
    }, 'Apply'),
  );
}

function dataSection(rerender) {
  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json',
    style: 'display:none',
    onchange: (e) => importFile(e.target.files[0], rerender),
  });

  return el('section.card',
    {},
    el('h2.section-title', {}, 'Data'),
    el('p.help', {},
      'Everything is stored in this browser\'s localStorage only. Clearing ' +
      'site data will erase it, so export occasionally.'),
    el('div.actions-row',
      {},
      el('button.btn.btn-secondary', { type: 'button', onclick: exportData },
        'Export'),
      el('button.btn.btn-secondary', {
        type: 'button', onclick: () => fileInput.click(),
      }, 'Import'),
    ),
    fileInput,
    el('button.btn.btn-danger', {
      type: 'button',
      onclick: () => {
        if (confirm('Erase all settings, progress, and session history?')) {
          store.resetAll();
          rerender();
        }
      },
    }, 'Reset everything'),
  );
}

/*
 * Which version am I running, and can I have the new one now?
 *
 * An installed PWA gives you no address bar and no visible reload, and the
 * shell is served cache-first, so "reload the page" genuinely cannot fetch a
 * new deploy — only a new service worker installing can. This section is the
 * manual lever for that, and the version string is what makes the answer
 * checkable: compare it against the version shown by the deploy you expect.
 */
function versionSection() {
  const status = el('p.help', {}, '');
  const actions = el('div.actions-row', {});

  const check = el('button.btn.btn-secondary', {
    type: 'button',
    onclick: async () => {
      check.disabled = true;
      status.textContent = 'Checking…';
      const result = await checkForUpdate();
      check.disabled = false;

      if (result === 'updated') {
        // The new worker has installed and claimed this page, but this tab's
        // JS is still the old code in memory — only a reload swaps it in.
        status.textContent = 'A new version is ready to install.';
        if (!actions.contains(reload)) actions.append(reload);
        return;
      }
      status.textContent = {
        current: 'You are on the latest version.',
        offline: 'Could not check — you may be offline.',
        unsupported: 'This browser cannot check for updates automatically. ' +
          'Reload the page to pick up a new version.',
      }[result];
    },
  }, 'Check for updates');

  const reload = el('button.btn.btn-primary', {
    type: 'button',
    onclick: () => window.location.reload(),
  }, 'Reload now');

  actions.append(check);

  return el('section.card',
    {},
    el('h2.section-title', {}, 'Version'),
    el('p.version', {}, APP_VERSION),
    el('p.help', {},
      'The app updates itself in the background, but an installed PWA can ' +
      'hold onto the old version for a while. Check here to pull a new one ' +
      'immediately.'),
    actions,
    status,
  );
}

function exportData() {
  const blob = new Blob([JSON.stringify(store.getState(), null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a', {
    href: url,
    download: `5bx-backup-${store.todayKey()}.json`,
  });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importFile(file, rerender) {
  if (!file) return;
  try {
    const incoming = JSON.parse(await file.text());
    if (!incoming || typeof incoming !== 'object' || !incoming.progress) {
      throw new Error('Not a 5BX backup file.');
    }
    if (confirm('Replace all current data with this backup?')) {
      store.replaceState(incoming);
      rerender();
    }
  } catch (err) {
    alert(`Could not import that file: ${err.message}`);
  }
}

/* ---------------------------------------------------------------- helpers */

function field(label, control) {
  return el('label.field', {}, el('span.field-label', {}, label), control);
}

function option(value, label, selected) {
  return el('option', { value, selected: String(selected) === value }, label);
}
