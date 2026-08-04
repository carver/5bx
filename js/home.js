/* Home / dashboard view. */

import { getChart, getTargets, TIMING_SECONDS, TOTAL_SECONDS, DECONDITIONING }
  from './config.js';
import * as store from './state.js';
import { el, mount, formatTime, plural } from './ui.js';

export function renderHome(root, { onStart, onNav }) {
  const { chartId, levelIndex } = store.getProgress();
  const chart = getChart(chartId);
  const targets = getTargets(chartId, levelIndex);
  const days = store.daysAtLevel();
  const needed = store.requiredDays();
  const streak = store.currentStreak();
  const idle = store.daysSinceLastSession();

  mount(root,
    el('h1.view-title', {}, '5BX'),

    el('div.card.card-hero',
      {},
      el('p.eyebrow', {}, 'Current level'),
      el('p.hero-position', {}, store.positionLabel(chartId, levelIndex)),
      el('div.progress',
        {},
        el('div.progress-bar', {
          style: `width:${Math.min(100, (days / needed) * 100)}%`,
        }),
      ),
      el('p.hero-days', {}, `Day ${days} of ${needed} at this level`),
      days >= needed
        ? el('p.hero-hint.ready', {},
            'Minimum days met — hit every target today to advance.')
        : el('p.hero-hint', {},
            `${plural(needed - days, 'more day')} at this level before you ` +
            'can advance.'),
    ),

    el('div.actions',
      {},
      el('button.btn.btn-primary.btn-hero', { type: 'button', onclick: onStart },
        `Start workout · ${formatTime(TOTAL_SECONDS)}`),
    ),

    idle !== null && idle >= DECONDITIONING.restartAfterDays
      ? el('div.note.note-warn', {},
          el('strong', {}, `It has been ${plural(idle, 'day')} since your ` +
            'last session. '),
          'The plan says to restart at Chart 1, D- after a break this long. ' +
          'Use Settings to jump back.')
      : null,

    el('div.stats',
      {},
      stat(String(streak), streak === 1 ? 'day streak' : 'day streak'),
      stat(String(store.getSessions().length), 'sessions logged'),
    ),

    el('h2.section-title', {}, `Today · ${chart.name}`),
    el('ol.preview',
      {},
      chart.exercises.map((ex, i) => el('li',
        {},
        el('span.preview-name', {}, ex.name),
        el('span.preview-target', {},
          `${targets[i]} ${ex.unit} · ${formatTime(TIMING_SECONDS[i])}`),
      )),
    ),

    el('nav.nav',
      {},
      el('button.btn.btn-secondary',
        { type: 'button', onclick: () => onNav('history') }, 'Progress'),
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
