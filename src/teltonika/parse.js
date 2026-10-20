// -----------------------------------------------------------------------------
// The answers of the RutOS API, read into plain objects (pure). Ported from
// the pydantic models of teltasync (Apache-2.0: see THIRD_PARTY_NOTICES.md):
// the envelope { success, data, errors[] }, "N/A" read as nothing, the online
// and offline shapes of a modem.
//
// Only what the integration shows is kept. The IMEI, the IMSI, the ICCID, the
// serial numbers, the cell ids and the area codes are never copied out of the
// answer: the router serial only becomes a SHA-256 identity, so that a command
// can check it talks to the same router. A text that holds a long run of
// digits (an IMSI, an ICCID or a phone number in a field that should not
// have one) or a MAC address is dropped.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { LIMITS } from '../constants.js';

/** A modem id as RutOS gives it (its USB path: `2-1`, `1-1.4`, `3-1`). */
export const MODEM_ID = /^[a-z0-9][a-z0-9._-]{0,31}$/;

const MAC = [
  /\b[0-9a-f]{2}([:-])(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}\b/i,
  /\b[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}\b/i,
  /\b[0-9a-f]{12}\b/i,
];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (object, key) =>
  isObject(object) && Object.hasOwn(object, key) ? object[key] : undefined;

/** A text to show: control characters removed, cut, nothing that looks like a number of a person. */
export function cleanText(value, max = LIMITS.TEXT_LENGTH) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (!text || text === 'N/A' || text.length > 512) return null;
  // Eight digits or more in a row (spaces and dashes allowed): an IMSI, an
  // ICCID, an IMEI, a phone number. Never shown.
  if (/\+?\d(?:[\s-]?\d){7,}/.test(text)) return null;
  // A MAC address, written with colons, dashes or dots, or as 12 hex digits.
  if (MAC.some((pattern) => pattern.test(text))) return null;
  return text.slice(0, max);
}

/** A number within [min, max] (number or numeric text), else null. "N/A" is null. */
export function number(value, min, max) {
  let n = value;
  if (typeof value === 'string') {
    if (value.trim() === '' || value.length > 24) return null;
    n = Number(value);
  }
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** A byte counter: a safe non-negative integer, else null. */
const counter = (value) => {
  const n = number(value, 0, Number.MAX_SAFE_INTEGER);
  return n !== null && Number.isInteger(n) ? n : null;
};

/** The envelope of every answer: { success, data, errors: [{ code, error }] } or null. */
export function parseEnvelope(json) {
  if (!isObject(json) || typeof json.success !== 'boolean') return null;
  const errors = Array.isArray(json.errors)
    ? json.errors
        .slice(0, 10)
        .filter(isObject)
        .map((e) => ({
          code: number(e.code, 0, 1_000_000),
          error: cleanText(e.error, 120),
        }))
    : [];
  return { success: json.success, data: own(json, 'data'), errors };
}

/** Data connection: true connected, false disconnected, null unknown. */
function dataState(raw) {
  for (const key of ['data_conn_state', 'state']) {
    const value = own(raw, key);
    if (value === 'Connected') return true;
    if (value === 'Disconnected') return false;
  }
  return null;
}

/** The SIM: the PIN state when it asks something (PIN, PUK, failure), else the SIM state. */
function simState(raw) {
  const pin = cleanText(own(raw, 'pinstate'));
  if (pin && pin !== 'Inserted') return pin;
  return cleanText(own(raw, 'simstate')) ?? pin;
}

/** One modem of GET /modems/status, or null when it has no usable id. */
export function parseModem(raw) {
  if (!isObject(raw)) return null;
  const rawId = own(raw, 'id');
  const id = typeof rawId === 'string' ? rawId.trim().toLowerCase() : '';
  if (!MODEM_ID.test(id)) return null;
  const name = cleanText(own(raw, 'name'));
  // The offline shape: { id, name, offline, blocked, disabled, ... } (teltasync ModemStatusOffline).
  const offline = own(raw, 'offline') !== undefined && own(raw, 'operator') === undefined;
  const make = [cleanText(own(raw, 'manufacturer')), cleanText(own(raw, 'model'))]
    .filter(Boolean)
    .join(' ');
  if (offline) {
    return {
      id,
      name,
      make: make || null,
      online: false,
      dataConnected: false,
      operator: null,
      networkType: null,
      band: null,
      simState: null,
      rssi: null,
      rsrp: null,
      rsrq: null,
      sinr: null,
      temperature: null,
      rx: null,
      tx: null,
    };
  }
  return {
    id,
    name,
    make: make || null,
    online: true,
    dataConnected: dataState(raw),
    operator: cleanText(own(raw, 'operator')) ?? cleanText(own(raw, 'oper')),
    networkType: cleanText(own(raw, 'conntype')) ?? cleanText(own(raw, 'ntype')),
    band: cleanText(own(raw, 'band')),
    simState: simState(raw),
    rssi: number(own(raw, 'rssi') ?? own(raw, 'signal'), -150, 0),
    rsrp: number(own(raw, 'rsrp'), -160, 0),
    rsrq: number(own(raw, 'rsrq'), -40, 10),
    sinr: number(own(raw, 'sinr'), -30, 60),
    temperature: number(own(raw, 'temperature'), -40, 150),
    rx: counter(own(raw, 'rxbytes')),
    tx: counter(own(raw, 'txbytes')),
  };
}

/** GET /modems/status: { modems, invalid } (LIMITS.MODEMS at most), or null when not a list. */
export function parseModems(json) {
  const envelope = parseEnvelope(json);
  if (!envelope?.success || !Array.isArray(envelope.data)) return null;
  const modems = new Map();
  let invalid = 0;
  for (const raw of envelope.data.slice(0, 64)) {
    const modem = parseModem(raw);
    if (!modem) {
      invalid += 1;
      continue;
    }
    // The same id twice: the first one is kept.
    if (!modems.has(modem.id) && modems.size < LIMITS.MODEMS) modems.set(modem.id, modem);
  }
  return { modems: [...modems.values()], invalid };
}

/**
 * GET /system/device/status: { model, firmware, name, identity } or null.
 * `identity`: a SHA-256 of the serial number and the model (the serial itself
 * is not kept), null when the router gives neither.
 */
export function parseDeviceStatus(json) {
  const envelope = parseEnvelope(json);
  const data = envelope?.success ? envelope.data : null;
  if (!isObject(data)) return null;
  const info = own(data, 'static');
  const mnf = own(data, 'mnfinfo');
  if (!isObject(info)) return null;
  const model = cleanText(own(info, 'model')) ?? cleanText(own(mnf, 'name'));
  const serial = own(mnf, 'serial');
  const identity =
    typeof serial === 'string' && serial.trim()
      ? createHash('sha256')
          .update(JSON.stringify([serial.trim(), model ?? '']))
          .digest('hex')
      : null;
  return {
    model,
    firmware: cleanText(own(info, 'fw_version')),
    name: cleanText(own(info, 'device_name')) ?? cleanText(own(info, 'hostname')),
    identity,
  };
}

/** POST /login: { token, expires } or null. */
export function parseLogin(json) {
  const envelope = parseEnvelope(json);
  if (!envelope?.success) return null;
  const token = own(envelope.data, 'token');
  if (typeof token !== 'string' || !/^[\x21-\x7e]{8,4096}$/.test(token)) return null;
  return { token, expires: number(own(envelope.data, 'expires'), 1, 86_400) };
}
