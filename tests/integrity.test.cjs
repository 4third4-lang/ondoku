'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture, ok, TEXT, WORDS } = require('./helpers/fixture.cjs');

test('same student can have only one active reading across two clients', () => {
  const f = createFixture();
  const first = ok(f.begin().result, 'first client');
  const blocked = f.begin({ clientId: 'test-phone-b' }).result;
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'ATTEMPT_ACTIVE');
  assert.equal(f.data.records.length, 0);
  assert.ok(first.attempt.id);
});

test('different students can start independently on the same network', () => {
  const f = createFixture();
  const first = ok(f.begin().result).attempt;
  const second = ok(f.begin({ token: f.tokens[1], clientId: 'test-phone-b' }).result).attempt;
  assert.notEqual(first.id, second.id);
});

test('a retried start request returns the original attempt, including its expiry', () => {
  const f = createFixture();
  const start = f.begin({ rid: 'stable-start-request' });
  const first = ok(start.result).attempt;
  f.advance(1000);
  const second = ok(f.call('beginAttempt', { ...start.payload })).attempt;
  assert.equal(second.id, first.id);
  assert.equal(second.expiresAt, first.expiresAt);
  assert.equal(second.phrase, first.phrase);
});

test('completed attempt cannot add words or points again even with a different request ID', () => {
  const f = createFixture();
  const start = f.begin({ recite: true });
  const submitted = f.submit(start);
  ok(submitted.result);
  const totals = () => ({ totalWords: f.data.students[0].totalWords, todayWords: f.data.students[0].todayWords,
    points: JSON.parse(f.data.students[0].ach || '{}').p, records: JSON.stringify(f.data.records), bests: JSON.stringify(f.data.bests) });
  const before = totals();
  const retried = f.call('submit', { ...submitted.payload, rid: 'different-retry-id' });
  assert.ok(retried.ok === false || retried.duplicate === true, JSON.stringify(retried));
  assert.deepEqual(totals(), before, 'No cumulative field or record may change on retry');
});

test('explicit takeover rejects stale competing takeover and the displaced client submission', () => {
  const f = createFixture();
  const original = f.begin();
  const oldPayload = f.payloadFor(original);
  const replacement = f.begin({ clientId: 'test-phone-b', takeover: true, expectedAttemptId: original.result.attempt.id });
  ok(replacement.result);
  assert.notEqual(replacement.result.attempt.id, original.result.attempt.id);
  const staleSwitch = f.begin({ clientId: 'test-tablet-c', takeover: true, expectedAttemptId: original.result.attempt.id });
  assert.equal(staleSwitch.result.ok, false);
  f.advance(30000);
  assert.equal(f.call('submit', oldPayload).ok, false);
  ok(f.submit(replacement).result);
  assert.equal(f.data.records.length, 1);
});

test('evicting transient cache cannot unlock an active reading', () => {
  const f = createFixture();
  ok(f.begin().result);
  f.clearCache();
  assert.equal(f.begin({ clientId: 'test-phone-b' }).result.code, 'ATTEMPT_ACTIVE');
});

test('cancel and explicit switch permit the new client, but reject the old delayed submission', () => {
  const f = createFixture();
  const old = f.begin();
  const stale = f.payloadFor(old);
  ok(f.call('cancelAttempt', { token: f.tokens[0], attemptId: old.result.attempt.id, clientId: 'test-ipad-a', rid: 'cancel-old' }));
  const next = f.begin({ clientId: 'test-phone-b' });
  ok(next.result);
  f.advance(30000);
  assert.equal(f.call('submit', stale).ok, false);
  assert.equal(f.data.records.length, 0);
  ok(f.submit(next).result);
  assert.equal(f.data.records.length, 1);
});

test('expired attempt cannot be submitted after a new client starts', () => {
  const f = createFixture();
  const old = f.begin();
  const stale = f.payloadFor(old);
  const expiry = old.result.attempt.expiresAt;
  const milliseconds = typeof expiry === 'number' ? expiry : Date.parse(expiry);
  assert.ok(Number.isFinite(milliseconds), 'Expiry must identify a concrete server deadline');
  f.setTime(milliseconds + 1000);
  const next = f.begin({ clientId: 'test-phone-b' });
  ok(next.result);
  assert.equal(f.call('submit', stale).ok, false);
  ok(f.submit(next).result);
  assert.equal(f.data.records.length, 1);
});

