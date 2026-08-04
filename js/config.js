/*
 * 5BX configuration — ALL workout data lives here.
 * ---------------------------------------------------------------------------
 * This is the only file you need to edit to tune the program: rep targets,
 * exercise descriptions, timings, and the age -> minimum-days table.
 * Nothing in here imports anything; the UI/timer/PWA code reads from it.
 *
 * REP COUNTING CONVENTION
 *   For every alternating exercise (the original plan's alternate leg raise,
 *   and all of the bird dog variants), 1 rep = ONE FULL ALTERNATING CYCLE:
 *   one side, then the other side. This matches how the original 5BX text
 *   counts its alternate leg raise ("count one each time the second leg
 *   touches the floor"). So "3 reps" of bird dog = 3 left + 3 right = 6
 *   individual limb extensions.
 */

/* -------------------------------------------------------------------------
 * Tunable flags
 * ---------------------------------------------------------------------- */

export const CONFIG = {
  /*
   * Chart 2 uses bird dog level 2b (leg only). The source describes two ways
   * to do it. 'extension' sweeps the leg smoothly out to full extension (the
   * harder, default variant); 'raise' extends then lifts, squeezing the glute.
   * Flip this to 'raise' to show the easier description instead.
   */
  birdDogChart2Variant: 'extension',

  /*
   * Assumed duration of ONE bonus movement in exercise 5's interval breaks
   * (one scissor jump, one astride jump, one half knee bend, ...).
   *
   * This only affects the on-screen step ESTIMATE during exercise 5. The step
   * count freezes for `count * this` seconds while you do a block, because you
   * are jumping rather than running. Since those breaks come out of the same
   * 6 minutes, the running cadence is scaled up so the estimate still reaches
   * the target step count exactly at 6:00. The 11-minute timing is untouched.
   *
   * A rough guess — tune it if the estimate runs ahead of or behind your real
   * count. Per-chart override: set `secondsEach` on that chart's exercise 5
   * `interval` object.
   */
  intervalMovementSeconds: 1,
};

/* -------------------------------------------------------------------------
 * Levels & timing
 * ---------------------------------------------------------------------- */

/** Levels ordered low -> high. Index 0 is the entry point of every chart. */
export const LEVELS = [
  'D-', 'D', 'D+',
  'C-', 'C', 'C+',
  'B-', 'B', 'B+',
  'A-', 'A', 'A+',
];

/**
 * Seconds allotted to each exercise, by index 0-4. Identical for every chart
 * and every level in the original plan. Sums to 11:00.
 */
export const TIMING_SECONDS = [120, 60, 60, 60, 360];

export const TOTAL_SECONDS = TIMING_SECONDS.reduce((a, b) => a + b, 0);

/**
 * Minimum calendar days to remain at a level before advancing, by age.
 * Read top-down: the first entry whose `maxAge` is >= your age wins.
 *
 * The source table overlaps at 20 ("20 or under: 1 day" and "20-29: 2 days");
 * we resolve that in favour of the more lenient reading, so age 20 -> 1 day.
 * The original documents this for Chart 1 only; per the spec we apply it as a
 * general per-level minimum across all charts.
 */
export const MIN_DAYS_BY_AGE = [
  { maxAge: 20, days: 1 },
  { maxAge: 29, days: 2 },
  { maxAge: 39, days: 4 },
  { maxAge: 49, days: 7 },
  { maxAge: 59, days: 8 },
  { maxAge: Infinity, days: 10 },
];

/** Fallback when no age has been entered yet. */
export const DEFAULT_MIN_DAYS = 4;

/**
 * Deconditioning guidance, shown as advice only — the app never silently
 * resets your level. Use Settings -> "Jump to chart/level" to act on it.
 */
export const DECONDITIONING = {
  restartAfterDays: 60,        // break longer than ~2 months -> restart at 1 D-
  restartAfterIllnessDays: 30, // break longer than ~1 month due to illness
  note: 'After a shorter break, drop back a few levels rather than resuming ' +
        'where you left off.',
};

