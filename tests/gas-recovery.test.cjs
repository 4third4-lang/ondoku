'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasFixture } = require('./helpers/fake-gas.cjs');
const { ok, WORDS } = require('./helpers/fixture.cjs');

test('GAS: start decisions serialize before writing and survive complete cache eviction', () => {
  const f = createGasFixture();
  let overlapping;
  f.onNextLock(() => { overlapping = f.begin({ clientId: 'test-phone-b' }).result; });
  const first = f.begin();
  ok(first.result);
  assert.equal(overlapping.ok, false, 'Concurrent start must not succeed while the first holds the lock');
  assert.ok(f.lockCount() > 0);
  assert.ok(f.writes.filter(write => write.key === 'students').every(write => write.locked));
  f.clearCache();
  assert.equal(f.begin({ clientId: 'test-phone-b' }).result.code, 'ATTEMPT_ACTIVE');
  f.assertUnlocked();
});

test('GAS: begin request responses cannot be read across students or without authentication', () => {
  const f = createGasFixture();
  const first = f.begin({ rid: 'shared-untrusted-request-id' });
  ok(first.result);
  const other = f.begin({ token: f.tokens[1], clientId: 'test-phone-b', rid: 'shared-untrusted-request-id' });
  ok(other.result);
  assert.notEqual(first.result.attempt.id, other.result.attempt.id);
  const anonymous = f.call('beginAttempt', { ...first.payload, token: '' });
  assert.equal(anonymous.ok, false);
});

test('GAS: cancelled begin request cannot be revived by a stale cached response', () => {
  const f = createGasFixture();
  const first = f.begin();
  ok(first.result);
  ok(f.call('cancelAttempt', { token: f.tokens[0], clientId: 'test-ipad-a', attemptId: first.result.attempt.id, rid: 'gas-cancel' }));
  const retry = f.call('beginAttempt', first.payload);
  assert.equal(retry.ok, false, 'A cancelled start request must not return a usable cached attempt');
});

test('GAS: student write succeeded but best write failed; retry repairs records and best without double credit', () => {
  const f = createGasFixture();
  const first = f.begin();
  ok(first.result);
  f.injectFailure('bests', { count: 20 });
  const submitted = f.submit(first);
  assert.equal(submitted.result.ok, false, 'The failed aggregate write should not report complete success');
  const afterFailure = f.rows('students')[0].totalWords;
  assert.equal(Number(afterFailure), WORDS, 'This fixture exercises failure after the student row was committed');
  f.clearFailures();
  f.clearCache();
  const recovered = f.call('submit', { ...submitted.payload, rid: 'recovery-other-rid' });
  ok(recovered, 'retry after partial write');
  assert.equal(Number(f.rows('students')[0].totalWords), WORDS);
  assert.equal(f.rows('records').length, 1);
  assert.equal(Number(f.rows('records')[0].correct), WORDS);
  assert.equal(Number(f.rows('bests')[0].passes), 1);
  assert.equal(Number(f.rows('bests')[0].attempts), 1);
});

test('GAS: failed record append is recoverable by resending the same attempt', () => {
  const f = createGasFixture();
  const first = f.begin();
  ok(first.result);
  f.injectFailure('records', { count: 50 });
  const submitted = f.submit(first);
  assert.equal(f.rows('records').length, 0);
  assert.equal(Number(f.rows('students')[0].totalWords), WORDS);
  f.clearFailures();
  f.clearCache();
  ok(f.call('submit', { ...submitted.payload, rid: 'record-recovery-id' }));
  assert.equal(f.rows('records').length, 1);
  assert.equal(Number(f.rows('students')[0].totalWords), WORDS);
  assert.equal(Number(f.rows('bests')[0].passes), 1);
});

test('GAS: uncertain record append outcome is reconciled before retrying the write', () => {
  const f = createGasFixture();
  const first = f.begin();
  ok(first.result);
  f.injectFailure('records', { phase: 'after', count: 1 });
  const submitted = f.submit(first);
  f.clearFailures();
  f.clearCache();
  ok(f.call('submit', { ...submitted.payload, rid: 'uncertain-append-recovery' }));
  assert.equal(f.rows('records').length, 1, 'A response failure after append must not make a second record');
  assert.equal(Number(f.rows('students')[0].totalWords), WORDS);
});