test('another student cannot submit or cancel an attempt they do not own', () => {
  const f = createFixture();
  const start = f.begin();
  ok(f.begin({ token: f.tokens[1], clientId: 'test-phone-b' }).result);
  const stolen = f.payloadFor(start, { token: f.tokens[1] });
  f.advance(30000);
  assert.equal(f.call('submit', stolen).ok, false);
  const denied = f.call('cancelAttempt', { token: f.tokens[1], clientId: 'test-ipad-a', attemptId: start.result.attempt.id });
  assert.equal(denied.ok, false);
  ok(f.submit(start).result);
  assert.equal(f.store.getStudent('1-1-2').totalWords, 0);
});

test('an old client submit without a server attempt is rejected without writing', () => {
  const f = createFixture();
  const result = f.call('submit', { token: f.tokens[0], rid: 'legacy-submit', aid: 'A1', type: 1, transcript: TEXT,
    duration: 30, phrase: 'hello blue sky' });
  assert.equal(result.ok, false);
  assert.equal(f.data.records.length, 0);
  assert.equal(f.store.getStudent('1-1-1').totalWords, 0);
});

test('server-issued phrase is authoritative despite client phrase tampering', () => {
  const f = createFixture();
  const start = f.begin();
  const response = ok(f.submit(start, { phrase: 'invented client phrase', phraseAt: 999 }).result);
  assert.equal(response.flagged, undefined);
  assert.equal(response.result.correct, WORDS);
});

test('sixth reading preserves practice and required passes but adds no ranking words or recitation bonus', () => {
  const f = createFixture();
  const responses = Array.from({ length: 6 }, () => ok(f.read({ recite: true }).result));
  for (const response of responses.slice(0, 5)) {
    assert.equal(response.credit.rankWords, WORDS);
    assert.equal(response.bonus, WORDS);
  }
  const sixth = responses[5];
  assert.equal(sixth.credit.limit, 5);
  assert.equal(sixth.credit.remaining, 0);
  assert.equal(sixth.credit.rankWords, 0);
  assert.equal(sixth.credit.limited, true);
  assert.equal(sixth.bonus, 0);
  assert.equal(f.store.getStudent('1-1-1').totalWords, WORDS * 6);
  assert.equal(f.store.getStudent('1-1-1').todayWords, WORDS * 6);
  assert.equal(f.store.getBest('1-1-1', 'A1').passes, 6);
  assert.equal(f.store.getBest('1-1-1', 'A1').attempts, 6);
  assert.equal(f.data.records.length, 6);
  assert.equal(ok(f.call('ranking', { token: f.tokens[0], period: 'day' })).mine.words, WORDS * 5);
});

test('same normalized text shares its cap across task IDs, free practice and reading modes', () => {
  const f = createFixture();
  f.store.addAssignment({ ...f.store.getAssignment('A1'), id: 'A2', title: 'Duplicate text assignment' });
  ok(f.read({ aid: 'A1', type: 1 }).result);
  ok(f.read({ aid: 'A2', type: 5 }).result);
  ok(f.read({ aid: '', kind: 'library', libId: 'test-library', text: TEXT.toUpperCase().replace(/ /g, '  ') }).result);
  ok(f.read({ aid: 'A1', type: 2 }).result);
  ok(f.read({ aid: '', kind: 'repeat', text: TEXT }).result);
  const sixth = ok(f.read({ aid: '', kind: 'proverb', text: TEXT, recite: true }).result);
  assert.equal(sixth.credit.rankWords, 0);
  assert.equal(sixth.credit.limited, true);
  assert.equal(sixth.bonus, 0);
});

test('a different text still receives credit after the first text reaches its cap', () => {
  const f = createFixture();
  for (let i = 0; i < 5; i++) ok(f.read().result);
  const response = ok(f.read({ aid: '', text: 'We enjoy reading new stories with our classmates every morning.', kind: 'library' }).result);
  assert.ok(response.credit.rankWords > 0);
  assert.equal(response.credit.limited, false);
});

test('repeat credit resets at midnight Japan time, using server time', () => {
  const f = createFixture({ now: '2026-10-26T14:50:00.000Z' });
  for (let i = 0; i < 6; i++) ok(f.read().result);
  f.setTime('2026-10-26T15:00:01.000Z');
  const next = ok(f.read({ date: '1900-01-01' }).result);
  assert.equal(next.credit.rankWords, WORDS);
  assert.equal(next.credit.remaining, 4);
  assert.equal(f.data.records.at(-1).date, '2026-10-27');
  assert.equal(f.store.getStudent('1-1-1').todayWords, WORDS);
});

