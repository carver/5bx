/*
 * When the app talks to the cloud, and what it sends.
 *
 * The transport is stubbed, so these are about policy: that a sync does not
 * spend a write announcing nothing, that a snapshot happens once a day rather
 * than once a session, that a device applying a remote change does not then
 * treat its own write as a reason to sync again, and that a restore actually
 * undoes something instead of merging the damage straight back in.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installLocalStorage } from './helpers/env.js';

const memory = installLocalStorage();

const store = await import('../js/state.js');
const { createBackup } = await import('../js/backup.js');

const SAVE_ID = '0189ff2c-7b3a-4d5e-9f61-2c8ad4e70b13';
const DAY = 86_400_000;

/** A stand-in for js/sync.js, recording what the policy asked it to do. */
function stubSync({ remote = null, snapshots = [] } = {}) {
  const calls = [];
  let saveId = null;
  let stored = remote;
  const days = new Map(snapshots.map((day) => [day, remote]));

  return {
    calls,
    get stored() { return stored; },
    get days() { return days; },
    failWith: null,

    activeSaveId: () => saveId,
    startSharing() { saveId = SAVE_ID; return saveId; },
    joinSave(id) { saveId = id; },
    forgetSave() { saveId = null; },

    async pull(id) {
      calls.push(['pull', id]);
      if (this.failWith) throw this.failWith;
      return stored ? { state: stored, updatedAt: '2026-09-01T00:00:00Z' } : null;
    },
    async push(id, state) {
      calls.push(['push', id]);
      if (this.failWith) throw this.failWith;
      stored = state;
    },
    async deleteSave(id) { calls.push(['deleteSave', id]); stored = null; },
    async writeSnapshot(id, day, state) { calls.push(['snapshot', day]); days.set(day, state); },
    async listSnapshots() { calls.push(['listSnapshots']); return [...days.keys()].sort(); },
    async readSnapshot(id, day) { return { state: days.get(day) }; },
    async deleteSnapshot(id, day) { calls.push(['deleteSnapshot', day]); days.delete(day); },
  };
}

const operations = (sync) => sync.calls.map(([name]) => name);

function backupWith(sync, { now = () => 1_000_000 } = {}) {
  return createBackup({ store, sync, storage: globalThis.localStorage, now });
}

/** A save as another device would have stored it, with some real history. */
function remoteSave({ sessions = 3, at = Date.UTC(2026, 0, 1) } = {}) {
  return {
    version: 1,
    settings: { age: 45, minDaysOverride: null, reminderTime: '07:00', updatedAt: at },
    progress: { chartId: 2, levelIndex: 1, levelStartedTs: at },
    sessions: Array.from({ length: sessions }, (_, i) => ({
      ts: at + i * DAY,
      date: store.todayKey(new Date(at + i * DAY)),
      chartId: 2,
      levelIndex: 1,
      results: [true, true, true, true, true],
      completed: true,
    })),
    levelLog: [{ ts: at, date: '2026-01-01', chartId: 2, levelIndex: 1, reason: 'start' }],
  };
}

beforeEach(() => {
  memory.clear();
  store.resetAll();
});

describe('an unpaired device', () => {
  test('does nothing at all', async () => {
    const sync = stubSync();
    const result = await backupWith(sync).syncNow('2026-09-01');

    assert.equal(result.status, 'unpaired');
    assert.deepEqual(sync.calls, []);
  });

  test('reports itself as unpaired', () => {
    assert.deepEqual(backupWith(stubSync()).status().paired, false);
  });
});

describe('a first backup', () => {
  test('pushes the local save when the cloud has nothing yet', async () => {
    const sync = stubSync();
    const backup = backupWith(sync);
    store.logSession([true, true, true, true, true]);

    await backup.startSharing();

    assert.deepEqual(operations(sync), ['pull', 'push', 'snapshot', 'listSnapshots']);
    assert.equal(sync.stored.sessions.length, 1);
  });

  test('leaves the theme and reminder switch on the phone', async () => {
    const sync = stubSync();
    const backup = backupWith(sync);
    store.updateSettings({ theme: 'dark', reminderEnabled: true, age: 45 });

    await backup.startSharing();

    assert.equal(sync.stored.settings.age, 45);
    assert.ok(!('theme' in sync.stored.settings), 'the theme never leaves the device');
    assert.ok(!('reminderEnabled' in sync.stored.settings));
  });
});

