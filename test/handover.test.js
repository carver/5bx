/*
 * Moving a phone's history to a new phone, end to end.
 *
 * Everything here is the real thing except the server: the real store, merge,
 * REST client, backup policy and QR encoder, driven through the actual HTTP
 * requests against an in-memory Firestore that speaks the same wire format and
 * applies the same shape rule as firestore.rules.
 *
 * The unit suites each prove one piece. This proves they are wired together,
 * which is the failure they cannot catch between them.
 *
 * A "new phone" is simulated by clearing this device's storage, which is
 * exactly what a fresh install is: default state, no pairing, no credentials.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installLocalStorage } from './helpers/env.js';

const memory = installLocalStorage();

const store = await import('../js/state.js');
const { createSyncClient, pairingLink, joinIdFromHash } = await import('../js/sync.js');
const { createBackup } = await import('../js/backup.js');
const { qrModules } = await import('../js/qr.js');

const CONFIG = { projectId: 'fivebx-test', apiKey: 'test-key' };
const APP_URL = 'https://carver.github.io/5bx/';
const DAY = 86_400_000;

/* --------------------------------------------------------- the fake server */

/** Enough of Firestore's REST API for js/sync.js to talk to. */
function fakeFirestore() {
  const documents = new Map();
  const reply = (status, body) => ({
    ok: status < 300, status, json: async () => body ?? {},
  });

  const server = async (url, init = {}) => {
    server.requests.push(`${init.method ?? 'GET'} ${url.split('/documents/')[1] ?? url}`);

    if (url.startsWith('https://identitytoolkit.')) {
      return reply(200, { idToken: 'id-1', refreshToken: 'refresh-1', expiresIn: '3600' });
    }
    if (url.startsWith('https://securetoken.')) {
      return reply(200, { id_token: 'id-2', refresh_token: 'refresh-2', expires_in: '3600' });
    }
    // Every document request must be signed in, exactly as the rules require.
    if (!init.headers?.Authorization) return reply(401);

    const [path, query] = url.split('/documents/')[1].split('?');
    const method = init.method ?? 'GET';

    if (method === 'GET' && query) {
      const prefix = `${path}/`;
      const listed = [...documents.keys()]
        .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .sort()
        .map((key) => ({ name: `projects/p/databases/(default)/documents/${key}` }));
      return reply(200, listed.length ? { documents: listed } : {});
    }

    if (method === 'GET') {
      return documents.has(path) ? reply(200, documents.get(path)) : reply(404);
    }

    if (method === 'PATCH') {
      const body = JSON.parse(init.body);
      // The shape rule firestore.rules enforces server-side.
      if (typeof body.fields?.payload?.stringValue !== 'string'
        || body.fields.payload.stringValue.length === 0) {
        return reply(403);
      }
      documents.set(path, { ...body, updateTime: new Date(server.clock).toISOString() });
      return reply(200, documents.get(path));
    }

    if (method === 'DELETE') {
      documents.delete(path);
      return reply(200);
    }
    return reply(405);
  };

  server.requests = [];
  server.clock = Date.UTC(2026, 8, 1);
  server.documents = documents;
  server.saved = (path) => JSON.parse(documents.get(path).fields.payload.stringValue);
  return server;
}

/* ------------------------------------------------------------ the devices */

function deviceOn(server) {
  const sync = createSyncClient({
    config: CONFIG, fetch: server, storage: globalThis.localStorage,
  });
  return { sync, backup: createBackup({ store, sync, storage: globalThis.localStorage }) };
}

/** Wipes this device: fresh install, nothing paired, no credentials. */
function newPhone() {
  memory.clear();
  store.resetAll();
}

function workoutsOn(days) {
  for (const daysAgo of days) {
    const when = Date.now() - daysAgo * DAY;
    store.getSessions().push({
      ts: when,
      date: store.todayKey(new Date(when)),
      chartId: store.getProgress().chartId,
      levelIndex: store.getProgress().levelIndex,
      results: [true, true, true, true, true],
      completed: true,
    });
  }
}

beforeEach(() => {
  newPhone();
});

/* ------------------------------------------------------------------ tests */

