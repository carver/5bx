/*
 * Cloud backup and cross-device sync, over Firestore's REST API.
 *
 * No Firebase SDK. The app ships no runtime dependencies and has no build
 * step, and the SDK is neither small nor droppable into a plain <script
 * type="module"> — so this talks to the same service the SDK does, directly.
 * Three endpoints, plain fetch, roughly a page of request-shaping. What is
 * given up is the SDK's offline write queue and live snapshot listener, and
 * neither is missed: this app writes about once per workout, and reads once
 * when it opens.
 *
 * The whole save travels as one opaque JSON string in a single field. That
 * avoids Firestore's typed-value encoding (`{"integerValue": "3"}` and friends,
 * recursively, for every session ever logged), and it keeps the merge rules in
 * js/merge.js as the single place that understands the save's shape.
 *
 * Access model: a save lives at `saves/{saveId}`, where saveId is a random
 * UUID handed over once by QR code. Anyone with the link can read and write
 * that save — the same trust model as an unlisted document link. Anonymous
 * sign-in is required on every request, but only as a speed bump against
 * drive-by bots; it deliberately does not check *which* anonymous user is
 * asking, since any device holding the link is meant to have access. See
 * docs/adr/0001 for why that tradeoff is acceptable here, and firestore.rules
 * for what the server enforces.
 */

import { SYNC_CONFIG } from './sync-config.js';
import { isSaveShaped } from './merge.js';

/** Where this device records which saves it has paired with. */
const PAIRING_KEY = '5bx-sync-v1';

/** Anonymous credentials. Device-local, and never part of the save. */
const TOKEN_KEY = '5bx-sync-token-v1';

/*
 * Renew a little before the hour is actually up, so a request that is about to
 * be sent with a token expiring in two seconds does not race its own expiry.
 */
const TOKEN_RENEWAL_MARGIN_MS = 120_000;

/** Daily snapshots kept before the oldest are pruned. */
export const SNAPSHOTS_KEPT = 30;

/*
 * Firestore's hard limit is 1 MiB per document. At roughly 120 bytes per
 * session that is some twenty years of daily workouts, so this is a guard
 * against a corrupted save rather than a real ceiling — but a write that hits
 * it should say so plainly rather than fail as an opaque 400.
 */
const MAX_PAYLOAD_BYTES = 900_000;

const SCHEMA_VERSION = 1;

export class SyncError extends Error {
  constructor(kind, message, options) {
    super(message, options);
    this.name = 'SyncError';
    /** One of: offline, auth, denied, notFound, tooLarge, malformed, server. */
    this.kind = kind;
  }
}

/* ------------------------------------------------------------------ pure */

/**
 * The link that pairs another device with this save.
 *
 * A full URL rather than a bare ID, so a phone's camera app can act on it
 * directly: scanning offers "open this link" and the app takes it from there,
 * with nothing to copy, type, or paste.
 */
export function pairingLink(baseUrl, saveId) {
  const url = new URL(baseUrl);
  url.hash = `join/${saveId}`;
  return url.toString();
}

/** The save ID in a pairing link's hash, or null if it is not one. */
export function joinIdFromHash(hash) {
  const match = /^#join\/([0-9a-fA-F-]{36})$/.exec(hash ?? '');
  return match ? match[1] : null;
}

/**
 * Which snapshots to delete, given every snapshot currently stored.
 *
 * Snapshot IDs are calendar dates, so sorting them as strings sorts them by
 * time, and the newest `keep` survive.
 */
export function snapshotsToPrune(dateKeys, keep = SNAPSHOTS_KEPT) {
  return [...dateKeys].sort().slice(0, Math.max(0, dateKeys.length - keep));
}

/* --------------------------------------------------------------- pairing */

/*
 * Deliberately a list with an active entry, though the app only ever creates
 * one. A second person (or a second save for the same person) is then a new
 * entry rather than a change of shape, so adding that later needs no migration
 * of anything already stored on a device. See docs/adr/0001.
 */
