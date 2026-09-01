/* Settings view: age/minimum days, reminders, manual level, data management. */

import { CHARTS, LEVELS, minDaysForAge, DECONDITIONING } from './config.js';
import * as store from './state.js';
import { el, mount, plural, formatDate } from './ui.js';
import * as notify from './notifications.js';
import { checkForUpdate } from './update.js';
import { APP_VERSION } from './version.js';
import { isSyncConfigured } from './sync-config.js';
import { pairingLink } from './sync.js';
import { qrSvg } from './qr.js';

export function renderSettings(root, { onNav, applyTheme, backup }) {
  const rerender = () => renderSettings(root, { onNav, applyTheme, backup });
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

    /* ------------------------------------------------------------ backup */
    syncSection(backup, rerender),

    /* -------------------------------------------------------------- data */
    dataSection(backup, rerender),

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

/* ------------------------------------------------------------------ backup */

/** "3 minutes ago", or a date once it stops being useful to count. */
function ago(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, size] of units) {
    if (seconds >= size * 2) return `${plural(Math.floor(seconds / size), unit)} ago`;
  }
  return 'just now';
}

function syncSection(backup, rerender) {
  const section = el('section.card', {}, el('h2.section-title', {}, 'Cloud backup'));

  if (!isSyncConfigured()) {
    section.append(el('p.help', {},
      'No backup project is configured in this build, so everything stays on ' +
      'this device. Run `npm run setup:sync` to point it at your own Firebase ' +
      'project, then redeploy.'));
    return section;
  }

  const status = backup.status();
  const busy = el('p.help', {}, '');

  /** Runs an operation with the buttons disabled and the outcome reported. */
  const attempt = async (message, operation) => {
    busy.textContent = message;
    for (const button of section.querySelectorAll('button')) button.disabled = true;
    try {
      await operation();
      rerender();
    } catch (error) {
      busy.textContent = error.message;
      for (const button of section.querySelectorAll('button')) button.disabled = false;
    }
  };

  if (!status.paired) {
    section.append(
      el('p.help', {},
        'Keeps a copy of your history off this phone, and lets another phone ' +
        'pick it up. A dated copy is kept for each of the last ' +
        `${plural(30, 'day')}, so a bad import or a bug can be undone.`),
      el('p.help', {},
        'There is no account and no password. Whoever has the pairing link ' +
        'can read and write this history, so treat it like a door key.'),
      el('div.actions-row', {},
        el('button.btn.btn-primary', {
          type: 'button',
          onclick: () => attempt('Backing up…', () => backup.startSharing()),
        }, 'Start backing up'),
      ),
      el('button.btn.btn-secondary', {
        type: 'button',
        onclick: () => {
          const pasted = prompt('Paste the pairing link from your other phone:');
          const id = pasted && new URL(pasted, window.location.href).hash.replace('#join/', '');
          if (id) attempt('Fetching…', () => backup.joinSave(id));
        },
      }, 'Restore from another phone'),
      busy,
    );
    return section;
  }

  const lastBackedUp = status.lastSyncedAt
    ? `Last backed up ${ago(status.lastSyncedAt)}.`
    : 'Not backed up yet.';

  section.append(
    el('p.help', { class: status.pending ? 'warn' : '' },
      status.pending ? `${lastBackedUp} There are changes still to send.` : lastBackedUp),
    el('div.actions-row', {},
      el('button.btn.btn-secondary', {
        type: 'button',
        onclick: () => attempt('Backing up…', () => backup.syncNow()),
      }, 'Back up now'),
      el('button.btn.btn-secondary', {
        type: 'button',
        onclick: (event) => showPairingCode(event.target, status.saveId),
      }, 'Add another phone'),
    ),
    el('button.btn.btn-secondary', {
      type: 'button',
      onclick: (event) => showSnapshots(event.target, backup, attempt),
    }, 'Go back to an earlier day…'),
    busy,
    el('div.actions-row', {},
      el('button.btn.btn-secondary', {
        type: 'button',
        onclick: () => {
          if (confirm('Stop backing up on this phone? Your history stays here, '
            + 'and the cloud copy stays where it is for your other devices.')) {
            backup.unpair();
            rerender();
          }
        },
      }, 'Stop on this phone'),
      el('button.btn.btn-danger', {
        type: 'button',
        onclick: () => {
          if (confirm('Erase the cloud copy and every dated backup, for every '
            + 'device? The history on this phone is kept.')) {
            attempt('Erasing…', () => backup.wipeCloud());
          }
        },
      }, 'Erase cloud copy'),
    ),
  );

  return section;
}

/*
 * The link as a QR code, because the receiving phone needs no app and no
 * typing: its camera decodes a URL straight into "open this link", which lands
 * on the join flow.
 */
function showPairingCode(button, saveId) {
  const link = pairingLink(window.location.href, saveId);
  const panel = el('div.pairing', {},
    el('div.qr', { html: qrSvg(link, { label: 'Pairing code for this backup' }) }),
    el('p.help', {},
      'Point your other phone\'s camera at this. Anyone who scans it gets full ' +
      'access to this history.'),
    el('button.btn.btn-secondary', {
      type: 'button',
      onclick: async (event) => {
        await navigator.clipboard?.writeText(link);
        event.target.textContent = 'Copied';
      },
    }, 'Copy the link instead'),
  );
  button.replaceWith(panel);
}

async function showSnapshots(button, backup, attempt) {
  button.disabled = true;
  button.textContent = 'Loading…';

  let days;
  try {
    days = await backup.listSnapshots();
  } catch (error) {
    button.textContent = error.message;
    return;
  }

  if (!days.length) {
    button.textContent = 'No earlier days saved yet';
    return;
  }

  let chosen = days[days.length - 1];
  button.replaceWith(el('div.snapshots', {},
    el('p.help', {},
      'Replaces everything on this phone, and in the cloud, with the copy ' +
      'saved on the day you pick. Anything done since is discarded.'),
    field('Day', el('select.input', {
      onchange: (event) => { chosen = event.target.value; },
    }, days.slice().reverse().map((day) =>
      option(day, formatDate(day), chosen)))),
    el('button.btn.btn-danger', {
      type: 'button',
      onclick: () => {
        if (confirm(`Go back to the copy saved on ${formatDate(chosen)}?`)) {
          attempt('Restoring…', () => backup.restoreSnapshot(chosen));
        }
      },
    }, 'Go back to this day'),
  ));
}

function dataSection(backup, rerender) {
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
      onclick: async () => {
        if (!confirm('Erase all settings, progress, and session history?')) return;
        // The merge means a local reset alone would be undone by the next
        // sync, so erasing has to reach the cloud copy or it is not erasing.
        if (backup.status().paired
          && confirm('Erase the cloud copy and every dated backup too?')) {
          await backup.wipeCloud();
        }
        store.resetAll();
        rerender();
      },
    }, 'Reset everything'),
  );
}

/*
 * Which version am I running, and can I have the new one now?
 *
 * An installed PWA gives you no address bar and no visible reload, and the
 * shell is served cache-first, so "reload the page" cannot fetch a
 * new deploy; only a new service worker installing can. This section is the
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
        // JS is still the old code in memory; only a reload swaps it in.
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
