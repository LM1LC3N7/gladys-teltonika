// -----------------------------------------------------------------------------
// TeltonikaApp: the integration. One Teltonika router (RutOS), its modems.
//
//   start(config)  (re)connects: the router read, Discovery published, the
//                  loop started
//   loop           every `poll_interval` s (60 by default): GET
//                  /api/modems/status -> data connected, signal, operator,
//                  network, SIM, temperature, rates, data counters, and the
//                  triggers `mobile_data_lost`, `mobile_data_restored`; the
//                  router description (model, firmware) once an hour
//   reboot         a `button`, refused unless "Allow rebooting the router" is
//                  on: the router read again first (the same one?), the
//                  option checked again right before sending, one request
//                  never retried, at most one every 10 min
//   failures       credentials refused stop everything until the
//                  configuration is saved (the router may lock an account
//                  after a few failures); another HTTPS certificate than the
//                  one learned stops before anything is written; HTTP 429 and
//                  5xx pause every request (bounded, kept in /data); anything
//                  else is retried, never faster than the poll interval,
//                  doubling up to 30 min
//
// The loop is one chain of timers: halt() bumps an epoch, and a run of an
// older epoch (still in flight when the router failed) never schedules
// itself again. Neither the password, nor the token, nor the serial number,
// the IMEI, the IMSI, the ICCID or a phone number is ever logged.
// -----------------------------------------------------------------------------

import { createHash, createHmac } from 'node:crypto';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { Budget } from './budget.js';
import { normalizeConfig } from './config.js';
import {
  COMMAND,
  FEATURES,
  INTERVALS,
  LIMITS,
  PRESSED,
  SCENE_TRIGGERS,
  SIGNAL_BARS,
  STORE_FILE,
} from './constants.js';
import {
  buildModemDevice,
  buildRouterDevice,
  createdDevices,
  modemIds,
  parseExternalId,
  routerIds,
} from './devices.js';
import { T, reasonOf } from './i18n.js';
import { Store } from './store.js';
import { TeltonikaClient } from './teltonika/client.js';
import { CODES, isCredentialsRefused } from './teltonika/errors.js';
import { httpRequest } from './teltonika/http.js';

/** The "Test the connection" button waits 30 s: answer before. */
const TEST_BUDGET_MS = 25_000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
/** The value of a state entry, number or text, as one comparable key. */
const valueOf = (s) => (s.text !== undefined ? `t:${s.text}` : `s:${s.state}`);
/** A scene variable: a string, or null (never undefined, never NaN). */
const orNull = (value) => (typeof value === 'string' && value ? value : null);
const round1 = (n) => Math.round(n * 10) / 10;
/** What Discovery shows: sent again when it changes. */
const discoveredKeyOf = (router, modems) =>
  JSON.stringify([router?.model, router?.name, modems.map((m) => [m.id, m.name, m.make])]);

/** Signal bars 0 to 5 from the RSSI (dBm), null when unknown. */
export function signalBars(rssi) {
  if (rssi === null || rssi === undefined) return null;
  return SIGNAL_BARS.filter((threshold) => rssi >= threshold).length;
}

