'use strict';

const assert = require('node:assert/strict');
const { createFixture, ok } = require('./fixture.cjs');

// Runs the real doPost + SheetStore against a small in-memory Sheets adapter.
// It models completed writes and injected transport failures, not Google's service performance.
function createGasFixture(options = {}) {
  const f = createFixture(options);
  const { runtime, data } = f;
  const cacheData = new Map();
  const properties = new Map([['LIVE_SHEET_DROPPED', '1']]);
  const faults = [];
  const writes = [];
  const sheets = new Map();
  let sequence = 0;
  let locked = false;
  let lockCount = 0;
  let lockHook = null;
  const cache = {
    get: key => {
      const entry = cacheData.get(key);
      return entry && entry.expires > f.time() ? entry.value : null;
    },
    put: (key, value, seconds) => cacheData.set(key, { value: String(value), expires: f.time() + seconds * 1000 }),
    getAll: keys => Object.fromEntries(keys.map(key => [key, cache.get(key)]).filter(([, value]) => value !== null)),
    putAll: (values, seconds) => Object.entries(values).forEach(([key, value]) => cache.put(key, value, seconds)),
    remove: key => cacheData.delete(key),
    removeAll: keys => keys.forEach(key => cacheData.delete(key))
  };
  function fault(key, phase, operation, row) {
    const item = faults.find(item => item.remaining > 0 && item.key === key && item.phase === phase &&
      (!item.operation || item.operation === operation) && (item.minimumRow || 0) <= row);
    if (item) {
      item.remaining--;
      throw new Error(`Injected ${phase}-write failure: ${key}/${operation}`);
    }
  }
  function decode(value) { return typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value; }
  function makeSheet(key, rows) {
    const sheet = {
      key, rows,
      getLastRow: () => rows.length,
      getLastColumn: () => Math.max(0, ...rows.map(row => row.length)),
      setFrozenRows: () => sheet,
      getRange(row, column, height = 1, width = 1) {
        const range = {
          getValues: () => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => rows[row - 1 + r]?.[column - 1 + c] ?? '')),
          setValues(values) {
            fault(key, 'before', 'setValues', row);
            for (let r = 0; r < height; r++) {
              rows[row - 1 + r] ||= [];
              for (let c = 0; c < width; c++) rows[row - 1 + r][column - 1 + c] = decode(values[r][c]);
            }
            writes.push({ key, operation: 'setValues', row, locked });
            fault(key, 'after', 'setValues', row);
            return range;
          },
          setValue: value => range.setValues([[value]]),
          setNumberFormats: () => range,
          setNumberFormat: () => range,
          setFontWeight: () => range,
          setBackground: () => range
        };
        return range;
      },
      appendRow(values) {
        const row = rows.length + 1;
        fault(key, 'before', 'appendRow', row);
        rows.push(values.map(decode));
        writes.push({ key, operation: 'appendRow', row, locked });
        fault(key, 'after', 'appendRow', row);
        return sheet;
      },
      deleteRow: row => rows.splice(row - 1, 1)
    };
    return sheet;
  }
  for (const [key, definition] of Object.entries(runtime.SHEETS)) {
    const source = key === 'settings' ? Object.entries(data.settings).map(([name, value]) => ({ key: name, value }))
      : key === 'bests' ? Object.values(data.bests) : data[key] || [];
    sheets.set(definition.name, makeSheet(key, [definition.cols.map(column => column[1]),
      ...source.map(item => definition.cols.map(column => item[column[0]] ?? ''))]));
  }
  const spreadsheet = {
    getSheetByName: name => sheets.get(name),
    insertSheet: name => { const sheet = makeSheet(name, []); sheets.set(name, sheet); return sheet; }
  };
  const lock = {
    tryLock() {
      if (locked) return false;
      locked = true;
      lockCount++;
      if (lockHook) { const callback = lockHook; lockHook = null; callback(); }
      return true;
    },
    releaseLock: () => { locked = false; }
  };
  runtime.SpreadsheetApp = { openById: () => spreadsheet, getActiveSpreadsheet: () => spreadsheet, flush() {} };
  runtime.CacheService = { getScriptCache: () => cache };
  runtime.LockService = { getScriptLock: () => lock };
  runtime.PropertiesService = { getScriptProperties: () => ({ getProperty: key => properties.get(key) || null,
    setProperty: (key, value) => properties.set(key, String(value)) }) };
  runtime.Utilities = { sleep() {}, formatDate: (date, zone, format) => {
    const jst = new Date(date.getTime() + 9 * 3600000).toISOString();
    return format.includes('HH') ? jst.slice(0, 16) : jst.slice(0, 10);
  } };
  runtime.ContentService = { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) };
  runtime.GAS_CTX = { ...f.ctx, cacheGet: cache.get, cachePut: cache.put, cacheRemove: cache.remove };

  function call(action, payload = {}) {
    return JSON.parse(runtime.doPost({ postData: { contents: JSON.stringify({ action, payload }) } }).text);
  }
  function begin(overrides = {}) {
    const payload = { token: f.tokens[0], clientId: 'test-ipad-a', aid: 'A1', type: 1, rid: `gas-begin-${++sequence}`, ...overrides };
    return { payload, result: call('beginAttempt', payload) };
  }
  function submit(start, overrides = {}) {
    const payload = f.payloadFor(start, { rid: `gas-submit-${++sequence}`, ...overrides });
    f.advance(30000);
    return { payload, result: call('submit', payload) };
  }
  function rows(key) {
    const definition = runtime.SHEETS[key];
    return sheets.get(definition.name).rows.slice(1).filter(row => row.some(value => value !== '')).map(row =>
      Object.fromEntries(definition.cols.map((column, i) => [column[0], row[i] ?? ''])));
  }
  return { ...f, call, begin, submit, rows, writes,
    freshStore: () => new runtime.SheetStore({ fresh: true, request: true }),
    injectFailure: (key, { phase = 'before', count = 1, operation, minimumRow = 2 } = {}) => faults.push({ key, phase, remaining: count, operation, minimumRow }),
    clearFailures: () => { faults.length = 0; },
    clearCache: () => cacheData.clear(),
    lockCount: () => lockCount,
    onNextLock: callback => { assert.equal(lockHook, null); lockHook = callback; },
    assertUnlocked: () => assert.equal(locked, false)
  };
}

module.exports = { createGasFixture };
