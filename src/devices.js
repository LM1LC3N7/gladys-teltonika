// -----------------------------------------------------------------------------
// Gladys devices (pure).
//
//   router  `ext:<selector>:router:main`
//           firmware (text), reboot (button, refused unless allowed)
//   modem   `ext:<selector>:modem:<modem id>`
//           mobile data connected, signal bars, RSSI / RSRP / RSRQ / SINR,
//           operator, network type, band, SIM, temperature, download and
//           upload rates, data received and sent
//
// Every reading is read only. The reboot is a `button`/`push` feature, never
// a switch nor a binary: a "turn everything off" of a voice assistant, MCP or
// a `switch` scene action must not reach it.
//
// A device published again never loses a feature: the core would mark it
// `structure_changed`, and "Update" would drop the history of the missing
// one. The features of the device created in Gladys (`gladys.devices`, kept
// up to date by the SDK) are added back when the blueprint lacks them.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { FEATURES, MODEM_TYPE, ROUTER_ID, ROUTER_TYPE } from './constants.js';
import { MODEM_ID } from './teltonika/parse.js';

export const routerIds = (gladys) => gladys.externalIds(ROUTER_TYPE, ROUTER_ID);
export const modemIds = (gladys, id) => gladys.externalIds(MODEM_TYPE, id);

const reading = (extra) => ({ read_only: true, has_feedback: false, keep_history: true, ...extra });

/** The modem features: [key, name, definition]. Units of the core only. */
export const MODEM_FEATURES = [
  // Never a switch: read-only `unknown`/`binary`.
  [
    FEATURES.DATA_CONNECTED,
    'Mobile data connected',
    reading({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 }),
  ],
  [
    FEATURES.SIGNAL,
    'Signal (bars)',
    reading({ category: C.SIGNAL, type: T.SIGNAL.QUALITY, min: 0, max: 5 }),
  ],
  // No dBm nor dB unit in the core: the unit is in the name.
  [
    FEATURES.RSSI,
    'RSSI (dBm)',
    reading({ category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: -150, max: 0 }),
  ],
  [
    FEATURES.RSRP,
    'RSRP (dBm)',
    reading({ category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: -160, max: 0 }),
  ],
  [
    FEATURES.RSRQ,
    'RSRQ (dB)',
    reading({ category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: -40, max: 10 }),
  ],
  [
    FEATURES.SINR,
    'SINR (dB)',
    reading({ category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: -30, max: 60 }),
  ],
  [
    FEATURES.OPERATOR,
    'Operator',
    reading({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false }),
  ],
  [
    FEATURES.NETWORK_TYPE,
    'Network type',
    reading({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false }),
  ],
  [
    FEATURES.BAND,
    'Band',
    reading({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false }),
  ],
  [
    FEATURES.SIM_STATE,
    'SIM card',
    reading({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false }),
  ],
  [
    FEATURES.TEMPERATURE,
    'Modem temperature',
    reading({
      category: C.DEVICE_TEMPERATURE_SENSOR,
      type: T.SENSOR.DECIMAL,
      unit: U.CELSIUS,
      min: -40,
      max: 150,
    }),
  ],
  [
    FEATURES.DOWNLOAD_RATE,
    'Download rate',
    reading({
      category: C.DATARATE,
      type: T.DATARATE.RATE,
      unit: U.KILOBITS_PER_SECOND,
      min: 0,
      max: 10_000_000,
    }),
  ],
  [
    FEATURES.UPLOAD_RATE,
    'Upload rate',
    reading({
      category: C.DATARATE,
      type: T.DATARATE.RATE,
      unit: U.KILOBITS_PER_SECOND,
      min: 0,
      max: 10_000_000,
    }),
  ],
  [
    FEATURES.RECEIVED,
    'Data received',
    reading({
      category: C.DATA,
      type: T.DATA.SIZE,
      unit: U.MEGABYTE,
      min: 0,
      max: 1_000_000_000,
    }),
  ],
  [
    FEATURES.SENT,
    'Data sent',
    reading({ category: C.DATA, type: T.DATA.SIZE, unit: U.MEGABYTE, min: 0, max: 1_000_000_000 }),
  ],
];

/** The features of the created device the blueprint lacks, appended (never fewer). */
export function withCreatedFeatures(gladys, device, devices = gladys.devices) {
  const created = (devices ?? []).find((d) => d?.external_id === device.external_id);
  if (!created) return device;
  const known = new Set(device.features.map((f) => f.external_id));
  const extra = (created.features ?? []).filter(
    (f) => f && typeof f.external_id === 'string' && !known.has(f.external_id),
  );
  if (extra.length === 0) return device;
  return { ...device, features: [...device.features, ...extra] };
}

/** @param {{ model?: string|null, name?: string|null }} [router] */
export function buildRouterDevice(gladys, router = {}) {
  const ids = routerIds(gladys);
  const model = router?.model ? `Teltonika ${router.model}` : 'Teltonika router';
  return withCreatedFeatures(gladys, {
    name: router?.name || router?.model || 'Teltonika router',
    external_id: ids.device,
    model,
    should_poll: false,
    features: [
      {
        name: 'Firmware',
        external_id: ids.feature(FEATURES.FIRMWARE),
        ...reading({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false }),
      },
      {
        name: 'Reboot the router',
        external_id: ids.feature(FEATURES.REBOOT),
        category: C.BUTTON,
        type: T.BUTTON.PUSH,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: false,
        keep_history: false,
      },
    ],
  });
}

/** @param {{ id: string, name?: string|null, make?: string|null }} modem */
export function buildModemDevice(gladys, modem) {
  const ids = modemIds(gladys, modem.id);
  return withCreatedFeatures(gladys, {
    name: modem.name || `Modem ${modem.id}`,
    external_id: ids.device,
    model: modem.make || 'Teltonika modem',
    should_poll: false,
    features: MODEM_FEATURES.map(([key, name, definition]) => ({
      name,
      external_id: ids.feature(key),
      ...definition,
    })),
  });
}

/**
 * What a device or feature external id of this integration designates:
 * { kind: 'router' | 'modem', id, feature } or null.
 */
export function parseExternalId(gladys, externalId) {
  if (typeof externalId !== 'string' || externalId.length > 200) return null;
  for (const [kind, type] of [
    ['router', ROUTER_TYPE],
    ['modem', MODEM_TYPE],
  ]) {
    const prefix = gladys.externalId(`${type}:`);
    if (!externalId.startsWith(prefix)) continue;
    const [id, feature, ...rest] = externalId.slice(prefix.length).split(':');
    if (rest.length > 0) return null;
    if (kind === 'router' ? id !== ROUTER_ID : !MODEM_ID.test(id ?? '')) return null;
    return { kind, id, feature: feature ?? null };
  }
  return null;
}

/** The created devices of this integration: { router: entry | null, modems: [...] }. */
export function createdDevices(gladys, devices = gladys.devices) {
  let router = null;
  const modems = [];
  for (const device of devices ?? []) {
    const parsed = parseExternalId(gladys, device?.external_id);
    if (!parsed || parsed.feature !== null) continue;
    const entry = { ...parsed, externalId: device.external_id };
    if (parsed.kind === 'router') router = entry;
    else modems.push(entry);
  }
  return { router, modems };
}
