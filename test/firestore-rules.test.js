/*
 * The security rules, checked without an emulator.
 *
 * Running the real rules engine would mean pulling in firebase-tools and the
 * Java emulator, which is a lot of machinery for a file this small — and the
 * suite has to stay runnable with nothing installed. So this asserts the
 * properties that actually matter, by reading the file.
 *
 * The important one is the absence of a grant. Adding `allow list` on /saves
 * would let any signed-in stranger enumerate every save in the project without
 * guessing a single ID, and anonymous sign-in is open to anyone who loads the
 * site. It is exactly the kind of line that looks harmless in a diff.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { repoPath } from './helpers/env.js';

const rules = readFileSync(repoPath('firestore.rules'), 'utf8');

/** The body of `match /saves/{saveId}`, excluding its nested subcollection. */
const savesBlock = (() => {
  const start = rules.indexOf('match /saves/{saveId}');
  assert.notEqual(start, -1, 'the rules must have a /saves match block');
  const nested = rules.indexOf('match /days/', start);
  return rules.slice(start, nested === -1 ? rules.length : nested);
})();

const daysBlock = (() => {
  const start = rules.indexOf('match /days/');
  assert.notEqual(start, -1, 'the rules must have a /days match block');
  return rules.slice(start);
})();

/** Every operation named across all `allow` statements in `block`. */
function grants(block) {
  return [...block.matchAll(/allow\s+([a-z,\s]+?):\s*if\s+(.+?);/gs)]
    .flatMap(([, operations, condition]) =>
      operations.split(',').map((operation) => ({ operation: operation.trim(), condition })));
}

describe('the saves collection', () => {
  test('never grants list, which would expose every save at once', () => {
    const listed = grants(savesBlock).filter((grant) => grant.operation === 'list');
    assert.deepEqual(listed, [], 'a list grant on /saves leaks the whole project');
  });

  test('grants read only for one document at a time', () => {
    const reads = grants(savesBlock)
      .filter((grant) => ['get', 'read'].includes(grant.operation));
    assert.deepEqual(reads.map((grant) => grant.operation), ['get'],
      '`read` would imply `list`; only `get` is safe here');
  });

  test('requires a signed-in caller and a valid shape for every write', () => {
    for (const grant of grants(savesBlock)) {
      if (!['create', 'update'].includes(grant.operation)) continue;
      assert.match(grant.condition, /isSignedIn\(\)/, `${grant.operation} must require sign-in`);
      assert.match(grant.condition, /isValidSave\(request\.resource\.data\)/,
        `${grant.operation} must check the document's shape`);
    }
  });

  test('the shape check rejects anything without a payload', () => {
    assert.match(rules, /data\.payload is string/);
    assert.match(rules, /data\.payload\.size\(\)\s*>\s*0/);
  });
});

describe('the snapshot subcollection', () => {
  test('may be listed, since that already requires knowing the save ID', () => {
    const listed = grants(daysBlock).filter((grant) => grant.operation === 'list');
    assert.equal(listed.length, 1, 'pruning needs to list a save\'s own snapshots');
    assert.match(listed[0].condition, /isSignedIn\(\)/);
  });

  test('validates its writes the same way the live save does', () => {
    for (const grant of grants(daysBlock)) {
      if (!['create', 'update'].includes(grant.operation)) continue;
      assert.match(grant.condition, /isValidSave\(request\.resource\.data\)/);
    }
  });
});

describe('agreement with the client', () => {
  test('the size cap matches the one js/sync.js enforces', () => {
    // The same number in two files: the client refuses the write, the server
    // refuses it again. They must not drift, or one of them stops meaning
    // anything.
    const client = readFileSync(repoPath('js', 'sync.js'), 'utf8')
      .match(/MAX_PAYLOAD_BYTES\s*=\s*([\d_]+)/)[1].replaceAll('_', '');
    const server = rules.match(/data\.payload\.size\(\)\s*<\s*(\d+)/)[1];
    assert.equal(server, client);
  });

  test('firebase.json deploys the rules this suite just checked', () => {
    const config = JSON.parse(readFileSync(repoPath('firebase.json'), 'utf8'));
    assert.equal(config.firestore.rules, 'firestore.rules');
  });

  test('every grant requires sign-in, so nothing is world-writable', () => {
    for (const grant of [...grants(savesBlock), ...grants(daysBlock)]) {
      if (grant.condition.trim() === 'false') continue;
      assert.match(grant.condition, /isSignedIn\(\)/,
        `${grant.operation} is granted without requiring sign-in`);
    }
  });
});
