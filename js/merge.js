/*
 * Reconciling two copies of the save, from this device and from the cloud.
 *
 * Almost everything worth keeping here is an append-only log. Every session
 * you have ever done, every level change. So the merge is a union rather than
 * a choice between two whole saves. That matters: last-write-wins on the whole
 * document would let a phone that has been sitting in a drawer overwrite weeks
 * of sessions the moment it comes back online, which is exactly the loss this
 * feature exists to prevent.
 *
 * The union is deliberately commutative, associative, and idempotent, which is
 * what lets devices sync in any order, any number of times, and still converge.
 * test/merge.test.js asserts all three.
 *
 * Pure: no storage, no network, no clock.
 */

/*
 * Settings that describe the phone in your hand rather than the person holding
 * it, and so never travel. Syncing the reminder switch would have a new phone
 * silently promise notifications it has no OS permission for; syncing the theme
 * would let a tablet in a bright room dictate what a phone in bed looks like.
 */
export const DEVICE_LOCAL_SETTINGS = ['reminderEnabled', 'theme'];

export function isSaveShaped(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;

  const { settings, progress, sessions, levelLog } = value;
  return isPlainObject(settings)
    && isPlainObject(progress)
    && Number.isFinite(progress.chartId)
    && Number.isFinite(progress.levelIndex)
    && Number.isFinite(progress.levelStartedTs)
    && Array.isArray(sessions)
    && Array.isArray(levelLog)
    && levelLog.length > 0;
}

/**
 * A copy of the save with the device-local settings removed.
 *
 * Used on the way out, so those settings do not merely lose the merge. They
 * never leave the phone at all, and the stored copy is the same whichever
 * device wrote it.
 */
export function withoutDeviceSettings(save) {
  const settings = { ...save.settings };
  for (const key of DEVICE_LOCAL_SETTINGS) delete settings[key];
  return { ...save, settings };
}

/**
 * Whether two saves hold the same data.
 *
 * Compared by content rather than by JSON text: a merge rebuilds the save from
 * both sides, so the key order can differ between two saves that are otherwise
 * identical, and a plain stringify comparison would report a change that isn't
 * one, and then spend a network write announcing it.
 */
export function sameSave(a, b) {
  return canonicalDeep(a) === canonicalDeep(b);
}

function canonicalDeep(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalDeep).join(',')}]`;
  if (!isPlainObject(value)) return JSON.stringify(value) ?? 'null';
  return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalDeep(value[key])}`).join(',')}}`;
}

/**
 * Combine this device's save with another copy of it.
 *
 * @param {object} local  this device's save; wins on device-local settings
 * @param {object} remote the other copy
 * @returns {object} a new save; neither input is modified
 */
export function mergeSaves(local, remote) {
  const levelLog = mergeLevelLog(local.levelLog, remote.levelLog);

  return {
    ...local,
    ...remote,
    version: Math.max(local.version ?? 1, remote.version ?? 1),
    settings: mergeSettings(local.settings, remote.settings),
    sessions: union([...local.sessions, ...remote.sessions]),
    levelLog,
    progress: positionFrom(levelLog),
  };
}

/*
 * The current position is derived rather than merged, because the level log
 * already records it: every move writes an entry stamped with the same instant
 * it sets as `levelStartedTs`, so the last entry *is* the current position.
 *
 * Deriving it is what keeps a newly installed phone from winning. Its default
 * position is Chart 1 D- stamped with today, which is newer than a position
 * earned months ago and would take precedence under any "most recent wins"
 * rule. As a log entry it is just an origin marker, and collapseStarts drops it.
 */
function positionFrom(levelLog) {
  const { chartId, levelIndex, ts } = levelLog[levelLog.length - 1];
  return { chartId, levelIndex, levelStartedTs: ts };
}

function mergeSettings(local, remote) {
  const newer = (remote.updatedAt ?? 0) > (local.updatedAt ?? 0) ? remote : local;
  const merged = { ...newer };
  for (const key of DEVICE_LOCAL_SETTINGS) merged[key] = local[key];
  return merged;
}

/*
 * The level log is an origin plus a list of changes, not a flat list of equals.
 *
 * Every device writes its own `start` entry the first time it opens the app, so
 * a union of two devices carries two origins, and the later one reads as a jump
 * back to Chart 1 partway through the history. Only the earliest is kept.
 *
 * Splitting the origin out before the union, rather than filtering duplicates
 * afterwards, is what makes the merge associative: a discarded origin sharing a
 * timestamp with a real level change must not take that change down with it.
 */
function mergeLevelLog(mine, theirs) {
  const all = [...mine, ...theirs];
  const origins = all.filter(isOrigin);
  const changes = union(all.filter((entry) => !isOrigin(entry)));
  if (!origins.length) return changes;

  return [union(origins)[0], ...changes]
    // An origin and a change stamped with the same instant both survive, with
    // the origin first, so the position still comes from the change.
    .sort((a, b) => a.ts - b.ts || (isOrigin(b) ? 1 : 0) - (isOrigin(a) ? 1 : 0));
}

function isOrigin(entry) {
  return entry.reason === 'start';
}

/*
 * Entries are identified by the millisecond they were recorded, so the same
 * session arriving from both devices collapses to one. Two *different* entries
 * sharing a timestamp would mean one person finishing two workouts in the same
 * millisecond; it cannot happen, but the tie is still broken by content rather
 * than by argument order, since a merge that disagreed with itself depending on
 * which side was called "local" would never converge.
 */
function union(entries) {
  const byTimestamp = new Map();
  for (const entry of entries) {
    const existing = byTimestamp.get(entry.ts);
    if (!existing || canonical(entry) < canonical(existing)) {
      byTimestamp.set(entry.ts, entry);
    }
  }
  return [...byTimestamp.values()].sort((a, b) => a.ts - b.ts);
}

/** Key order can differ between two copies of the same entry; this ignores it. */
function canonical(entry) {
  return JSON.stringify(entry, Object.keys(entry).sort());
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
