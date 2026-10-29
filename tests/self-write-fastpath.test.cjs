'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasFixture } = require('./helpers/fake-gas.cjs');
const { ok } = require('./helpers/fixture.cjs');

const achOf = (f, i = 0) => JSON.parse(f.rows('students')[i].ach || '{}');

test('GAS: submit with ackStamps stores stamps as already seen; without it they stay unseen', () => {
  const f = createGasFixture();
  const r1 = f.submit(f.begin(), { ackStamps: true }).result;
  ok(r1, 'submit with ack');
  assert.equal(r1.stampsSeen, true);
  assert.ok(r1.newStamps.length >= 1, 'first stamp awarded');
  assert.ok(achOf(f).st.every(x => !x.n), 'no unseen flag stored');
  const r2 = f.submit(f.begin({ token: f.tokens[1], clientId: 'test-phone-b' })).result;
  ok(r2, 'submit without ack');
  assert.ok(!r2.stampsSeen);
  assert.ok(achOf(f, 1).st.some(x => x.n), 'old clients still see unseen stamps');
});

test('GAS: seenStamps with nothing to change returns without taking the lock', () => {
  const f = createGasFixture();
  ok(f.submit(f.begin(), { ackStamps: true }).result);
  const before = f.lockCount();
  const r = f.call('seenStamps', { token: f.tokens[0] });
  ok(r, 'seenStamps');
  assert.equal(r._skip, true);
  assert.equal(f.lockCount(), before, 'no lock');
  f.assertUnlocked();
});

test('GAS: self writes only touch the student row inside the lock and keep other columns', () => {
  const f = createGasFixture({ settings: { 'ニックネームを使う': 'TRUE' } });
  ok(f.submit(f.begin({ token: f.tokens[1], clientId: 'test-phone-b' })).result);
  f.resetOperations();
  ok(f.call('seenStamps', { token: f.tokens[1] }), 'seenStamps');
  assert.ok(achOf(f, 1).st.every(x => !x.n), 'flags cleared');
  const sm = f.summary(), inLock = sm.insideLock;
  assert.equal(sm.all.lockAcquired, 1);
  assert.ok(inLock.readCells <= 40, 'only one row re-read inside the lock: ' + inLock.readCells);
  ok(f.call('setNick', { token: f.tokens[1], nick: 'Taro' }), 'setNick');
  ok(f.call('setAvatar', { token: f.tokens[1], av: { b: 'cat' } }), 'setAvatar');
  const row = f.rows('students')[1];
  assert.equal(row.nick, 'Taro');
  assert.equal(achOf(f, 1).av.b, 'cat');
  assert.ok(Number(row.totalWords) > 0, 'reading totals kept');
  f.assertUnlocked();
});

test('GAS: a self write is recomputed when the row changed behind the cache', () => {
  const f = createGasFixture({ settings: { 'ニックネームを使う': 'TRUE' } });
  ok(f.call('home', { token: f.tokens[0] }));
  const sheetRows = f.rows('students');
  // change the row directly (as a teacher editing the sheet would)
  f.freshStore().updateStudent(sheetRows[0].cls + '-' + sheetRows[0].no, { name: 'Edited by hand' });
  ok(f.call('setNick', { token: f.tokens[0], nick: 'Hana' }), 'setNick');
  const row = f.rows('students')[0];
  assert.equal(row.nick, 'Hana');
  assert.equal(row.name, 'Edited by hand');
});
