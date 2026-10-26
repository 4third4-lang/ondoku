'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasFixture } = require('./helpers/fake-gas.cjs');
const { ok, WORDS } = require('./helpers/fixture.cjs');

function cancel(f, start) {
  return ok(f.call('cancelAttempt', { token: start.payload.token, clientId: start.payload.clientId,
    attemptId: ok(start.result).attempt.id, rid: 'performance-cancel-request' }));
}
function student(f, id = '1-1-1') {
  return f.rows('students').find(row => `${row.cls}-${row.no}` === id);
}
function warm(f) {
  const first = f.begin();
  ok(first.result);
  cancel(f, first);
  f.resetOperations();
}
function recordChecks(f) {
  return f.operations.filter(event => event.key === 'records' && (event.kind === 'read' || event.kind === 'search'));
}

for (const count of [166, 1000]) {
  test(`GAS performance: warm begin reads only fresh student row with ${count} students`, () => {
    const f = createGasFixture({ studentCount: count });
    warm(f);
    ok(f.begin().result);
    const reads = f.operations.filter(event => event.key === 'students' && event.kind === 'read');
    assert.ok(reads.length > 0, 'A cached pointer must never replace a fresh authorization/state read');
    assert.ok(reads.every(event => event.height === 1 && event.locked), JSON.stringify(reads));
    assert.ok(reads.reduce((sum, event) => sum + event.cells, 0) <= f.runtime.SHEETS.students.cols.length * 2,
      'Warm-start student reads must not grow with roster size');
    assert.ok(f.operations.filter(event => event.key === 'students' && event.kind === 'write').every(event => event.locked));
  });
}

test('GAS performance: warm cancellation still reads the student row under the lock', () => {
  const f = createGasFixture({ studentCount: 166 });
  const first = f.begin();
  ok(first.result);
  f.resetOperations();
  cancel(f, first);
  const reads = f.operations.filter(event => event.key === 'students' && event.kind === 'read');
  assert.ok(reads.length > 0);
  assert.ok(reads.every(event => event.height === 1 && event.locked));
  assert.equal(JSON.parse(student(f).attemptState).active, undefined);
});

test('GAS performance: stale cached row after reorder never overwrites another student', () => {
  const f = createGasFixture({ studentCount: 166 });
  warm(f);
  const otherBefore = JSON.stringify(student(f, '1-1-2'));
  f.swapSheetRows('students', 2, 3);
  const start = f.begin();
  ok(start.result);
  assert.equal(JSON.stringify(student(f, '1-1-2')), otherBefore);
  assert.equal(JSON.parse(student(f).attemptState).active.id, start.result.attempt.id);
  assert.ok(f.operations.some(event => event.key === 'students' && event.kind === 'read' && event.height > 1),
    'A mismatched row hint must take the safe roster lookup fallback');
  assert.ok(f.operations.filter(event => event.key === 'students' && event.kind === 'write').every(event => event.row === 3));
});

test('GAS performance: removed student with a stale row hint cannot mutate the row that moved into its place', () => {
  const f = createGasFixture({ studentCount: 166 });
  warm(f);
  const otherBefore = JSON.stringify(student(f, '1-1-2'));
  f.removeSheetRow('students', 2);
  assert.equal(f.begin().result.ok, false);
  assert.equal(JSON.stringify(student(f, '1-1-2')), otherBefore);
  assert.equal(f.operations.filter(event => event.key === 'students' && event.kind === 'write').length, 0);
});

test('GAS performance: cache eviction uses safe fallback and preserves other students', () => {
  const f = createGasFixture({ studentCount: 166 });
  warm(f);
  const otherBefore = JSON.stringify(student(f, '1-1-2'));
  f.swapSheetRows('students', 2, 3);
  f.clearCache();
  ok(f.begin().result);
  assert.equal(JSON.stringify(student(f, '1-1-2')), otherBefore);
  assert.ok(f.operations.some(event => event.key === 'students' && event.kind === 'read' && event.height > 1));
  assert.ok(f.operations.filter(event => event.key === 'students' && event.kind === 'write').every(event => event.row === 3));
});

test('GAS performance: next begin after a successful submit avoids record searches and best reads', () => {
  const f = createGasFixture({ studentCount: 166 });
  const first = f.begin();
  ok(first.result);
  ok(f.submit(first).result);
  f.resetOperations();
  ok(f.begin().result);
  assert.equal(f.operations.filter(event => ['records', 'bests'].includes(event.key)).length, 0,
    JSON.stringify(f.operations));
  assert.equal(f.rows('records').length, 1);
  assert.equal(Number(student(f).totalWords), WORDS);
});

test('GAS performance: loss of a success marker safely rechecks the previous receipt without duplicating credit', () => {
  const f = createGasFixture({ studentCount: 166 });
  const first = f.begin();
  ok(first.result);
  ok(f.submit(first).result);
  f.clearCache();
  f.resetOperations();
  ok(f.begin().result);
  assert.ok(recordChecks(f).length > 0, 'Cache absence cannot count as proof of a completed projection');
  assert.equal(f.rows('records').length, 1);
  assert.equal(Number(student(f).totalWords), WORDS);
  assert.equal(Number(f.rows('bests')[0].passes), 1);
});

for (const failedSheet of ['bests', 'records']) {
  test(`GAS performance: ${failedSheet} failure does not create a success marker and next begin repairs it`, () => {
    const f = createGasFixture();
    const first = f.begin();
    ok(first.result);
    f.injectFailure(failedSheet, { count: 1 });
    assert.equal(f.submit(first).result.ok, false);
    f.clearFailures();
    // Do not clear cache here: an erroneously published marker must be detectable.
    f.resetOperations();
    ok(f.begin({ clientId: 'performance-next-device' }).result);
    assert.equal(f.rows('records').length, 1);
    assert.equal(Number(student(f).totalWords), WORDS);
    assert.equal(Number(f.rows('bests')[0].passes), 1);
    assert.ok(f.operations.some(event => event.key === failedSheet && event.kind === 'write'), 'Pending projection must actually be repaired');
  });
}

test('GAS performance: failed flush does not mark a receipt completed', () => {
  const f = createGasFixture();
  const first = f.begin();
  ok(first.result);
  f.injectFlushFailure();
  assert.equal(f.submit(first).result.ok, false);
  assert.ok(f.operations.some(event => event.kind === 'flush' && event.succeeded === false));
  f.clearFailures();
  f.resetOperations();
  ok(f.begin({ clientId: 'performance-next-device' }).result);
  assert.ok(recordChecks(f).length > 0, 'A failed flush cannot authorize the next start to skip receipt verification');
  assert.equal(f.rows('records').length, 1);
  assert.equal(Number(student(f).totalWords), WORDS);
});

test('GAS performance: warm begin retains same-student exclusion during a competing lock acquisition', () => {
  const f = createGasFixture({ studentCount: 166 });
  warm(f);
  let competing;
  f.onNextLock(() => { competing = f.begin({ clientId: 'performance-other-device' }).result; });
  const first = f.begin();
  ok(first.result);
  assert.equal(competing.ok, false);
  assert.equal(f.begin({ clientId: 'performance-other-device' }).result.code, 'ATTEMPT_ACTIVE');
  assert.equal(JSON.parse(student(f).attemptState).active.id, first.result.attempt.id);
  f.assertUnlocked();
});
