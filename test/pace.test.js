/* The exercise-5 pacing model: step estimate, jump blocks, per-set counter. */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { installLocalStorage } from './helpers/env.js';

installLocalStorage();

const cfg = await import('../js/config.js');
const { createPace, paceAt } = await import('../js/pace.js');

const DURATION = 360;
const INTERVAL = { every: 75, count: 10, name: 'scissor jumps' };

/** Chart 1 A+: 400 steps, 5 jump blocks, 6 sets. The worked example. */
const pace = createPace({
  targetSteps: 400, totalSeconds: DURATION, interval: INTERVAL,
});

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

describe('schedule', () => {
  test('breaks fall between sets, never after the final step', () => {
    assert.equal(pace.blocks, 5);
    assert.equal(pace.setCount, 6);
    assert.equal(pace.finalSetSteps, 25);
    assert.equal(pace.blocks * INTERVAL.every + pace.finalSetSteps, 400);
  });

  test('a jump block takes count x intervalMovementSeconds', () => {
    assert.ok(near(pace.jumpSeconds, 10));
  });

  test('running time excludes every jump block', () => {
    assert.ok(near(pace.runSeconds, DURATION - 5 * 10));
  });

  test('cadence is scaled up to absorb the break time', () => {
    assert.ok(near(pace.stepsPerSecond, 400 / 310));
    assert.ok(pace.stepsPerSecond > 400 / DURATION);
  });

  test('run and jump time exactly fill the exercise', () => {
    const scheduled = pace.blocks * pace.runPerBlock +
      pace.blocks * pace.jumpSeconds +
      (pace.runSeconds - pace.blocks * pace.runPerBlock);
    assert.ok(near(scheduled, DURATION, 1e-9));
  });
});

describe('step estimate', () => {
  test('starts at zero and is not in a break', () => {
    const start = paceAt(pace, 0);
    assert.equal(start.steps, 0);
    assert.equal(start.inBreak, false);
  });

  test('reaches the target exactly at 6:00', () => {
    assert.equal(paceAt(pace, DURATION).steps, 400);
  });

  test('never exceeds the target, even past the buzzer', () => {
    assert.equal(paceAt(pace, DURATION + 60).steps, 400);
  });

  test('never goes backwards', () => {
    let previous = 0;
    for (let t = 0; t <= DURATION; t += 0.1) {
      const { steps } = paceAt(pace, t);
      assert.ok(steps >= previous, `dropped from ${previous} to ${steps}`);
      previous = steps;
    }
  });
});

describe('jump blocks', () => {
  test('the first break begins exactly at 75 steps', () => {
    const before = paceAt(pace, pace.runPerBlock - 0.001);
    const during = paceAt(pace, pace.runPerBlock + 0.001);
    assert.equal(before.inBreak, false);
    assert.equal(during.inBreak, true);
    assert.equal(during.steps, 75);
    assert.equal(during.blockIndex, 1);
  });

  test('the step estimate is frozen for the whole break', () => {
    let previous = paceAt(pace, 0);
    let sampled = 0;
    for (let t = 0.1; t <= DURATION; t += 0.1) {
      const now = paceAt(pace, t);
      if (now.inBreak && previous.inBreak) {
        sampled += 1;
        assert.equal(now.steps, previous.steps, `moved at t=${t.toFixed(1)}`);
      }
      previous = now;
    }
    assert.ok(sampled > 400, `only ${sampled} in-break samples`);
  });

  test('total frozen time equals total jump time', () => {
    let frozen = 0;
    const dt = 0.01;
    for (let t = 0; t < DURATION; t += dt) {
      if (paceAt(pace, t).inBreak) frozen += dt;
    }
    assert.ok(near(frozen, pace.blocks * pace.jumpSeconds, 0.05),
      `${frozen.toFixed(2)}s frozen vs ${pace.blocks * pace.jumpSeconds}s`);
  });

  test('the break countdown runs down to zero', () => {
    const mid = paceAt(pace, pace.runPerBlock + 4);
    assert.ok(near(mid.breakRemaining, 6));
  });

  test('running resumes after the block', () => {
    const after = paceAt(pace, pace.runPerBlock + pace.jumpSeconds + 0.001);
    assert.equal(after.inBreak, false);
    assert.equal(after.steps, 75);
  });

  test('no break is scheduled at the very end', () => {
    assert.equal(paceAt(pace, DURATION - 0.001).inBreak, false);
    assert.equal(paceAt(pace, DURATION).inBreak, false);
  });
});

