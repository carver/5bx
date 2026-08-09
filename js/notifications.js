/*
 * Daily local reminder.
 *
 * PLATFORM CAVEAT — read before filing a bug against this file:
 * There is no reliable, universally supported way for a web app to schedule a
 * future notification on Android. What we do, best-available-first:
 *
 *   1. Notification Triggers (`TimestampTrigger`) — genuinely scheduled by the
 *      OS, fires even with the browser closed. Only available behind a flag /
 *      origin trial in Chrome, so it is feature-detected, not relied upon.
 *   2. Periodic Background Sync — the service worker gets woken roughly daily
 *      (installed PWAs only, and Chrome decides the cadence based on how often
 *      you actually use the app). We check "is the reminder due today?" on each
 *      wake-up.
 *   3. An in-page setTimeout — exact, but only while the tab is alive.
 *
 * Consequence: if the browser is fully closed for a long stretch and neither
 * (1) nor (2) is available, the reminder can be late or skipped. That is an
 * Android battery/background-execution restriction, not a bug in this code.
 *
 * Reminder settings are mirrored into a Cache entry rather than localStorage
 * because a service worker cannot read localStorage, and the Cache API is one
 * of the few stores available in both contexts. It is used here as a plain
 * key/value store holding a single JSON blob.
 */

import { todayKey } from './state.js';

const KV_CACHE = '5bx-kv';
const KV_KEY = new URL('reminder-settings.json', document.baseURI).href;
const PERIODIC_TAG = '5bx-daily-reminder';

let pageTimer = null;

/* ------------------------------------------------------------- shared KV */

async function writeReminderKV(data) {
  if (!('caches' in window)) return;
  try {
    const cache = await caches.open(KV_CACHE);
    await cache.put(KV_KEY, new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch (err) {
    console.warn('5BX: could not persist reminder settings.', err);
  }
}

async function readReminderKV() {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(KV_CACHE);
    const res = await cache.match(KV_KEY);
    return res ? res.json() : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- permission */

export function notificationsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

export function permissionState() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/**
 * Ask for permission. The caller is responsible for explaining *why* before
 * calling this — the browser prompt itself gives no context, and a cold
 * prompt is the fastest way to get permanently blocked.
 */
export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/* --------------------------------------------------------------- schedule */

/** Next occurrence of local "HH:MM" as a Date, always in the future. */
export function nextOccurrence(timeString, from = new Date()) {
  const [hours, minutes] = timeString.split(':').map(Number);
  const next = new Date(from);
  next.setHours(hours, minutes, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next;
}

/**
 * Bring all reminder mechanisms in line with the current settings. Safe to
 * call on every settings change and on every app start.
 */
export async function syncReminder(settings) {
  clearTimeout(pageTimer);
  pageTimer = null;

  const enabled = settings.reminderEnabled &&
    permissionState() === 'granted';

  await writeReminderKV({
    enabled,
    time: settings.reminderTime,
    lastNotified: (await readReminderKV())?.lastNotified || null,
  });

  const registration = await navigator.serviceWorker?.ready.catch(() => null);
  if (!registration) return;

  await syncPeriodicBackgroundSync(registration, enabled);
  await syncTriggeredNotification(registration, settings, enabled);

  if (enabled) schedulePageTimeout(registration, settings);
}

async function syncPeriodicBackgroundSync(registration, enabled) {
  if (!('periodicSync' in registration)) return;
  try {
    if (enabled) {
      // minInterval is a hint; Chrome throttles by site engagement.
      await registration.periodicSync.register(PERIODIC_TAG, {
        minInterval: 12 * 60 * 60 * 1000,
      });
    } else {
      await registration.periodicSync.unregister(PERIODIC_TAG);
    }
  } catch { /* requires an installed PWA and granted permission */ }
}

async function syncTriggeredNotification(registration, settings, enabled) {
  if (!('TimestampTrigger' in window)) return;
  try {
    // Clear any previously scheduled reminder before (re)scheduling.
    const scheduled = await registration.getNotifications({
      includeTriggered: true, tag: PERIODIC_TAG,
    });
    scheduled.forEach((n) => n.close());

    if (!enabled) return;
    await registration.showNotification('Time for your 5BX', {
      tag: PERIODIC_TAG,
      body: '11 minutes. Five exercises.',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      showTrigger: new TimestampTrigger(
        nextOccurrence(settings.reminderTime).getTime()),
    });
  } catch { /* unsupported — the other mechanisms still apply */ }
}

function schedulePageTimeout(registration, settings) {
  const due = nextOccurrence(settings.reminderTime);
  const delay = due.getTime() - Date.now();
  pageTimer = setTimeout(async () => {
    const kv = await readReminderKV();
    // Must be the local calendar day, not UTC — this key is shared with
    // sw.js's periodicsync handler, which dedupes on the local date. A UTC
    // date here would drift from the local one for part of the day in most
    // timezones, and the two mechanisms would disagree about whether
    // today's reminder already fired, producing a second notification.
    const key = todayKey(due);
    if (kv?.enabled && kv.lastNotified !== key) {
      await registration.showNotification('Time for your 5BX', {
        body: '11 minutes. Five exercises.',
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: '5bx-reminder-fired',
      });
      await writeReminderKV({ ...kv, lastNotified: key });
    }
    schedulePageTimeout(registration, settings); // roll to tomorrow
  }, delay);
}

/** One-off test notification so the user can confirm it works end to end. */
export async function sendTestNotification() {
  const registration = await navigator.serviceWorker?.ready.catch(() => null);
  if (!registration) return false;
  await registration.showNotification('5BX reminder test', {
    body: 'This is what your daily reminder will look like.',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: '5bx-test',
  });
  return true;
}
