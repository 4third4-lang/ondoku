'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasFixture } = require('./helpers/fake-gas.cjs');
const { ok } = require('./helpers/fixture.cjs');

test('GAS: stamp name is stored in a new column on the stamps sheet', () => {
  const f = createGasFixture();
  ok(f.call('t_saveStamp', { token: f.admin, stamp: { kind: 'art', animal: 'cat', text: 'Great!', name: '運動会' } }), 'save');
  const rows = f.rows('stamps');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '運動会');
  assert.equal(rows[0].text, 'Great!');
  f.clearCache();
  assert.equal(ok(f.call('t_stamps', { token: f.admin })).custom[0].name, '運動会');
});