describe('moving to a new phone', () => {
  test('the whole history arrives, and the old phone is not needed again', async () => {
    const server = fakeFirestore();

    // The old phone: a few months of workouts and a level earned along the way.
    const old = deviceOn(server);
    workoutsOn([40, 39, 38, 12, 11, 10, 2, 1]);
    store.setPosition(2, 3, 'advance');
    store.updateSettings({ age: 45 });
    const saveId = await old.backup.startSharing('2026-09-01');

    const link = pairingLink(APP_URL, saveId);

    // The new phone scans the code. Nothing carries over but the link.
    newPhone();
    const fresh = deviceOn(server);
    assert.equal(store.getSessions().length, 0, 'the new phone really is empty');

    fresh.sync.joinSave(joinIdFromHash(new URL(link).hash));
    const result = await fresh.backup.syncNow('2026-09-01');

    assert.equal(result.status, 'ok');
    assert.equal(store.getSessions().length, 8, 'every workout came across');
    assert.deepEqual(store.getProgress(), { chartId: 2, levelIndex: 3, levelStartedTs: store.getProgress().levelStartedTs });
    assert.equal(store.getSettings().age, 45);
    assert.equal(store.currentStreak(), 2, 'the streak survives the move');
  });

  test('the pairing link fits in a QR code a camera can read', () => {
    const link = pairingLink(APP_URL, '0189ff2c-7b3a-4d5e-9f61-2c8ad4e70b13');
    const modules = qrModules(link);

    // A link too long to encode would be a failure discovered only in the
    // field, by someone standing there with a camera pointed at nothing.
    assert.ok(modules.length <= 57, `version ${(modules.length - 17) / 4} is legible on a phone`);
  });

  test('a new phone that was already used keeps its own workouts too', async () => {
    const server = fakeFirestore();

    const old = deviceOn(server);
    workoutsOn([9, 8, 7]);
    const saveId = await old.backup.startSharing('2026-09-01');

    // Someone who tried the app on the new phone before thinking to pair it.
    newPhone();
    const fresh = deviceOn(server);
    workoutsOn([2, 1]);

    fresh.sync.joinSave(saveId);
    await fresh.backup.syncNow('2026-09-01');

    assert.equal(store.getSessions().length, 5, 'both sides survive the join');
  });

  test('a level earned months ago is not reset by a phone unboxed today', async () => {
    const server = fakeFirestore();

    const old = deviceOn(server);
    store.setPosition(4, 2, 'advance');
    workoutsOn([30, 29, 28]);
    const saveId = await old.backup.startSharing('2026-09-01');

    newPhone();
    const fresh = deviceOn(server);
    // The fresh save is Chart 1 D- stamped with today, which is *newer* than
    // the real position. Any "most recent wins" rule loses the history here.
    assert.deepEqual(
      [store.getProgress().chartId, store.getProgress().levelIndex], [1, 0]);

    fresh.sync.joinSave(saveId);
    await fresh.backup.syncNow('2026-09-01');

    assert.equal(store.getProgress().chartId, 4);
    assert.equal(store.getProgress().levelIndex, 2);
  });
});

describe('both phones in use', () => {
  test('workouts done on either phone end up on both', async () => {
    const server = fakeFirestore();

    const first = deviceOn(server);
    const saveId = await first.backup.startSharing('2026-09-01');
    workoutsOn([5]);
    await first.backup.syncNow('2026-09-01');

    newPhone();
    const second = deviceOn(server);
    second.sync.joinSave(saveId);
    await second.backup.syncNow('2026-09-01');
    workoutsOn([1]);
    await second.backup.syncNow('2026-09-02');

    assert.equal(store.getSessions().length, 2);
    assert.equal(server.saved(`saves/${saveId}`).sessions.length, 2);
  });

  test('a phone left in a drawer for months cannot erase what it missed', async () => {
    const server = fakeFirestore();

    const stale = deviceOn(server);
    const saveId = await stale.backup.startSharing('2026-05-01');
    workoutsOn([120]);
    await stale.backup.syncNow('2026-05-01');
    const staleState = JSON.parse(JSON.stringify(store.getState()));

    // Months of workouts on the other phone in the meantime.
    newPhone();
    const active = deviceOn(server);
    active.sync.joinSave(saveId);
    await active.backup.syncNow('2026-09-01');
    workoutsOn([30, 20, 10, 3]);
    await active.backup.syncNow('2026-09-01');
    assert.equal(server.saved(`saves/${saveId}`).sessions.length, 5);

    // Now the old phone is switched on and syncs.
    memory.clear();
    store.replaceState(staleState);
    const woken = deviceOn(server);
    woken.sync.joinSave(saveId);
    await woken.backup.syncNow('2026-09-02');

    // Last-write-wins would leave one session here. This is the whole reason
    // the merge exists.
    assert.equal(server.saved(`saves/${saveId}`).sessions.length, 5);
    assert.equal(store.getSessions().length, 5);
  });
});

