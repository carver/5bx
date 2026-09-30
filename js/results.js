/*
 * A session's per-exercise answers, each a button that flips it. Shared by the
 * workout summary and the history, the two places a mis-tapped Yes/No gets
 * noticed.
 */

import { getChart, getTargets } from './config.js';
import { el } from './ui.js';

export function resultList(session, onFlip) {
  const { exercises } = getChart(session.chartId);
  const targets = getTargets(session.chartId, session.levelIndex);

  return el('ul.result-list', {},
    exercises.map((ex, i) => {
      const hit = session.results[i];
      return el('li',
        { class: hit ? 'ok' : 'miss' },
        el('button.result-flip', {
          type: 'button',
          'aria-label': `${ex.name}: ${hit ? 'hit' : 'missed'}. Tap to change.`,
          onclick: () => onFlip(i),
        },
        el('span.result-mark', {}, hit ? '✓' : '✗'),
        el('span.result-name', {}, `${i + 1}. ${ex.name}`),
        el('span.result-target', {}, `${targets[i]} ${ex.unit}`),
        ),
      );
    }),
  );
}
