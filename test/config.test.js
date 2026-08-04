/*
 * Workout data integrity.
 *
 * The most valuable test here is `rep tables match the source`: the expected
 * numbers below were transcribed from the RCAF tables in the order they are
 * printed (A+ down to D-), which is the REVERSE of how config.js stores them
 * (D- up to A+). An identical typo in both directions is unlikely, so this
 * catches transcription errors rather than just restating the config.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as cfg from '../js/config.js';

/* Printed order: A+ first, D- last. */
const SOURCE = {
  1: [[20, 18, 18, 13, 400], [18, 17, 17, 12, 375], [16, 15, 16, 11, 335],
      [14, 13, 15, 9, 320], [12, 12, 14, 8, 305], [10, 11, 13, 7, 280],
      [8, 9, 12, 6, 260], [7, 8, 10, 5, 235], [6, 7, 8, 4, 205],
      [4, 5, 6, 3, 175], [3, 4, 5, 3, 145], [2, 3, 4, 2, 100]],
  2: [[30, 23, 33, 20, 500], [29, 21, 31, 19, 485], [28, 20, 29, 18, 470],
      [26, 18, 27, 17, 455], [24, 17, 25, 16, 445], [22, 16, 23, 15, 440],
      [20, 15, 21, 14, 425], [19, 14, 19, 13, 410], [18, 13, 17, 12, 395],
      [16, 12, 15, 11, 380], [15, 11, 14, 10, 360], [14, 10, 13, 9, 335]],
  3: [[30, 32, 47, 24, 550], [30, 31, 45, 22, 540], [30, 30, 43, 21, 525],
      [28, 28, 41, 20, 510], [28, 27, 39, 19, 500], [28, 26, 37, 18, 490],
      [26, 25, 35, 17, 480], [26, 24, 34, 17, 465], [26, 23, 33, 16, 450],
      [24, 22, 31, 15, 430], [24, 21, 30, 15, 415], [24, 20, 29, 15, 400]],
  4: [[30, 22, 50, 42, 400], [30, 22, 49, 40, 395], [30, 22, 49, 37, 390],
      [28, 21, 47, 34, 380], [28, 21, 46, 32, 375], [28, 21, 46, 30, 355],
      [26, 19, 44, 28, 355], [26, 19, 43, 26, 345], [26, 19, 43, 24, 335],
      [24, 18, 41, 22, 325], [24, 18, 40, 19, 315], [24, 18, 40, 17, 300]],
  5: [[30, 40, 50, 44, 500], [30, 39, 49, 43, 485], [30, 38, 48, 42, 475],
      [28, 36, 47, 40, 465], [28, 35, 46, 39, 455], [28, 34, 45, 38, 445],
      [28, 32, 44, 36, 435], [26, 31, 43, 35, 420], [26, 30, 42, 34, 410],
      [24, 28, 41, 32, 400], [24, 27, 40, 31, 385], [24, 26, 39, 30, 375]],
  6: [[30, 50, 40, 40, 600], [30, 48, 39, 39, 580], [30, 47, 38, 38, 555],
      [28, 45, 37, 36, 530], [28, 44, 36, 35, 525], [28, 43, 35, 34, 515],
      [26, 41, 34, 32, 505], [26, 40, 33, 31, 495], [26, 39, 32, 30, 485],
      [24, 37, 31, 28, 475], [24, 36, 30, 27, 460], [24, 35, 29, 26, 450]],
};

describe('program shape', () => {
  test('6 charts of 12 levels', () => {
    assert.equal(cfg.CHARTS.length, 6);
    assert.equal(cfg.LEVELS.length, 12);
  });

  test('levels run low to high', () => {
    assert.deepEqual(cfg.LEVELS, ['D-', 'D', 'D+', 'C-', 'C', 'C+',
      'B-', 'B', 'B+', 'A-', 'A', 'A+']);
  });

  test('timing is 2/1/1/1/6 and sums to 11 minutes', () => {
    assert.deepEqual(cfg.TIMING_SECONDS, [120, 60, 60, 60, 360]);
    assert.equal(cfg.TOTAL_SECONDS, 660);
  });
});

describe('charts', () => {
  for (const chart of cfg.CHARTS) {
    describe(`chart ${chart.id}`, () => {
      test('has exactly 5 exercises', () => {
        assert.equal(chart.exercises.length, 5);
      });

      test('every exercise has a name, instructions and a unit', () => {
        for (const [i, ex] of chart.exercises.entries()) {
          assert.ok(ex.name?.length, `exercise ${i + 1} name`);
          assert.ok(ex.text?.length > 20, `exercise ${i + 1} text`);
          assert.ok(['reps', 'steps'].includes(ex.unit),
            `exercise ${i + 1} unit: ${ex.unit}`);
        }
      });

      test('exercise 5 counts steps and has an interval cue', () => {
        const ex5 = chart.exercises[4];
        assert.equal(ex5.unit, 'steps');
        assert.equal(ex5.interval.every, 75);
        assert.equal(ex5.interval.count, 10);
        assert.ok(ex5.interval.name?.length);
        assert.ok(ex5.interval.text?.length > 20);
      });

      test('has one rep row per level, each 5 positive integers', () => {
        assert.equal(Object.keys(chart.reps).length, 12);
        for (const level of cfg.LEVELS) {
          const row = chart.reps[level];
          assert.ok(Array.isArray(row), `${level} missing`);
          assert.equal(row.length, 5, `${level}: ${JSON.stringify(row)}`);
          for (const n of row) {
            assert.ok(Number.isInteger(n) && n > 0,
              `${level}: ${JSON.stringify(row)}`);
          }
        }
      });

      test('targets never decrease as levels rise', () => {
        for (let i = 1; i < cfg.LEVELS.length; i += 1) {
          const prev = chart.reps[cfg.LEVELS[i - 1]];
          const curr = chart.reps[cfg.LEVELS[i]];
          for (const [j, n] of curr.entries()) {
            assert.ok(n >= prev[j],
              `exercise ${j + 1} drops from ${prev[j]} at ` +
              `${cfg.LEVELS[i - 1]} to ${n} at ${cfg.LEVELS[i]}`);
          }
        }
      });

      test('rep tables match the source', () => {
        for (const [i, expected] of SOURCE[chart.id].entries()) {
          // SOURCE is printed high -> low; LEVELS is stored low -> high.
          const levelIndex = cfg.LEVELS.length - 1 - i;
          assert.deepEqual(cfg.getTargets(chart.id, levelIndex), expected,
            `chart ${chart.id} ${cfg.LEVELS[levelIndex]}`);
        }
      });
    });
  }
});