describe('going back to an earlier day', () => {
  test('clearing this phone by accident heals itself on the next sync', async () => {
    const server = fakeFirestore();

    const phone = deviceOn(server);
    workoutsOn([10, 9, 8]);
    const saveId = await phone.backup.startSharing('2026-08-20');

    store.replaceState({ ...store.getState(), sessions: [] });
    await phone.backup.syncNow('2026-08-21');

    // A union can only add, so losing data locally cannot propagate at all.
    // Snapshots exist for the other kind of damage, below.
    assert.equal(store.getSessions().length, 3);
    assert.equal(server.saved(`saves/${saveId}`).sessions.length, 3);
  });

  test('undoes a bad import that a sync would otherwise have copied everywhere', async () => {
    const server = fakeFirestore();

    const phone = deviceOn(server);
    workoutsOn([10, 9, 8]);
    const saveId = await phone.backup.startSharing('2026-08-20');
    assert.deepEqual(await phone.backup.listSnapshots(), ['2026-08-20'],
      'the day\'s snapshot holds the three real sessions');

    // Importing someone else's backup file. Added sessions are exactly the
    // damage a merge cannot protect against, because a merge only ever adds.
    const junk = Array.from({ length: 40 }, (_, i) => ({
      ts: Date.UTC(2020, 0, 1) + i * DAY,
      date: '2020-01-01',
      chartId: 6,
      levelIndex: 11,
      results: [true, true, true, true, true],
      completed: true,
    }));
    store.replaceState({ ...store.getState(), sessions: [...store.getSessions(), ...junk] });
    await phone.backup.syncNow('2026-08-21');
    assert.equal(server.saved(`saves/${saveId}`).sessions.length, 43,
      'the cloud faithfully copied the damage, which is why snapshots exist');

    await phone.backup.restoreSnapshot('2026-08-20');

    assert.equal(store.getSessions().length, 3);
    assert.equal(server.saved(`saves/${saveId}`).sessions.length, 3);

    // And it stays undone rather than being merged back on the next sync.
    await phone.backup.syncNow('2026-08-21');
    assert.equal(store.getSessions().length, 3);
  });
});

describe('the wire format', () => {
  test('a save is written as one document, not one per session', async () => {
    const server = fakeFirestore();
    const phone = deviceOn(server);
    const saveId = await phone.backup.startSharing('2026-09-01');
    workoutsOn([3, 2, 1]);
    await phone.backup.syncNow('2026-09-01');

    assert.deepEqual(
      [...server.documents.keys()].sort(),
      [`saves/${saveId}`, `saves/${saveId}/days/2026-09-01`],
    );
  });

  test('signing in happens once, not once per request', async () => {
    const server = fakeFirestore();
    const phone = deviceOn(server);
    await phone.backup.startSharing('2026-09-01');
    await phone.backup.syncNow('2026-09-02');
    await phone.backup.syncNow('2026-09-03');

    const signIns = server.requests.filter((r) => r.includes('identitytoolkit')).length;
    assert.equal(signIns, 1, `signed in ${signIns} times`);
  });

  test('the server rejects a document the rules would reject', async () => {
    const server = fakeFirestore();
    const phone = deviceOn(server);
    const saveId = phone.sync.startSharing();

    await assert.rejects(
      () => phone.sync.push(saveId, { ...store.getState(), toJSON: undefined }).then(
        () => server(`https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}`
          + `/databases/(default)/documents/saves/${saveId}`,
        { method: 'PATCH', headers: { Authorization: 'Bearer x' }, body: '{"fields":{}}' })
          .then((r) => { if (!r.ok) throw new Error('denied'); }),
      ),
      /denied/,
    );
  });
});