export class TeltonikaApp {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {object} [options.logger]
   * @param {Function} [options.request] the HTTP transport (tests inject a fake router)
   * @param {string} [options.dataDir] the writable volume
   * @param {() => number} [options.now]
   * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
   */
  constructor({
    gladys,
    logger = createLogger({ name: 'teltonika' }),
    request = httpRequest,
    dataDir = process.env.DATA_DIR ?? '/data',
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.request = request;
    this.now = now;
    this.timers = timers;
    this.store = new Store({ filePath: join(dataDir, STORE_FILE), logger });
    this.budget = new Budget({ perMinute: LIMITS.STATES_PER_MINUTE, now });
    this.rawConfig = {};
    this.config = normalizeConfig();
    this.client = null;
    this.generation = 0;
    this.epoch = 0;
    this.handles = new Set();
    this.queue = Promise.resolve();
    this.lastStatus = null;
    /** The last good reading, kept across a restart of the app; in memory only. */
    this.known = null;
    /** After a failed reading: { key, at, delay, message }; in memory only. */
    this.retryWait = null;
    /** Values last accepted by Gladys (feature -> value), to budget only changes. */
    this.published = new Map();
    /** The reading in flight: one at a time (loop, Discovery, command). */
    this.reading = null;
    /** The reboot being sent. */
    this.inFlight = null;
    /** When the last reboot was sent (ms), mirrored in /data. */
    this.lastRebootAt = 0;
    /** The last pause asked by the router { key, until }, in memory (a /data that cannot be written). */
    this.pauseMemory = null;
    /** Until then, a failing reading is the reboot that was sent. */
    this.rebootingUntil = 0;
    this.reset();
  }

  reset() {
    this.online = false;
    this.blocked = false;
    this.pausedUntil = 0;
    this.retryDelay = this.minRetry();
    /** { model, firmware, name, identity } of the router, and when it was read. */
    this.router = null;
    this.routerAt = 0;
    /** id -> modem of the last reading, rates included. */
    this.modems = new Map();
    /** id -> { rx, tx, at }: the counters of the previous reading, for the rates. */
    this.counters = new Map();
    /** A reading to compare with: false at start and after any failure (no event then). */
    this.baseline = false;
    this.discoveredKey = null;
    this.transports = new Map();
    this.published.clear();
  }

  /** A failure is never read again faster than the poll interval. */
  minRetry() {
    return Math.max(INTERVALS.RETRY_MIN_MS, (this.config?.pollSeconds ?? 60) * 1000);
  }

  pollMs() {
    return this.config.pollSeconds * 1000;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** Run `task` after every start / restart already queued. */
  enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * (Re)start with a configuration. Calls are serialized. `force`: the user
   * saved the configuration: credentials refused earlier are tried again, a
   * new certificate is accepted, and the router is read at once even within
   * the retry wait of a failure. Nothing else (a reconnection to Gladys, the
   * test button) reads faster than the interval, nor lifts a pause asked by
   * the router.
   */
  start(rawConfig, { force = false } = {}) {
    return this.enqueue(() => this.run(rawConfig, { force }));
  }

  /** `host:port` of the router: the key of its refusal, pause, certificate. */
  routerKey(config = this.config) {
    return `${config.host}:${config.port}`;
  }

  /** The values a refusal is about (HMAC with the salt of /data: never the password). */
  async refusalKey(config) {
    return createHmac('sha256', await this.store.salt())
      .update(
        JSON.stringify([this.routerKey(config), config.protocol, config.username, config.password]),
      )
      .digest('hex');
  }

  /** What the known reading belongs to (a SHA-256 of the account, in memory only). */
  knownKey(config) {
    return JSON.stringify([
      this.routerKey(config),
      config.protocol,
      createHash('sha256')
        .update(JSON.stringify([config.username, config.password]))
        .digest('hex'),
    ]);
  }

  pauseKey() {
    return `pausedUntil|${this.routerKey()}`;
  }

  certKey() {
    return `certChanged|${this.routerKey()}`;
  }

  rebootKey() {
    return `rebootAt|${this.routerKey()}`;
  }

  async stop() {
    this.generation += 1;
    this.halt();
    this.dropClient();
  }

  /** Clear every timer; the runs still in flight will not schedule again. */
  halt() {
    this.epoch += 1;
    for (const handle of this.handles) this.timers.clearTimeout(handle);
    this.handles.clear();
  }

  dropClient() {
    this.client?.close();
    this.client = null;
  }

  async run(rawConfig, { force = false } = {}) {
    this.halt();
    this.dropClient();
    const generation = ++this.generation;
    this.rawConfig = rawConfig ?? {};
    const config = normalizeConfig(rawConfig);
    // A pause known in memory (even if /data could not keep it) outlives the restart.
    const memoryPause = this.pauseMemory;
    this.config = config;
    this.reset();
    // The core keeps the status and Discovery in memory: a start (a
    // reconnection to Gladys included) always sends them again.
    this.lastStatus = null;
    if (this.known && this.known.key !== this.knownKey(config)) this.known = null;
    await this.store.load();

    if (config.hostError) {
      await this.stopWith(
        config.hostError === 'missing' ? T.status.hostMissing : T.status.hostInvalid,
      );
      return;
    }
    if (config.portInvalid) return this.stopWith(T.status.portInvalid);
    if (config.usernameInvalid) return this.stopWith(T.status.usernameInvalid);
    if (!config.password) return this.stopWith(T.status.missingPassword);
    if (config.passwordInvalid) return this.stopWith(T.status.passwordInvalid);

    const key = this.routerKey(config);
    const configKey = await this.refusalKey(config);
    // Credentials the router refused with these very values are not tried
    // again before the configuration is saved.
    const refused = this.store.get('refusals', key);
    if (refused && refused === configKey && !force) {
      this.blocked = true;
      this.logger.warn('Credentials refused earlier: not tried again');
      return this.stopWith(T.status.credentialsRefused);
    }
    if (refused) await this.store.set('refusals', key, null);
    // Another certificate met with these values: nothing is sent until the
    // configuration is saved, which accepts the new certificate.
    const changed = this.store.get('meta', this.certKey());
    if (changed && changed === configKey && !force) {
      this.blocked = true;
      this.logger.warn('The HTTPS certificate of the router changed: nothing sent');
      return this.stopWith(T.status.certificateChanged);
    }
    if (changed) {
      await this.store.set('meta', this.certKey(), null);
      await this.store.set('pins', key, null);
      this.logger.info('A new HTTPS certificate of the router will be accepted');
    }
    this.lastRebootAt = Number(this.store.get('meta', this.rebootKey())) || 0;
    // A reboot "in the future" (a clock set back, a file written by hand)
    // counts as one now: at most 10 min of cooldown, never none.
    if (this.lastRebootAt > this.now()) this.lastRebootAt = this.now();

    this.client = new TeltonikaClient({
      protocol: config.protocol,
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password,
      pin: this.store.get('pins', key),
      onPin: async (fingerprint) => {
        await this.store.set('pins', key, fingerprint);
        this.logger.info('HTTPS certificate of the router learned');
      },
      request: this.request,
      now: this.now,
    });
    this.logger.info(`Using the RutOS API at ${config.protocol}://${config.host}:${config.port}`);
    // A pause (HTTP 429 or 5xx) outlives a restart, a reconnection to Gladys
    // and a saved configuration; its end is capped (a clock jump, a file
    // written by hand) and the capped end written back.
    let stored = Number(this.store.get('meta', this.pauseKey())) || 0;
    if (memoryPause?.key === this.pauseKey()) stored = Math.max(stored, memoryPause.until);
    const pausedUntil = Math.min(stored, this.now() + INTERVALS.BUSY_MAX_MS);
    if (pausedUntil < stored) await this.store.set('meta', this.pauseKey(), String(pausedUntil));
    if (this.now() < pausedUntil) {
      this.pausedUntil = pausedUntil;
      const delay = pausedUntil - this.now();
      await this.restoreKnown();
      await this.publishTransports();
      await this.setStatus(false, T.status.paused(delay));
      this.schedule(delay, () => this.connect(generation));
      return;
    }
    // After a failed reading, a reconnection to Gladys waits for the retry
    // like the loop would (never faster than the interval), and so does the
    // test button; only a saved configuration reads at once.
    const waiting = this.retryWait;
    if (!force && waiting?.key === configKey) {
      if (this.now() < waiting.at) {
        this.retryDelay = waiting.delay;
        await this.restoreKnown();
        await this.publishTransports();
        await this.setStatus(false, waiting.message);
        this.schedule(waiting.at - this.now(), () => this.connect(generation));
        return;
      }
      this.retryDelay = waiting.delay;
    }
    // The last reading worked less than one interval ago (a reconnection to
    // Gladys, the test button, the same values saved again): everything is
    // sent again from it, and the router is read again when the interval is
    // over.
    const fresh = this.freshKnown();
    if (fresh && !this.retryWait) {
      await this.resume(fresh, generation);
      return;
    }
    await this.connect(generation);
  }

  /** The last reading, when it worked less than one poll interval ago; else null. */
  freshKnown() {
    const known = this.known;
    if (!known || known.key !== this.knownKey(this.config)) return null;
    const age = this.now() - known.at;
    return age >= 0 && age < this.pollMs() ? known : null;
  }

  /** Online again from the last reading: Discovery, states, badges, status, the loop. */
  async resume(known, generation) {
    this.router = known.router;
    this.routerAt = known.routerAt;
    this.modems = new Map(known.modems.map((m) => [m.id, m]));
    this.counters = new Map(known.counters);
    this.baseline = true;
    this.online = true;
    this.discoveredKey = discoveredKeyOf(this.router, known.modems);
    await this.publishDiscovered();
    if (generation !== this.generation) return;
    await this.publishDeviceStates();
    await this.publishTransports();
    if (generation !== this.generation) return;
    await this.setStatus(true, this.okMessage());
    if (generation !== this.generation) return;
    this.scheduleLoop(Math.max(0, this.pollMs() - (this.now() - known.at)), generation);
  }

  /** Discovery again from the last reading (a pause, a wait), or the router alone. */
  async restoreKnown() {
    if (this.known) {
      this.router = this.known.router;
      for (const modem of this.known.modems) this.modems.set(modem.id, modem);
    }
    await this.publishDiscovered();
  }

  /** Stopped before any request (configuration, refusal, certificate): status and badges. */
  async stopWith(message) {
    // Discovery too: the core forgets it at every reconnection (the router alone).
    await this.publishDiscovered();
    await this.publishTransports();
    await this.setStatus(false, message);
  }

  schedule(delay, task) {
    const handle = this.timers.setTimeout(async () => {
      this.handles.delete(handle);
      try {
        await task();
      } catch (err) {
        this.logger.error(`Loop failed: ${err?.message}`);
      }
    }, delay);
    this.handles.add(handle);
    return handle;
  }

  scheduleLoop(delay, generation) {
    const epoch = this.epoch;
    this.schedule(delay, () => this.loop(generation, epoch));
  }

  current(generation, epoch) {
    return generation === this.generation && epoch === this.epoch && !this.blocked;
  }

  /** The first reading, then the loop. Never throws. */
  async connect(generation) {
    if (!this.client || generation !== this.generation) return;
    try {
      await this.refresh({ publish: true });
      if (generation !== this.generation) return;
      this.logger.info(`The router answers: ${this.modems.size} modem(s)`);
    } catch (err) {
      await this.failed(err, generation);
      return;
    }
    this.scheduleLoop(this.pollMs(), generation);
  }

  async loop(generation, epoch) {
    if (!this.current(generation, epoch)) return;
    if (this.paused()) {
      // A pause met on another path (a command): no reading before its end.
      this.scheduleLoop(this.pausedUntil - this.now(), generation);
      return;
    }
    if (this.reading) {
      // A reading is in flight (Discovery, a command): it is this round's.
      await this.reading.catch(() => {});
      if (this.current(generation, epoch)) this.scheduleLoop(this.pollMs(), generation);
      return;
    }
    try {
      await this.refresh({ publish: false });
    } catch (err) {
      if (this.current(generation, epoch)) await this.failed(err, generation);
      return;
    }
    if (this.current(generation, epoch)) this.scheduleLoop(this.pollMs(), generation);
  }

  /** HTTP 429 or 5xx: a bounded pause of every request, kept in /data. Returns its length or 0. */
  async pauseFor(err) {
    if (err?.code !== CODES.HTTP) return 0;
    let delay;
    if (err.status === 429) {
      delay = clamp(
        err.retryAfterMs ?? INTERVALS.BUSY_MIN_MS,
        Math.max(INTERVALS.BUSY_MIN_MS, this.pollMs()),
        INTERVALS.BUSY_MAX_MS,
      );
    } else if (err.status >= 500) {
      delay = clamp(err.retryAfterMs ?? this.retryDelay, this.retryDelay, INTERVALS.BUSY_MAX_MS);
    } else {
      return 0;
    }
    this.pausedUntil = this.now() + delay;
    this.pauseMemory = { key: this.pauseKey(), until: this.pausedUntil };
    await this.store.set('meta', this.pauseKey(), String(this.pausedUntil));
    return delay;
  }

  /** A reading failed: final refusal, certificate, a pause, or a retry with a growing delay. */
  async failed(err, generation) {
    if (generation !== this.generation) return;
    const wasOnline = this.online;
    this.online = false;
    // After an outage, the first reading is a new start: no event.
    this.baseline = false;
    this.counters.clear();
    this.halt();
    await this.publishTransports();
    if (isCredentialsRefused(err)) {
      this.blocked = true;
      this.known = null;
      await this.store.set('refusals', this.routerKey(), await this.refusalKey(this.config));
      this.logger.warn(
        'The router refused the user name or the password: not retried until the configuration is saved',
      );
      await this.setStatus(false, T.status.credentialsRefused);
      return;
    }
    if (err?.code === CODES.CERTIFICATE && err.fingerprint) {
      this.blocked = true;
      this.known = null;
      await this.store.set('meta', this.certKey(), await this.refusalKey(this.config));
      this.logger.warn(
        'The HTTPS certificate of the router is not the one learned: nothing sent, stopped until the configuration is saved',
      );
      await this.setStatus(false, T.status.certificateChanged);
      return;
    }
    let delay = this.retryDelay;
    const paused = await this.pauseFor(err);
    if (paused > 0) delay = paused;
    if (err?.status !== 429)
      this.retryDelay = Math.min(this.retryDelay * 2, INTERVALS.RETRY_MAX_MS);
    if (wasOnline || delay === this.minRetry() || paused > 0) {
      // A RouterError message never holds a secret nor an identifier;
      // anything else is reduced to its code.
      const what = err?.name === 'RouterError' ? err.message : String(err?.code ?? 'error');
      this.logger.warn(`The router fails: ${what}`);
    }
    const message = this.errorMessage(err, delay);
    this.retryWait = {
      key: await this.refusalKey(this.config),
      at: this.now() + delay,
      delay: this.retryDelay,
      message,
    };
    if (generation !== this.generation) return;
    await this.setStatus(false, message);
    this.schedule(delay, () => this.connect(generation));
  }

  errorMessage(err, delay) {
    if (err?.status === 429) return T.status.busy(delay);
    if (err?.code === CODES.HTTP && err.status >= 500) {
      return T.status.serverError(err.status, delay);
    }
    if (this.now() < this.rebootingUntil) return T.status.rebooting(delay);
    switch (err?.code) {
      case CODES.ACCESS:
        return T.status.access(delay);
      case CODES.REDIRECT:
        return T.status.redirect(this.config.protocol, delay);
      case CODES.BAD_ANSWER:
      case CODES.HTTP:
      case CODES.API_ERROR:
        return T.status.notRutos(delay);
      default:
        return T.status.unreachable(err, delay);
    }
  }

  paused() {
    return this.now() < this.pausedUntil;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys.setConnectionStatus(connected, message).catch((err) => {
      this.lastStatus = null;
      this.logger.warn(`Connection status not sent: ${err.message}`);
    });
  }

  // --- Reading -----------------------------------------------------------------

  /** Read the router, publish it. Throws when it cannot be read. */
  refresh(options) {
    const reading = this.read(options).finally(() => {
      if (this.reading === reading) this.reading = null;
    });
    this.reading = reading;
    return reading;
  }

  /** The rates (kbit/s) of a modem from its counters and the previous ones; null when unknown. */
  rates(modem, at) {
    const before = this.counters.get(modem.id);
    if (!before || modem.rx === null || modem.tx === null) return { down: null, up: null };
    const seconds = (at - before.at) / 1000;
    const maxGap = (this.pollMs() / 1000) * INTERVALS.RATE_MAX_GAP_FACTOR;
    if (seconds < 5 || seconds > maxGap) return { down: null, up: null };
    const rate = (now, then) =>
      then === null || now < then ? null : round1(((now - then) * 8) / 1000 / seconds);
    return { down: rate(modem.rx, before.rx), up: rate(modem.tx, before.tx) };
  }

  async read({ publish }) {
    const client = this.client;
    const generation = this.generation;
    if (!client) return;
    // A reading that ends after a restart publishes nothing, fires nothing and
    // sets no status: it is not the reading of the current configuration.
    const stale = () => client !== this.client || generation !== this.generation;
    let router = this.router;
    let routerAt = this.routerAt;
    if (!router || this.now() - routerAt >= INTERVALS.DEVICE_STATUS_MS) {
      router = await client.deviceStatus();
      routerAt = this.now();
      if (stale()) return;
    }
    const { modems: list } = await client.modems();
    if (stale()) return;
    const at = this.now();
    // A pause asked earlier is over (the reading worked): forget it.
    this.pauseMemory = null;
    if (this.store.get('meta', this.pauseKey())) {
      await this.store.set('meta', this.pauseKey(), null);
      if (stale()) return;
    }
    this.pausedUntil = 0;
    this.rebootingUntil = 0;

    const modems = list.map((modem) => {
      const { down, up } = this.rates(modem, at);
      return { ...modem, down, up };
    });
    const events = [];
    if (this.baseline) {
      for (const modem of modems) {
        const was = this.modems.get(modem.id);
        if (was?.dataConnected === true && modem.dataConnected === false) {
          events.push([SCENE_TRIGGERS.DATA_LOST, modem]);
        }
        if (was?.dataConnected === false && modem.dataConnected === true) {
          events.push([SCENE_TRIGGERS.DATA_RESTORED, modem]);
        }
      }
    }
    this.router = router;
    this.routerAt = routerAt;
    this.modems = new Map(modems.map((m) => [m.id, m]));
    this.counters = new Map(
      modems
        .filter((m) => m.rx !== null && m.tx !== null)
        .map((m) => [m.id, { rx: m.rx, tx: m.tx, at }]),
    );
    this.baseline = true;
    this.online = true;
    this.retryDelay = this.minRetry();
    this.retryWait = null;
    this.known = {
      key: this.knownKey(this.config),
      at,
      router,
      routerAt,
      modems,
      counters: [...this.counters],
    };

    const discoveredKey = discoveredKeyOf(router, modems);
    if (publish || discoveredKey !== this.discoveredKey) await this.publishDiscovered();
    if (stale()) return;
    this.discoveredKey = discoveredKey;
    await this.publishDeviceStates();
    if (stale()) return;
    await this.publishTransports();
    for (const [key, modem] of events) {
      if (stale()) return;
      await this.fire(key, modem);
    }
    if (stale()) return;
    await this.setStatus(true, this.okMessage());
  }

  okMessage() {
    if (this.modems.size === 0) return T.status.noModem(this.router?.model);
    const connected = [...this.modems.values()].filter((m) => m.dataConnected === true).length;
    return T.status.ok({ model: this.router?.model, modems: this.modems.size, connected });
  }

  /** Every value a string or null: never undefined, never NaN. */
  async fire(key, modem) {
    await this.gladys
      .publishSceneEvent(key, {
        device: modemIds(this.gladys, modem.id).device,
        modem_name: orNull(modem.name),
        operator: orNull(modem.operator),
      })
      .catch((err) => {
        this.logger.warn(`Scene event not sent: ${err.message}`);
      });
  }

  /** Never throws: a refusal of Gladys is not a failure of the router. */
  async publishDiscovered() {
    const devices = [buildRouterDevice(this.gladys, this.router ?? {})];
    for (const modem of this.modems.values()) devices.push(buildModemDevice(this.gladys, modem));
    await this.gladys.publishDiscoveredDevices(devices).catch((err) => {
      this.logger.warn(`Discovery not published: ${err.message}`);
    });
  }

  /**
   * Discovery (scan button): read again when connected and the last reading
   * is older than the poll interval (never faster), else what is known.
   */
  async publishDiscovery() {
    if (this.reading) {
      await this.reading.catch(() => {});
      await this.publishDiscovered();
      return;
    }
    if (this.online && this.freshKnown()) {
      await this.publishDiscovered();
      return;
    }
    if (this.online && !this.paused() && this.client) {
      const generation = this.generation;
      const done = await this.refresh({ publish: true }).then(
        () => true,
        async (err) => {
          if (generation !== this.generation) return true;
          await this.failed(err, generation);
          return false;
        },
      );
      if (done) return;
    }
    await this.publishDiscovered();
  }

  /** The states of the created devices, the most useful first. */
  statesOf() {
    const created = createdDevices(this.gladys);
    const states = [];
    const number = (id, value) => {
      if (value !== null && value !== undefined && Number.isFinite(value)) {
        states.push({ device_feature_external_id: id, state: value });
      }
    };
    const text = (id, value) => {
      if (typeof value === 'string' && value) {
        states.push({ device_feature_external_id: id, text: value });
      }
    };
    for (const { id } of created.modems) {
      const modem = this.modems.get(id);
      if (!modem) continue;
      const ids = modemIds(this.gladys, id);
      if (modem.dataConnected !== null) {
        number(ids.feature(FEATURES.DATA_CONNECTED), modem.dataConnected ? 1 : 0);
      }
      number(ids.feature(FEATURES.SIGNAL), signalBars(modem.rssi));
      number(ids.feature(FEATURES.RSSI), modem.rssi);
      number(ids.feature(FEATURES.RSRP), modem.rsrp);
      number(ids.feature(FEATURES.RSRQ), modem.rsrq);
      number(ids.feature(FEATURES.SINR), modem.sinr);
      number(ids.feature(FEATURES.DOWNLOAD_RATE), modem.down);
      number(ids.feature(FEATURES.UPLOAD_RATE), modem.up);
      number(ids.feature(FEATURES.TEMPERATURE), modem.temperature);
      number(ids.feature(FEATURES.RECEIVED), modem.rx === null ? null : round1(modem.rx / 1e6));
      number(ids.feature(FEATURES.SENT), modem.tx === null ? null : round1(modem.tx / 1e6));
      text(ids.feature(FEATURES.OPERATOR), modem.operator);
      text(ids.feature(FEATURES.NETWORK_TYPE), modem.networkType);
      text(ids.feature(FEATURES.BAND), modem.band);
      text(ids.feature(FEATURES.SIM_STATE), modem.simState);
    }
    if (created.router && this.router) {
      text(routerIds(this.gladys).feature(FEATURES.FIRMWARE), this.router.firmware);
    }
    return states;
  }

  /** Publish what changed, within the minute budget (POST /state admits 300 per minute). */
  async publishDeviceStates() {
    const fresh = this.statesOf().filter(
      (s) => this.published.get(s.device_feature_external_id) !== valueOf(s),
    );
    const room = this.budget.remaining();
    const list = fresh.slice(0, room);
    if (fresh.length > room) {
      this.logger.debug(`${fresh.length - room} state(s) held back (state budget)`);
    }
    if (list.length === 0) return;
    try {
      const result = await this.gladys.publishChangedStates(list);
      this.budget.record(result?.count ?? list.length);
      for (const s of list) this.published.set(s.device_feature_external_id, valueOf(s));
    } catch (err) {
      this.budget.record(list.length);
      this.logger.warn(`States not published: ${err.message}`);
    }
  }

  /** Forget what was published for a device (Gladys forgot it too). */
  forget(externalId) {
    if (typeof externalId !== 'string') return;
    const prefix = `${externalId}:`;
    for (const id of [...this.published.keys()]) {
      if (id === externalId || id.startsWith(prefix)) this.published.delete(id);
    }
  }

  async publishTransports() {
    const created = createdDevices(this.gladys);
    const transport = this.online ? 'local' : 'unreachable';
    const entries = [
      ...(created.router ? [{ external_id: created.router.externalId, transport }] : []),
      ...created.modems.map(({ id, externalId }) => ({
        external_id: externalId,
        transport: this.online && this.modems.has(id) ? 'local' : 'unreachable',
      })),
    ];
    const changed = entries.filter((e) => this.transports.get(e.external_id) !== e.transport);
    if (changed.length === 0) return;
    for (const entry of changed) this.transports.set(entry.external_id, entry.transport);
    await this.gladys.publishTransports(changed).catch((err) => {
      for (const entry of changed) this.transports.delete(entry.external_id);
      this.logger.debug(`Transports not published: ${err.message}`);
    });
  }

  // --- Devices created / deleted in Gladys -----------------------------------

  async deviceCreated(device) {
    this.forget(device?.external_id);
    this.transports.delete(device?.external_id);
    if (this.online) await this.publishDeviceStates();
    await this.publishTransports();
  }

  async deviceUpdated(device) {
    await this.deviceCreated(device);
  }

  deviceDeleted(device) {
    this.forget(device?.external_id);
    this.transports.delete(device?.external_id);
  }

  // --- The reboot command ------------------------------------------------------

  /**
   * A command from Gladys. Only the reboot button acts; every reading
   * refuses. Resolves when the router accepted the reboot.
   */
  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.now();
    const target = parseExternalId(this.gladys, feature?.external_id);
    if (!target || target.feature === null) throw new Error(T.errors.unknownDevice);
    if (target.kind !== 'router' || target.feature !== FEATURES.REBOOT) {
      throw new Error(T.errors.readOnly);
    }
    // Strictly the value of a button: never a 0, a true or an empty text.
    if (value !== PRESSED && value !== String(PRESSED)) throw new Error(T.errors.badValue);
    if (!this.config.allowReboot) throw new Error(T.errors.rebootDisabled);
    if (this.inFlight) throw new Error(T.errors.stillRunning);
    const promise = this.reboot(received);
    this.inFlight = promise;
    try {
      return await promise;
    } finally {
      if (this.inFlight === promise) this.inFlight = null;
    }
  }

  /** The checks of the reboot, on the latest configuration: before the read and right before sending. */
  checkReboot(generation, client) {
    if (!this.config.allowReboot) throw new Error(T.errors.rebootDisabled);
    if (generation !== this.generation || client !== this.client || !client || !this.online) {
      throw new Error(T.errors.notConnected);
    }
    if (this.paused()) throw new Error(T.errors.paused(this.pausedUntil - this.now()));
    // A reboot "in the future" (a clock set back) counts as one now: at most
    // 10 min of cooldown, never none.
    if (this.lastRebootAt > this.now()) this.lastRebootAt = this.now();
    const ago = this.now() - this.lastRebootAt;
    if (ago < COMMAND.COOLDOWN_MS) throw new Error(T.errors.cooldown(ago));
  }

  /**
   * A failure met by the command that the loop must follow at once (refused
   * credentials, another certificate, HTTP 429 / 5xx): the usual path,
   * persisted, the loop stopped or paused. In the background: its
   * synchronous start already halts the loop, and the ack never waits for
   * Gladys.
   */
  followFailure(err, generation) {
    const pause = err?.code === CODES.HTTP && (err.status === 429 || err.status >= 500);
    const final = isCredentialsRefused(err) || (err?.code === CODES.CERTIFICATE && err.fingerprint);
    if (!pause && !final) return;
    /** The failure being followed (the tests wait for it). */
    this.following = this.failed(err, generation).catch((e) =>
      this.logger.warn(`Failure not handled: ${e?.message}`),
    );
  }

  async reboot(received) {
    const generation = this.generation;
    const client = this.client;
    const sendBy = received + COMMAND.SEND_BY_MS;
    this.checkReboot(generation, client);
    const known = this.router?.identity ?? null;

    // The router read just before acting, never the one in memory: it must
    // answer, and be the very router read before (the same serial number).
    let fresh;
    try {
      fresh = await client.deviceStatus(received + COMMAND.READ_BY_MS);
    } catch (err) {
      this.followFailure(err, generation);
      if (err?.code === CODES.LATE || err?.code === CODES.TIMEOUT) {
        throw new Error(T.errors.tooSlow, { cause: err });
      }
      throw new Error(T.errors.unknownState(reasonOf(err).en), { cause: err });
    }
    if (!known || !fresh.identity || fresh.identity !== known) {
      throw new Error(T.errors.otherRouter);
    }
    // The option may have been turned off during the read: checked again.
    this.checkReboot(generation, client);
    if (this.now() > sendBy) throw new Error(T.errors.tooSlow);
    this.logger.info('Reboot of the router requested from Gladys');
    try {
      await client.reboot({
        sendBy,
        answerBy: received + COMMAND.ANSWER_BY_MS,
        // The very last check, right before the request is written (after
        // the TCP and TLS handshakes): the option, the connection, a pause,
        // the cooldown, and the deadline.
        beforeSend: () => {
          this.checkReboot(generation, client);
          if (this.now() > sendBy) throw new Error(T.errors.tooSlow);
        },
      });
    } catch (err) {
      if (err?.beforeSend) throw err;
      const reason = reasonOf(err).en;
      this.logger.warn(
        `Reboot of the router: ${err?.name === 'RouterError' ? err.message : 'error'}`,
      );
      const cause = { cause: err };
      this.followFailure(err, generation);
      if (err?.noSession) throw new Error(T.errors.noSession, cause);
      if (err?.code === CODES.LATE) throw new Error(T.errors.tooSlow, cause);
      if (err?.notSent) throw new Error(T.errors.notSent(reason), cause);
      if (err?.status === 429) throw new Error(T.errors.refused(reason), cause);
      if (
        err?.code === CODES.ACCESS ||
        err?.code === CODES.API_ERROR ||
        err?.code === CODES.REDIRECT ||
        (err?.code === CODES.HTTP && err.status < 500)
      ) {
        throw new Error(T.errors.refused(reason), cause);
      }
      // A 5xx, a silence, a broken answer after the request was written: it
      // may have reached the router.
      await this.rebooted();
      throw new Error(T.errors.sentUnconfirmed(reason), cause);
    }
    await this.rebooted();
  }

  /** A reboot sent: the cooldown, in memory and in /data (a local file; never Gladys). */
  async rebooted() {
    this.lastRebootAt = this.now();
    this.rebootingUntil = this.now() + COMMAND.REBOOTING_MS;
    // Kept before the ack, so that a restart right after keeps the cooldown.
    // The store never throws (a failed write keeps the value in memory).
    await this.store.set('meta', this.rebootKey(), String(this.lastRebootAt));
  }

  // --- Configuration button --------------------------------------------------

  /** Resolves `promise`, or rejects with `message` after `ms`. */
  within(promise, ms, message) {
    let handle;
    const limit = new Promise((_, reject) => {
      handle = this.timers.setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, limit]).finally(() => this.timers.clearTimeout(handle));
  }

  /**
   * Reconnects, then reports, within 25 s. Like a reconnection to Gladys, it
   * never reads faster than the interval: after a failure it answers the
   * status of that failure until the retry. Refused credentials are not
   * tried again (only saving the configuration does), nor is a pause
   * shortened.
   */
  async testConnection() {
    await this.within(this.start(this.rawConfig), TEST_BUDGET_MS, T.errors.testTooLong);
    if (!this.online) {
      const message = this.lastStatus ? JSON.parse(this.lastStatus)[1] : null;
      throw new Error(message?.en ?? T.errors.notConnected);
    }
    return T.test.ok(this.okMessage());
  }
}
