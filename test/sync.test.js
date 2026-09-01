/*
 * The Firestore REST client.
 *
 * There is no emulator here and no network: `fetch` is injected, so what gets
 * asserted is the thing that actually breaks in a hand-rolled API client —
 * the exact shape of each request, and the token handling around it. The
 * responses are the ones the real endpoints return, including the two Google
 * services that disagree about camelCase.
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createSyncClient, pairingLink, joinIdFromHash, snapshotsToPrune, SyncError, SNAPSHOTS_KEPT,
} from '../js/sync.js';

const CONFIG = { projectId: 'fivebx-test', apiKey: 'test-api-key' };
const SAVE_ID = '0189ff2c-7b3a-4d5e-9f61-2c8ad4e70b13';
const DOCUMENTS = `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}`
  + '/databases/(default)/documents';

const SAVE = {
  version: 1,
  settings: { age: 45, updatedAt: 1000, theme: 'system', reminderEnabled: false },
  progress: { chartId: 2, levelIndex: 3, levelStartedTs: 500 },
  sessions: [{ ts: 900, date: '2026-01-01', chartId: 2, levelIndex: 3, results: [], completed: true }],
  levelLog: [{ ts: 500, date: '2026-01-01', chartId: 2, levelIndex: 3, reason: 'start' }],
};

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

/** Records every call, and answers from `route`. */
function stubFetch(route) {
  const calls = [];
  const doFetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', init, body: init.body && JSON.parse(init.body) });
    const { status = 200, json = {}, throws } = route(url, init, calls.length) ?? {};
    if (throws) throw throws;
    return { ok: status >= 200 && status < 300, status, json: async () => json };
  };
  doFetch.calls = calls;
  return doFetch;
}

const SIGN_UP = { idToken: 'id-1', refreshToken: 'refresh-1', expiresIn: '3600' };

/** Answers sign-in, then hands everything else to `rest`. */
function withAuth(rest) {
  return (url, init, callNumber) => {
    if (url.startsWith('https://identitytoolkit.')) return { json: SIGN_UP };
    if (url.startsWith('https://securetoken.')) {
      return { json: { id_token: 'id-2', refresh_token: 'refresh-2', expires_in: '3600' } };
    }
    return rest(url, init, callNumber);
  };
}

const documentFor = (state, updateTime = '2026-09-01T10:00:00.000000Z') => ({
  name: `projects/${CONFIG.projectId}/databases/(default)/documents/saves/${SAVE_ID}`,
  fields: { payload: { stringValue: JSON.stringify(state) }, schema: { integerValue: '1' } },
  updateTime,
});

function client(route, { storage = memoryStorage(), now = () => 1_000_000 } = {}) {
  const doFetch = stubFetch(route);
  return {
    sync: createSyncClient({ config: CONFIG, fetch: doFetch, storage, now, newId: () => SAVE_ID }),
    doFetch,
    storage,
  };
}

/* ------------------------------------------------------------------ pure */

describe('pairing links', () => {
  test('keeps the app\'s own path, so a Pages subpath still works', () => {
    assert.equal(
      pairingLink('https://carver.github.io/5bx/', SAVE_ID),
      `https://carver.github.io/5bx/#join/${SAVE_ID}`,
    );
  });

  test('replaces any hash already on the page', () => {
    assert.equal(
      pairingLink('https://carver.github.io/5bx/#join/old', SAVE_ID),
      `https://carver.github.io/5bx/#join/${SAVE_ID}`,
    );
  });

  test('round-trips through the hash reader', () => {
    assert.equal(joinIdFromHash(new URL(pairingLink('https://x.test/', SAVE_ID)).hash), SAVE_ID);
  });

  for (const [label, hash] of [
    ['no hash at all', ''],
    ['a hash that is not a join link', '#settings'],
    ['a join link with no ID', '#join/'],
    ['an ID that is not a UUID', '#join/not-a-uuid'],
    ['a path smuggled into the ID', '#join/../../other'],
    ['a truncated UUID', '#join/0189ff2c-7b3a-4d5e-9f61-2c8ad4e70b1'],
  ]) {
    test(`rejects ${label}`, () => {
      assert.equal(joinIdFromHash(hash), null);
    });
  }
});