describe('per-set counter', () => {
  test('starts at 0 of 75 on set 1', () => {
    const start = paceAt(pace, 0);
    assert.equal(start.setSteps, 0);
    assert.equal(start.setTarget, 75);
    assert.equal(start.setIndex, 1);
  });

  test('holds at a full 75 through the break', () => {
    const during = paceAt(pace, pace.runPerBlock + 4);
    assert.equal(during.setSteps, 75);
    assert.equal(during.setTarget, 75);
    assert.equal(during.setIndex, 1);
  });

  test('restarts from zero once running resumes', () => {
    const after = paceAt(pace, pace.runPerBlock + pace.jumpSeconds + 0.001);
    assert.equal(after.setSteps, 0);
    assert.equal(after.setIndex, 2);
    assert.equal(after.steps, 75, 'running total must not reset');
  });

  test('the final set is the remainder, not a full 75', () => {
    const end = paceAt(pace, DURATION);
    assert.equal(end.setTarget, 25);
    assert.equal(end.setSteps, 25);
    assert.equal(end.setIndex, 6);
  });

  test('stays within bounds and advances once per break', () => {
    let previous = paceAt(pace, 0);
    let advances = 0;
    for (let t = 0.05; t <= DURATION; t += 0.05) {
      const now = paceAt(pace, t);
      assert.ok(now.setSteps >= 0 && now.setSteps <= now.setTarget,
        `${now.setSteps} of ${now.setTarget} at t=${t.toFixed(2)}`);
      assert.ok(now.setIndex >= 1 && now.setIndex <= pace.setCount);
      if (now.setIndex !== previous.setIndex) {
        advances += 1;
        assert.equal(previous.setSteps, previous.setTarget,
          `set ${previous.setIndex} ended early`);
      }
      previous = now;
    }
    assert.equal(advances, pace.blocks);
  });
});

describe('every chart and level', () => {
  for (const chart of cfg.CHARTS) {
    const interval = chart.exercises[4].interval;
    for (const level of cfg.LEVELS) {
      const target = chart.reps[level][4];
      test(`chart ${chart.id} ${level} (${target} steps)`, () => {
        const p = createPace({
          targetSteps: target, totalSeconds: DURATION, interval,
        });
        const end = paceAt(p, DURATION);

        assert.equal(end.steps, target, 'must land exactly on target at 6:00');
        assert.equal(end.inBreak, false, 'must not end mid-break');
        assert.ok(p.runSeconds > 0 && p.runSeconds <= DURATION);
        assert.equal(p.blocks, Math.ceil(target / interval.every) - 1);
        assert.equal(p.blocks * interval.every + p.finalSetSteps, target,
          'sets must partition the target');
        assert.ok(p.finalSetSteps > 0 && p.finalSetSteps <= interval.every);
        assert.equal(end.setIndex, p.setCount);
        assert.equal(end.setSteps, p.finalSetSteps);
      });
    }
  }
});

describe('edge cases', () => {
  test('an exact multiple of 75 gets no trailing break', () => {
    const exact = createPace({
      targetSteps: 300, totalSeconds: DURATION, interval: INTERVAL,
    });
    assert.equal(exact.blocks, 3, '300 steps is 4 sets with 3 breaks');
    assert.equal(exact.setCount, 4);
    assert.equal(exact.finalSetSteps, 75);
    assert.equal(paceAt(exact, DURATION).inBreak, false);
    assert.equal(paceAt(exact, DURATION).setSteps, 75);
  });

  test('a target under 75 is a single set with no breaks', () => {
    const tiny = createPace({
      targetSteps: 50, totalSeconds: DURATION, interval: INTERVAL,
    });
    assert.equal(tiny.blocks, 0);
    assert.equal(tiny.setCount, 1);
    assert.equal(paceAt(tiny, DURATION / 2).inBreak, false);
    assert.equal(paceAt(tiny, DURATION).steps, 50);
    assert.equal(paceAt(tiny, DURATION).setIndex, 1);
  });

  test('the lowest real target (100 steps) gives one break', () => {
    const low = createPace({
      targetSteps: 100, totalSeconds: DURATION, interval: INTERVAL,
    });
    assert.equal(low.blocks, 1);
    assert.equal(low.setCount, 2);
    assert.equal(low.finalSetSteps, 25);
    assert.equal(paceAt(low, DURATION).steps, 100);
  });

  test('a pathological block duration stays finite and clamped', () => {
    // 8 blocks x 30s cannot fit in 6 minutes. The target becomes unreachable,
    // but the model must not produce negative time, NaN, or a runaway count.
    // tools/verify-config.mjs is what flags a config this broken.
    const absurd = createPace({
      targetSteps: 600,
      totalSeconds: DURATION,
      interval: { ...INTERVAL, secondsEach: 30 },
    });
    assert.ok(absurd.runSeconds >= DURATION * 0.25);
    const end = paceAt(absurd, DURATION);
    assert.ok(Number.isFinite(end.steps));
    assert.ok(end.steps >= 0 && end.steps <= 600);
    assert.ok(end.steps >= paceAt(absurd, DURATION / 2).steps);
  });

  test('secondsEach shortens the available running time', () => {
    const slower = createPace({
      targetSteps: 400,
      totalSeconds: DURATION,
      interval: { ...INTERVAL, secondsEach: 2 },
    });
    assert.equal(slower.jumpSeconds, 20);
    assert.ok(slower.runSeconds < pace.runSeconds);
    assert.equal(paceAt(slower, DURATION).steps, 400);
  });
});
