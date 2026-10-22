// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and the fake router, through
// the exact wiring of the container (src/handlers.js).
// -----------------------------------------------------------------------------

import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { TeltonikaApp, signalBars } from '../src/app.js';
import { ACTIONS, INTERVALS, SCENE_TRIGGERS } from '../src/constants.js';
import { buildModemDevice, buildRouterDevice } from '../src/devices.js';
import { registerHandlers } from '../src/handlers.js';
import { PASSWORD, SECRETS, createFakeRouter, modem } from './helpers/fakeRouter.js';
import { createFakeTimers } from './helpers/fakeTimers.js';

const T0 = Date.parse('2026-10-20T08:00:00Z');
const SELECTOR = 'teltonika';
const ids = createFakeGladys({ selector: SELECTOR });
const ROUTER = `ext:${SELECTOR}:router:main`;
const MODEM = `ext:${SELECTOR}:modem:2-1`;
const feature = (key) => `${MODEM}:${key}`;
const BASE_CONFIG = { host: '192.168.1.1', password: PASSWORD };

let running;
afterEach(async () => {
  await running?.stop();
  running = undefined;
});

async function setup({
  config = {},
  created = true,
  router,
  dataDir,
  now = T0,
  clock = { now },
} = {}) {
  router ??= createFakeRouter({ clock });
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: { ...BASE_CONFIG, ...config },
    devices: created ? [buildRouterDevice(ids), buildModemDevice(ids, { id: '2-1' })] : [],
  });
  const timers = createFakeTimers();
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.stack ?? String(a)).join(' ')}`),
    ]),
  );
  dataDir ??= mkdtempSync(join(tmpdir(), 'teltonika-app-'));
  const app = new TeltonikaApp({
    gladys,
    logger,
    request: router.request,
    dataDir,
    now: () => clock.now,
    timers,
  });
  running = app;
  registerHandlers(gladys, app, logger);
  await gladys.connect();
  return { gladys, router, timers, clock, logs, app, dataDir };
}

const poll = (timers, ms = 60_000) => timers.run((delay) => delay === ms);
const last = (gladys, key) => gladys.fake.lastState(feature(key));
async function reconnect(gladys, app) {
  gladys.emit('connected');
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  await app.queue;
}
const rebootFeature = { external_id: `${ROUTER}:reboot` };
const press = (gladys, value = 1) =>
  gladys.fake.setValue(buildRouterDevice(ids), rebootFeature, value);

/** Nothing secret nor identifying anywhere: logs, Gladys, /data. */
function assertClean({ logs, gladys, dataDir }) {
  const files = readdirSync(dataDir).map((f) => readFileSync(join(dataDir, f), 'utf8'));
  const places = {
    logs: logs.join('\n'),
    states: JSON.stringify(gladys.fake.states),
    discovery: JSON.stringify(gladys.fake.discoveredDevices),
    events: JSON.stringify(gladys.fake.sceneEvents),
    statuses: JSON.stringify(gladys.fake.connectionStatuses),
    data: files.join('\n'),
  };
  for (const [place, text] of Object.entries(places)) {
    for (const secret of SECRETS) {
      assert.ok(!text.includes(secret), `${place} holds ${secret}`);
    }
  }
}

test('start: status, Discovery, states, badges; modems read every 60 s', async () => {
  const ctx = await setup();
  const { gladys, router, timers } = ctx;
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: true,
    message: {
      en: 'RUTX50 answers: 1 modem, mobile data connected.',
      fr: 'RUTX50 répond : 1 modem, données mobiles connectées.',
    },
  });
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => [d.external_id, d.name, d.model]),
    [
      [ROUTER, 'RUTX50', 'Teltonika RUTX50'],
      [MODEM, 'Internal modem', 'Quectel RG501Q-EU'],
    ],
  );
  assert.equal(last(gladys, 'data_connected'), 1);
  assert.equal(last(gladys, 'signal'), 5);
  assert.equal(last(gladys, 'rssi'), -58);
  assert.equal(last(gladys, 'rsrp'), -86);
  assert.equal(last(gladys, 'rsrq'), -7);
  assert.equal(last(gladys, 'sinr'), 13);
  assert.equal(last(gladys, 'operator'), 'Orange F');
  assert.equal(last(gladys, 'network_type'), '5G (NSA)');
  assert.equal(last(gladys, 'band'), '5G N78');
  assert.equal(last(gladys, 'sim_state'), 'Inserted');
  assert.equal(last(gladys, 'temperature'), 45);
  assert.equal(last(gladys, 'received'), 10);
  assert.equal(last(gladys, 'sent'), 2);
  assert.equal(last(gladys, 'download_rate'), undefined, 'no rate from one reading');
  assert.equal(gladys.fake.lastState(`${ROUTER}:firmware`), 'RUTX_R_00.07.13.3');
  assert.ok(gladys.fake.transports.every((t) => t.transport === 'local'));
  assert.equal(gladys.fake.transports.length, 2);
  assert.deepEqual(timers.delays(), [60_000]);
  assert.deepEqual(
    router.requests.map((r) => `${r.method} ${r.path}`),
    ['POST /api/login', 'GET /api/system/device/status', 'GET /api/modems/status'],
  );
  assert.match(router.requests[1].headers['user-agent'], /^gladys-teltonika\/\d+\.\d+\.\d+$/);
  assert.match(router.requests[1].headers.authorization, /^Bearer /);

  // The next reading: the modems only, the same token, the rates.
  ctx.clock.now += 60_000;
  router.modems[0].rxbytes += 7_500_000; // 60 Mbit in 60 s
  router.modems[0].txbytes += 750_000;
  await poll(timers);
  assert.deepEqual(
    router.requests.slice(3).map((r) => r.path),
    ['/api/modems/status'],
  );
  assert.equal(last(gladys, 'download_rate'), 1000);
  assert.equal(last(gladys, 'upload_rate'), 100);
  assert.equal(last(gladys, 'received'), 17.5);
  assertClean(ctx);
});

test('nothing identifying reaches Gladys, the logs or /data', async () => {
  const ctx = await setup();
  ctx.clock.now += 60_000;
  ctx.router.modems[0].data_conn_state = 'Disconnected';
  await poll(ctx.timers);
  assert.equal(ctx.gladys.fake.sceneEvents.length, 1);
  assertClean(ctx);
  const sent = JSON.stringify([ctx.gladys.fake.states, ctx.gladys.fake.discoveredDevices]);
  for (const value of ['987654', '65432', 'Teltonika-RUTX50.com']) {
    assert.ok(!sent.includes(value), value);
  }
});

test('signal bars from the RSSI', () => {
  assert.equal(signalBars(null), null);
  assert.equal(signalBars(-50), 5);
  assert.equal(signalBars(-65), 5);
  assert.equal(signalBars(-66), 4);
  assert.equal(signalBars(-90), 2);
  assert.equal(signalBars(-105), 1);
  assert.equal(signalBars(-120), 0);
});

test('a token is reused, then renewed before it expires; a rejected session once', async () => {
  const { router, timers, clock, gladys } = await setup();
  for (let i = 0; i < 4; i += 1) {
    clock.now += 60_000;
    await poll(timers);
  }
  // 299 s - 30 s of margin: the 5th reading (at 240 s) still uses it.
  assert.equal(router.logins().length, 1);
  clock.now += 60_000;
  await poll(timers);
  assert.equal(router.logins().length, 2);
  // The router forgets the session: one new login, then the reading.
  router.dropSessions();
  clock.now += 60_000;
  await poll(timers);
  assert.equal(router.logins().length, 3);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a session refused again after a new login: no loop, a spaced retry', async () => {
  const { router, timers, clock, gladys } = await setup();
  const refused = { status: 401, body: '{"success":false,"errors":[{"code":120}]}' };
  router.failuresOn.set('/api/modems/status', [refused, refused]);
  router.dropSessions();
  clock.now += 60_000;
  await poll(timers);
  assert.equal(router.logins().length, 2, 'one new login only');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refuses the readings/);
  assert.deepEqual(timers.delays(), [60_000]);
});

test('credentials refused: stopped, remembered, retried only when the configuration is saved', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teltonika-refused-'));
  const router = createFakeRouter();
  router.password = 'another one';
  const first = await setup({ router, dataDir });
  assert.equal(first.gladys.fake.connectionStatus.connected, false);
  assert.match(
    first.gladys.fake.connectionStatus.message.en,
    /refused the user name or the password/,
  );
  assert.deepEqual(first.timers.delays(), [], 'no retry timer');
  assert.equal(router.logins().length, 1);
  await reconnect(first.gladys, first.app);
  assert.equal(router.logins().length, 1, 'not tried again on a reconnection');
  await first.app.stop();

  // A restart of the container with the same values: nothing sent.
  const second = await setup({ router, dataDir });
  assert.equal(router.logins().length, 1);
  assert.match(second.gladys.fake.connectionStatus.message.en, /refused/);
  assertClean({ ...second, dataDir });
  // Saving the configuration tries again.
  router.password = PASSWORD;
  await second.gladys.fake.configUpdated({ ...BASE_CONFIG });
  assert.equal(router.logins().length, 2);
  assert.equal(second.gladys.fake.connectionStatus.connected, true);
});

test('HTTPS certificate: learned once, another one stops everything before sending', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teltonika-pin-'));
  const ctx = await setup({ dataDir });
  const { router, gladys, timers, clock, app } = ctx;
  assert.equal(router.requests[0].pin, null, 'first use');
  assert.equal(router.requests[1].pin, router.fingerprint);
  const stored = JSON.parse(readFileSync(join(dataDir, 'teltonika.json'), 'utf8'));
  assert.equal(stored.pins['192.168.1.1:443'], router.fingerprint);

  // Another certificate at the same address.
  router.fingerprint = 'BB:'.repeat(31) + 'BB';
  const before = router.requests.length;
  clock.now += 60_000;
  await poll(timers);
  assert.equal(router.requests.length, before, 'nothing written to it');
  assert.match(gladys.fake.connectionStatus.message.en, /certificate of the router is not the one/);
  assert.deepEqual(timers.delays(), []);
  await reconnect(gladys, app);
  assert.equal(router.requests.length, before, 'a reconnection does not try again');
  // Saving the configuration accepts the new certificate.
  await gladys.fake.configUpdated({ ...BASE_CONFIG });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const after = JSON.parse(readFileSync(join(dataDir, 'teltonika.json'), 'utf8'));
  assert.equal(after.pins['192.168.1.1:443'], router.fingerprint);
});

test('HTTP: no certificate, port 80', async () => {
  const { router } = await setup({ config: { protocol: 'http' } });
  assert.equal(router.requests[0].protocol, 'http');
  assert.equal(router.requests[0].port, 80);
  assert.equal(router.requests[0].pin, null);
});

test('HTTP 429: every request paused, kept in /data across a restart, capped', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teltonika-429-'));
  const ctx = await setup({ dataDir });
  ctx.router.failuresOn.set('/api/modems/status', [
    { status: 429, headers: { 'retry-after': '900' } },
  ]);
  ctx.clock.now += 60_000;
  await poll(ctx.timers);
  assert.deepEqual(ctx.timers.delays(), [900_000]);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /HTTP 429/);
  await ctx.app.stop();
  const count = ctx.router.requests.length;
  const again = await setup({ dataDir, router: ctx.router, clock: ctx.clock });
  assert.equal(ctx.router.requests.length, count, 'the pause goes on after a restart');
  assert.match(again.gladys.fake.connectionStatus.message.en, /pause goes on/);
  await again.timers.run();
  assert.equal(again.gladys.fake.connectionStatus.connected, true);
});

test('unreachable: retried never faster than the interval, doubling, no event after', async () => {
  const { router, timers, clock, gladys } = await setup({ config: { poll_interval: '30' } });
  router.unreachable = true;
  clock.now += 30_000;
  await poll(timers, 30_000);
  assert.deepEqual(timers.delays(), [INTERVALS.RETRY_MIN_MS]);
  assert.match(gladys.fake.connectionStatus.message.en, /does not answer: no connection/);
  assert.ok(gladys.fake.transports.some((t) => t.transport === 'unreachable'));
  clock.now += 60_000;
  await timers.run();
  assert.deepEqual(timers.delays(), [120_000]);
  // Back, with the data connection lost meanwhile: no event (no baseline).
  router.unreachable = false;
  router.modems[0].data_conn_state = 'Disconnected';
  clock.now += 120_000;
  await timers.run();
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('triggers: data lost and back, never undefined; none at the first reading', async () => {
  const router = createFakeRouter();
  router.modems = [modem('2-1', { data_conn_state: 'Disconnected', operator: 'N/A' })];
  const { gladys, timers, clock } = await setup({ router });
  assert.equal(gladys.fake.sceneEvents.length, 0);
  router.modems[0].data_conn_state = 'Connected';
  clock.now += 60_000;
  await poll(timers);
  router.modems[0].data_conn_state = 'Disconnected';
  router.modems[0].operator = 'Orange F';
  clock.now += 60_000;
  await poll(timers);
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: SCENE_TRIGGERS.DATA_RESTORED,
      data: { device: MODEM, modem_name: 'Internal modem', operator: null },
    },
    {
      key: SCENE_TRIGGERS.DATA_LOST,
      data: { device: MODEM, modem_name: 'Internal modem', operator: 'Orange F' },
    },
  ]);
});

test('a reconnection to Gladys sends status and Discovery again without reading faster', async () => {
  const { gladys, router, app } = await setup();
  const statuses = gladys.fake.connectionStatuses.length;
  const count = router.requests.length;
  await reconnect(gladys, app);
  assert.equal(router.requests.length, count, 'the router is not read again');
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('a published device never loses a feature of the created one', async () => {
  const created = buildModemDevice(ids, { id: '2-1' });
  created.features.push({ ...created.features[0], external_id: `${MODEM}:legacy`, name: 'Old' });
  const router = createFakeRouter();
  const gladys = createFakeGladys({
    selector: SELECTOR,
    config: BASE_CONFIG,
    devices: [created],
  });
  const app = new TeltonikaApp({
    gladys,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    request: router.request,
    dataDir: mkdtempSync(join(tmpdir(), 'teltonika-keep-')),
    now: () => T0,
    timers: createFakeTimers(),
  });
  running = app;
  registerHandlers(gladys, app);
  await gladys.connect();
  const published = gladys.fake.discoveredDevices.find((d) => d.external_id === MODEM);
  assert.ok(published.features.some((f) => f.external_id === `${MODEM}:legacy`));
});

test('the test button answers, and a refusal is said', async () => {
  const { gladys, router } = await setup();
  const ack = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /RUTX50 answers/);
  assert.match(ack.data.message.fr, /Découverte/);
  router.password = 'changed';
  router.dropSessions();
  await gladys.fake.configUpdated({ ...BASE_CONFIG, password: 'wrong' });
  const refused = await gladys.fake.action(ACTIONS.TEST);
  assert.equal(refused.success, false);
  assert.match(refused.error, /refused the user name or the password/);
});

test('the readings refuse every command', async () => {
  const { gladys } = await setup();
  const ack = await gladys.fake.setValue(
    buildModemDevice(ids, { id: '2-1' }),
    { external_id: feature('signal') },
    1,
  );
  assert.equal(ack.success, false);
  assert.match(ack.error, /only reads/);
});

// --- The reboot ------------------------------------------------------------------

test('reboot: refused by default, nothing sent', async () => {
  const { gladys, router } = await setup();
  const ack = await press(gladys);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Rebooting is not allowed/);
  assert.equal(router.reboots, 0);
});

test('reboot allowed: read again, sent once, cooldown of 10 min kept in /data', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teltonika-reboot-'));
  const ctx = await setup({ config: { allow_reboot: true }, dataDir });
  const { gladys, router, clock } = ctx;
  const count = router.requests.length;
  const ack = await press(gladys);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(
    router.requests.slice(count).map((r) => `${r.method} ${r.path}`),
    ['GET /api/system/device/status', 'POST /api/system/actions/reboot'],
  );
  assert.equal(router.reboots, 1);
  // A second press (a scene in a loop): refused, even after a restart.
  clock.now += 60_000;
  const again = await press(gladys);
  assert.match(again.error, /10 min between two reboots/);
  await ctx.app.stop();
  const restarted = await setup({ config: { allow_reboot: true }, dataDir, clock, router });
  assert.match((await press(restarted.gladys)).error, /10 min/);
  assert.equal(router.reboots, 1);
  clock.now += 10 * 60_000;
  assert.equal((await press(restarted.gladys)).success, true);
  assert.equal(router.reboots, 2);
  assertClean(restarted);
});

test('reboot: only the button value, never 0', async () => {
  const { gladys, router } = await setup({ config: { allow_reboot: true } });
  for (const value of [0, '', true, 2]) {
    const ack = await press(gladys, value);
    assert.equal(ack.success, false, String(value));
  }
  assert.equal(router.reboots, 0);
});

test('reboot: the option turned off during the fresh reading: not sent', async () => {
  const { gladys, router, app } = await setup({ config: { allow_reboot: true } });
  let release;
  router.gate = new Promise((resolve) => (release = resolve));
  const pending = press(gladys);
  await new Promise((resolve) => setImmediate(resolve));
  app.config = { ...app.config, allowReboot: false };
  router.gate = null;
  release();
  const ack = await pending;
  assert.equal(ack.success, false);
  assert.match(ack.error, /not allowed/);
  assert.equal(router.reboots, 0);
});

test('reboot: a slow fresh reading is refused unsent', async () => {
  const { gladys, router } = await setup({ config: { allow_reboot: true } });
  router.delayMs = 3_000;
  const ack = await press(gladys);
  assert.equal(ack.success, false);
  assert.match(ack.error, /not sent|did not answer in time/);
  assert.equal(router.reboots, 0);
});

test('reboot: another router at the address is refused', async () => {
  const { gladys, router } = await setup({ config: { allow_reboot: true } });
  router.device = {
    ...router.device,
    mnfinfo: { ...router.device.mnfinfo, serial: 'OTHER0000001' },
  };
  const ack = await press(gladys);
  assert.match(ack.error, /not the one read before/);
  assert.equal(router.reboots, 0);
});

test('reboot: no answer after sending is "sent, without confirmation" and starts the cooldown', async () => {
  const { gladys, router, timers, clock } = await setup({ config: { allow_reboot: true } });
  router.reboot = 'timeout';
  const ack = await press(gladys);
  assert.match(ack.error, /was sent, without confirmation/);
  router.reboot = 'ok';
  assert.match((await press(gladys)).error, /10 min/);
  // The router restarting: the status says so.
  router.unreachable = true;
  clock.now += 60_000;
  await poll(timers);
  assert.match(gladys.fake.connectionStatus.message.en, /reboot was sent/);
});

test('reboot: a refusal of the router is said refused', async () => {
  const { gladys, router } = await setup({ config: { allow_reboot: true } });
  router.reboot = 'refused';
  const ack = await press(gladys);
  assert.match(ack.error, /refused the reboot/);
});

test('reboot: during a pause, nothing is sent', async () => {
  const { gladys, router, timers, clock } = await setup({ config: { allow_reboot: true } });
  router.failuresOn.set('/api/modems/status', [{ status: 503 }]);
  clock.now += 60_000;
  await poll(timers);
  const ack = await press(gladys);
  assert.equal(ack.success, false);
  assert.equal(router.reboots, 0);
});

// --- Review 1 ---------------------------------------------------------------------

test('I1 reboot: slow handshakes after the fresh reading: refused unsent past 3.5 s', async () => {
  const { gladys, router } = await setup({ config: { allow_reboot: true } });
  router.delayMs = 2_400; // the fresh reading takes 2.4 s
  router.connectMs = { '/api/system/actions/reboot': 1_200 }; // then 1.2 s of handshakes
  const ack = await press(gladys);
  assert.equal(ack.success, false);
  assert.match(ack.error, /did not answer in time: the reboot was not sent/);
  assert.equal(router.reboots, 0, 'never written after the deadline');
});

test('I2 reboot: a 429 on the fresh reading pauses the loop too, kept until its end', async () => {
  const { gladys, router, timers, clock, app } = await setup({ config: { allow_reboot: true } });
  router.failuresOn.set('/api/system/device/status', [
    { status: 429, headers: { 'retry-after': '1800' }, body: '{}' },
  ]);
  const ack = await press(gladys);
  assert.match(ack.error, /could not be read just before the reboot \(HTTP error 429\)/);
  await app.following;
  assert.equal(app.pausedUntil, clock.now + 1_800_000);
  assert.deepEqual(timers.delays(), [1_800_000], 'the loop timer replaced by the end of the pause');
  assert.match(gladys.fake.connectionStatus.message.en, /HTTP 429/);
  const count = router.requests.length;
  clock.now += 60_000;
  await poll(timers);
  assert.equal(router.requests.length, count, 'nothing read inside the pause');
  // Even a loop round already scheduled waits for the end of the pause.
  await app.loop(app.generation, app.epoch);
  assert.equal(router.requests.length, count);
  clock.now += 1_800_000;
  await timers.run((ms) => ms === 1_800_000);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('I3 the test button never reads faster than the interval after a failure', async () => {
  const router = createFakeRouter();
  const request = router.request;
  let calls = 0;
  router.request = (target, options) => {
    calls += 1;
    return request(target, options);
  };
  const { gladys, timers, clock } = await setup({ router });
  router.unreachable = true;
  clock.now += 60_000;
  await poll(timers);
  const base = calls;
  for (let i = 0; i < 3; i += 1) {
    clock.now += 1_000;
    const ack = await gladys.fake.action(ACTIONS.TEST);
    assert.equal(ack.success, false);
    assert.match(ack.error, /does not answer/);
  }
  assert.equal(calls, base, 'no request from the button within the retry wait');
  // Saving the configuration reads at once.
  router.unreachable = false;
  await gladys.fake.configUpdated({ ...BASE_CONFIG });
  assert.ok(calls > base);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('M1 a short token (20 s): one login at start, the reboot works', async () => {
  const router = createFakeRouter();
  router.expires = 20;
  const { gladys } = await setup({ router, config: { allow_reboot: true } });
  assert.equal(router.logins().length, 1);
  const ack = await press(gladys);
  assert.equal(ack.success, true, ack.error);
  assert.equal(router.reboots, 1);
});

test('M3 a MAC address in a name never reaches Discovery', async () => {
  const router = createFakeRouter();
  router.device.static.device_name = 'RUTX50 20:97:27:AA:BB:CC';
  router.modems[0].name = 'Modem 209727aabbcc';
  const { gladys } = await setup({ router });
  const text = JSON.stringify(gladys.fake.discoveredDevices).toLowerCase();
  assert.ok(!text.includes('20:97:27:aa:bb:cc'));
  assert.ok(!text.includes('209727aabbcc'));
  // The name with a MAC is dropped: the host name of the router instead.
  assert.equal(gladys.fake.discoveredDevices[0].name, 'Teltonika-RUTX50.com');
  assert.equal(gladys.fake.discoveredDevices[1].name, 'Modem 2-1');
});

test('M5 a reboot time in the future counts as now: 10 min of cooldown, not none', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teltonika-future-'));
  writeFileSync(
    join(dataDir, 'teltonika.json'),
    JSON.stringify({ meta: { 'rebootAt|192.168.1.1:443': String(T0 + 365 * 86_400_000) } }),
  );
  const { gladys, router, clock } = await setup({ config: { allow_reboot: true }, dataDir });
  assert.match((await press(gladys)).error, /10 min between two reboots/);
  clock.now += 10 * 60_000;
  assert.equal((await press(gladys)).success, true);
  assert.equal(router.reboots, 1);
});

test('M7 a blocked start still publishes Discovery (the router)', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teltonika-m7-'));
  const router = createFakeRouter();
  router.password = 'another one';
  const first = await setup({ router, dataDir });
  await first.app.stop();
  // A restart with the refused values: stopped before any request.
  const { gladys } = await setup({ router, dataDir });
  assert.equal(router.logins().length, 1);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [ROUTER],
  );
});

test('M8 credentials refused during the fresh reading are persisted at once', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teltonika-m8-'));
  const ctx = await setup({ config: { allow_reboot: true }, dataDir });
  const { gladys, router, clock, app } = ctx;
  router.password = 'changed on the router';
  router.dropSessions();
  clock.now += 300_000; // the token expired: the fresh reading logs in
  const ack = await press(gladys);
  assert.match(ack.error, /user name or password refused/);
  await app.following;
  assert.match(gladys.fake.connectionStatus.message.en, /refused the user name or the password/);
  assert.deepEqual(ctx.timers.delays(), [], 'the loop stopped');
  await app.stop();
  const logins = router.logins().length;
  await setup({ dataDir, router, clock });
  assert.equal(router.logins().length, logins, 'not tried again after a restart');
});

// --- Review 2 ---------------------------------------------------------------------

test('R1 two 429 at once (the loop and the reboot): one reading chain only', async () => {
  const { gladys, router, timers, clock, app } = await setup({ config: { allow_reboot: true } });
  router.failuresOn.set('/api/modems/status', [{ status: 429, headers: { 'retry-after': '120' } }]);
  router.failuresOn.set('/api/system/device/status', [
    { status: 429, headers: { 'retry-after': '120' } },
  ]);
  let release;
  router.gate = new Promise((resolve) => (release = resolve));
  clock.now += 60_000;
  const loop = poll(timers);
  const pressed = press(gladys);
  await new Promise((resolve) => setImmediate(resolve));
  router.gate = null;
  release();
  await loop;
  const ack = await pressed;
  assert.equal(ack.success, false);
  await app.following;
  await app.queue;
  assert.deepEqual(timers.delays(), [120_000], 'a single timer');
  // Directly: two failures handled at the same time keep a single chain.
  const err = Object.assign(new Error('HTTP 429'), {
    code: 'http',
    status: 429,
    retryAfterMs: 120_000,
  });
  await Promise.all([app.failed(err, app.generation), app.failed(err, app.generation)]);
  assert.equal(timers.delays().length, 1);
  clock.now += 120_000;
  await timers.run();
  assert.deepEqual(timers.delays(), [60_000], 'back to one loop');
});

test('R2 the reboot joining a slow login of the loop gives up at its own deadline', async () => {
  const { gladys, router, timers, clock } = await setup({ config: { allow_reboot: true } });
  const request = router.request;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  router.request = async (target, options) => {
    if (target.path === '/api/login') await gate;
    return request(target, options);
  };
  // The app holds the fake transport through the client: patch it there.
  const app = running;
  app.client.request = router.request;
  clock.now += 300_000; // the token expired
  const loop = poll(timers); // the loop logs in (deadline 15 s), stuck
  await new Promise((resolve) => setImmediate(resolve));
  const pressed = press(gladys);
  await new Promise((resolve) => setImmediate(resolve));
  // The only timer of 2.5 s or less: the deadline of the reboot's wait.
  const waits = timers.delays().filter((ms) => ms <= 2_500);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] <= 2_500);
  clock.now += waits[0];
  await timers.run((ms) => ms <= 2_500);
  const ack = await pressed;
  assert.equal(ack.success, false);
  assert.match(ack.error, /did not answer in time: the reboot was not sent/);
  assert.equal(router.reboots, 0);
  release();
  await loop;
  assert.equal(gladys.fake.connectionStatus.connected, true, 'the shared login went on');
});