/* -------------------------------------------------------------------------
 * Exercise text
 * ---------------------------------------------------------------------- */

/* Chart 2's exercise 2 text depends on CONFIG.birdDogChart2Variant. */
const BIRD_DOG_2B_TEXT = {
  extension:
    'All fours, hands under shoulders, knees under hips, back flat. Sweep ' +
    'one leg smoothly from the all-fours position out into a full straight-' +
    'leg extension behind you. Alternate legs each rep.',
  raise:
    'All fours, hands under shoulders, knees under hips, back flat. Extend ' +
    'one leg straight back, squeeze the glute, and lift it without moving ' +
    'the lower back. Alternate legs each rep.',
};

/* -------------------------------------------------------------------------
 * The charts
 *
 * Each chart has exactly 5 exercises, always performed in this order:
 *   0. stretch / toe touch      3. push-up variant
 *   1. abdominal (bird dog on charts 1-3, see below)
 *   2. back / leg raise         4. stationary run + periodic jumps
 *
 * `reps` is keyed by level and ordered low -> high to match LEVELS. Each value
 * is a 5-element array of targets, positionally matching `exercises`.
 * Exercise 5's number is a STEP count (one step = one left-foot touchdown),
 * not a rep count; `unit` on the exercise says which.
 * ---------------------------------------------------------------------- */

