/*
 * Progression rules: days at level, the advance gate, streaks, persistence.
 *
 * A note on timing: the whole suite executes inside a millisecond or two, and
 * daysAtLevel() deliberately counts sessions STRICTLY after `levelStartedTs`
 * (the session that earns an advance belongs to the old level). Tests
 * therefore nudge `levelStartedTs` backwards rather than relying on real time
 * passing between calls.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installLocalStorage } from './helpers/env.js';

installLocalStorage();

const store = await import('../js/state.js');

const DAY = 86_400_000;

/** Backdate the arrival at the current level by `days`. */
function arrivedDaysAgo(days) {
  store.getProgress().levelStartedTs = Date.now() - days * DAY;
}

/** Push a completed session `daysAgo` days in the past. */
function sessionDaysAgo(daysAgo, results = [true, true, true, true, true]) {
  const when = new Date(Date.now() - daysAgo * DAY);
  store.getSessions().push({
    ts: when.getTime(),
    date: store.todayKey(when),
    chartId: store.getProgress().chartId,
    levelIndex: store.getProgress().levelIndex,
    results,
    completed: results.every(Boolean),
  });
}

beforeEach(() => {
  store.resetAll();
});

describe('required days', () => {
  test('defaults when no age is set', () => {
    assert.equal(store.requiredDays(), 4);
  });

  test('follows the age table', () => {
    store.updateSettings({ age: 35 });
    assert.equal(store.requiredDays(), 4);
    store.updateSettings({ age: 55 });
    assert.equal(store.requiredDays(), 8);
  });

  test('an explicit override beats the age table', () => {
    store.updateSettings({ age: 35, minDaysOverride: 2 });
    assert.equal(store.requiredDays(), 2);
  });

  test('clearing the override falls back to age', () => {
    store.updateSettings({ age: 35, minDaysOverride: 2 });
    store.updateSettings({ minDaysOverride: null });
    assert.equal(store.requiredDays(), 4);
  });
});

describe('days at level', () => {
  test('starts at zero', () => {
    assert.equal(store.daysAtLevel(), 0);
  });

  test('a session counts the day', () => {
    arrivedDaysAgo(1);
    store.logSession([true, true, true, true, true]);
    assert.equal(store.daysAtLevel(), 1);
  });

  test('two sessions on one day still count once', () => {
    arrivedDaysAgo(1);
    store.logSession([true, true, true, true, true]);
    store.logSession([true, true, true, true, true]);
    assert.equal(store.daysAtLevel(), 1);
  });

  test('a partial session still counts the day', () => {
    arrivedDaysAgo(1);
    store.logSession([true, false, true, true, true]);
    assert.equal(store.daysAtLevel(), 1);
  });

  test('distinct days accumulate', () => {
    arrivedDaysAgo(10);
    sessionDaysAgo(3);
    sessionDaysAgo(2);
    sessionDaysAgo(1);
    store.logSession([true, true, true, true, true]);
    assert.equal(store.daysAtLevel(), 4);
  });

  test('sessions logged before arriving at the level do not count', () => {
    sessionDaysAgo(3);
    sessionDaysAgo(2);
    arrivedDaysAgo(0); // arrive now — the older sessions belong to the past
    assert.equal(store.daysAtLevel(), 0);
  });
});

describe('advance gate', () => {
  test('blocked until the minimum days are met', () => {
    store.updateSettings({ age: 35 }); // 4 days
    arrivedDaysAgo(1);
    store.logSession([true, true, true, true, true]);
    assert.equal(store.canAdvance(), false);
  });

  test('unlocked once the minimum is met', () => {
    store.updateSettings({ age: 35 });
    arrivedDaysAgo(10);
    sessionDaysAgo(3);
    sessionDaysAgo(2);
    sessionDaysAgo(1);
    store.logSession([true, true, true, true, true]);
    assert.equal(store.canAdvance(), true);
  });

  test('advancing moves one level and resets the day counter', () => {
    store.updateSettings({ minDaysOverride: 1 });
    arrivedDaysAgo(5);
    store.logSession([true, true, true, true, true]);

    const next = store.advanceLevel();
    assert.deepEqual(next, { chartId: 1, levelIndex: 1 });
    assert.equal(store.getProgress().levelIndex, 1);
    assert.equal(store.daysAtLevel(), 0);
    assert.equal(store.getLevelLog().at(-1).reason, 'advance');
  });

  test('A+ advances into the next chart at D-', () => {
    store.setPosition(1, 11, 'manual');
    store.advanceLevel();
    assert.equal(store.getProgress().chartId, 2);
    assert.equal(store.getProgress().levelIndex, 0);
  });

  test('chart 6 A+ cannot advance', () => {
    store.setPosition(6, 11, 'manual');
    assert.equal(store.canAdvance(), false);
    assert.equal(store.advanceLevel(), null);
    assert.equal(store.getProgress().chartId, 6);
    assert.equal(store.getProgress().levelIndex, 11);
  });
});