test('only administrator can change repeatCreditLimit and values stay within 1..20', () => {
  const f = createFixture();
  const current = () => ok(f.call('home', { token: f.tokens[0] })).settings.repeatCreditLimit;
  assert.equal(current(), 5);
  for (const token of [f.tokens[0], f.teacher]) {
    assert.equal(f.call('t_saveSettings', { token, settings: { repeatCreditLimit: 8 } }).ok, false);
    assert.equal(current(), 5);
  }
  ok(f.call('t_saveSettings', { token: f.admin, settings: { repeatCreditLimit: 7 } }));
  assert.equal(current(), 7);
  for (const value of [0, 21, -4, 'invalid']) {
    f.call('t_saveSettings', { token: f.admin, settings: { repeatCreditLimit: value } });
    assert.ok(current() >= 1 && current() <= 20, `Invalid limit after ${value}: ${current()}`);
  }
});

test('legacy records without rankWords still count; explicit zero rankWords does not', () => {
  const f = createFixture();
  const common = { date: '2026-10-26', sid: '1-1-1', aid: 'A1', type: 1, accuracy: 100, total: WORDS, duration: 30 };
  f.store.appendRecord({ ...common, time: '2026-10-26T01:00:00Z', correct: 12 });
  f.store.appendRecord({ ...common, time: '2026-10-26T01:01:00Z', correct: 8, rankWords: '' });
  f.store.appendRecord({ ...common, time: '2026-10-26T01:02:00Z', correct: WORDS, rankWords: 0 });
  f.store.appendRecord({ ...common, time: '2026-10-26T01:03:00Z', correct: WORDS, rankWords: 7 });
  const ranking = ok(f.call('ranking', { token: f.tokens[0], period: 'day' }));
  assert.equal(ranking.mine.words, 27);
});

test('teacher approval of a legacy flagged record credits practice exactly once', () => {
  const f = createFixture();
  const record = { date: '2026-10-26', time: '2026-10-26T01:00:00Z', sid: '1-1-1', aid: 'A1', type: 1,
    flag: '読む速さが不自然に速い', reviewed: '', accuracy: 80, correct: 0, total: 20, duration: 1 };
  f.store.appendRecord(record);
  const payload = { token: f.teacher, rid: `${record.time}|${record.sid}`, verdict: 'ok' };
  ok(f.call('t_reviewFlag', payload));
  assert.equal(record.correct, 16);
  assert.equal(f.store.getStudent('1-1-1').totalWords, 16);
  assert.equal(f.store.getBest('1-1-1', 'A1').passes, 1);
  ok(f.call('t_reviewFlag', payload));
  assert.equal(f.store.getStudent('1-1-1').totalWords, 16);
  assert.equal(f.store.getBest('1-1-1', 'A1').passes, 1);
});

test('live readings use the same active-attempt exclusion but are outside the daily repeat cap', () => {
  const f = createFixture();
  f.store.addLive({ id: 'LIVE1', aid: 'A1', title: 'Class reading', classes: '1-1', status: 'running',
    started: '2026-10-26T01:00:00Z', ends: '2026-10-26T03:00:00Z', scores: '{}' });
  const first = f.begin();
  ok(first.result);
  assert.equal(f.begin({ clientId: 'test-phone-b' }).result.code, 'ATTEMPT_ACTIVE');
  const responses = [ok(f.submit(first).result)];
  for (let i = 0; i < 5; i++) responses.push(ok(f.read().result));
  for (const response of responses) {
    assert.equal(response.liveOnly, true);
    assert.ok(response.live.gained > 0);
  }
  assert.equal(responses.at(-1).live.count, 6);
  assert.equal(f.data.records.length, 0);
  assert.equal(f.store.getStudent('1-1-1').totalWords, 0);
});

test('an active normal reading also blocks starting a live reading for that student', () => {
  const f = createFixture();
  ok(f.begin({ aid: '', text: TEXT }).result);
  f.store.addLive({ id: 'LIVE1', aid: 'A1', classes: '1-1', status: 'running', ends: '2026-10-26T03:00:00Z', scores: '{}' });
  assert.equal(f.begin({ clientId: 'test-phone-b' }).result.code, 'ATTEMPT_ACTIVE');
});