describe('bird dog modification', () => {
  test('charts 1-3 use bird dog for exercise 2', () => {
    for (const id of [1, 2, 3]) {
      const ex = cfg.getChart(id).exercises[1];
      assert.match(ex.name, /bird dog/i);
      assert.equal(ex.modified, true, `chart ${id} missing modified flag`);
    }
  });

  test('charts 4-6 keep the original sit-up, flagged as a TODO', () => {
    for (const id of [4, 5, 6]) {
      const ex = cfg.getChart(id).exercises[1];
      assert.match(ex.name, /sit-up/i);
      assert.equal(ex.birdDogTodo, true, `chart ${id} missing TODO flag`);
    }
  });

  test('chart 2 wording follows CONFIG.birdDogChart2Variant', () => {
    const original = cfg.CONFIG.birdDogChart2Variant;
    try {
      cfg.CONFIG.birdDogChart2Variant = 'extension';
      const extension = cfg.getChart(2).exercises[1].text;
      cfg.CONFIG.birdDogChart2Variant = 'raise';
      const raise = cfg.getChart(2).exercises[1].text;

      assert.notEqual(extension, raise);
      assert.match(extension, /sweep/i);
      assert.match(raise, /squeeze the glute/i);
    } finally {
      cfg.CONFIG.birdDogChart2Variant = original;
    }
  });
});

describe('minimum days by age', () => {
  const cases = [[16, 1], [20, 1], [21, 2], [29, 2], [30, 4], [39, 4],
                 [40, 7], [49, 7], [50, 8], [59, 8], [60, 10], [85, 10]];

  for (const [age, expected] of cases) {
    test(`age ${age} requires ${expected} day(s)`, () => {
      assert.equal(cfg.minDaysForAge(age), expected);
    });
  }

  test('missing or nonsense age falls back to the default', () => {
    assert.equal(cfg.minDaysForAge(null), cfg.DEFAULT_MIN_DAYS);
    assert.equal(cfg.minDaysForAge(0), cfg.DEFAULT_MIN_DAYS);
    assert.equal(cfg.minDaysForAge(NaN), cfg.DEFAULT_MIN_DAYS);
  });
});

describe('position helpers', () => {
  test('advances within a chart', () => {
    assert.deepEqual(cfg.nextPosition(1, 0), { chartId: 1, levelIndex: 1 });
  });

  test('A+ rolls over to the next chart at D-', () => {
    assert.deepEqual(cfg.nextPosition(1, 11), { chartId: 2, levelIndex: 0 });
    assert.deepEqual(cfg.nextPosition(5, 11), { chartId: 6, levelIndex: 0 });
  });

  test('chart 6 A+ is the end of the program', () => {
    assert.equal(cfg.nextPosition(6, 11), null);
  });

  test('absolute level spans the whole program', () => {
    assert.equal(cfg.absoluteLevel(1, 0), 0);
    assert.equal(cfg.absoluteLevel(6, 11), 71);
  });

  test('every position is reachable by stepping from the start', () => {
    let position = { chartId: 1, levelIndex: 0 };
    let count = 1;
    while (position) {
      const next = cfg.nextPosition(position.chartId, position.levelIndex);
      if (!next) break;
      position = next;
      count += 1;
    }
    assert.equal(count, 72);
    assert.deepEqual(position, { chartId: 6, levelIndex: 11 });
  });
});

describe('interval break duration', () => {
  test('derives from CONFIG.intervalMovementSeconds', () => {
    const interval = { every: 75, count: 10, name: 'x' };
    const original = cfg.CONFIG.intervalMovementSeconds;
    try {
      cfg.CONFIG.intervalMovementSeconds = 1;
      assert.equal(cfg.intervalBreakSeconds(interval), 10);
      cfg.CONFIG.intervalMovementSeconds = 1.5;
      assert.equal(cfg.intervalBreakSeconds(interval), 15);
    } finally {
      cfg.CONFIG.intervalMovementSeconds = original;
    }
  });

  test('a per-chart secondsEach overrides the global', () => {
    assert.equal(
      cfg.intervalBreakSeconds({ every: 75, count: 10, secondsEach: 2 }), 20);
  });
});