describe('manual position changes', () => {
  test('jumping resets the day counter', () => {
    arrivedDaysAgo(10);
    sessionDaysAgo(1);
    assert.equal(store.daysAtLevel(), 1);

    store.setPosition(3, 5, 'manual');
    assert.equal(store.getProgress().chartId, 3);
    assert.equal(store.getProgress().levelIndex, 5);
    assert.equal(store.daysAtLevel(), 0);
  });

  test('dropping back does not resurrect old days at that level', () => {
    arrivedDaysAgo(10);
    sessionDaysAgo(2);
    sessionDaysAgo(1);
    store.setPosition(2, 0, 'manual');
    store.setPosition(1, 0, 'manual'); // back to where those sessions happened
    assert.equal(store.daysAtLevel(), 0);
  });

  test('every change is recorded in the level log', () => {
    store.setPosition(2, 3, 'manual');
    const entry = store.getLevelLog().at(-1);
    assert.equal(entry.chartId, 2);
    assert.equal(entry.levelIndex, 3);
    assert.equal(entry.reason, 'manual');
  });
});

describe('session logging', () => {
  test('all-yes is a completed session', () => {
    const session = store.logSession([true, true, true, true, true]);
    assert.equal(session.completed, true);
    assert.equal(store.getSessions().length, 1);
  });

  test('any no makes it partial', () => {
    const session = store.logSession([true, true, false, true, true]);
    assert.equal(session.completed, false);
  });

  test('records the position it was performed at', () => {
    store.setPosition(3, 7, 'manual');
    const session = store.logSession([true, true, true, true, true]);
    assert.equal(session.chartId, 3);
    assert.equal(session.levelIndex, 7);
  });
});

describe('streaks', () => {
  test('no sessions means no streak', () => {
    assert.equal(store.currentStreak(), 0);
  });

  test('counts consecutive days back from today', () => {
    sessionDaysAgo(0);
    sessionDaysAgo(1);
    sessionDaysAgo(2);
    assert.equal(store.currentStreak(), 3);
  });

  test('survives not having worked out yet today', () => {
    sessionDaysAgo(1);
    sessionDaysAgo(2);
    assert.equal(store.currentStreak(), 2);
  });

  test('breaks when yesterday was missed too', () => {
    sessionDaysAgo(2);
    sessionDaysAgo(3);
    assert.equal(store.currentStreak(), 0);
  });

  test('ignores a gap further back', () => {
    sessionDaysAgo(0);
    sessionDaysAgo(1);
    sessionDaysAgo(5);
    assert.equal(store.currentStreak(), 2);
  });
});

describe('deconditioning signal', () => {
  test('reports days since the last session', () => {
    assert.equal(store.daysSinceLastSession(), null);
    sessionDaysAgo(90);
    assert.equal(store.daysSinceLastSession(), 90);
  });
});

describe('persistence', () => {
  test('state survives a reload', () => {
    store.updateSettings({ age: 41, reminderTime: '06:30' });
    store.setPosition(2, 4, 'manual');
    store.logSession([true, true, true, true, false]);

    const snapshot = JSON.parse(JSON.stringify(store.getState()));
    store.replaceState(snapshot);

    assert.equal(store.getSettings().age, 41);
    assert.equal(store.getSettings().reminderTime, '06:30');
    assert.equal(store.getProgress().chartId, 2);
    assert.equal(store.getProgress().levelIndex, 4);
    assert.equal(store.getSessions().length, 1);
  });

  test('export shape round-trips through JSON', () => {
    store.logSession([true, true, true, true, true]);
    const exported = JSON.stringify(store.getState());
    const parsed = JSON.parse(exported);
    assert.ok(parsed.settings && parsed.progress);
    assert.ok(Array.isArray(parsed.sessions));
    assert.ok(Array.isArray(parsed.levelLog));
  });

  test('reset returns to chart 1 D- with no history', () => {
    store.setPosition(4, 8, 'manual');
    store.logSession([true, true, true, true, true]);
    store.resetAll();

    assert.equal(store.getProgress().chartId, 1);
    assert.equal(store.getProgress().levelIndex, 0);
    assert.equal(store.getSessions().length, 0);
    assert.equal(store.daysAtLevel(), 0);
  });
});

describe('date keys', () => {
  test('formats a local calendar date', () => {
    assert.equal(store.todayKey(new Date(2026, 7, 4)), '2026-08-04');
    assert.equal(store.todayKey(new Date(2026, 0, 9)), '2026-01-09');
  });

  test('uses local time, not UTC', () => {
    // 23:30 local must key to that local day regardless of the UTC offset.
    const late = new Date(2026, 7, 4, 23, 30);
    assert.equal(store.todayKey(late), '2026-08-04');
  });
});