describe('snapshot pruning', () => {
  const dates = (count, from = 1) =>
    Array.from({ length: count }, (_, i) => `2026-01-${String(from + i).padStart(2, '0')}`);

  test('keeps everything while under the limit', () => {
    assert.deepEqual(snapshotsToPrune(dates(SNAPSHOTS_KEPT)), []);
  });

  test('drops the oldest once over', () => {
    assert.deepEqual(snapshotsToPrune(dates(SNAPSHOTS_KEPT + 3)), ['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  test('sorts by date rather than trusting the order it was given', () => {
    const shuffled = ['2026-03-05', '2026-01-09', '2026-02-01'];
    assert.deepEqual(snapshotsToPrune(shuffled, 1), ['2026-01-09', '2026-02-01']);
  });
});

/* -------------------------------------------------------------------- auth */

describe('signing in', () => {
  test('signs in anonymously and sends the token as a bearer', async () => {
    const { sync, doFetch } = client(withAuth(() => ({ json: documentFor(SAVE) })));
    await sync.pull(SAVE_ID);

    const [signIn, read] = doFetch.calls;
    assert.equal(signIn.url,
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${CONFIG.apiKey}`);
    assert.deepEqual(signIn.body, { returnSecureToken: true });
    assert.equal(read.init.headers.Authorization, 'Bearer id-1');
  });

  test('reuses a cached token instead of creating a new anonymous user', async () => {
    const storage = memoryStorage();
    const route = withAuth(() => ({ json: documentFor(SAVE) }));

    const first = client(route, { storage });
    await first.sync.pull(SAVE_ID);
    const second = client(route, { storage });
    await second.sync.pull(SAVE_ID);

    assert.equal(second.doFetch.calls.filter((c) => c.url.includes('identitytoolkit')).length, 0);
    assert.equal(second.doFetch.calls[0].init.headers.Authorization, 'Bearer id-1');
  });

  test('refreshes rather than re-registering once the token is near expiry', async () => {
    const storage = memoryStorage();
    const route = withAuth(() => ({ json: documentFor(SAVE) }));

    await client(route, { storage, now: () => 1_000_000 }).sync.pull(SAVE_ID);
    // An hour on: the cached token is inside the renewal margin.
    const later = client(route, { storage, now: () => 1_000_000 + 3_600_000 });
    await later.sync.pull(SAVE_ID);

    const [refresh, read] = later.doFetch.calls;
    assert.equal(refresh.url, `https://securetoken.googleapis.com/v1/token?key=${CONFIG.apiKey}`);
    assert.deepEqual(refresh.body, { grant_type: 'refresh_token', refresh_token: 'refresh-1' });
    // The refresh endpoint answers in snake_case; reading it as camelCase would
    // store `undefined` and silently sign out on the next call.
    assert.equal(read.init.headers.Authorization, 'Bearer id-2');
  });

  test('retries once with a fresh token when the server rejects the old one', async () => {
    let reads = 0;
    const { sync, doFetch } = client(withAuth(() => {
      reads += 1;
      return reads === 1 ? { status: 401 } : { json: documentFor(SAVE) };
    }));

    const result = await sync.pull(SAVE_ID);

    assert.deepEqual(result.state, SAVE);
    const documentReads = doFetch.calls.filter((c) => c.url.startsWith(DOCUMENTS));
    assert.equal(documentReads.length, 2, 'exactly one retry');
    // Renewed through the refresh token rather than by registering a second
    // anonymous user, and the retry carries the new token, not the rejected one.
    assert.equal(documentReads[0].init.headers.Authorization, 'Bearer id-1');
    assert.equal(documentReads[1].init.headers.Authorization, 'Bearer id-2');
  });

  test('gives up rather than looping when the retry is rejected too', async () => {
    const { sync, doFetch } = client(withAuth(() => ({ status: 401 })));

    await assert.rejects(() => sync.pull(SAVE_ID), (error) => {
      assert.ok(error instanceof SyncError);
      assert.equal(error.kind, 'server');
      return true;
    });
    assert.equal(doFetch.calls.filter((c) => c.url.startsWith(DOCUMENTS)).length, 2);
  });

  test('reports a rejected sign-in as an auth failure', async () => {
    const { sync } = client(() => ({ status: 400, json: { error: { message: 'API key not valid' } } }));
    await assert.rejects(() => sync.pull(SAVE_ID), { kind: 'auth' });
  });
});

/* --------------------------------------------------------------- documents */

describe('reading a save', () => {
  test('asks for the right document and returns its contents', async () => {
    const { sync, doFetch } = client(withAuth(() => ({ json: documentFor(SAVE) })));
    const result = await sync.pull(SAVE_ID);

    assert.equal(doFetch.calls[1].url, `${DOCUMENTS}/saves/${SAVE_ID}`);
    assert.deepEqual(result.state, SAVE);
  });

  test('reports when the save was last written, from the server\'s own record', async () => {
    const { sync } = client(withAuth(() => ({ json: documentFor(SAVE, '2026-08-30T07:00:00Z') })));
    // Not either device's clock: a phone with the wrong date must not be able
    // to make a stale backup look current.
    assert.equal((await sync.pull(SAVE_ID)).updatedAt, '2026-08-30T07:00:00Z');
  });

  test('is empty rather than an error when nothing has been backed up yet', async () => {
    const { sync } = client(withAuth(() => ({ status: 404 })));
    assert.equal(await sync.pull(SAVE_ID), null);
  });

  for (const [label, json] of [
    ['a document with no payload field', { fields: {} }],
    ['a payload that is not JSON', { fields: { payload: { stringValue: '{oops' } } }],
    ['JSON that is not a save', { fields: { payload: { stringValue: '{"hello":true}' } } }],
    ['a save missing its level log', {
      fields: { payload: { stringValue: JSON.stringify({ ...SAVE, levelLog: [] }) } },
    }],
  ]) {
    test(`refuses ${label} instead of handing it to the merge`, async () => {
      const { sync } = client(withAuth(() => ({ json })));
      await assert.rejects(() => sync.pull(SAVE_ID), { kind: 'malformed' });
    });
  }
});

describe('writing a save', () => {
  test('sends the whole save as one JSON string field', async () => {
    const { sync, doFetch } = client(withAuth(() => ({ json: {} })));
    await sync.push(SAVE_ID, SAVE);

    const write = doFetch.calls[1];
    assert.equal(write.method, 'PATCH');
    assert.equal(write.url, `${DOCUMENTS}/saves/${SAVE_ID}`);
    assert.deepEqual(JSON.parse(write.body.fields.payload.stringValue), SAVE);
    assert.equal(write.body.fields.schema.integerValue, '1');
  });

  test('writes a snapshot into the save\'s own dated subcollection', async () => {
    const { sync, doFetch } = client(withAuth(() => ({ json: {} })));
    await sync.writeSnapshot(SAVE_ID, '2026-09-01', SAVE);

    assert.equal(doFetch.calls[1].url, `${DOCUMENTS}/saves/${SAVE_ID}/days/2026-09-01`);
    assert.equal(doFetch.calls[1].method, 'PATCH');
  });

  test('erases the stored save on request', async () => {
    const { sync, doFetch } = client(withAuth(() => ({ json: {} })));
    await sync.deleteSave(SAVE_ID);

    assert.equal(doFetch.calls[1].method, 'DELETE');
    assert.equal(doFetch.calls[1].url, `${DOCUMENTS}/saves/${SAVE_ID}`);
  });

  test('refuses a save too large for a Firestore document', async () => {
    const huge = { ...SAVE, sessions: Array.from({ length: 40_000 }, (_, i) => ({ ...SAVE.sessions[0], ts: i })) };
    const { sync, doFetch } = client(withAuth(() => ({ json: {} })));

    await assert.rejects(() => sync.push(SAVE_ID, huge), { kind: 'tooLarge' });
    assert.equal(doFetch.calls.filter((c) => c.method === 'PATCH').length, 0,
      'rejected before spending a request on a write that cannot succeed');
  });
});

describe('snapshots', () => {
  test('lists only the dates, not a month of full saves', async () => {
    const { sync, doFetch } = client(withAuth(() => ({
      json: {
        documents: ['2026-08-31', '2026-09-01', '2026-08-30'].map((day) => ({
          name: `projects/p/databases/(default)/documents/saves/${SAVE_ID}/days/${day}`,
        })),
      },
    })));

    assert.deepEqual(await sync.listSnapshots(SAVE_ID), ['2026-08-30', '2026-08-31', '2026-09-01']);
    assert.match(doFetch.calls[1].url, /mask\.fieldPaths=schema/);
  });

  test('has no snapshots to list before the first backup', async () => {
    const { sync } = client(withAuth(() => ({ json: {} })));
    assert.deepEqual(await sync.listSnapshots(SAVE_ID), []);
  });

  test('reads one back in full', async () => {
    const { sync, doFetch } = client(withAuth(() => ({ json: documentFor(SAVE) })));
    const restored = await sync.readSnapshot(SAVE_ID, '2026-08-30');

    assert.equal(doFetch.calls[1].url, `${DOCUMENTS}/saves/${SAVE_ID}/days/2026-08-30`);
    assert.deepEqual(restored.state, SAVE);
  });

  test('deletes one by date', async () => {
    const { sync, doFetch } = client(withAuth(() => ({ json: {} })));
    await sync.deleteSnapshot(SAVE_ID, '2026-01-01');

    assert.equal(doFetch.calls[1].method, 'DELETE');
    assert.equal(doFetch.calls[1].url, `${DOCUMENTS}/saves/${SAVE_ID}/days/2026-01-01`);
  });
});

describe('failures worth telling the user apart', () => {
  test('a dead network is offline, not a server error', async () => {
    const { sync } = client(() => ({ throws: new TypeError('Failed to fetch') }));
    await assert.rejects(() => sync.pull(SAVE_ID), { kind: 'offline' });
  });

  test('a rules rejection is reported as denied', async () => {
    const { sync } = client(withAuth(() => ({ status: 403 })));
    await assert.rejects(() => sync.push(SAVE_ID, SAVE), { kind: 'denied' });
  });

  test('anything else carries its status code', async () => {
    const { sync } = client(withAuth(() => ({ status: 503 })));
    await assert.rejects(() => sync.pull(SAVE_ID), (error) => {
      assert.equal(error.kind, 'server');
      assert.match(error.message, /503/);
      return true;
    });
  });
});

/* ----------------------------------------------------------------- pairing */

describe('which saves this device knows', () => {
  let sync;
  let storage;

  beforeEach(() => {
    ({ sync, storage } = client(withAuth(() => ({ json: {} }))));
  });

  test('knows nothing until sharing starts', () => {
    assert.deepEqual(sync.pairing(), { saves: [], activeId: null });
    assert.equal(sync.activeSaveId(), null);
  });

  test('starting to share mints an ID and makes it active', () => {
    const id = sync.startSharing();
    assert.equal(id, SAVE_ID);
    assert.equal(sync.activeSaveId(), SAVE_ID);
  });

  test('is stored as a list, so a second save needs no migration later', () => {
    sync.startSharing();
    const stored = JSON.parse(storage.getItem('5bx-sync-v1'));
    assert.ok(Array.isArray(stored.saves), 'saves is a list from the first write');
    assert.equal(stored.saves.length, 1);
  });

  test('joining an existing save records and activates it', () => {
    const other = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    sync.joinSave(other);
    assert.equal(sync.activeSaveId(), other);
    assert.deepEqual(sync.pairing().saves.map((s) => s.id), [other]);
  });

  test('rejoining a save already known just switches to it', () => {
    sync.startSharing();
    sync.joinSave(SAVE_ID);
    assert.equal(sync.pairing().saves.length, 1);
  });

  test('forgetting a save leaves the backup itself alone', async () => {
    sync.startSharing();
    const before = sync.doFetch?.calls.length ?? 0;
    sync.forgetSave(SAVE_ID);

    assert.equal(sync.activeSaveId(), null);
    assert.equal(sync.pairing().saves.length, 0);
    assert.equal(before, 0, 'unpairing is local; it never deletes anyone else\'s data');
  });

  test('forgetting a save discards this device\'s credentials with it', () => {
    sync.startSharing();
    storage.setItem('5bx-sync-token-v1', '{"idToken":"id-1"}');
    sync.forgetSave(SAVE_ID);
    assert.equal(storage.getItem('5bx-sync-token-v1'), null);
  });

  test('survives a corrupted pairing record rather than refusing to start', () => {
    storage.setItem('5bx-sync-v1', 'not json at all');
    assert.deepEqual(sync.pairing(), { saves: [], activeId: null });
  });
});
