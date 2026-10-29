'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture, ok, WORDS } = require('./helpers/fixture.cjs');

function save(f, autoRules, extra = {}) {
  return f.call('t_saveSettings', { token: f.admin, settings: { autoRules, ...extra } });
}
function stampsOf(f, i = 0) {
  return JSON.parse(f.data.students[i].ach || '{}').st || [];
}
const rule = (o) => ({ id: 'u' + Math.random().toString(36).slice(2, 8), on: true, ...o });

test('built-in thresholds can be changed and are used when stamping', () => {
  const f = createFixture();
  ok(save(f, { p: { week3: 1, perfect: 60 }, c: [] }), 'save');
  const ov = ok(f.call('t_overview', { token: f.admin }));
  assert.equal(ov.settings.autoRules.p.week3, 1);
  assert.match(ov.settings.autoRules.rules.find(r => r.id === 'week3').name, /1週間に1日/);
  ok(f.read().result);
  const rules = stampsOf(f).map(x => x.r);
  assert.ok(rules.includes('week3'), 'week3 fires on the first day when set to 1: ' + rules);
});

test('built-in threshold out of range is rejected', () => {
  const f = createFixture();
  const r = save(f, { p: { week3: 9 }, c: [] });
  assert.equal(r.ok, false);
});

test('custom rules: day words, accuracy, specific assignment, weekday and repetition limit', () => {
  const f = createFixture();
  const dow = new Date(Date.parse('2026-10-26T02:00:00.000Z') + 9 * 3600e3).getUTCDay();
  const rs = [
    rule({ type: 'dayWords', n: WORDS, rep: 'day' }),
    rule({ type: 'accuracy', n: 80, rep: 'week' }),
    rule({ type: 'assign', aid: 'A1', at: 'Reading practice' }),
    rule({ type: 'weekday', n: dow }),
    rule({ type: 'totalCount', n: 2 }),
    rule({ type: 'dayCount', n: 1, on: false })
  ];
  ok(save(f, { c: rs }), 'save rules');
  ok(f.read().result, 'first read');
  let got = stampsOf(f).filter(x => x.r && x.r[0] === 'u').map(x => x.r);
  assert.ok(got.includes(rs[0].id), 'dayWords');
  assert.ok(got.includes(rs[1].id), 'accuracy');
  assert.ok(got.includes(rs[3].id), 'weekday');
  assert.ok(!got.includes(rs[4].id), 'totalCount not yet');
  assert.ok(!got.includes(rs[5].id), 'disabled rule never fires');
  const named = stampsOf(f).find(x => x.r === rs[1].id);
  assert.match(named.rn, /正確さ80%以上/);
  f.advance(60000);
  ok(f.read().result, 'second read');
  got = stampsOf(f).filter(x => x.r && x.r[0] === 'u').map(x => x.r);
  assert.equal(got.filter(id => id === rs[1].id).length, 1, 'accuracy only once per week');
  assert.equal(got.filter(id => id === rs[0].id).length, 1, 'dayWords crossing only once');
  assert.ok(got.includes(rs[4].id), 'totalCount fires on the 2nd reading');
});

test('streak rule fires when the streak reaches N', () => {
  const f = createFixture();
  const r1 = rule({ type: 'streak', n: 2 });
  ok(save(f, { c: [r1] }));
  ok(f.read().result);
  assert.ok(!stampsOf(f).some(x => x.r === r1.id));
  f.advance(24 * 3600e3);
  ok(f.read().result);
  assert.ok(stampsOf(f).some(x => x.r === r1.id), 'streak 2 reached on day 2');
});

test('invalid custom rules are rejected and the list is limited to 40', () => {
  const f = createFixture();
  assert.equal(save(f, { c: [rule({ type: 'streak', n: 1 })] }).ok, false, 'streak below 2');
  assert.equal(save(f, { c: [rule({ type: 'assign' })] }).ok, false, 'assign without aid');
  assert.equal(save(f, { c: [rule({ type: 'period', from: '2026-11-02', to: '2026-11-01' })] }).ok, false, 'reversed period');
  assert.equal(save(f, { c: [rule({ type: 'nope', n: 1 })] }).ok, false, 'unknown type');
  const many = Array.from({ length: 41 }, () => rule({ type: 'dayCount', n: 2 }));
  assert.equal(save(f, { c: many }).ok, false, 'over 40');
});

test('custom rules can get a teacher-made stamp picture and appear in the stamps screen', () => {
  const f = createFixture();
  const r1 = rule({ type: 'dayCount', n: 1 });
  ok(save(f, { c: [r1] }));
  const st = ok(f.call('t_stamps', { token: f.admin }));
  assert.ok(st.rules.some(r => r.id === r1.id), 'listed');
  assert.ok(st.on.includes(r1.id), 'on');
  ok(f.call('t_saveStamp', { token: f.admin, stamp: { kind: 'art', animal: 'cat', text: 'Nice!' } }));
  const sid = ok(f.call('t_stamps', { token: f.admin })).custom[0].id;
  ok(save(f, undefined, { autoArt: { [r1.id]: sid } }));
  ok(f.read().result);
  const got = stampsOf(f).find(x => x.r === r1.id);
  assert.equal(got.t, 'Nice!');
});

test('non-admin teachers do not receive the rule editor data', () => {
  const f = createFixture();
  const ov = ok(f.call('t_overview', { token: f.teacher }));
  assert.equal(ov.settings.autoRules, undefined);
  assert.equal(f.call('t_saveSettings', { token: f.teacher, settings: { autoRules: { c: [] } } }).ok, false);
});
