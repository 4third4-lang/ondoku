/* Local-only UI state tests: no browser, audio playback, or production requests. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto').webcrypto;

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'UI test section remains identifiable');
  return source.slice(from, to);
}
const helpers = section('  function newRid()', '  function outboxKey()');
const outbox = section('  async function flushOutbox()', "  window.addEventListener('online'");

function harness() {
  let queue = [], confirmed = true;
  const calls = [], responses = [], events = {}, notices = [];
  const ctx = {
    state: { renderSeq: 1, session: { token: 'student-token' } },
    window: { crypto, addEventListener(name, fn) { events[name] = fn; } }, crypto,
    Uint32Array, Date, Math, Number, Promise, JSON, Object, Array, String, Error,
    document: { hidden: false }, navigator: {}, CFG: {},
    location: { hash: '#/a/test' }, n: x => String(x || 0), esc: x => String(x),
    render() {}, $() { return null; }, toast(message) { notices.push(message); },
    confirm: () => confirmed,
    outboxAdd(p, title) {
      queue = queue.filter(x => x.p.rid !== p.rid);
      queue.push({ p: JSON.parse(JSON.stringify(p)), title });
      return true;
    },
    outboxGet: () => queue, outboxSet: list => { queue = list; }, outboxBusy: false,
    API: {
      isDemo: () => false,
      call: async (action, payload) => { calls.push({ action, payload: { ...payload } }); return { ok: true }; }
    },
    call: async (action, payload) => {
      payload.token = 'student-token';
      calls.push({ action, payload: { ...payload } });
      const result = responses.shift();
      if (result instanceof Error) throw result;
      return typeof result === 'function' ? result() : result;
    }
  };
  vm.createContext(ctx);
  vm.runInContext(helpers, ctx);
  vm.runInContext(outbox, ctx);
  return { ctx, calls, responses, events, notices,
    queue: () => queue,
    setQueue(list) { queue = list; },
    confirm(value) { confirmed = value; }
  };
}
function netError() { return Object.assign(new Error('offline'), { net: true }); }
function activeError() { return Object.assign(new Error('active'), { code: 'ATTEMPT_ACTIVE', activeAttemptId: 'older-attempt', expiresAt: 'later' }); }

test('all inline scripts parse', () => {
  const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0);
  scripts.forEach((s, i) => new vm.Script(s[1], { filename: 'inline-' + i + '.js' }));
});

test('default repetition credit is five, bounded to 1 through 20', () => {
  const { ctx } = harness();
  assert.equal(ctx.repeatCreditLimit(), 5);
  assert.equal(ctx.repeatCreditLimit({ repeatCreditLimit: 8 }), 8);
  assert.equal(ctx.repeatCreditLimit({ repeatCreditLimit: -1 }), 1);
  assert.equal(ctx.repeatCreditLimit({ repeatCreditLimit: 99 }), 20);
});

test('each page has its own client ID and cancellation binds that ID', async () => {
  const h = harness(), second = harness();
  assert.notEqual(h.ctx.readingClientId, second.ctx.readingClientId);
  h.responses.push({ attempt: { id: 'a1', phrase: 'red fox seven', phraseAt: 2 } });
  const a = await h.ctx.beginReadingAttempt({ text: 'Hello', kind: 'repeat' });
  assert.equal(a.clientId, h.ctx.readingClientId);
  h.ctx.cancelReadingAttempt(a);
  assert.equal(h.calls.at(-1).action, 'cancelAttempt');
  assert.equal(h.calls.at(-1).payload.attemptId, 'a1');
  assert.equal(h.calls.at(-1).payload.clientId, a.clientId);
});

test('takeover requires confirmation and names the prior attempt', async () => {
  const h = harness();
  h.responses.push(activeError(), { attempt: { id: 'new-attempt' } });
  const a = await h.ctx.beginReadingAttempt({ text: 'Hello' });
  assert.equal(a.id, 'new-attempt');
  assert.equal(h.calls.at(-1).payload.expectedAttemptId, 'older-attempt');
  assert.equal(h.calls.at(-1).payload.takeover, true);
  assert.notEqual(h.calls[0].payload.rid, h.calls[1].payload.rid);
});

test('declining takeover sends no replacement request', async () => {
  const h = harness(); h.confirm(false); h.responses.push(activeError());
  assert.equal(await h.ctx.beginReadingAttempt({ text: 'Hello' }), null);
  assert.equal(h.calls.length, 1);
});

test('a network retry reuses the original begin request ID', async () => {
  const h = harness(); h.responses.push(netError());
  await assert.rejects(h.ctx.beginReadingAttempt({ text: 'Hello' }));
  const rid = h.calls.at(-1).payload.rid;
  h.responses.push({ attempt: { id: 'retry' } });
  await h.ctx.beginReadingAttempt({ text: 'Hello' });
  assert.equal(h.calls.at(-1).payload.rid, rid);
});

test('concurrent begin clicks do not dispatch parallel starts', async () => {
  const h = harness(); let resolve;
  h.responses.push(() => new Promise(r => { resolve = r; }));
  const first = h.ctx.beginReadingAttempt({ text: 'Hello' });
  await assert.rejects(h.ctx.beginReadingAttempt({ text: 'Hello' }), /少し待って/);
  resolve({ attempt: { id: 'first' } });
  await first;
  assert.equal(h.calls.filter(x => x.action === 'beginAttempt').length, 1);
});

test('a late grant after leaving the page is cancelled', async () => {
  const h = harness(); let resolve;
  h.responses.push(() => new Promise(r => { resolve = r; }));
  const pending = h.ctx.beginReadingAttempt({ text: 'Hello' });
  h.ctx.state.renderSeq++;
  resolve({ attempt: { id: 'late' } });
  assert.equal(await pending, null);
  assert.equal(h.calls.at(-1).action, 'cancelAttempt');
  assert.equal(h.calls.at(-1).payload.token, 'student-token');
});

test('a hidden page cannot retain a newly granted attempt', async () => {
  const h = harness(); h.ctx.document.hidden = true;
  h.responses.push({ attempt: { id: 'hidden' } });
  assert.equal(await h.ctx.beginReadingAttempt({ text: 'Hello' }), null);
  assert.equal(h.calls.at(-1).action, 'cancelAttempt');
});

test('submission network failure preserves attempt and request IDs for replay', async () => {
  const h = harness();
  h.responses.push({ attempt: { id: 'retry' } });
  const a = await h.ctx.beginReadingAttempt({ text: 'Hello' });
  const payload = { rid: 'submit1', transcript: 'Hello' };
  h.responses.push(netError());
  await assert.rejects(h.ctx.submitReadingAttempt(a, payload, 'test'), e => e.outboxSaved === true);
  assert.equal(h.queue()[0].p.attemptId, 'retry');
  assert.equal(h.queue()[0].p.clientId, a.clientId);
  assert.equal(h.queue()[0].p.rid, 'submit1');
  h.ctx.cancelReadingAttempt(a);
  assert.equal(h.calls.at(-1).action, 'submit', 'submitting attempt is not cancelled');
  h.responses.push({ ok: true, credit: { rankWords: 5 } });
  await h.ctx.submitReadingAttempt(a, payload, 'test');
  assert.equal(h.queue().length, 0);
});

test('a permanent submission error cancels the attempt and removes automatic retries', async () => {
  const h = harness();
  h.responses.push({ attempt: { id: 'a1' } });
  const a = await h.ctx.beginReadingAttempt({ text: 'Hello' });
  h.responses.push(Object.assign(new Error('expired'), { code: 'ATTEMPT_EXPIRED' }));
  await assert.rejects(h.ctx.submitReadingAttempt(a, { rid: 's1' }, 'test'));
  assert.equal(h.calls.at(-1).action, 'cancelAttempt');
  assert.equal(h.queue().length, 0);
});

test('outbox retains rejected records with a visible failure reason', async () => {
  const h = harness();
  h.setQueue([{ p: { rid: 'old', attemptId: 'expired' }, title: 'Practice' }]);
  h.responses.push(new Error('音読の有効期限が切れています'));
  await h.ctx.flushOutbox();
  assert.equal(h.queue().length, 1);
  assert.match(h.queue()[0].failed, /有効期限/);
  assert.match(h.ctx.outboxNoticeHTML(), /有効期限/);
  const count = h.calls.length;
  await h.ctx.flushOutbox();
  assert.equal(h.calls.length, count, 'rejected record is not retried indefinitely');
});

test('outbox completion preserves a newer submission added during transmission', async () => {
  const h = harness();
  h.setQueue([{ p: { rid: 'old' }, title: 'Old' }]);
  h.responses.push(() => { h.ctx.outboxAdd({ rid: 'new' }, 'New'); return { ok: true }; });
  await h.ctx.flushOutbox();
  assert.equal(h.queue().length, 1);
  assert.equal(h.queue()[0].p.rid, 'new');
});

test('outbox does not race a submission already in flight', async () => {
  const h = harness();
  h.setQueue([{ p: { rid: 'current' }, title: 'Current' }]);
  h.ctx.submissionsInFlight.current = true;
  await h.ctx.flushOutbox();
  assert.equal(h.calls.length, 0);
  assert.equal(h.queue().length, 1);
});
