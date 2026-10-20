// -----------------------------------------------------------------------------
// A fake RutOS API (in memory): the transport of src/teltonika/http.js. The
// shapes come from the fixtures of teltasync (RUTX50, RUT241, TRB140); never
// checked against a real router (TODO.md). The identifiers (IMEI, IMSI,
// ICCID, serial numbers, MAC, phone number) are fake, and the tests check
// none of them ever leaves the integration.
// -----------------------------------------------------------------------------

import { CODES, RouterError } from '../../src/teltonika/errors.js';

export const USERNAME = 'admin';
export const PASSWORD = 'fake Router pass-0123';
export const TOKEN_PREFIX = 'fakeTokenJWT';
export const FINGERPRINT =
  'AA:11:BB:22:CC:33:DD:44:EE:55:FF:66:00:77:11:88:22:99:33:AA:44:BB:55:CC:66:DD:77:EE:88:FF:99:00';
/** Every identifier of the fixtures: never in a log, a state, Discovery, an event or /data. */
export const SECRETS = [
  PASSWORD,
  TOKEN_PREFIX,
  '356789012345678', // IMEI
  '208011234567890', // IMSI
  '89330123456789012345', // ICCID
  'RUTX50SERIAL1234', // router serial
  'MODEMSERIAL5678', // modem serial
  '20:97:27:aa:bb:cc', // MAC
  '+33612345678', // phone number
];

export function modem(id = '2-1', overrides = {}) {
  return {
    id,
    name: 'Internal modem',
    imei: '356789012345678',
    imsi: '208011234567890',
    iccid: '89330123456789012345',
    serial: 'MODEMSERIAL5678',
    phone_number: '+33612345678',
    model: 'RG501Q-EU',
    manufacturer: 'Quectel',
    operator: 'Orange F',
    provider: 'N/A',
    conntype: '5G (NSA)',
    ntype: '5G-NSA',
    band: '5G N78',
    simstate: 'Inserted',
    pinstate: 'Inserted',
    data_conn_state: 'Connected',
    state: 'Connected',
    rssi: -58,
    rsrp: -86,
    rsrq: -7,
    sinr: 13,
    temperature: 45,
    txbytes: 2_000_000,
    rxbytes: 10_000_000,
    cellid: '987654',
    tac: '65432',
    lac: 'N/A',
    cell_info: [{ mcc: '208', mnc: '01', cellid: '987654', tac: '65432' }],
    ...overrides,
  };
}

export function deviceStatus(overrides = {}) {
  return {
    mnfinfo: {
      macEth: '20:97:27:aa:bb:cc',
      name: 'RUTX5000XXXX',
      hwver: '0202',
      batch: '0010',
      serial: overrides.serial ?? 'RUTX50SERIAL1234',
      mac: '20:97:27:aa:bb:cd',
    },
    static: {
      fw_version: overrides.firmware ?? 'RUTX_R_00.07.13.3',
      kernel: '5.4.259',
      system: 'ARMv7',
      device_name: 'RUTX50',
      hostname: 'Teltonika-RUTX50.com',
      cpu_count: 4,
      fw_build_date: '2025-05-01',
      model: 'RUTX50',
      board_name: 'rutx',
    },
    features: { ipv6: true },
    board: { modems: [{ id: '2-1', simcount: 2, num: '1' }] },
  };
}

