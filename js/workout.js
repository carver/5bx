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

import { getChart, getTargets, TIMING_SECONDS, levelName, nextPosition,
  intervalBreakSeconds } from './config.js';
import { createPace, paceAt } from './pace.js';
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
    const breakSeconds = Math.round(intervalBreakSeconds(exercise.interval));
    return el('div.note',
      {},
      el('strong', {}, `Every ${every} steps: ${count} ${name}. `),
      text,
      el('p.note-aside', {},
        `The step estimate pauses for about ${breakSeconds}s during each ` +
        'block, and the running pace allows for that.'),
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
    // since counting taps while running in place isn't realistic. See pace.js
    // — the estimate freezes during each jump block and the cadence allows for
    // the time those blocks take.
    const pace = exercise.interval
      ? createPace({
          targetSteps: targets[i],
          totalSeconds: TIMING_SECONDS[i],
          interval: exercise.interval,
        })
      : null;

    const view = buildRunningView(exercise, pace);
    mount(root, view.node);

    timer = new Countdown(
      TIMING_SECONDS[i],
      (remaining, elapsed) => {
        view.setTime(remaining);
        if (pace) updatePace(view, pace, elapsed);
      },
      () => {
        cueTimeUp();
        renderCheckpoint();
      },
    );
    timer.start();
  }

  function updatePace(view, pace, elapsed) {
    const now = paceAt(pace, elapsed);
    view.setPace(now);

    if (now.inBreak) {
      if (!pace.inBreak) {
        pace.inBreak = true;
        cueInterval();
      }
      view.showBanner(
        `${pace.count} ${pace.name}`,
        `Break ${now.blockIndex} of ${pace.blocks} · ` +
        `${Math.ceil(now.breakRemaining)}s`,
      );
    } else if (pace.inBreak) {
      // Block finished — cue the return to running and clear the banner.
      pace.inBreak = false;
      cueBlip();
      view.hideBanner();
    }
  }

  function buildRunningView(exercise, pace) {
    const timeNode = el('div.clock', {}, formatTime(TIMING_SECONDS[session.index]));
    const stepNode = pace ? el('p.steps', {}, `0 of ${targets[session.index]} steps`) : null;
    // Per-set count, restarting at each break to match counting in your head.
    // Pointless if the whole run is a single set, so only shown when it isn't.
    const setNode = pace && pace.setCount > 1 ? el('p.set-steps', {}, '') : null;

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
        setNode,
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
      setPace: (state) => {
        if (!stepNode) return;
        stepNode.textContent =
          `~${state.steps} of ${targets[session.index]} steps`;
        stepNode.classList.toggle('frozen', state.inBreak);
        if (!setNode) return;
        setNode.textContent = `~${state.setSteps} of ${state.setTarget} · ` +
          `set ${state.setIndex} of ${pace.setCount}`;
        setNode.classList.toggle('frozen', state.inBreak);
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
    // Interval exercises (the stationary run) end on a partial-size final
    // set, so the yes/no question also needs that count alongside the total.
    const pace = exercise.interval
      ? createPace({
          targetSteps: targets[i],
          totalSeconds: TIMING_SECONDS[i],
          interval: exercise.interval,
        })
      : null;

    mount(root,
      header(i),
      el('div.card',
        {},
        el('h2.exercise-name', {}, exercise.name),
        el('p.question', {}, 'Did you complete the target?'),
        el('p.target', {},
          el('strong', {}, String(targets[i])), ` ${exercise.unit}`),
        pace ? el('p.note-aside', {},
          `Final set: ${pace.finalSetSteps} ${exercise.unit}`) : null,
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
