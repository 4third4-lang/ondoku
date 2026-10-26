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
  const operations = [];
  const sheets = new Map();
  let sequence = 0;
  let locked = false;
  let lockCount = 0;
  let lockHook = null;
  let flushFailures = 0;
  function track(kind, key, operation, details = {}) {
    const event = { kind, key, operation, locked, ...details };
    operations.push(event);
    return event;
  }
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
      getLastRow: () => { track('metadata', key, 'getLastRow'); return rows.length; },
      getLastColumn: () => { track('metadata', key, 'getLastColumn'); return Math.max(0, ...rows.map(row => row.length)); },
      setFrozenRows: () => sheet,
      getRange(row, column, height = 1, width = 1) {
        const dimensions = { row, column, height, width, cells: height * width };
        const range = {
          getValues: () => {
            track('read', key, 'getValues', dimensions);
            return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => rows[row - 1 + r]?.[column - 1 + c] ?? ''));
          },
          setValues(values) {
            const event = track('write', key, 'setValues', { ...dimensions, succeeded: false });
            fault(key, 'before', 'setValues', row);
            for (let r = 0; r < height; r++) {
              rows[row - 1 + r] ||= [];
              for (let c = 0; c < width; c++) rows[row - 1 + r][column - 1 + c] = decode(values[r][c]);
            }
            writes.push({ key, operation: 'setValues', row, locked });
            event.succeeded = true;
            fault(key, 'after', 'setValues', row);
            return range;
          },
          setValue: value => range.setValues([[value]]),
          setNumberFormats: () => { track('format', key, 'setNumberFormats', dimensions); return range; },
          setNumberFormat: () => { track('format', key, 'setNumberFormat', dimensions); return range; },
          setFontWeight: () => { track('format', key, 'setFontWeight', dimensions); return range; },
          setBackground: () => { track('format', key, 'setBackground', dimensions); return range; }
        };
        if (options.textFinder !== false) range.createTextFinder = searchText => {
          let entire = false;
          let matchCase = false;
          function matches() {
            const target = matchCase ? String(searchText) : String(searchText).toLowerCase();
            const found = [];
            for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
              const raw = String(rows[row - 1 + r]?.[column - 1 + c] ?? '');
              const value = matchCase ? raw : raw.toLowerCase();
              if (entire ? value === target : value.includes(target)) found.push({ row: row + r, column: column + c });
            }
            return found;
          }
          const finder = {
            matchEntireCell(value) { entire = value; return finder; },
            matchCase(value) { matchCase = value; return finder; },
            useRegularExpression(value) { assert.equal(value, false, 'Regex TextFinder is not modeled by this adapter'); return finder; },
            findNext() {
              track('search', key, 'TextFinder.findNext', { ...dimensions, searchedRangeCells: height * width });
              const item = matches()[0];
              return item ? { getRow: () => item.row, getColumn: () => item.column } : null;
            },
            findAll() {
              track('search', key, 'TextFinder.findAll', { ...dimensions, searchedRangeCells: height * width });
              return matches().map(item => ({ getRow: () => item.row, getColumn: () => item.column }));
            }
          };
          return finder;
        };
        return range;
      },
      appendRow(values) {
        const row = rows.length + 1;
        const event = track('write', key, 'appendRow', { row, column: 1, height: 1, width: values.length, cells: values.length, succeeded: false });
        fault(key, 'before', 'appendRow', row);
        rows.push(values.map(decode));
        writes.push({ key, operation: 'appendRow', row, locked });
        event.succeeded = true;
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
      const event = track('lock', '', 'tryLock', { succeeded: false });
      if (locked) return false;
      locked = true;
      lockCount++;
      event.succeeded = true;
      if (lockHook) { const callback = lockHook; lockHook = null; callback(); }
      return true;
    },
    releaseLock: () => { track('lock', '', 'releaseLock'); locked = false; }
  };
  runtime.SpreadsheetApp = {
    openById: () => { track('open', '', 'openById'); return spreadsheet; },
    getActiveSpreadsheet: () => { track('open', '', 'getActiveSpreadsheet'); return spreadsheet; },
    flush() {
      const event = track('flush', '', 'flush', { succeeded: false });
      if (flushFailures > 0) { flushFailures--; throw new Error('Injected SpreadsheetApp.flush failure'); }
      event.succeeded = true;
    }
  };
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
  function summary() {
    function count(events) {
      const result = { readCalls: 0, readCells: 0, searchCalls: 0, searchedRangeCells: 0, writeCalls: 0, writeCells: 0,
        formatCalls: 0, flushCalls: 0, metadataCalls: 0, openCalls: 0, lockAcquireCalls: 0, lockAcquired: 0, lockReleaseCalls: 0 };
      for (const event of events) {
        if (event.kind === 'read') { result.readCalls++; result.readCells += event.cells; }
        if (event.kind === 'search') { result.searchCalls++; result.searchedRangeCells += event.searchedRangeCells; }
        if (event.kind === 'write') { result.writeCalls++; result.writeCells += event.cells; }
        if (event.kind === 'format') result.formatCalls++;
        if (event.kind === 'flush') result.flushCalls++;
        if (event.kind === 'metadata') result.metadataCalls++;
        if (event.kind === 'open') result.openCalls++;
        if (event.operation === 'tryLock') { result.lockAcquireCalls++; if (event.succeeded) result.lockAcquired++; }
        if (event.operation === 'releaseLock') result.lockReleaseCalls++;
      }
      return result;
    }
    const keys = [...new Set(operations.map(event => event.key).filter(Boolean))];
    return { all: count(operations), insideLock: count(operations.filter(event => event.locked)),
      outsideLock: count(operations.filter(event => !event.locked)),
      bySheet: Object.fromEntries(keys.map(key => [key, count(operations.filter(event => event.key === key))])) };
  }
  return { ...f, call, begin, submit, rows, writes, operations, summary,
    freshStore: () => new runtime.SheetStore({ fresh: true, request: true }),
    injectFailure: (key, { phase = 'before', count = 1, operation, minimumRow = 2 } = {}) => faults.push({ key, phase, remaining: count, operation, minimumRow }),
    clearFailures: () => { faults.length = 0; flushFailures = 0; },
    injectFlushFailure: (count = 1) => { flushFailures = count; },
    clearCache: () => cacheData.clear(),
    resetOperations: () => { operations.length = 0; },
    swapSheetRows: (key, first, second) => {
      const rows = sheets.get(runtime.SHEETS[key].name).rows;
      assert.ok(first >= 2 && first <= rows.length && second >= 2 && second <= rows.length, 'Only populated data rows can be swapped');
      [rows[first - 1], rows[second - 1]] = [rows[second - 1], rows[first - 1]];
    },
    removeSheetRow: (key, row) => {
      const rows = sheets.get(runtime.SHEETS[key].name).rows;
      assert.ok(row >= 2 && row <= rows.length, 'Only a populated data row can be removed');
      rows.splice(row - 1, 1);
    },
    lockCount: () => lockCount,
    onNextLock: callback => { assert.equal(lockHook, null); lockHook = callback; },
    assertUnlocked: () => assert.equal(locked, false)
  };
}

module.exports = { createGasFixture };
