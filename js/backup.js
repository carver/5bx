/*
 * When to talk to the cloud, as opposed to how.
 *
 * js/sync.js is the transport; this decides what to send and when. The split
 * is what makes both testable: the transport against a stubbed fetch, the
 * policy here against a stubbed transport.
 *
 * The policy is deliberately small. One operation, which pulls, merges, pushes
 * and writes at most one snapshot a day. It runs when the app opens, a few
 * seconds after a session is logged, when the network comes back, and when the
 * button in Settings is pressed. There is no live listener and no write queue, because there is
 * nothing here worth that machinery: a workout is finished before it is
 * recorded, and a failed write costs nothing but a retry next time.
 */

import { sameSave, withoutDeviceSettings } from './merge.js';
import { snapshotsToPrune } from './sync.js';

const BACKUP_KEY = '5bx-backup-v1';

/*
 * Long enough that logging a session and advancing a level land in one write
 * rather than two; short enough to be gone before the phone goes back in a
 * pocket.
 */
const PUSH_DELAY_MS = 3_000;

export function createBackup({
  store,
  sync,
  storage = globalThis.localStorage,
  now = Date.now,
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
}) {
  let running = null;
  let pushTimer = null;
  /*
   * Applying a merge writes to the store, which notifies the very listener
   * that asked for the sync. Without this the app would chase its own tail.
   */
  let applyingRemote = false;
  let lastError = null;
  const watchers = new Set();

  function record() {
    try {
      return JSON.parse(storage.getItem(BACKUP_KEY) ?? 'null') ?? {};
    } catch {
      return {};
    }
  }

  function mark(patch) {
    storage.setItem(BACKUP_KEY, JSON.stringify({ ...record(), ...patch }));
    watchers.forEach((watcher) => watcher(status()));
  }

  function status() {
    const { lastSyncedAt = null, lastSnapshotDay = null, pending = false } = record();
    return {
      saveId: sync.activeSaveId(),
      paired: Boolean(sync.activeSaveId()),
      lastSyncedAt,
      lastSnapshotDay,
      pending,
      lastError,
      syncing: Boolean(running),
    };
  }

  /* ----------------------------------------------------------- snapshots */

  /*
   * One dated copy a day, which is what makes this a backup rather than a
   * mirror: a save corrupted by a bug or a bad import is otherwise replicated
   * faithfully to every device and to the cloud, with nothing to go back to.
   */
  async function maybeSnapshot(saveId, save, today) {
    if (record().lastSnapshotDay === today) return;

    await sync.writeSnapshot(saveId, today, save);
    mark({ lastSnapshotDay: today });

    // Housekeeping only. Failing to prune leaves extra history lying around,
    // which is not a reason to report the backup itself as failed.
    try {
      const stored = await sync.listSnapshots(saveId);
      for (const day of snapshotsToPrune(stored)) await sync.deleteSnapshot(saveId, day);
    } catch (error) {
      console.warn('5BX: could not prune old snapshots.', error);
    }
  }

  /* ---------------------------------------------------------- the sync */

  async function run(today) {
    const saveId = sync.activeSaveId();
    if (!saveId) return { status: 'unpaired' };

    try {
      const remote = await sync.pull(saveId);
      if (remote) {
        applyingRemote = true;
        try {
          store.mergeIn(remote.state);
        } finally {
          applyingRemote = false;
        }
      }

      const outgoing = withoutDeviceSettings(store.getState());
      // Nothing to say if the merge left the stored copy already correct,
      // which is the common case for the second and later opens in a day.
      if (!remote || !sameSave(remote.state, outgoing)) {
        await sync.push(saveId, outgoing);
      }

      await maybeSnapshot(saveId, outgoing, today);

      lastError = null;
      mark({ lastSyncedAt: now(), pending: false });
      return { status: 'ok' };
    } catch (error) {
      lastError = error;
      mark({ pending: true });
      return { status: 'failed', error };
    }
  }

  /** Coalesces concurrent callers onto one round trip. */
  function syncNow(today = store.todayKey()) {
    if (running) return running;
    running = run(today).finally(() => {
      running = null;
    });
    watchers.forEach((watcher) => watcher(status()));
    return running;
  }

  return {
    status,
    syncNow,

    watch(watcher) {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },

    /**
     * Begin backing up from this device, and put the first copy in place
     * before returning, so the pairing link is immediately worth scanning.
     */
    async startSharing(today) {
      const saveId = sync.startSharing();
      await syncNow(today);
      return saveId;
    },

    /**
     * Adopt a save created on another device. The local save is merged rather
     * than discarded, so pairing a phone that has already been used for a few
     * workouts keeps those workouts.
     */
    async joinSave(saveId, today) {
      sync.joinSave(saveId);
      return syncNow(today);
    },

    /**
     * Put this device back to a dated snapshot, and make the cloud agree.
     *
     * A replace, not a merge: the whole point of a snapshot is to undo
     * something, and a union would faithfully restore the damage alongside
     * the good data. The live copy is overwritten directly rather than through
     * syncNow, which would merge the very state being discarded back in.
     */
    async restoreSnapshot(day) {
      const saveId = sync.activeSaveId();
      const snapshot = await sync.readSnapshot(saveId, day);

      applyingRemote = true;
      try {
        store.replaceState(snapshot.state);
      } finally {
        applyingRemote = false;
      }

      await sync.push(saveId, withoutDeviceSettings(store.getState()));
      mark({ lastSyncedAt: now(), pending: false });
    },

    listSnapshots: () => sync.listSnapshots(sync.activeSaveId()),

    /**
     * Erase the stored copy and every snapshot, then unpair this device.
     * Snapshots go first: deleting the save while its history survived would
     * leave orphaned copies that nothing can reach or clean up.
     */
    async wipeCloud() {
      const saveId = sync.activeSaveId();
      if (!saveId) return;

      for (const day of await sync.listSnapshots(saveId)) {
        await sync.deleteSnapshot(saveId, day);
      }
      await sync.deleteSave(saveId);

      sync.forgetSave(saveId);
      storage.removeItem(BACKUP_KEY);
      watchers.forEach((watcher) => watcher(status()));
    },

    /** Unpair without touching the stored copy, which other devices may share. */
    unpair() {
      const saveId = sync.activeSaveId();
      if (saveId) sync.forgetSave(saveId);
      storage.removeItem(BACKUP_KEY);
      watchers.forEach((watcher) => watcher(status()));
    },

    /**
     * Sync when the app opens, a few seconds after any change, and whenever
     * the network comes back to a device with an unsent change.
     */
    start({ addEventListener = globalThis.addEventListener } = {}) {
      // Attached even when this device is not paired yet, because pairing
      // happens from Settings while the app is running. Bailing out here would
      // leave the very first workout after "Start backing up" unsent until the
      // app was next reloaded.
      const unsubscribe = store.subscribe(() => {
        if (applyingRemote || !sync.activeSaveId()) return;
        cancel(pushTimer);
        pushTimer = schedule(() => syncNow(), PUSH_DELAY_MS);
      });

      const onOnline = () => {
        if (record().pending) syncNow();
      };
      addEventListener?.('online', onOnline);

      syncNow();

      return () => {
        unsubscribe();
        cancel(pushTimer);
      };
    },
  };
}
