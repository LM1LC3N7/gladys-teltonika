// -----------------------------------------------------------------------------
// The answers of RutOS read into plain objects (src/teltonika/parse.js): the
// shapes of the teltasync fixtures, "N/A", the offline modem, the caps, and
// no identifier ever copied out.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanText,
  number,
  parseDeviceStatus,
  parseLogin,
  parseModem,
  parseModems,
} from '../src/teltonika/parse.js';
import { SECRETS, deviceStatus, modem } from './helpers/fakeRouter.js';

test('an online modem: the values shown, no identifier', () => {
  const parsed = parseModem(modem());
  assert.deepEqual(parsed, {
    id: '2-1',
    name: 'Internal modem',
    make: 'Quectel RG501Q-EU',
    online: true,
    dataConnected: true,
    operator: 'Orange F',
    networkType: '5G (NSA)',
    band: '5G N78',
    simState: 'Inserted',
    rssi: -58,
    rsrp: -86,
    rsrq: -7,
    sinr: 13,
    temperature: 45,
    rx: 10_000_000,
    tx: 2_000_000,
  });
  const text = JSON.stringify(parsed);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), secret);
});

test('"N/A", strings, old fields, a PIN asked', () => {
  const parsed = parseModem({
    id: '1-1.4',
    oper: 'Bouygues',
    ntype: 'LTE',
    signal: '-91',
    rsrp: 'N/A',
    state: 'Disconnected',
    pinstate: 'Required PIN, 3 attempts left',
    simstate: 'Inserted',
  });
  assert.equal(parsed.operator, 'Bouygues');
  assert.equal(parsed.networkType, 'LTE');
  assert.equal(parsed.rssi, -91);
  assert.equal(parsed.rsrp, null);
  assert.equal(parsed.dataConnected, false);
  assert.equal(parsed.simState, 'Required PIN, 3 attempts left');
  assert.equal(parseModem({ id: '3-1', operator: 'x' }).dataConnected, null);
});

test('an offline modem: data not connected, nothing else', () => {
  const parsed = parseModem({ id: '3-1', name: 'External modem', offline: '1', blocked: 0 });
  assert.equal(parsed.online, false);
  assert.equal(parsed.dataConnected, false);
  assert.equal(parsed.rssi, null);
});

test('ids: normalized, invalid ones left out, duplicates and the cap', () => {
  assert.equal(parseModem({ id: 'A-1' }).id, 'a-1');
  for (const id of ['', '../x', 'a:b', 'x'.repeat(40), 12, null]) {
    assert.equal(parseModem({ id }), null, String(id));
  }
  const list = Array.from({ length: 12 }, (_, i) => modem(`${i}-1`));
  list.push(modem('0-1', { operator: 'second' }), { id: 'bad id' });
  const { modems, invalid } = parseModems({ success: true, data: list });
  assert.equal(modems.length, 8);
  assert.equal(modems[0].operator, 'Orange F', 'the first of a duplicate');
  assert.equal(invalid, 1);
  assert.equal(parseModems({ success: false, errors: [] }), null);
  assert.equal(parseModems({ success: true, data: {} }), null);
  assert.equal(parseModems([]), null);
});

test('values out of range or not numbers are nothing', () => {
  assert.equal(number(-200, -150, 0), null);
  assert.equal(number('1e400', -1e9, 1e9), null);
  assert.equal(number('', 0, 1), null);
  assert.equal(number(true, 0, 1), null);
  assert.equal(parseModem(modem('2-1', { rxbytes: -1, txbytes: 1.5 })).rx, null);
  assert.equal(parseModem(modem('2-1', { txbytes: 1.5 })).tx, null);
  assert.equal(parseModem(modem('2-1', { temperature: 'hot' })).temperature, null);
});

test('texts: control characters removed, cut, no number of a person', () => {
  assert.equal(cleanText('Orange\nF'), 'Orange F');
  assert.equal(cleanText('x'.repeat(100)).length, 64);
  assert.equal(cleanText('N/A'), null);
  for (const value of [
    '+33612345678',
    'Call 06 12 34 56 78',
    '208011234567890',
    '8933-0123-4567',
  ]) {
    assert.equal(cleanText(value), null, value);
  }
  assert.equal(cleanText('RUTX_R_00.07.13.3'), 'RUTX_R_00.07.13.3');
  assert.equal(cleanText('20801'), '20801');
  assert.equal(parseModem(modem('2-1', { operator: '+33612345678' })).operator, null);
});

test('device status: model, firmware, name; the serial only as a hash', () => {
  const parsed = parseDeviceStatus({ success: true, data: deviceStatus() });
  assert.equal(parsed.model, 'RUTX50');
  assert.equal(parsed.firmware, 'RUTX_R_00.07.13.3');
  assert.equal(parsed.name, 'RUTX50');
  assert.match(parsed.identity, /^[0-9a-f]{64}$/);
  const text = JSON.stringify(parsed);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), secret);
  const other = parseDeviceStatus({ success: true, data: deviceStatus({ serial: 'X2' }) });
  assert.notEqual(other.identity, parsed.identity);
  assert.equal(parseDeviceStatus({ success: true, data: { mnfinfo: {} } }), null);
  const noSerial = parseDeviceStatus({ success: true, data: { static: { model: 'RUT241' } } });
  assert.equal(noSerial.identity, null);
});

test('login: a token or nothing', () => {
  assert.deepEqual(parseLogin({ success: true, data: { token: 'abcdefgh123', expires: 299 } }), {
    token: 'abcdefgh123',
    expires: 299,
  });
  assert.equal(parseLogin({ success: true, data: { token: 'a b' } }), null);
  assert.equal(parseLogin({ success: false }), null);
  assert.equal(parseLogin({ success: true, data: { token: 'abcdefgh123' } }).expires, null);
});

test('no prototype pollution from an answer', () => {
  const json = JSON.parse(
    '{"success":true,"data":[{"__proto__":{"polluted":1},"id":"2-1","constructor":{"x":1}}]}',
  );
  const { modems } = parseModems(json);
  assert.equal(modems.length, 1);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(modems[0]), Object.prototype);
});