export const CHARTS = [
  /* ===================================================================== */
  {
    id: 1,
    name: 'Chart 1',
    note: 'Entry chart. Push-ups are done from the knees.',
    exercises: [
      {
        name: 'Toe touch',
        unit: 'reps',
        text:
          'Feet astride, arms upward. Bend forward to touch the floor, then ' +
          'stretch upward and bend backward. Do not strain to keep the knees ' +
          'straight.',
      },
      {
        // MODIFIED: bird dog level 2a replaces the original sit-up.
        // Rep targets below are a seeded guess (copied from the original
        // sit-up column) and are expected to be tuned from experience.
        name: 'Bird dog — level 2a (arm reach)',
        unit: 'reps',
        modified: true,
        text:
          'All fours, hands under shoulders, knees under hips, back flat and ' +
          'neutral. Lift and straighten one arm, reaching forward/overhead as ' +
          'high as possible without flaring the ribs or bending the arm, then ' +
          'return it. Alternate arms each rep.',
      },
      {
        name: 'Alternate leg raise',
        unit: 'reps',
        text:
          'Front lying, palms placed under the thighs. Raise the head and one ' +
          'leg, alternating legs. Keep the raised leg straight at the knee; ' +
          'the thigh must clear the palm. Count one rep each time the second ' +
          'leg touches the floor.',
      },
      {
        name: 'Push-up (knees down)',
        unit: 'reps',
        text:
          'Front lying, hands under the shoulders, palms flat on the floor. ' +
          'Straighten the arms to lift the upper body, keeping the knees on ' +
          'the floor. Body straight from the knees; arms fully extended at ' +
          'the top; chest touches the floor at the bottom to complete a rep.',
      },
      {
        name: 'Stationary run',
        unit: 'steps',
        text:
          'Run in place, counting a step each time the LEFT foot touches the ' +
          'floor. Lift the feet about 4 inches off the floor.',
        interval: {
          every: 75,
          count: 10,
          name: 'scissor jumps',
          text:
            'Stand with the right leg and left arm forward, left leg and ' +
            'right arm back. Jump and switch arm and leg positions before ' +
            'landing; arms at shoulder height. Then resume the run.',
        },
      },
    ],
    reps: {
      'D-': [2, 3, 4, 2, 100],
      'D':  [3, 4, 5, 3, 145],
      'D+': [4, 5, 6, 3, 175],
      'C-': [6, 7, 8, 4, 205],
      'C':  [7, 8, 10, 5, 235],
      'C+': [8, 9, 12, 6, 260],
      'B-': [10, 11, 13, 7, 280],
      'B':  [12, 12, 14, 8, 305],
      'B+': [14, 13, 15, 9, 320],
      'A-': [16, 15, 16, 11, 335],
      'A':  [18, 17, 17, 12, 375],
      'A+': [20, 18, 18, 13, 400],
    },
  },

  /* ===================================================================== */
  {
    id: 2,
    name: 'Chart 2',
    note: 'Push-ups move to the toes.',
    exercises: [
      {
        name: 'Toe touch + press',
        unit: 'reps',
        text:
          'Feet astride, arms upward. Touch the floor, press (bounce) once, ' +
          'then stretch upward and bend backward. Do not strain to keep the ' +
          'knees straight.',
      },
      {
        // MODIFIED: bird dog level 2b replaces the original sit-up.
        // Rep targets are a seeded guess (original sit-up column).
        name: 'Bird dog — level 2b (leg only)',
        unit: 'reps',
        modified: true,
        get text() {
          return BIRD_DOG_2B_TEXT[CONFIG.birdDogChart2Variant];
        },
      },
      {
        name: 'Leg + head raise',
        unit: 'reps',
        text:
          'Front lying, palms under the thighs. Raise the head, shoulders, ' +
          'and both legs together. Legs straight; both thighs must clear the ' +
          'palms.',
      },
      {
        name: 'Push-up (toes down)',
        unit: 'reps',
        text:
          'Front lying, hands under the shoulders, palms flat. Straighten the ' +
          'arms to lift the body onto palms and toes only, back straight. ' +
          'Chest touches the floor at the bottom of each rep; arms fully ' +
          'extend at the top.',
      },
      {
        name: 'Stationary run',
        unit: 'steps',
        text:
          'Run in place, counting a step each time the LEFT foot touches the ' +
          'floor. Lift the feet about 4 inches off the floor.',
        interval: {
          every: 75,
          count: 10,
          name: 'astride jumps',
          text:
            'Feet together, arms at the sides. Jump to feet-astride with the ' +
            'arms raised sideways to shoulder height; jump back to the start ' +
            'for a count of one.',
        },
      },
    ],
    reps: {
      'D-': [14, 10, 13, 9, 335],
      'D':  [15, 11, 14, 10, 360],
      'D+': [16, 12, 15, 11, 380],
      'C-': [18, 13, 17, 12, 395],
      'C':  [19, 14, 19, 13, 410],
      'C+': [20, 15, 21, 14, 425],
      'B-': [22, 16, 23, 15, 440],
      'B':  [24, 17, 25, 16, 445],
      'B+': [26, 18, 27, 17, 455],
      'A-': [28, 20, 29, 18, 470],
      'A':  [29, 21, 31, 19, 485],
      'A+': [30, 23, 33, 20, 500],
    },
  },

  /* ===================================================================== */
  {
    id: 3,
    name: 'Chart 3',
    note: 'Push-ups gain the chin/forehead touch.',
    exercises: [
      {
        name: 'Toe touch, alternating sides',
        unit: 'reps',
        text:
          'Feet astride, arms upward. Touch the floor 6 inches outside the ' +
          'left foot, then between the feet (press once), then 6 inches ' +
          'outside the right foot; bend backward as far as possible. Reverse ' +
          'direction after half the reps.',
      },
      {
        // MODIFIED: bird dog level 3 replaces the original sit-up.
        // Rep targets are a seeded guess (original sit-up column).
        name: 'Bird dog — level 3 (combined)',
        unit: 'reps',
        modified: true,
        text:
          'All fours, hands under shoulders, knees under hips, back flat. ' +
          'Extend the opposite arm and leg together (e.g. right arm forward + ' +
          'left leg back) smoothly and simultaneously, hold briefly, return to ' +
          'all fours, then alternate to the other side each rep.',
      },
      {
        name: 'Back raise, hands behind head',
        unit: 'reps',
        text:
          'Front lying, hands interlocked behind the head. Lift the head, ' +
          'shoulders, chest, and both legs as high as possible. Legs straight; ' +
          'chest and both thighs fully clear the floor.',
      },
      {
        name: 'Push-up with chin/forehead touch',
        unit: 'reps',
        text:
          'Front lying, hands under the shoulders, palms flat. Touch the chin ' +
          'to the floor in front of the hands, then the forehead to the floor ' +
          'behind the hands, as two distinct movements, before returning to ' +
          'the up position. Three distinct motions — chin, forehead, arms ' +
          'straight — not one continuous move.',
      },
      {
        name: 'Stationary run',
        unit: 'steps',
        text:
          'Run in place, counting a step each time the LEFT foot touches the ' +
          'floor. Lift the feet about 4 inches off the floor.',
        interval: {
          every: 75,
          count: 10,
          name: 'half knee bends',
          text:
            'Feet together, hands on hips. Bend the knees to about 110 ' +
            'degrees (not past a right angle), then straighten back up ' +
            'raising the heels. Feet stay in contact with the floor and the ' +
            'back stays upright throughout.',
        },
      },
    ],
    reps: {
      'D-': [24, 20, 29, 15, 400],
      'D':  [24, 21, 30, 15, 415],
      'D+': [24, 22, 31, 15, 430],
      'C-': [26, 23, 33, 16, 450],
      'C':  [26, 24, 34, 17, 465],
      'C+': [26, 25, 35, 17, 480],
      'B-': [28, 26, 37, 18, 490],
      'B':  [28, 27, 39, 19, 500],
      'B+': [28, 28, 41, 20, 510],
      'A-': [30, 30, 43, 21, 525],
      'A':  [30, 31, 45, 22, 540],
      'A+': [30, 32, 47, 24, 550],
    },
  },

  /* ===================================================================== */
  {
    id: 4,
    name: 'Chart 4',
    // TODO: no bird-dog variant defined yet for charts 4-6. Exercise 2 below
    // is the ORIGINAL 5BX sit-up, left in as a placeholder. When a suitable
    // bird dog progression is chosen, replace the exercise 2 entry (and
    // retune its rep column) the same way charts 1-3 were modified.
    note: 'Exercise 2 is still the original sit-up — no bird dog defined yet.',
    exercises: [
      {
        name: 'Toe touch, circle bend',
        unit: 'reps',
        text:
          'Feet astride, arms upward. Touch the floor outside the left foot, ' +
          'between the feet (press once), outside the right foot, then ' +
          'circle-bend backward as far as possible; reverse direction after ' +
          'half the reps. The arms make a full circle above the head, bending ' +
          'backward past vertical each time.',
      },
      {
        name: 'Sit-up, arms overhead',
        unit: 'reps',
        birdDogTodo: true, // TODO: no bird-dog variant defined yet
        text:
          'Back lying, legs straight, feet together, arms straight overhead. ' +
          'Sit up and touch the toes, keeping arms and legs straight. Arms ' +
          'stay against the sides of the head throughout; knees may bend ' +
          'slightly.',
      },
      {
        name: 'Full-body raise, arms sideways',
        unit: 'reps',
        text:
          'Front lying, arms stretched sideways. Lift the head, shoulders, ' +
          'arms, chest, and both legs as high as possible; legs straight, ' +
          'chest and thighs fully clear the floor.',
      },
      {
        name: 'Push-up, narrow hand position',
        unit: 'reps',
        text:
          'Front lying, palms flat about 1 foot from the ears. Straighten the ' +
          'arms to lift the body; the chest touches the floor each rep.',
      },
      {
        name: 'Stationary run',
        unit: 'steps',
        text:
          'Run in place lifting the knees waist-high, counting a step each ' +
          'time the LEFT foot touches the floor.',
        interval: {
          every: 75,
          count: 10,
          name: 'semi-squat jumps',
          text:
            'Drop to a half-crouch, hands on knees, arms straight, one foot ' +
            'slightly ahead. Jump to upright with the feet leaving the floor, ' +
            'reversing foot position before landing; return to the half-' +
            'crouch and repeat.',
        },
      },
    ],
    reps: {
      'D-': [24, 18, 40, 17, 300],
      'D':  [24, 18, 40, 19, 315],
      'D+': [24, 18, 41, 22, 325],
      'C-': [26, 19, 43, 24, 335],
      'C':  [26, 19, 43, 26, 345],
      'C+': [26, 19, 44, 28, 355],
      'B-': [28, 21, 46, 30, 355],
      'B':  [28, 21, 46, 32, 375],
      'B+': [28, 21, 47, 34, 380],
      'A-': [30, 22, 49, 37, 390],
      'A':  [30, 22, 49, 40, 395],
      'A+': [30, 22, 50, 42, 400],
    },
  },

  /* ===================================================================== */
  {
    id: 5,
    name: 'Chart 5',
    // TODO: no bird-dog variant defined yet — exercise 2 is the original.
    note: 'Exercise 2 is still the original sit-up — no bird dog defined yet.',
    exercises: [
      {
        name: 'Toe touch, hands clasped',
        unit: 'reps',
        text:
          'Feet astride, arms upward, hands clasped, arms straight. Touch the ' +
          'floor outside the left foot, between the feet (press once), ' +
          'outside the right foot, then circle-bend backward. Reverse ' +
          'direction after half the reps.',
      },
      {
        name: 'Twisting sit-up',
        unit: 'reps',
        birdDogTodo: true, // TODO: no bird-dog variant defined yet
        text:
          'Back lying, legs straight, feet together, hands clasped behind the ' +
          'head. Sit up while raising the bent legs, twisting to touch the ' +
          'right elbow to the left knee; alternate twist direction each rep. ' +
          'The feet stay off the floor when elbow touches knee.',
      },
      {
        name: 'Full-body raise, arms overhead',
        unit: 'reps',
        text:
          'Front lying, arms extended overhead. Raise the arms, head, chest, ' +
          'and both legs as high as possible; legs and arms straight, chest ' +
          'and thighs fully clear the floor.',
      },
      {
        name: 'Push-up with clap',
        unit: 'reps',
        text:
          'Front lying, hands under the shoulders. Push off the floor and ' +
          'clap the hands before returning to the starting position; the body ' +
          'stays straight throughout and the clap must be audible.',
      },
      {
        name: 'Stationary run',
        unit: 'steps',
        text:
          'Run in place, knees waist-high, counting a step each time the LEFT ' +
          'foot touches the floor.',
        interval: {
          every: 75,
          count: 10,
          name: 'semi-spread eagle jumps',
          text:
            'Half-crouch with hands on knees. Jump to feet-astride swinging ' +
            'the arms overhead mid-air, then land directly back at the start. ' +
            'Hands go above head height; feet at least shoulder-width apart ' +
            'at the top.',
        },
      },
    ],
    reps: {
      'D-': [24, 26, 39, 30, 375],
      'D':  [24, 27, 40, 31, 385],
      'D+': [24, 28, 41, 32, 400],
      'C-': [26, 30, 42, 34, 410],
      'C':  [26, 31, 43, 35, 420],
      'C+': [28, 32, 44, 36, 435],
      'B-': [28, 34, 45, 38, 445],
      'B':  [28, 35, 46, 39, 455],
      'B+': [28, 36, 47, 40, 465],
      'A-': [30, 38, 48, 42, 475],
      'A':  [30, 39, 49, 43, 485],
      'A+': [30, 40, 50, 44, 500],
    },
  },

  /* ===================================================================== */
  {
    id: 6,
    name: 'Chart 6',
    // TODO: no bird-dog variant defined yet — exercise 2 is the original.
    note: 'Usually found only in champion athletes. Exercise 2 is still the ' +
          'original sit-up — no bird dog defined yet.',
    exercises: [
      {
        name: 'Toe touch, reverse-clasped hands',
        unit: 'reps',
        text:
          'Feet astride, arms upward, hands reverse clasped, arms straight. ' +
          'Touch the floor outside the left foot, between the feet (press ' +
          'once), outside the right foot, then circle-bend backward; reverse ' +
          'direction after half the reps. Keep the hands tightly reverse-' +
          'clasped throughout.',
      },
      {
        name: 'Pike sit-up',
        unit: 'reps',
        birdDogTodo: true, // TODO: no bird-dog variant defined yet
        text:
          'Back lying, legs straight, feet together, arms straight overhead. ' +
          'Sit up while lifting both legs to touch the toes in a pike / "V" ' +
          'position. Feet together, legs and arms straight; upper back and ' +
          'legs fully clear the floor.',
      },
      {
        name: 'Full-body raise with press-back',
        unit: 'reps',
        text:
          'Front lying, arms extended overhead. Raise the arms, head, chest, ' +
          'and both legs as high as possible, then press back once more. Legs ' +
          'and arms straight; chest and thighs fully clear the floor.',
      },
      {
        name: 'Push-up with chest slap',
        unit: 'reps',
        text:
          'Front lying, hands under the shoulders. Push off the floor and ' +
          'slap the chest before returning to the starting position; the body ' +
          'stays straight throughout and the slap must be audible.',
      },
      {
        name: 'Stationary run',
        unit: 'steps',
        text:
          'Run in place, knees waist-high, counting a step each time the LEFT ' +
          'foot touches the floor.',
        interval: {
          every: 75,
          count: 10,
          name: 'jack jumps',
          text:
            'Crouch with the knees bent, sitting on the heels, fingertips ' +
            'touching the floor. Jump up raising the legs to waist height and ' +
            'touching the toes in midair, legs straight; land back in the ' +
            'crouch.',
        },
      },
    ],
    reps: {
      'D-': [24, 35, 29, 26, 450],
      'D':  [24, 36, 30, 27, 460],
      'D+': [24, 37, 31, 28, 475],
      'C-': [26, 39, 32, 30, 485],
      'C':  [26, 40, 33, 31, 495],
      'C+': [26, 41, 34, 32, 505],
      'B-': [28, 43, 35, 34, 515],
      'B':  [28, 44, 36, 35, 525],
      'B+': [28, 45, 37, 36, 530],
      'A-': [30, 47, 38, 38, 555],
      'A':  [30, 48, 39, 39, 580],
      'A+': [30, 50, 40, 40, 600],
    },
  },
];

