/* Progress & history view: days at level, streak, calendar, level movement. */

import { levelName, absoluteLevel } from './config.js';
import * as store from './state.js';
import { el, mount, formatDate, plural } from './ui.js';

const CALENDAR_WEEKS = 9;

export function renderHistory(root, { onNav }) {
  const { chartId, levelIndex } = store.getProgress();
  const sessions = store.getSessions();
  const days = store.daysAtLevel();
  const needed = store.requiredDays();

  mount(root,
    el('h1.view-title', {}, 'Progress'),

    el('div.card',
      {},
      el('p.eyebrow', {}, 'Current level'),
      el('p.hero-position', {}, store.positionLabel(chartId, levelIndex)),
      el('div.progress', {},
        el('div.progress-bar', {
          style: `width:${Math.min(100, (days / needed) * 100)}%`,
        })),
      el('p.hero-days', {}, `Day ${days} of ${needed} at this level`),
    ),

    el('div.stats',
      {},
      stat(String(store.currentStreak()), 'day streak'),
      stat(String(sessions.filter((s) => s.completed).length), 'full sessions'),
      stat(String(sessions.length), 'total'),
    ),

    el('h2.section-title', {}, 'Last 9 weeks'),
    calendar(sessions),
    el('div.legend',
      {},
      el('span.legend-item', {}, el('span.cell.complete'), 'all targets'),
      el('span.legend-item', {}, el('span.cell.partial'), 'partial'),
      el('span.legend-item', {}, el('span.cell'), 'no session'),
    ),

    el('h2.section-title', {}, 'Level over time'),
    sparkline(store.getLevelLog()),
    levelList(store.getLevelLog()),

    el('h2.section-title', {}, 'Recent sessions'),
    sessionList(sessions),

    el('nav.nav',
      {},
      el('button.btn.btn-secondary',
        { type: 'button', onclick: () => onNav('home') }, 'Back'),
      el('button.btn.btn-secondary',
        { type: 'button', onclick: () => onNav('settings') }, 'Settings'),
    ),
  );
}

function stat(value, label) {
  return el('div.stat', {},
    el('span.stat-value', {}, value),
    el('span.stat-label', {}, label));
}

/* ---------------------------------------------------------------- calendar */

function calendar(sessions) {
  // date -> 'complete' if any session that day hit all targets, else 'partial'
  const byDate = new Map();
  for (const s of sessions) {
    if (s.completed || !byDate.has(s.date)) {
      byDate.set(s.date, s.completed ? 'complete' : 'partial');
    }
  }

  // Walk back to the start of the week containing (today - 8 weeks), so the
  // grid always ends on today's column and rows line up with weekdays.
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (CALENDAR_WEEKS - 1) * 7 - start.getDay());

  const grid = el('div.calendar', {});
  const today = store.todayKey();
  const cursor = new Date(start);

  for (let i = 0; i < CALENDAR_WEEKS * 7; i += 1) {
    const key = store.todayKey(cursor);
    const status = byDate.get(key);
    grid.append(el('span.cell', {
      class: [status || '', key === today ? 'today' : ''].filter(Boolean).join(' '),
      title: `${formatDate(key)}${status ? ` — ${status}` : ''}`,
    }));
    cursor.setDate(cursor.getDate() + 1);
  }
  return grid;
}

/* --------------------------------------------------------------- sparkline */

/**
 * Level movement as a step chart. The y value is the absolute position in the
 * whole 72-level program, but the scale tops out at the highest level you've
 * actually reached (rather than the fixed 72-level ceiling) so early progress
 * isn't squashed flat at the bottom of the chart.
 */
function sparkline(levelLog) {
  const W = 300;
  const H = 64;
  const PAD = 4;
  const values = levelLog.map((entry) =>
    absoluteLevel(entry.chartId, entry.levelIndex));
  const maxLevel = Math.max(1, ...values);

  const points = levelLog.map((entry, i) => {
    const x = levelLog.length === 1
      ? W / 2
      : PAD + (i / (levelLog.length - 1)) * (W - PAD * 2);
    const y = H - PAD - (values[i] / maxLevel) * (H - PAD * 2);
    return [x, y];
  });

  // Step path — level changes are discrete events, not a smooth ramp.
  let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` H ${points[i][0].toFixed(1)} V ${points[i][1].toFixed(1)}`;
  }
  d += ` H ${(W - PAD).toFixed(1)}`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label',
    `Level progression across ${plural(levelLog.length, 'change')}`);

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function levelList(levelLog) {
  const recent = levelLog.slice(-8).reverse();
  return el('ul.log-list',
    {},
    recent.map((entry) => el('li',
      {},
      el('span.log-main', {},
        `Chart ${entry.chartId} · ${levelName(entry.levelIndex)}`),
      el('span.log-meta', {},
        `${formatDate(entry.date)} · ${entry.reason}`),
    )),
  );
}

function sessionList(sessions) {
  if (!sessions.length) {
    return el('p.empty', {}, 'No sessions yet. Your first one starts the log.');
  }
  const recent = sessions.slice(-10).reverse();
  return el('ul.log-list',
    {},
    recent.map((s) => el('li',
      { class: s.completed ? 'ok' : 'miss' },
      el('span.log-main', {},
        `${formatDate(s.date)} — Chart ${s.chartId} · ${levelName(s.levelIndex)}`),
      el('span.log-meta', {},
        `${s.results.filter(Boolean).length} of ${s.results.length} targets` +
        `${s.completed ? ' · complete' : ''}`),
    )),
  );
}
