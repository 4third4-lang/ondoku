'use strict';

const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const TEXT = 'My friends and I read interesting books together after school because every story helps us learn something new about the world.';
const WORDS = TEXT.split(/\s+/).length;

function loadRuntime(options = {}) {
  // No module/require binding: the bundled modules expose the same globals as GAS.
  const sandbox = vm.createContext({ console, Date, Math, Uint16Array });
  const codePath = path.resolve(ROOT, options.codePath || 'Code.gs');
  const indexPath = path.resolve(ROOT, options.indexPath || 'index.html');
  vm.runInContext(fs.readFileSync(codePath, 'utf8'), sandbox, { filename: codePath });
  const html = fs.readFileSync(indexPath, 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const memStore = scripts.find(script => /function MemStore\s*\(/.test(script));
  assert.ok(memStore, 'The actual browser MemStore module must be present');
  vm.runInContext(memStore, sandbox, { filename: 'index.html:MemStore' });
  return sandbox;
}

function ok(result, operation = 'operation') {
  assert.equal(result.ok, true, `${operation}: ${JSON.stringify(result)}`);
  return result;
}

function createFixture(options = {}) {
  const runtime = loadRuntime(options);
  let time = Date.parse(options.now || '2026-10-26T02:00:00.000Z');
  let sequence = 0;
  const cache = new Map();
  const ctx = {
    now: () => new Date(time),
    sign: value => createHmac('sha256', 'test-only-signing-secret').update(String(value)).digest('base64url'),
    b64: value => Buffer.from(value, 'utf8').toString('base64url'),
    unb64: value => Buffer.from(value, 'base64url').toString('utf8'),
    uuid: () => randomUUID(),
    cacheGet: key => {
      const entry = cache.get(key);
      return entry && entry.expires > time ? entry.value : null;
    },
    cachePut: (key, value, seconds) => cache.set(key, { value, expires: time + seconds * 1000 }),
    cacheRemove: key => cache.delete(key)
  };
  const data = {
    students: Array.from({ length: Math.max(2, options.studentCount || 2) }, (_, i) => i + 1)
      .map(no => ({ id: `1-1-${no}`, cls: '1-1', no, name: `Test student ${no}`, pass: '1234', totalWords: 0, todayWords: 0 })),
    teachers: [
      { id: 'admin', name: 'Test administrator', role: 'admin', classes: '', active: true, pass: 'admin-test' },
      { id: 'teacher', name: 'Test teacher', role: 'teacher', classes: '1-1', active: true, pass: 'teacher-test' }
    ],
    classes: [{ name: '1-1', count: Math.max(2, options.studentCount || 2) }],
    assignments: [{ id: 'A1', title: 'Reading practice', text: TEXT, ja: 'テスト用の和訳です。', classes: '1-1', published: true,
      types: '1,2,3,4,5', mode: 'normal', pass: 80, passCount: 10, words: WORDS, created: '2026-10-25T00:00:00.000Z' }],
    records: [],
    bests: {},
    settings: { 'ランキングを表示': 'TRUE', '合言葉チェック': 'TRUE', '自動無効チェック': 'TRUE', '音声を保存': 'FALSE', ...(options.settings || {}) }
  };
  const store = new runtime.MemStore(data);
  function call(action, payload = {}) {
    return runtime.Core.handle(action, payload, store, ctx);
  }
  const tokens = [1, 2].map(no => ok(call('studentLogin', { cls: '1-1', no, pass: '1234' }), 'studentLogin').token);
  const admin = ok(call('teacherLogin', { id: 'admin', pass: 'admin-test' }), 'administrator login').token;
  const teacher = ok(call('teacherLogin', { id: 'teacher', pass: 'teacher-test' }), 'teacher login').token;
  function begin(overrides = {}) {
    const payload = { token: tokens[0], rid: `begin-request-${++sequence}`, clientId: 'test-ipad-a', aid: 'A1', type: 1, ...overrides };
    return { payload, result: call('beginAttempt', payload) };
  }
  function transcriptFor(text, attempt) {
    if (!attempt.phrase) return text;
    return runtime.Scoring.phraseTokens(text, attempt.phrase, attempt.phraseAt)
      .filter(token => !token.phraseLabel && !token.ja && !token.speaker)
      .map(token => token.text).join('');
  }
  function payloadFor(start, overrides = {}) {
    const attempt = ok(start.result, 'beginAttempt').attempt;
    assert.ok(attempt && attempt.id, 'beginAttempt must return an attempt ID');
    const text = start.payload.aid ? store.getAssignment(start.payload.aid).text : start.payload.text;
    return { ...start.payload, rid: `submit-${++sequence}`, attemptId: attempt.id, transcript: transcriptFor(text, attempt),
      duration: 30, phrase: attempt.phrase, phraseAt: attempt.phraseAt, ...overrides };
  }
  function submit(start, overrides = {}) {
    const payload = payloadFor(start, overrides);
    time += 30000;
    return { payload, result: call('submit', payload) };
  }
  function read(overrides = {}) {
    const start = begin(overrides);
    return submit(start);
  }
  return { runtime, data, store, ctx, call, tokens, admin, teacher, begin, submit, read, payloadFor, transcriptFor,
    advance: milliseconds => { time += milliseconds; },
    setTime: value => { time = typeof value === 'number' ? value : Date.parse(value); },
    time: () => time,
    clearCache: () => cache.clear() };
}

module.exports = { createFixture, loadRuntime, ok, TEXT, WORDS, ROOT };
