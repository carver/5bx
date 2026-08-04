/*
 * Persistent state: settings, current position, session log, level history.
 * Backed by localStorage. All reads/writes go through here so the shape of
 * the stored blob is defined in exactly one place.
 */

import { levelName, minDaysForAge, nextPosition } from './config.js';

const STORAGE_KEY = '5bx-state-v1';

/** Local (not UTC) calendar date as YYYY-MM-DD. */
export function todayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultState() {
  const now = Date.now();
  return {
    version: 1,
    settings: {
      age: null,              // null until entered in Settings
      minDaysOverride: null,  // null => derive from age table
      reminderEnabled: false,
      reminderTime: '07:00',  // local HH:MM
      theme: 'system',        // 'system' | 'light' | 'dark'
    },
    progress: {
      chartId: 1,
      levelIndex: 0,
      // Sessions logged at/after this timestamp count toward days-at-level.
      levelStartedTs: now,
    },
    // Every session ever, newest last.
    // { ts, date, chartId, levelIndex, results: [bool x5], completed }
    sessions: [],
    // Level changes, newest last. { ts, date, chartId, levelIndex, reason }
    levelLog: [
      { ts: now, date: todayKey(), chartId: 1, levelIndex: 0, reason: 'start' },
    ],
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // Shallow-merge against defaults so added fields don't break old saves.
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings || {}) },
      progress: { ...base.progress, ...(parsed.progress || {}) },
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      levelLog: Array.isArray(parsed.levelLog) && parsed.levelLog.length
        ? parsed.levelLog
        : base.levelLog,
    };
  } catch (err) {
    console.warn('5BX: could not read saved state, starting fresh.', err);
    return defaultState();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('5BX: could not save state.', err);
  }
  listeners.forEach((fn) => fn(state));
}

/* -------------------------------------------------------------------------
 * Subscriptions
 * ---------------------------------------------------------------------- */

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* -------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------- */

export function getState() {
  return state;
}

export function getSettings() {
  return state.settings;
}

export function getProgress() {
  return state.progress;
}

export function getSessions() {
  return state.sessions;
}

export function getLevelLog() {
  return state.levelLog;
}

/** Required days at the current level: explicit override, else age table. */
export function requiredDays() {
  const { minDaysOverride, age } = state.settings;
  if (Number.isFinite(minDaysOverride) && minDaysOverride > 0) {
    return minDaysOverride;
  }
  return minDaysForAge(age);
}

/**
 * Distinct calendar dates on which a session was logged since arriving at the
 * current level. Multiple sessions in one day count once; partial sessions
 * count too (the spec counts days spent at the level, not perfect days).
 *
 * Strictly after `levelStartedTs`, not at-or-after: the session that earns an
 * advance was performed at the *old* level and must not seed the new one.
 */
export function daysAtLevel() {
  const since = state.progress.levelStartedTs;
  const dates = new Set(
    state.sessions.filter((s) => s.ts > since).map((s) => s.date),
  );
  return dates.size;
}

/** Consecutive days with at least one session, counting back from today. */
export function currentStreak() {
  const dates = new Set(state.sessions.map((s) => s.date));
  if (!dates.size) return 0;

  const cursor = new Date();
  // A streak survives "haven't worked out yet today" — start from yesterday
  // if today is empty, but return 0 if yesterday is empty too.
  if (!dates.has(todayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!dates.has(todayKey(cursor))) return 0;
  }
  let streak = 0;
  while (dates.has(todayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Days since the most recent session, or null if there are none. */
export function daysSinceLastSession() {
  const last = state.sessions[state.sessions.length - 1];
  if (!last) return null;
  const ms = Date.now() - last.ts;
  return Math.floor(ms / 86400000);
}

/** True when a fully-completed session would unlock the next level. */
export function canAdvance() {
  return daysAtLevel() >= requiredDays() &&
    nextPosition(state.progress.chartId, state.progress.levelIndex) !== null;
}

/* -------------------------------------------------------------------------
 * Writes
 * ---------------------------------------------------------------------- */

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  save();
}

/**
 * Log a finished session. `results` is a 5-element boolean array of the
 * per-exercise "did you hit the target?" answers. A session is fully
 * completed only when every answer is true.
 */
export function logSession(results) {
  const now = new Date();
  const session = {
    ts: now.getTime(),
    date: todayKey(now),
    chartId: state.progress.chartId,
    levelIndex: state.progress.levelIndex,
    results: results.slice(),
    completed: results.every(Boolean),
  };
  state.sessions.push(session);
  save();
  return session;
}

/** Move to a specific chart+level and restart the days-at-level counter. */
export function setPosition(chartId, levelIndex, reason = 'manual') {
  const now = Date.now();
  state.progress = { chartId, levelIndex, levelStartedTs: now };
  state.levelLog.push({
    ts: now, date: todayKey(), chartId, levelIndex, reason,
  });
  save();
}

/** Advance one level (or to the next chart's D-). No-op at chart 6 A+. */
export function advanceLevel() {
  const next = nextPosition(state.progress.chartId, state.progress.levelIndex);
  if (!next) return null;
  setPosition(next.chartId, next.levelIndex, 'advance');
  return next;
}

export function replaceState(incoming) {
  state = { ...defaultState(), ...incoming };
  save();
}

export function resetAll() {
  state = defaultState();
  save();
}

/* -------------------------------------------------------------------------
 * Formatting helpers used across views
 * ---------------------------------------------------------------------- */

export function positionLabel(chartId = state.progress.chartId,
                              levelIndex = state.progress.levelIndex) {
  return `Chart ${chartId} · ${levelName(levelIndex)}`;
}