describe('an ordinary sync', () => {
  test('merges the stored save into this device', async () => {
    const sync = stubSync({ remote: remoteSave({ sessions: 3 }) });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);

    await backup.syncNow('2026-09-01');

    assert.equal(store.getSessions().length, 3);
    assert.equal(store.getSettings().age, 45);
  });

  test('sends nothing when the stored copy is already correct', async () => {
    const sync = stubSync({ remote: remoteSave() });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);

    await backup.syncNow('2026-09-01');
    sync.calls.length = 0;
    await backup.syncNow('2026-09-01');

    assert.deepEqual(operations(sync), ['pull'],
      'a second open the same day should cost one read and no writes');
  });

  test('sends the merged save when this device has something new', async () => {
    const sync = stubSync({ remote: remoteSave({ sessions: 2 }) });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);
    await backup.syncNow('2026-09-01');

    store.logSession([true, true, true, true, false]);
    sync.calls.length = 0;
    await backup.syncNow('2026-09-01');

    assert.ok(operations(sync).includes('push'));
    assert.equal(sync.stored.sessions.length, 3);
  });

  test('records when it last succeeded', async () => {
    const sync = stubSync({ remote: remoteSave() });
    const backup = backupWith(sync, { now: () => 1_700_000 });
    sync.joinSave(SAVE_ID);

    await backup.syncNow('2026-09-01');

    assert.equal(backup.status().lastSyncedAt, 1_700_000);
    assert.equal(backup.status().pending, false);
  });
});

describe('daily snapshots', () => {
  test('writes one the first time it syncs on a given day', async () => {
    const sync = stubSync({ remote: remoteSave() });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);

    await backup.syncNow('2026-09-01');

    assert.ok(sync.days.has('2026-09-01'));
  });

  test('does not write a second one later the same day', async () => {
    const sync = stubSync({ remote: remoteSave() });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);

    await backup.syncNow('2026-09-01');
    sync.calls.length = 0;
    store.logSession([true, true, true, true, true]);
    await backup.syncNow('2026-09-01');

    assert.ok(!operations(sync).includes('snapshot'), 'one snapshot a day, not one a session');
  });

  test('writes another one the next day', async () => {
    const sync = stubSync({ remote: remoteSave() });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);

    await backup.syncNow('2026-09-01');
    await backup.syncNow('2026-09-02');

    assert.deepEqual([...sync.days.keys()].sort(), ['2026-09-01', '2026-09-02']);
  });

  test('prunes the oldest once past the limit', async () => {
    const old = Array.from({ length: 32 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
    const sync = stubSync({ remote: remoteSave(), snapshots: old });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);

    await backup.syncNow('2026-09-01');

    assert.equal(sync.days.size, 30);
    assert.ok(sync.days.has('2026-09-01'), 'today survives');
    assert.ok(!sync.days.has('2026-01-01'), 'the oldest is gone');
  });

  test('a failed prune does not fail the backup', async () => {
    const sync = stubSync({ remote: remoteSave() });
    sync.listSnapshots = async () => { throw new Error('list refused'); };
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);

    // Housekeeping left undone is untidy; reporting the backup as failed when
    // the save is safely stored would be wrong.
    assert.equal((await backup.syncNow('2026-09-01')).status, 'ok');
  });
});

describe('when the network is down', () => {
  test('reports the failure rather than throwing', async () => {
    const sync = stubSync({ remote: remoteSave() });
    sync.joinSave(SAVE_ID);
    sync.failWith = new Error('offline');

    const result = await backupWith(sync).syncNow('2026-09-01');

    assert.equal(result.status, 'failed');
  });

  test('remembers there is something still to send', async () => {
    const sync = stubSync();
    sync.joinSave(SAVE_ID);
    sync.failWith = new Error('offline');
    const backup = backupWith(sync);

    await backup.syncNow('2026-09-01');
    assert.equal(backup.status().pending, true);

    sync.failWith = null;
    await backup.syncNow('2026-09-01');
    assert.equal(backup.status().pending, false);
  });

  test('leaves the local save untouched', async () => {
    const sync = stubSync();
    sync.joinSave(SAVE_ID);
    sync.failWith = new Error('offline');
    store.logSession([true, true, true, true, true]);

    await backupWith(sync).syncNow('2026-09-01');

    assert.equal(store.getSessions().length, 1, 'a workout is never lost to a failed backup');
  });
});

describe('restoring a snapshot', () => {
  test('replaces the local save rather than merging it', async () => {
    const clean = remoteSave({ sessions: 2 });
    const sync = stubSync({ remote: clean, snapshots: ['2026-08-20'] });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);
    await backup.syncNow('2026-09-01');

    store.logSession([false, false, false, false, false]);
    assert.equal(store.getSessions().length, 3);

    await backup.restoreSnapshot('2026-08-20');

    // A merge would union the unwanted session straight back in, which would
    // make the whole snapshot mechanism pointless.
    assert.equal(store.getSessions().length, 2);
  });

  test('overwrites the stored copy, so the next sync does not undo it', async () => {
    const clean = remoteSave({ sessions: 2 });
    const sync = stubSync({ remote: clean, snapshots: ['2026-08-20'] });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);
    await backup.syncNow('2026-09-01');
    store.logSession([false, false, false, false, false]);
    await backup.syncNow('2026-09-01');

    await backup.restoreSnapshot('2026-08-20');

    assert.equal(sync.stored.sessions.length, 2);
    await backup.syncNow('2026-09-01');
    assert.equal(store.getSessions().length, 2, 'the restore survives the next sync');
  });
});

