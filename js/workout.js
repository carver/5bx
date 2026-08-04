/*
 * Guided workout mode.
 *
 * Flow, repeated once per exercise (5 times):
 *   ready      -> exercise name, instructions, target, big Start button
 *   running    -> countdown; pause/resume/restart; audible cue at zero
 *   checkpoint -> "Did you complete the target?" yes/no, recorded
 * ...then a summary that logs the session and, if earned, offers the level up.
 *
 * Every control reachable mid-workout is oversized and well separated (see
 * .btn sizing in styles.css) because the app is used with shaky hands.
 */

import { getChart, getTargets, TIMING_SECONDS, levelName, nextPosition }
  from './config.js';
import * as store from './state.js';
import { Countdown, acquireWakeLock, releaseWakeLock } from './timer.js';
import { unlockAudio, cueTimeUp, cueInterval, cueBlip } from './audio.js';
import { el, mount, formatTime, plural } from './ui.js';

export function renderWorkout(root, { onExit }) {
  const { chartId, levelIndex } = store.getProgress();
  const chart = getChart(chartId);
  const targets = getTargets(chartId, levelIndex);

  const session = {
    index: 0,           // which exercise, 0-4
    results: [],        // yes/no answers so far
  };
  let timer = null;

  function cleanup() {
    timer?.stop();
    timer = null;
    document.body.dataset.keepAwake = 'false';
    releaseWakeLock();
  }

  function exit() {
    cleanup();
    onExit();
  }

  /* ---------------------------------------------------------------- ready */

  function renderReady() {
    const i = session.index;
    const exercise = chart.exercises[i];
    const seconds = TIMING_SECONDS[i];

    mount(root,
      header(i),
      el('div.card',
        {},
        el('h2.exercise-name', {}, exercise.name),
        el('p.target',
          {},
          el('strong', {}, String(targets[i])),
          ` ${exercise.unit}`,
          el('span.target-sep', {}, ' in '),
          el('strong', {}, formatTime(seconds)),
        ),
        el('p.instructions', {}, exercise.text),
        exercise.interval ? intervalNote(exercise) : null,
      ),
      el('div.actions',
        {},
        el('button.btn.btn-primary', {
          type: 'button',
          onclick: () => startExercise(),
        }, 'Start'),
        el('button.btn.btn-quiet', {
          type: 'button',
          onclick: () => confirmQuit(),
        }, 'Quit workout'),
      ),
    );
  }

  function intervalNote(exercise) {
    const { every, count, name, text } = exercise.interval;
    return el('div.note',
      {},
      el('strong', {}, `Every ${every} steps: ${count} ${name}. `),
      text,
    );
  }

  /* -------------------------------------------------------------- running */

  function startExercise() {
    unlockAudio();          // must happen inside the click handler
    const i = session.index;
    const exercise = chart.exercises[i];

    document.body.dataset.keepAwake = 'true';
    acquireWakeLock();

    // Exercise 5 only: pace the "every 75 steps do N jumps" cue off the clock,
    // since counting taps while running in place isn't realistic. The target
    // step count spread over the 6 minutes gives an expected cadence.
    const interval = exercise.interval;
    const pace = interval
      ? {
          secondsPerBlock: TIMING_SECONDS[i] / (targets[i] / interval.every),
          totalBlocks: Math.floor(targets[i] / interval.every),
          nextCueAt: 0,
          blocksDone: 0,
          bannerUntil: 0,
        }
      : null;
    if (pace) pace.nextCueAt = pace.secondsPerBlock;

    const view = buildRunningView(exercise, pace);
    mount(root, view.node);

    timer = new Countdown(
      TIMING_SECONDS[i],
      (remaining, elapsed) => {
        view.setTime(remaining);
        if (pace) updatePace(view, pace, elapsed, interval);
      },
      () => {
        cueTimeUp();
        renderCheckpoint();
      },
    );
    timer.start();
  }

  function updatePace(view, pace, elapsed, interval) {
    const stepsPerSecond = targets[session.index] / TIMING_SECONDS[session.index];
    view.setSteps(Math.min(targets[session.index],
      Math.floor(elapsed * stepsPerSecond)));

    if (elapsed >= pace.nextCueAt && pace.blocksDone < pace.totalBlocks) {
      pace.blocksDone += 1;
      pace.nextCueAt += pace.secondsPerBlock;
      pace.bannerUntil = elapsed + 20;   // banner clears itself if ignored
      cueInterval();
      view.showBanner(
        `${interval.count} ${interval.name}`,
        `Break ${pace.blocksDone} of ${pace.totalBlocks}`,
      );
    } else if (pace.bannerUntil && elapsed > pace.bannerUntil) {
      pace.bannerUntil = 0;
      view.hideBanner();
    }
  }

  function buildRunningView(exercise, pace) {
    const timeNode = el('div.clock', {}, formatTime(TIMING_SECONDS[session.index]));
    const stepNode = pace ? el('p.steps', {}, `0 of ${targets[session.index]} steps`) : null;

    const bannerTitle = el('div.banner-title', {}, '');
    const bannerSub = el('div.banner-sub', {}, '');
    const banner = el('div.banner.hidden', { hidden: true },
      bannerTitle, bannerSub);

    const pauseBtn = el('button.btn.btn-secondary', {
      type: 'button',
      onclick: () => {
        timer.toggle();
        cueBlip();
        pauseBtn.textContent = timer.running ? 'Pause' : 'Resume';
        node.classList.toggle('is-paused', !timer.running);
      },
    }, 'Pause');

    const node = el('div.running',
      {},
      header(session.index),
      el('div.card.card-run',
        {},
        el('h2.exercise-name', {}, exercise.name),
        timeNode,
        el('p.target-small', {},
          `Target: ${targets[session.index]} ${exercise.unit}`),
        stepNode,
        banner,
      ),
      el('div.actions',
        {},
        el('button.btn.btn-primary', {
          type: 'button',
          onclick: () => { timer.stop(); cueBlip(); renderCheckpoint(); },
        }, 'End exercise'),
        el('div.actions-row',
          {},
          pauseBtn,
          el('button.btn.btn-secondary', {
            type: 'button',
            onclick: () => {
              timer.reset();
              timer.start();
              cueBlip();
              pauseBtn.textContent = 'Pause';
              node.classList.remove('is-paused');
            },
          }, 'Restart'),
        ),
      ),
    );

    return {
      node,
      setTime: (remaining) => { timeNode.textContent = formatTime(remaining); },
      setSteps: (n) => {
        if (stepNode) {
          stepNode.textContent = `~${n} of ${targets[session.index]} steps`;
        }
      },
      showBanner: (title, sub) => {
        bannerTitle.textContent = title;
        bannerSub.textContent = sub;
        banner.hidden = false;
        banner.classList.remove('hidden');
      },
      hideBanner: () => {
        banner.hidden = true;
        banner.classList.add('hidden');
      },
    };
  }

  /* ----------------------------------------------------------- checkpoint */

  function renderCheckpoint() {
    document.body.dataset.keepAwake = 'false';
    releaseWakeLock();

    const i = session.index;
    const exercise = chart.exercises[i];

    mount(root,
      header(i),
      el('div.card',
        {},
        el('h2.exercise-name', {}, exercise.name),
        el('p.question', {}, 'Did you complete the target?'),
        el('p.target', {},
          el('strong', {}, String(targets[i])), ` ${exercise.unit}`),
      ),
      // Wide gap between Yes and No: a shaky tap must not flip the answer.
      el('div.actions.actions-answer',
        {},
        el('button.btn.btn-primary.btn-yes', {
          type: 'button',
          onclick: () => answer(true),
        }, 'Yes'),
        el('button.btn.btn-primary.btn-no', {
          type: 'button',
          onclick: () => answer(false),
        }, 'No'),
      ),
    );
  }

  function answer(didComplete) {
    cueBlip();
    session.results.push(didComplete);
    session.index += 1;
    if (session.index >= chart.exercises.length) renderSummary();
    else renderReady();
  }

  /* -------------------------------------------------------------- summary */

  function renderSummary() {
    cleanup();

    // Log first, then read the counters — so today counts toward days-at-level.
    const logged = store.logSession(session.results);
    const days = store.daysAtLevel();
    const needed = store.requiredDays();
    const next = nextPosition(chartId, levelIndex);

    const list = el('ul.result-list', {},
      chart.exercises.map((ex, i) => el('li',
        { class: session.results[i] ? 'ok' : 'miss' },
        el('span.result-mark', {}, session.results[i] ? '✓' : '✗'),
        el('span.result-name', {}, `${i + 1}. ${ex.name}`),
        el('span.result-target', {}, `${targets[i]} ${ex.unit}`),
      )),
    );

    const actions = el('div.actions', {});

    if (logged.completed && next && days >= needed) {
      actions.append(
        el('button.btn.btn-primary', {
          type: 'button',
          onclick: () => {
            store.advanceLevel();
            renderAdvanced(next);
          },
        }, `Advance to Chart ${next.chartId} ${levelName(next.levelIndex)}`),
        el('button.btn.btn-secondary', { type: 'button', onclick: exit },
          'Stay at this level'),
      );
    } else {
      actions.append(
        el('button.btn.btn-primary', { type: 'button', onclick: exit }, 'Done'),
      );
    }

    mount(root,
      el('h1.view-title', {}, logged.completed ? 'Session complete' : 'Session logged'),
      el('div.card',
        {},
        el('p.summary-line', {}, `${store.positionLabel(chartId, levelIndex)}`),
        list,
        el('p.summary-note', {}, summaryMessage(logged, days, needed, next)),
      ),
      actions,
    );
  }

  function summaryMessage(logged, days, needed, next) {
    if (!logged.completed) {
      const missed = logged.results.filter((r) => !r).length;
      return `Partial session — ${plural(missed, 'target')} missed. ` +
        `Logged, and it still counts toward your days at this level ` +
        `(day ${days} of ${needed}).`;
    }
    if (!next) {
      return 'All targets hit — and you are at the top of Chart 6. ' +
        'There is nothing left to advance to.';
    }
    if (days < needed) {
      const remaining = needed - days;
      return `Nice, all targets hit — but stick with this level for ` +
        `${plural(remaining, 'more day')} before advancing ` +
        `(day ${days} of ${needed}).`;
    }
    return `All targets hit and you have put in ${plural(days, 'day')} at ` +
      `this level. You have earned the next one.`;
  }

  function renderAdvanced(next) {
    mount(root,
      el('h1.view-title', {}, 'Level up'),
      el('div.card',
        {},
        el('p.big-note', {},
          `Now on Chart ${next.chartId} · ${levelName(next.levelIndex)}`),
        el('p.summary-note', {}, 'Days at level reset to 0.'),
      ),
      el('div.actions', {},
        el('button.btn.btn-primary', { type: 'button', onclick: exit }, 'Done')),
    );
  }

  /* --------------------------------------------------------------- shared */

  function header(i) {
    return el('div.workout-header',
      {},
      el('span.step-count', {}, `Exercise ${i + 1} of ${chart.exercises.length}`),
      el('span.position', {}, store.positionLabel(chartId, levelIndex)),
    );
  }

  function confirmQuit() {
    if (session.index === 0 ||
        confirm('Quit this workout? Nothing will be logged.')) {
      exit();
    }
  }

  renderReady();
  return cleanup;
}