function readPairing(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(PAIRING_KEY) ?? 'null');
    if (!parsed || !Array.isArray(parsed.saves)) return { saves: [], activeId: null };
    return {
      saves: parsed.saves.filter((save) => typeof save?.id === 'string'),
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
    };
  } catch {
    return { saves: [], activeId: null };
  }
}

function writePairing(storage, pairing) {
  storage.setItem(PAIRING_KEY, JSON.stringify(pairing));
}

/* ---------------------------------------------------------------- client */

/**
 * @param {object} options
 * @param {object} [options.config]  project identifiers; see js/sync-config.js
 * @param {Function} [options.fetch] injected for tests
 * @param {Storage} [options.storage]
 * @param {Function} [options.now]
 * @param {Function} [options.newId]
 */
export function createSyncClient({
  config = SYNC_CONFIG,
  fetch: doFetch = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  now = Date.now,
  newId = () => crypto.randomUUID(),
} = {}) {
  const documents = `https://firestore.googleapis.com/v1/projects/${config.projectId}`
    + '/databases/(default)/documents';

  /* -------------------------------------------------------------- auth */

  function storedToken() {
    try {
      return JSON.parse(storage.getItem(TOKEN_KEY) ?? 'null');
    } catch {
      return null;
    }
  }

  async function postJson(url, body) {
    const response = await send(`${url}?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new SyncError('auth', `Could not sign in to the backup service (${response.status}).`);
    }
    return response.json();
  }

  const signUpAnonymously = () =>
    postJson('https://identitytoolkit.googleapis.com/v1/accounts:signUp', { returnSecureToken: true })
      .then(({ idToken, refreshToken, expiresIn }) => ({ idToken, refreshToken, expiresIn }));

  // The refresh endpoint answers in snake_case where sign-up answers in
  // camelCase, which is a real difference between two Google services rather
  // than a typo waiting to be tidied up.
  const refreshAccessToken = (refreshToken) =>
    postJson('https://securetoken.googleapis.com/v1/token',
      { grant_type: 'refresh_token', refresh_token: refreshToken })
      .then((body) => ({
        idToken: body.id_token, refreshToken: body.refresh_token, expiresIn: body.expires_in,
      }));

  /*
   * Anonymous sign-in, cached across sessions. The refresh token outlives the
   * hour-long ID token, so a device that has synced before does not create a
   * new anonymous user every time the app opens.
   */
  async function accessToken({ force = false } = {}) {
    const cached = storedToken();
    if (!force && cached?.idToken && cached.expiresAt > now() + TOKEN_RENEWAL_MARGIN_MS) {
      return cached.idToken;
    }

    const fresh = cached?.refreshToken
      ? await refreshAccessToken(cached.refreshToken)
      : await signUpAnonymously();

    storage.setItem(TOKEN_KEY, JSON.stringify({
      idToken: fresh.idToken,
      refreshToken: fresh.refreshToken,
      expiresAt: now() + Number(fresh.expiresIn) * 1000,
    }));
    return fresh.idToken;
  }

  /* ---------------------------------------------------------- transport */

  async function send(url, init) {
    if (!doFetch) throw new SyncError('offline', 'This browser cannot reach the network.');
    try {
      return await doFetch(url, init);
    } catch (cause) {
      throw new SyncError('offline', 'Could not reach the backup service.', { cause });
    }
  }

  /*
   * One retry on 401, and only on 401. A token can expire between the margin
   * check and the request actually landing, or be invalidated server-side; both
   * are fixed by getting a new one. Anything else is a real answer.
   */
  async function request(path, init = {}, { retrying = false } = {}) {
    const token = await accessToken({ force: retrying });
    const response = await send(`${documents}/${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });

    if (response.status === 401 && !retrying) return request(path, init, { retrying: true });
    if (response.status === 404) throw new SyncError('notFound', 'No backup found for that link.');
    if (response.status === 403) {
      throw new SyncError('denied', 'The backup service refused that request.');
    }
    if (!response.ok) {
      throw new SyncError('server', `The backup service returned ${response.status}.`);
    }
    return response.json();
  }

  /* ----------------------------------------------------------- document */

  function encode(state) {
    const payload = JSON.stringify(state);
    if (payload.length > MAX_PAYLOAD_BYTES) {
      throw new SyncError('tooLarge',
        `This save is too large to back up (${payload.length} bytes).`);
    }
    return {
      fields: {
        payload: { stringValue: payload },
        schema: { integerValue: String(SCHEMA_VERSION) },
      },
    };
  }

  function decode(document) {
    const payload = document?.fields?.payload?.stringValue;
    if (typeof payload !== 'string') {
      throw new SyncError('malformed', 'The stored backup is not in a format this app understands.');
    }
    let state;
    try {
      state = JSON.parse(payload);
    } catch (cause) {
      throw new SyncError('malformed', 'The stored backup could not be read.', { cause });
    }
    if (!isSaveShaped(state)) {
      throw new SyncError('malformed', 'The stored backup is missing data this app needs.');
    }
    // Firestore's own record of when the document last changed, which needs no
    // trust in either device's clock.
    return { state, updatedAt: document.updateTime ?? null };
  }

  // async, so an oversized save rejects like every other failure here rather
  // than throwing synchronously and needing callers to guard it twice.
  async function write(path, state) {
    return request(path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(encode(state)),
    });
  }

  /* ------------------------------------------------------------- public */

  return {
    /** The saves this device has paired with, and which one is in use. */
    pairing: () => readPairing(storage),

    activeSaveId: () => readPairing(storage).activeId,

    /** Begin backing up: mints a new save ID and records it on this device. */
    startSharing() {
      const id = newId();
      const { saves } = readPairing(storage);
      writePairing(storage, { saves: [...saves, { id, label: 'My workouts' }], activeId: id });
      return id;
    },

    /** Pair with a save another device already created. */
    joinSave(id) {
      const { saves } = readPairing(storage);
      const known = saves.some((save) => save.id === id);
      writePairing(storage, {
        saves: known ? saves : [...saves, { id, label: 'My workouts' }],
        activeId: id,
      });
    },

    /**
     * Forget a save on this device. The save itself, and any other device
     * paired with it, is untouched — there is deliberately no way to delete
     * someone else's backup from here.
     */
    forgetSave(id) {
      const { saves, activeId } = readPairing(storage);
      const remaining = saves.filter((save) => save.id !== id);
      writePairing(storage, {
        saves: remaining,
        activeId: activeId === id ? (remaining[0]?.id ?? null) : activeId,
      });
      storage.removeItem(TOKEN_KEY);
    },

    /** The stored save, or null if nothing has been backed up yet. */
    async pull(id) {
      try {
        return decode(await request(`saves/${id}`));
      } catch (error) {
        if (error.kind === 'notFound') return null;
        throw error;
      }
    },

    push: (id, state) => write(`saves/${id}`, state),

    /**
     * Erase the stored save. Permitted because it grants nothing that write
     * access does not already grant, and because "erase my cloud backup" has
     * to be a real option rather than a promise the app cannot keep.
     */
    deleteSave: (id) => request(`saves/${id}`, { method: 'DELETE' }),

    /** A dated, immutable copy, so a corrupted save is recoverable. */
    writeSnapshot: (id, dateKey, state) => write(`saves/${id}/days/${dateKey}`, state),

    async listSnapshots(id) {
      // Only the names are wanted; asking for one small field keeps the whole
      // month's saves from being downloaded just to list their dates.
      const body = await request(
        `saves/${id}/days?pageSize=${SNAPSHOTS_KEPT * 4}&mask.fieldPaths=schema`,
      );
      return (body.documents ?? [])
        .map((document) => document.name.split('/').pop())
        .sort();
    },

    readSnapshot: (id, dateKey) => request(`saves/${id}/days/${dateKey}`).then(decode),

    deleteSnapshot: (id, dateKey) => request(`saves/${id}/days/${dateKey}`, { method: 'DELETE' }),
  };
}
