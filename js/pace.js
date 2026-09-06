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
 *  1. The estimate FREEZES during a jump block; you aren't taking steps.
 *  2. Because the blocks consume part of the six minutes, the running cadence
 *     must be higher than target/duration for the estimate to still reach the
 *     target at 6:00. Running time is the duration minus all the jump blocks.
 *
 * The exercise timer itself is untouched; it always runs the full 6:00.
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

  /*
   * Breaks fall BETWEEN sets of `every` steps, so there is always one more set
   * than there are breaks, and no break after the final step:
   *
   *   400 steps -> 75,75,75,75,75,25  =  6 sets, 5 breaks
   *   300 steps -> 75,75,75,75        =  4 sets, 3 breaks
   *
   * Hence ceil-minus-one rather than floor: a target that is an exact multiple
   * of `every` would otherwise schedule a pointless final break at 6:00.
   */
  const blocks = Math.max(0, Math.ceil(targetSteps / interval.every) - 1);

  // Steps in the last set, always in (0, every].
  const finalSetSteps = targetSteps - blocks * interval.every;

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
    runPerBlock: interval.every / stepsPerSecond, // seconds to run one set
    every: interval.every,
    finalSetSteps,
    setCount: blocks + 1,
    count: interval.count,
    name: interval.name,
    inBreak: false, // mutable: tracks whether the cue has already fired
  };
}

/**
 * Where you should be at `elapsed` seconds into the exercise.
 *
 * `steps` is the running total for the whole exercise; `setSteps` / `setTarget`
 * restart from zero at each break, matching how you count in your head.
 *
 * @returns {{steps:number, inBreak:boolean, blockIndex:number,
 *            breakRemaining:number, setSteps:number, setTarget:number,
 *            setIndex:number}}
 */
export function paceAt(pace, elapsed) {
  const { runPerBlock, jumpSeconds, blocks, stepsPerSecond, targetSteps,
    every, finalSetSteps } = pace;
  const cycle = runPerBlock + jumpSeconds;

  // Completed run+jump cycles so far, capped: after the last block there are
  // no more breaks, just the remaining run.
  const fullCycles = blocks > 0
    ? Math.min(blocks, Math.floor(elapsed / cycle))
    : 0;
  const intoCycle = elapsed - fullCycles * cycle;
  const inBreak = fullCycles < blocks && intoCycle > runPerBlock;

  // Time spent actually running. Jump blocks are excluded, which is what
  // freezes the step estimate.
  const runElapsed = fullCycles * runPerBlock +
    (inBreak ? runPerBlock : intoCycle);

  const steps = repInProgress(runElapsed * stepsPerSecond, targetSteps);

  /*
   * Which set of `every` steps you are in. `fullCycles` doubles as the 0-based
   * set index in both states: while running it is the set in progress, and
   * during a break it is the set you have just finished, which is what we
   * want on screen, held at its full count until the run resumes.
   */
  const setIndex = fullCycles;
  const setTarget = setIndex < blocks ? every : finalSetSteps;
  const setSteps = inBreak
    ? setTarget
    : Math.max(0, Math.min(setTarget, steps - setIndex * every));

  return {
    inBreak,
    blockIndex: fullCycles + (inBreak ? 1 : 0),
    breakRemaining: inBreak ? Math.max(0, cycle - intoCycle) : 0,
    steps,
    setSteps,
    setTarget,
    setIndex: setIndex + 1, // 1-based for display
  };
}

/**
 * Straight-line rep estimate for exercises 1-4: no jump blocks to pause for,
 * just a steady climb from 0 to `target` over `totalSeconds`. Used to show
 * roughly where in the set you should be, the same way exercise 5 does.
 */
export function estimateAt(elapsed, totalSeconds, target) {
  const ratio = totalSeconds > 0 ? elapsed / totalSeconds : 1;
  return repInProgress(ratio * target, target);
}

/**
 * The rep you should be doing right now, given `completed` fractional reps.
 *
 * Rounds up: the moment the clock starts you are on rep 1, and the final rep
 * shows for its whole share of the time rather than only at the buzzer. The
 * epsilon absorbs float error so a count computed as 75.00000000000001 still
 * reads 75 and not 76 (which would also unfreeze exercise 5's estimate during
 * a jump block).
 */
function repInProgress(completed, target) {
  return Math.max(0, Math.min(target, Math.ceil(completed - 1e-9)));
}
