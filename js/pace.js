/*
 * Pacing for exercise 5 (the stationary run).
 *
 * The run is not continuous: every `interval.every` steps you stop and do a
 * block of `interval.count` jumps, and those blocks come out of the same six
 * minutes. So the timeline is a repeating cycle of
 *
 *     [ run until the next 75 steps ][ jump block ][ run ][ jump block ] ...
 *
 * Two consequences the on-screen step estimate has to respect:
 *
 *  1. The estimate FREEZES during a jump block — you aren't taking steps.
 *  2. Because the blocks consume part of the six minutes, the running cadence
 *     must be higher than target/duration for the estimate to still reach the
 *     target at 6:00. Running time is the duration minus all the jump blocks.
 *
 * The exercise timer itself is untouched — it always runs the full 6:00.
 *
 * Everything here is a pure function of elapsed time, so the estimate is
 * self-correcting after a pause, a resume, or the phone sleeping.
 */

import { intervalBreakSeconds } from './config.js';

/**
 * Precompute the schedule for one run.
 *
 * @param {object}  opts
 * @param {number}  opts.targetSteps  step target for this chart + level
 * @param {number}  opts.totalSeconds the exercise's full duration (360)
 * @param {object}  opts.interval     the exercise's `interval` config
 */
export function createPace({ targetSteps, totalSeconds, interval }) {
  const jumpSeconds = intervalBreakSeconds(interval);

  // You only break after completing a full block of steps, so a target that
  // isn't a whole multiple of `every` simply ends on a partial run.
  const blocks = Math.floor(targetSteps / interval.every);

  // Guard against a pathological config (say, 30s per jump) leaving no time
  // to run at all. Never let breaks claim more than three quarters of the
  // exercise; beyond that the estimate would be meaningless anyway.
  const runSeconds = Math.max(totalSeconds * 0.25,
    totalSeconds - blocks * jumpSeconds);

  const stepsPerSecond = targetSteps / runSeconds;

  return {
    targetSteps,
    totalSeconds,
    blocks,
    jumpSeconds,
    runSeconds,
    stepsPerSecond,
    runPerBlock: interval.every / stepsPerSecond, // seconds to run one block
    count: interval.count,
    name: interval.name,
    inBreak: false, // mutable: tracks whether the cue has already fired
  };
}

/**
 * Where you should be at `elapsed` seconds into the exercise.
 *
 * @returns {{steps:number, inBreak:boolean, blockIndex:number,
 *            breakRemaining:number}}
 */
export function paceAt(pace, elapsed) {
  const { runPerBlock, jumpSeconds, blocks, stepsPerSecond, targetSteps } = pace;
  const cycle = runPerBlock + jumpSeconds;

  // Completed run+jump cycles so far, capped: after the last block there are
  // no more breaks, just the remaining run.
  const fullCycles = blocks > 0
    ? Math.min(blocks, Math.floor(elapsed / cycle))
    : 0;
  const intoCycle = elapsed - fullCycles * cycle;
  const inBreak = fullCycles < blocks && intoCycle > runPerBlock;

  // Time spent actually running — jump blocks are excluded, which is what
  // freezes the step estimate.
  const runElapsed = fullCycles * runPerBlock +
    (inBreak ? runPerBlock : intoCycle);

  return {
    inBreak,
    blockIndex: fullCycles + (inBreak ? 1 : 0),
    breakRemaining: inBreak ? Math.max(0, cycle - intoCycle) : 0,
    // The epsilon absorbs float error so the estimate lands exactly on the
    // target at 6:00 rather than one step short (340 * (175/340) computes to
    // 174.99999999999997, which would floor to 174).
    steps: Math.max(0,
      Math.min(targetSteps, Math.floor(runElapsed * stepsPerSecond + 1e-9))),
  };
}