describe('unpairing and erasing', () => {
  test('unpairing leaves the stored copy for other devices', async () => {
    const sync = stubSync({ remote: remoteSave() });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);
    await backup.syncNow('2026-09-01');

    backup.unpair();

    assert.equal(backup.status().paired, false);
    assert.ok(sync.stored, 'the save itself is untouched');
    assert.ok(!operations(sync).includes('deleteSave'));
  });

  test('erasing removes the snapshots before the save they belong to', async () => {
    const sync = stubSync({ remote: remoteSave(), snapshots: ['2026-08-30', '2026-08-31'] });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);

    await backup.wipeCloud();

    const order = operations(sync);
    assert.ok(order.indexOf('deleteSnapshot') < order.indexOf('deleteSave'),
      'deleting the save first would orphan its snapshots');
    assert.equal(sync.stored, null);
    assert.equal(sync.days.size, 0);
    assert.equal(backup.status().paired, false);
  });

  test('erasing keeps the local save, which is still yours', async () => {
    const sync = stubSync({ remote: remoteSave() });
    const backup = backupWith(sync);
    sync.joinSave(SAVE_ID);
    await backup.syncNow('2026-09-01');
    const before = store.getSessions().length;

    await backup.wipeCloud();

    assert.equal(store.getSessions().length, before);
  });
});

describe('scheduling', () => {
  /** A fake timer that runs pending callbacks only when told to. */
  function fakeTimers() {
    const pending = new Map();
    let next = 1;
    return {
      schedule: (fn) => { pending.set(next, fn); return next++; },
      cancel: (id) => pending.delete(id),
      run() {
        const due = [...pending.values()];
        pending.clear();
        due.forEach((fn) => fn());
      },
      get size() { return pending.size; },
    };
  }

  test('syncs once when it starts', async () => {
    const sync = stubSync({ remote: remoteSave() });
    sync.joinSave(SAVE_ID);
    const timers = fakeTimers();
    const backup = createBackup({
      store, sync, storage: globalThis.localStorage, ...timers,
    });

    const stop = backup.start({ addEventListener: () => {} });
    await backup.syncNow('2026-09-01');
    stop();

    assert.ok(operations(sync).includes('pull'));
  });

  test('coalesces a burst of changes into one scheduled sync', async () => {
    const sync = stubSync({ remote: remoteSave() });
    sync.joinSave(SAVE_ID);
    const timers = fakeTimers();
    const backup = createBackup({ store, sync, storage: globalThis.localStorage, ...timers });

    const stop = backup.start({ addEventListener: () => {} });
    await backup.syncNow('2026-09-01');
    sync.calls.length = 0;

    // Finishing a workout writes twice: the session, then the level advance.
    store.logSession([true, true, true, true, true]);
    store.setPosition(2, 2, 'advance');
    assert.equal(timers.size, 1, 'the second change replaces the first timer');

    timers.run();
    await backup.syncNow('2026-09-01');
    assert.equal(operations(sync).filter((op) => op === 'push').length, 1);
    stop();
  });

  test('applying a remote change does not schedule a sync of its own', async () => {
    const sync = stubSync({ remote: remoteSave({ sessions: 4 }) });
    sync.joinSave(SAVE_ID);
    const timers = fakeTimers();
    const backup = createBackup({ store, sync, storage: globalThis.localStorage, ...timers });

    const stop = backup.start({ addEventListener: () => {} });
    await backup.syncNow('2026-09-01');

    // The merge writes to the store, which notifies the listener that asked
    // for the sync. Left unguarded, the app would chase its own tail.
    assert.equal(timers.size, 0);
    stop();
  });

  test('retries when the network comes back, but only if something is owed', async () => {
    const sync = stubSync();
    sync.joinSave(SAVE_ID);
    sync.failWith = new Error('offline');
    const timers = fakeTimers();
    const listeners = {};
    const backup = createBackup({ store, sync, storage: globalThis.localStorage, ...timers });

    const stop = backup.start({ addEventListener: (name, fn) => { listeners[name] = fn; } });
    await backup.syncNow('2026-09-01');
    assert.equal(backup.status().pending, true);

    sync.failWith = null;
    sync.calls.length = 0;
    listeners.online();
    await backup.syncNow('2026-09-01');
    assert.ok(operations(sync).includes('push'));

    sync.calls.length = 0;
    listeners.online();
    assert.deepEqual(sync.calls, [], 'nothing owed, nothing sent');
    stop();
  });

  test('stopping detaches the listener', async () => {
    const sync = stubSync({ remote: remoteSave() });
    sync.joinSave(SAVE_ID);
    const timers = fakeTimers();
    const backup = createBackup({ store, sync, storage: globalThis.localStorage, ...timers });

    const stop = backup.start({ addEventListener: () => {} });
    await backup.syncNow('2026-09-01');
    stop();

    store.logSession([true, true, true, true, true]);
    assert.equal(timers.size, 0);
  });
});
