'use strict';

// Service-operation comparison only. No network requests or wall-time claims.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createGasFixture } = require('../tests/helpers/fake-gas.cjs');
const { ok, ROOT } = require('../tests/helpers/fixture.cjs');

const args = process.argv.slice(2);
let baseline = null;
let counts = [166, 1000];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--baseline') baseline = path.resolve(args[++i]);
  else if (args[i] === '--counts') counts = args[++i].split(',').map(Number);
  else throw new Error(`Unknown option: ${args[i]}`);
}
assert.ok(counts.length && counts.every(count => Number.isInteger(count) && count >= 2 && count <= 10000), 'Student counts must be integers in 2..10000');

function hash(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function source(label, directory) {
  const codePath = path.join(directory, 'Code.gs');
  const indexPath = path.join(directory, 'index.html');
  return { label, codePath, indexPath, sha256: { code: hash(codePath), index: hash(indexPath) } };
}
const sources = [source('current', ROOT)];
if (baseline) sources.unshift(source('baseline', baseline));

function measure(input, studentCount) {
  const f = createGasFixture({ codePath: input.codePath, indexPath: input.indexPath, studentCount });
  const scenarios = {};
  function capture(name, fn) {
    f.resetOperations();
    const result = fn();
    scenarios[name] = f.summary();
    return result;
  }
  function cancel(start) {
    return ok(f.call('cancelAttempt', { token: start.payload.token, clientId: start.payload.clientId,
      attemptId: start.result.attempt.id, rid: 'performance-report-cancel' }));
  }
  const cold = capture('coldBegin', () => { const start = f.begin(); ok(start.result); return start; });
  capture('warmCancel', () => cancel(cold));
  const warm = capture('warmBegin', () => { const start = f.begin(); ok(start.result); return start; });
  capture('normalSubmit', () => ok(f.submit(warm).result));
  const next = capture('afterSuccessfulSubmitBegin', () => { const start = f.begin(); ok(start.result); return start; });
  capture('afterSuccessfulSubmitCancel', () => cancel(next));
  f.clearCache();
  capture('afterCacheEvictionBegin', () => { const start = f.begin(); ok(start.result); return start; });
  return { source: input.label, studentCount, scenarios };
}

const results = [];
for (const input of sources) for (const count of counts) results.push(measure(input, count));
for (const input of sources) {
  assert.equal(hash(input.codePath), input.sha256.code, 'Code changed while measuring; rerun against a stable snapshot');
  assert.equal(hash(input.indexPath), input.sha256.index, 'HTML changed while measuring; rerun against a stable snapshot');
}
console.log(JSON.stringify({
  evidence: 'ローカルの偽GAS環境で実コードが要求したサービス操作数です。待ち時間・実サービスの速度・同時接続性能の実測ではありません。',
  definitions: {
    readCells: 'getValuesでアプリ側へ返されるセル数。',
    searchedRangeCells: 'TextFinderに指定した検索範囲のセル数。Google内部の実走査量を示しません。',
    writes: 'setValues/appendRowの呼出し回数。書式設定はformatCallsに分離。',
    lock: 'insideLock/outsideLockはそのサービス要求時にこの試験の共通ロックを保持していたかを示します。',
    cache: 'ウォームは直前の開始・取消でキャッシュが存在する条件。cache evictionは全キャッシュ消失の条件です。'
  },
  sources: sources.map(input => ({ label: input.label, sha256: input.sha256 })),
  results
}, null, 2));