/* -------------------------------------------------------------------------
 * Small lookup helpers (pure functions over the data above)
 * ---------------------------------------------------------------------- */

export function getChart(chartId) {
  return CHARTS.find((c) => c.id === chartId) || CHARTS[0];
}

/** How long one block of interval jumps is assumed to take, in seconds. */
export function intervalBreakSeconds(interval) {
  const each = interval.secondsEach ?? CONFIG.intervalMovementSeconds;
  return interval.count * each;
}

export function levelName(levelIndex) {
  return LEVELS[levelIndex] || LEVELS[0];
}

/** Target rep/step counts (array of 5) for a chart + level index. */
export function getTargets(chartId, levelIndex) {
  return getChart(chartId).reps[levelName(levelIndex)];
}

/** Minimum days at a level for a given age, per MIN_DAYS_BY_AGE. */
export function minDaysForAge(age) {
  if (!Number.isFinite(age) || age <= 0) return DEFAULT_MIN_DAYS;
  return MIN_DAYS_BY_AGE.find((row) => age <= row.maxAge).days;
}

/**
 * The next chart+level after the given one, or null if already at 6 A+
 * (the top of the program — there is nowhere further to advance).
 */
export function nextPosition(chartId, levelIndex) {
  if (levelIndex < LEVELS.length - 1) {
    return { chartId, levelIndex: levelIndex + 1 };
  }
  const idx = CHARTS.findIndex((c) => c.id === chartId);
  if (idx < CHARTS.length - 1) {
    return { chartId: CHARTS[idx + 1].id, levelIndex: 0 };
  }
  return null;
}

/** Absolute position in the whole program, 0..71. Useful for charting. */
export function absoluteLevel(chartId, levelIndex) {
  const idx = Math.max(0, CHARTS.findIndex((c) => c.id === chartId));
  return idx * LEVELS.length + levelIndex;
}
