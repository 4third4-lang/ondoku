'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasFixture } = require('./helpers/fake-gas.cjs');
const { ok, WORDS } = require('./helpers/fixture.cjs');

test('GAS: later readings cannot evict an unprojected record receipt', () => {
  const f = createGasFixture();
  const original = f.begin();
  ok(original.result);
  f.injectFailure('records', { count: 1 });
  const interrupted = f.submit(original);
  assert.equal(interrupted.result.ok, false);
  assert.equal(Number(f.rows('students')[0].totalWords), WORDS);
  assert.equal(f.rows('records').length, 0);

  // The first device can remain offline while another device resumes practice.
  // Repair must not depend on that device resending before the display history
  // of the three latest completed attempts rotates.
  f.clearFailures();
  f.clearCache();
  for (let i = 0; i < 3; i++) {
    const next = f.begin({ clientId: 'test-other-tablet' });
    ok(next.result, 'next reading');
    ok(f.submit(next).result, 'next reading submission');
  }

  assert.equal(Number(f.rows('students')[0].totalWords), WORDS * 4);
  assert.equal(f.rows('records').length, 4, 'The first committed reading must survive receipt-history rotation');
  assert.equal(f.rows('records').filter(record => record.attemptId === original.result.attempt.id).length, 1);
  assert.equal(f.rows('records').reduce((sum, record) => sum + Number(record.correct), 0), WORDS * 4);

  // An old retry can return a receipt or an explicit expiry, but cannot add
  // credit or recreate a second record after its record has been repaired.
  f.call('submit', { ...interrupted.payload, rid: 'late-recovery-after-rotation' });
  assert.equal(Number(f.rows('students')[0].totalWords), WORDS * 4);
  assert.equal(f.rows('records').length, 4);
});

test('GAS: unresolved projection failure preserves its receipt and blocks another reading for that student', () => {
  const f = createGasFixture();
  const original = f.begin();
  ok(original.result);
  f.injectFailure('records', { count: 50 });
  assert.equal(f.submit(original).result.ok, false);
  f.clearCache();

  const next = f.begin({ clientId: 'test-other-tablet' });
  assert.equal(next.result.ok, false, 'Do not open new readings while an earlier record cannot be repaired');
  const state = JSON.parse(f.rows('students')[0].attemptState);
  assert.equal(state.active, undefined);
  assert.ok(state.done.some(receipt => receipt.id === original.result.attempt.id), 'Keep the committed receipt for recovery');
  assert.equal(Number(f.rows('students')[0].totalWords), WORDS);
  assert.equal(f.rows('records').length, 0);

  const otherStudent = f.begin({ token: f.tokens[1], clientId: 'test-other-student' });
  ok(otherStudent.result, 'another student can start independently');
});

test('GAS: recovering a stale best-row pointer never overwrites another student', () => {
  const f = createGasFixture();
  const original = f.begin();
  ok(original.result);
  f.injectFailure('bests', { count: 1 });
  assert.equal(f.submit(original).result.ok, false);
  assert.equal(f.rows('bests').length, 0);
  f.clearFailures();
  f.clearCache();

  // The first student has a durable best-row pointer, but that row was never
  // written. Another student legitimately receives that row next.
  const other = f.begin({ token: f.tokens[1], clientId: 'test-other-student' });
  ok(other.result);
  ok(f.submit(other).result);
  const otherBefore = JSON.stringify(f.rows('bests').find(row => row.sid === '1-1-2'));

  ok(f.begin({ clientId: 'test-other-tablet' }).result, 'repair before the next recording');
  const rows = f.rows('bests');
  assert.equal(rows.length, 2);
  assert.equal(JSON.stringify(rows.find(row => row.sid === '1-1-2')), otherBefore);
  assert.equal(Number(rows.find(row => row.sid === '1-1-1').passes), 1);
  assert.equal(Number(rows.find(row => row.sid === '1-1-1').attempts), 1);
  assert.equal(f.rows('records').length, 2);
});
