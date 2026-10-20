// -----------------------------------------------------------------------------
// Keys, limits and timings. The manifest keys, the trigger keys and the
// external id shapes are stored in user scenes and devices: never rename them
// (test/manifest.test.js ties them to the manifest).
// -----------------------------------------------------------------------------

export const ACTIONS = Object.freeze({
  TEST: 'test_connection',
});

export const SCENE_TRIGGERS = Object.freeze({
  DATA_LOST: 'mobile_data_lost',
  DATA_RESTORED: 'mobile_data_restored',
});

/**
 * Device external ids:
 *   `ext:<selector>:router:main`          the router (one per installation)
 *   `ext:<selector>:modem:<modem id>`     one per modem, its USB id as RutOS
 *                                         gives it (`2-1`, `1-1.4`), lowercase
 * The modem id does not change with the SIM, the operator or a reboot.
 */
export const ROUTER_TYPE = 'router';
export const ROUTER_ID = 'main';
export const MODEM_TYPE = 'modem';

export const FEATURES = Object.freeze({
  // Router
  FIRMWARE: 'firmware',
  REBOOT: 'reboot',
  // Modem
  DATA_CONNECTED: 'data_connected',
  SIGNAL: 'signal',
  RSSI: 'rssi',
  RSRP: 'rsrp',
  RSRQ: 'rsrq',
  SINR: 'sinr',
  OPERATOR: 'operator',
  NETWORK_TYPE: 'network_type',
  BAND: 'band',
  SIM_STATE: 'sim_state',
  TEMPERATURE: 'temperature',
  DOWNLOAD_RATE: 'download_rate',
  UPLOAD_RATE: 'upload_rate',
  RECEIVED: 'received',
  SENT: 'sent',
});

export const PROTOCOLS = Object.freeze(['https', 'http']);
export const DEFAULT_PORTS = Object.freeze({ https: 443, http: 80 });

/** Seconds between two readings of the modems. */
export const POLL_INTERVALS = Object.freeze(['30', '60', '120', '300']);

/**
 * Signal bars (0 to 5) from the RSSI in dBm: at or above each threshold, one
 * bar more. Our own scale (RutOS shows its own in the WebUI): TODO.md.
 */
export const SIGNAL_BARS = Object.freeze([-105, -95, -85, -75, -65]);

export const LIMITS = Object.freeze({
  /** Modems read from one answer (the rest is ignored). */
  MODEMS: 8,
  /** POST /state admits 300 states per minute per integration: we keep under 250. */
  STATES_PER_MINUTE: 250,
  /** A text published to Gladys (operator, band) is cut to this length. */
  TEXT_LENGTH: 64,
});

export const TIMEOUTS = Object.freeze({
  /** One request to the router (login included). */
  API: 15_000,
});

export const INTERVALS = Object.freeze({
  /** A failure (network, unexpected answer) is retried after max(this, the poll interval), doubling. */
  RETRY_MIN_MS: 60_000,
  RETRY_MAX_MS: 30 * 60_000,
  /** HTTP 429 / 5xx: pause of every request, within these bounds (Retry-After if given). */
  BUSY_MIN_MS: 60_000,
  BUSY_MAX_MS: 6 * 3600_000,
  /** The router description (model, firmware) is read again after this long. */
  DEVICE_STATUS_MS: 3600_000,
  /** A token is renewed this long before RutOS says it expires. */
  TOKEN_MARGIN_MS: 30_000,
  /** What a token lasts when the router does not say (RutOS: 299 s). */
  TOKEN_DEFAULT_S: 299,
  /** A rate needs two readings at least this close (else it is not shown). */
  RATE_MAX_GAP_FACTOR: 3,
});

/** The reboot command: deadlines counted from its arrival (Gladys acks within 5 s). */
export const COMMAND = Object.freeze({
  /** The fresh reading of the router must end by then. */
  READ_BY_MS: 2_500,
  /** The reboot request is refused unsent after this. */
  SEND_BY_MS: 3_500,
  /** The answer of the router is awaited until this. */
  ANSWER_BY_MS: 4_500,
  /** No second reboot before this delay (a scene in a loop): kept in /data. */
  COOLDOWN_MS: 10 * 60_000,
  /** After a reboot is sent, a failing reading says "rebooting" this long. */
  REBOOTING_MS: 5 * 60_000,
});

/** The only value a `button`/`push` feature sends (BUTTON_PUSH.PRESSED of the core). */
export const PRESSED = 1;

/** Size cap of an answer read from the router. */
export const MAX_BYTES = 1024 * 1024;

/** The persistent store (refusals, pauses, certificates, last reboot: see src/store.js). */
export const STORE_FILE = 'teltonika.json';