export function createFakeRouter({ clock } = {}) {
  let tokens = 0;
  const fake = {
    requests: [],
    username: USERNAME,
    password: PASSWORD,
    fingerprint: FINGERPRINT,
    /** Seconds a token lasts. */
    expires: 299,
    /** Tokens the router still accepts. */
    valid: new Set(),
    modems: [modem()],
    device: deviceStatus(),
    /** { status, headers, body } answered once each (FIFO), any path. */
    failures: [],
    /** path -> { status, headers, body } answered once each. */
    failuresOn: new Map(),
    unreachable: false,
    /** A promise every request waits for before answering. */
    gate: null,
    /** ms the clock moves on during a request (a slow router). */
    delayMs: 0,
    /** The reboot answer: 'ok' | 'refused' | 'timeout' | 'error500'. */
    reboot: 'ok',
    reboots: 0,
  };

  const json = (status, value, headers = {}) => ({
    status,
    headers: { 'content-type': 'application/json', ...headers },
    body: Buffer.from(JSON.stringify(value)),
  });
  const rejected = () =>
    json(401, { success: false, errors: [{ code: 120, error: 'Unauthorized access' }] });

  function answer({ method, path }, headers, body) {
    const once = fake.failuresOn.get(path);
    if (once?.length) {
      const f = once.shift();
      return { status: f.status, headers: f.headers ?? {}, body: Buffer.from(f.body ?? '{}') };
    }
    if (fake.failures.length > 0) {
      const f = fake.failures.shift();
      return { status: f.status, headers: f.headers ?? {}, body: Buffer.from(f.body ?? '{}') };
    }
    if (method === 'POST' && path === '/api/login') {
      const credentials = JSON.parse(body ?? '{}');
      if (credentials.username !== fake.username || credentials.password !== fake.password) {
        return json(401, { success: false, errors: [{ code: 121, error: 'Login failed' }] });
      }
      tokens += 1;
      const token = `${TOKEN_PREFIX}${tokens}xyz`;
      fake.valid.add(token);
      return json(200, {
        success: true,
        data: { username: fake.username, token, expires: fake.expires },
      });
    }
    const token = (headers.authorization ?? '').replace(/^Bearer /, '');
    if (!fake.valid.has(token)) return rejected();
    if (method === 'GET' && path === '/api/system/device/status') {
      return json(200, { success: true, data: fake.device });
    }
    if (method === 'GET' && path === '/api/modems/status') {
      return json(200, { success: true, data: fake.modems });
    }
    if (method === 'POST' && path === '/api/system/actions/reboot') {
      fake.reboots += 1;
      if (fake.reboot === 'refused') {
        return json(200, { success: false, errors: [{ code: 103, error: 'Invalid options' }] });
      }
      if (fake.reboot === 'error500') return json(500, { success: false });
      return json(200, { success: true, data: {} });
    }
    return json(404, { success: false, errors: [{ code: 100, error: 'Not implemented' }] });
  }

  /** The transport of src/teltonika/http.js, in memory. */
  fake.request = async (target, options = {}) => {
    if (fake.gate) await fake.gate;
    if (fake.unreachable)
      throw new RouterError(CODES.UNREACHABLE, 'ECONNREFUSED', { notSent: true });
    if (target.protocol === 'https' && options.pin && options.pin !== fake.fingerprint) {
      throw Object.assign(
        new RouterError(CODES.CERTIFICATE, 'Another certificate', { notSent: true }),
        { fingerprint: fake.fingerprint },
      );
    }
    if (options.beforeSend) {
      try {
        options.beforeSend();
      } catch (err) {
        throw Object.assign(err, { notSent: true, beforeSend: true });
      }
    }
    fake.requests.push({
      ...target,
      headers: options.headers ?? {},
      body: options.body,
      pin: options.pin,
    });
    if (clock && fake.delayMs) {
      // A slow router: the clock moves on, and the deadline of the transport holds.
      if (fake.delayMs > options.timeout) {
        clock.now += options.timeout;
        throw new RouterError(CODES.TIMEOUT, 'No answer in time');
      }
      clock.now += fake.delayMs;
    }
    if (target.path === '/api/system/actions/reboot' && fake.reboot === 'timeout') {
      fake.reboots += 1;
      throw new RouterError(CODES.TIMEOUT, 'No answer within 1 s');
    }
    const result = answer(target, options.headers ?? {}, options.body);
    return { ...result, fingerprint: target.protocol === 'https' ? fake.fingerprint : null };
  };

  /** Requests other than the login. */
  fake.reads = () => fake.requests.filter((r) => r.path !== '/api/login');
  fake.logins = () => fake.requests.filter((r) => r.path === '/api/login');
  /** The router forgets every session (a reboot, a logout elsewhere). */
  fake.dropSessions = () => fake.valid.clear();
  return fake;
}
