/*
 * Merging two copies of the save.
 *
 * The stakes here are the whole point of syncing at all: a merge that drops a
 * session loses history that cannot be reconstructed, and a merge that resets
 * your position undoes weeks of progression. Both failure modes have an
 * obvious trigger — a freshly installed phone, whose default save looks like a
 * real one that happens to start today — so they get tests of their own.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { mergeSaves, isSaveShaped } from '../js/merge.js';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

/** Local-calendar date key, matching state.js's todayKey. */
function dateKey(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function session(ts, { chartId = 1, levelIndex = 0, completed = true } = {}) {
  return {
    ts,
    date: dateKey(ts),
    chartId,
    levelIndex,
    results: [completed, completed, completed, completed, completed],
    completed,
  };
}

function levelEntry(ts, { chartId = 1, levelIndex = 0, reason = 'advance' } = {}) {
  return { ts, date: dateKey(ts), chartId, levelIndex, reason };
}

function save({ sessions = [], levelLog = [levelEntry(T0, { reason: 'start' })],
                settings = {}, version = 1 } = {}) {
  const last = levelLog[levelLog.length - 1];
  return {
    version,
    settings: {
      age: null,
      minDaysOverride: null,
      reminderEnabled: false,
      reminderTime: '07:00',
      theme: 'system',
      updatedAt: 0,
      ...settings,
    },
    progress: {
      chartId: last.chartId,
      levelIndex: last.levelIndex,
      levelStartedTs: last.ts,
    },
    sessions,
    levelLog,
  };
}

/** The save a phone that installed the app today would hand to a merge. */
function freshSave(installedAt) {
  return save({ levelLog: [levelEntry(installedAt, { reason: 'start' })] });
}

describe('session log', () => {
  test('unions both sides, oldest first', () => {
    const merged = mergeSaves(
      save({ sessions: [session(T0), session(T0 + 2 * DAY)] }),
      save({ sessions: [session(T0 + DAY), session(T0 + 3 * DAY)] }),
    );

    assert.deepEqual(
      merged.sessions.map((s) => s.ts),
      [T0, T0 + DAY, T0 + 2 * DAY, T0 + 3 * DAY],
    );
  });

  test('a session both sides already have appears once', () => {
    const shared = session(T0 + DAY);
    const merged = mergeSaves(
      save({ sessions: [session(T0), shared] }),
      save({ sessions: [shared, session(T0 + 2 * DAY)] }),
    );

    assert.equal(merged.sessions.length, 3);
  });

  test('keeps every session when one side has none', () => {
    const sessions = [session(T0), session(T0 + DAY)];
    const merged = mergeSaves(save({ sessions }), freshSave(T0 + 30 * DAY));

    assert.equal(merged.sessions.length, 2);
  });
});

describe('level log', () => {
  test('collapses the start entries both devices generated to the earliest', () => {
    const merged = mergeSaves(
      save({ levelLog: [levelEntry(T0, { reason: 'start' })] }),
      save({ levelLog: [levelEntry(T0 + 30 * DAY, { reason: 'start' })] }),
    );

    assert.deepEqual(merged.levelLog.map((e) => e.ts), [T0]);
  });

  test('keeps every real level change', () => {
    const merged = mergeSaves(
      save({
        levelLog: [
          levelEntry(T0, { reason: 'start' }),
          levelEntry(T0 + 5 * DAY, { levelIndex: 1 }),
        ],
      }),
      save({
        levelLog: [
          levelEntry(T0, { reason: 'start' }),
          levelEntry(T0 + 9 * DAY, { levelIndex: 2 }),
        ],
      }),
    );

    assert.deepEqual(
      merged.levelLog.map((e) => e.levelIndex),
      [0, 1, 2],
    );
  });
});

describe('current position', () => {
  /*
   * The regression that motivates deriving position from the log rather than
   * picking between two `progress` objects: a phone unboxed today carries a
   * default position (Chart 1, D-) stamped with today's timestamp, which is
   * newer than the real position earned months ago.
   */
  test('a phone joining today does not reset a position earned months ago', () => {
    const earned = save({
      sessions: [session(T0 + 60 * DAY, { chartId: 3, levelIndex: 4 })],
      levelLog: [
        levelEntry(T0, { reason: 'start' }),
        levelEntry(T0 + 55 * DAY, { chartId: 3, levelIndex: 4 }),
      ],
    });

    const merged = mergeSaves(freshSave(T0 + 90 * DAY), earned);

    assert.deepEqual(merged.progress, {
      chartId: 3,
      levelIndex: 4,
      levelStartedTs: T0 + 55 * DAY,
    });
  });

  test('follows the most recent level change from either side', () => {
    const merged = mergeSaves(
      save({
        levelLog: [
          levelEntry(T0, { reason: 'start' }),
          levelEntry(T0 + 5 * DAY, { chartId: 2, levelIndex: 0 }),
        ],
      }),
      save({
        levelLog: [
          levelEntry(T0, { reason: 'start' }),
          levelEntry(T0 + 8 * DAY, { chartId: 2, levelIndex: 1 }),
        ],
      }),
    );

    assert.deepEqual(merged.progress, {
      chartId: 2,
      levelIndex: 1,
      levelStartedTs: T0 + 8 * DAY,
    });
  });
});

describe('settings', () => {
  test('the more recently edited side wins', () => {
    const merged = mergeSaves(
      save({ settings: { age: 30, updatedAt: T0 } }),
      save({ settings: { age: 45, updatedAt: T0 + DAY } }),
    );

    assert.equal(merged.settings.age, 45);
  });

  test('a save that predates updatedAt loses to one that has it', () => {
    const stale = save({ settings: { age: 30 } });
    delete stale.settings.updatedAt;

    const merged = mergeSaves(stale, save({ settings: { age: 45, updatedAt: T0 } }));

    assert.equal(merged.settings.age, 45);
  });

  test('this device keeps its own theme and reminder switch', () => {
    const merged = mergeSaves(
      save({ settings: { theme: 'dark', reminderEnabled: true, updatedAt: T0 } }),
      save({ settings: { theme: 'light', reminderEnabled: false, age: 45, updatedAt: T0 + DAY } }),
    );

    assert.equal(merged.settings.theme, 'dark');
    assert.equal(merged.settings.reminderEnabled, true);
    assert.equal(merged.settings.age, 45, 'non-device settings still take the newer side');
  });
});

describe('save version', () => {
  test('takes the higher of the two', () => {
    const merged = mergeSaves(save({ version: 1 }), save({ version: 2 }));
    assert.equal(merged.version, 2);
  });
});

describe('algebraic properties', () => {
  const randomSave = (rng, installedAt) => {
    const sessions = [];
    const levelLog = [levelEntry(installedAt, { reason: 'start' })];
    let levelIndex = 0;
    for (let day = 1; day < 40; day += 1) {
      if (rng() < 0.5) sessions.push(session(installedAt + day * DAY, { levelIndex }));
      if (rng() < 0.1) {
        levelIndex += 1;
        levelLog.push(levelEntry(installedAt + day * DAY, { levelIndex }));
      }
    }
    return save({ sessions, levelLog, settings: { updatedAt: installedAt } });
  };

  // A tiny deterministic PRNG: a seeded property run reproduces exactly, which
  // a failure you cannot re-run is not worth much.
  const seeded = (seed) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  test('merging a save with itself changes nothing', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const only = randomSave(seeded(seed), T0);
      assert.deepEqual(mergeSaves(only, only), only, `seed ${seed}`);
    }
  });

  test('the merged history is the same whichever side is local', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const rng = seeded(seed);
      const a = randomSave(rng, T0);
      const b = randomSave(rng, T0 + 10 * DAY);

      const ab = mergeSaves(a, b);
      const ba = mergeSaves(b, a);

      assert.deepEqual(ab.sessions, ba.sessions, `seed ${seed}`);
      assert.deepEqual(ab.levelLog, ba.levelLog, `seed ${seed}`);
      assert.deepEqual(ab.progress, ba.progress, `seed ${seed}`);
    }
  });

  test('merging in a third save is order-independent', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const rng = seeded(seed);
      const a = randomSave(rng, T0);
      const b = randomSave(rng, T0 + 10 * DAY);
      const c = randomSave(rng, T0 + 20 * DAY);

      const left = mergeSaves(mergeSaves(a, b), c);
      const right = mergeSaves(a, mergeSaves(b, c));

      assert.deepEqual(left.sessions, right.sessions, `seed ${seed}`);
      assert.deepEqual(left.levelLog, right.levelLog, `seed ${seed}`);
    }
  });
});

describe('shape check', () => {
  test('accepts a real save', () => {
    assert.equal(isSaveShaped(save({ sessions: [session(T0)] })), true);
  });

  for (const [label, value] of [
    ['null', null],
    ['a string', 'not a save'],
    ['an array', []],
    ['an empty object', {}],
    ['a save with no level log', { ...save(), levelLog: [] }],
    ['a save whose sessions are not an array', { ...save(), sessions: {} }],
    ['a save with no progress', { ...save(), progress: undefined }],
    ['a save whose settings are missing', { ...save(), settings: null }],
  ]) {
    test(`rejects ${label}`, () => {
      assert.equal(isSaveShaped(value), false);
    });
  }
});
