// -----------------------------------------------------------------------------
// The HTTP API of RutOS (Teltonika routers), ported from teltasync
// (Apache-2.0, see THIRD_PARTY_NOTICES.md):
//   POST /api/login  { username, password }   -> { token, expires } (Bearer)
//   GET  /api/system/device/status           model, firmware, name
//   GET  /api/modems/status                   the modems and their signal
//   POST /api/system/actions/reboot           reboot (a command, never retried)
// A token is renewed shortly before RutOS says it expires; a session the
// router rejects (HTTP 401, codes 120 / 123) is renewed ONCE, then the read
// fails: never a loop of logins. The password and the token are never in a
// log, an error message or /data.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { INTERVALS, MAX_BYTES, TIMEOUTS } from '../constants.js';
import { API_CODES, CODES, RouterError, SESSION_REJECTED } from './errors.js';
import { httpRequest } from './http.js';
import { parseDeviceStatus, parseEnvelope, parseLogin, parseModems } from './parse.js';

const PATHS = Object.freeze({
  LOGIN: '/api/login',
  DEVICE_STATUS: '/api/system/device/status',
  MODEMS: '/api/modems/status',
  REBOOT: '/api/system/actions/reboot',
});

/** Seconds of a Retry-After header (delta form only), in ms, or null. */
const retryAfterMs = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || !/^\d{1,8}$/.test(raw.trim())) return null;
  return Number(raw.trim()) * 1000;
};

/** gladys-teltonika/<version>, from package.json (copied into the image). */
export const USER_AGENT = (() => {
  try {
    const { version } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    return typeof version === 'string' ? `gladys-teltonika/${version}` : 'gladys-teltonika';
  } catch {
    return 'gladys-teltonika';
  }
})();

const json = (response) => {
  try {
    return JSON.parse(response.body.toString('utf8'));
  } catch {
    return undefined;
  }
};

/** A session the router no longer accepts (expired, revoked). */
const sessionRejected = (response, envelope) =>
  response.status === 401 ||
  (envelope?.success === false && envelope.errors.some((e) => SESSION_REJECTED.has(e.code)));

export class TeltonikaClient {
  /**
   * @param {object} options
   * @param {'https'|'http'} options.protocol
   * @param {string} options.host
   * @param {number} options.port
   * @param {string} options.username
   * @param {string} options.password
   * @param {string|null} [options.pin] the certificate fingerprint learned earlier
   * @param {(fingerprint: string) => Promise<void>} [options.onPin] a certificate learned now
   * @param {Function} [options.request] the HTTP transport (tests inject a fake router)
   * @param {() => number} [options.now]
   * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
   */
  constructor({
    protocol,
    host,
    port,
    username,
    password,
    pin = null,
    onPin,
    request = httpRequest,
    now = Date.now,
    timers = globalThis,
  }) {
    this.timers = timers;
    this.target = { protocol, host, port };
    this.username = username;
    this.password = password;
    this.pin = pin;
    this.onPin = onPin;
    this.request = request;
    this.now = now;
    this.token = null;
    this.tokenUntil = 0;
    this.closed = false;
    /** The login in flight, shared (single flight). */
    this.loggingIn = null;
  }

  close() {
    this.closed = true;
    this.token = null;
  }

  /** One exchange, within `deadline` (ms since epoch). */
  async send(method, path, { body, auth = true, deadline, beforeSend } = {}) {
    if (this.closed) throw new RouterError(CODES.CLOSED, 'Client closed', { notSent: true });
    const left = Math.min(TIMEOUTS.API, (deadline ?? Infinity) - this.now());
    if (left <= 0) throw new RouterError(CODES.LATE, 'Too late to send', { notSent: true });
    const headers = { 'user-agent': USER_AGENT };
    if (auth && this.token) headers.authorization = `Bearer ${this.token}`;
    const response = await this.request(
      { ...this.target, method, path },
      {
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        timeout: left,
        maxBytes: MAX_BYTES,
        pin: this.target.protocol === 'https' ? this.pin : null,
        beforeSend,
      },
    );
    if (this.target.protocol === 'https' && !this.pin && response.fingerprint) {
      // Trust on first use: the certificate met now is the one from now on.
      this.pin = response.fingerprint;
      await this.onPin?.(response.fingerprint);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new RouterError(CODES.REDIRECT, `HTTP ${response.status}`, { status: response.status });
    }
    if (response.status === 429 || response.status >= 500) {
      throw new RouterError(CODES.HTTP, `HTTP ${response.status}`, {
        status: response.status,
        retryAfterMs: retryAfterMs(response.headers?.['retry-after']),
      });
    }
    return response;
  }

  /**
   * POST /api/login: a new token. Rejects CREDENTIALS when the router refuses
   * them. One login at a time: a reading and a command that both need a new
   * token share the same login (single flight), and the old token is kept
   * until the new one arrives.
   */
  login(deadline) {
    if (!this.loggingIn) {
      this.loggingIn = this.#login(deadline).finally(() => {
        this.loggingIn = null;
      });
      // Every caller may stop waiting (its deadline): never an unhandled rejection.
      this.loggingIn.catch(() => {});
    }
    const shared = this.loggingIn;
    if (deadline === undefined || deadline === Infinity) return shared;
    // A caller that joins a login started by another waits until its own
    // deadline only (a command never waits for the 15 s of a reading); the
    // shared login goes on for the others.
    const left = deadline - this.now();
    if (left <= 0) {
      return Promise.reject(new RouterError(CODES.LATE, 'Too late', { notSent: true }));
    }
    let handle;
    const limit = new Promise((_, reject) => {
      handle = this.timers.setTimeout(
        () => reject(new RouterError(CODES.LATE, 'A login is still running', { notSent: true })),
        left,
      );
    });
    return Promise.race([shared, limit]).finally(() => this.timers.clearTimeout(handle));
  }

  async #login(deadline) {
    const response = await this.send('POST', PATHS.LOGIN, {
      body: { username: this.username, password: this.password },
      auth: false,
      deadline,
    });
    const body = json(response);
    const envelope = parseEnvelope(body);
    const loginFailed = envelope?.errors.some((e) => e.code === API_CODES.LOGIN_FAILED);
    if (response.status === 401 || loginFailed) {
      this.token = null;
      throw new RouterError(CODES.CREDENTIALS, 'User name or password refused', {
        status: response.status,
      });
    }
    if (response.status === 403) {
      throw new RouterError(CODES.ACCESS, 'HTTP 403', { status: 403 });
    }
    if (response.status < 200 || response.status > 299) {
      throw new RouterError(CODES.HTTP, `HTTP ${response.status}`, { status: response.status });
    }
    const login = parseLogin(body);
    if (!login) {
      const code = envelope?.errors[0]?.code;
      if (envelope && code !== null && code !== undefined) {
        throw new RouterError(CODES.API_ERROR, `Login error (code ${code})`, { apiCode: code });
      }
      throw new RouterError(CODES.BAD_ANSWER, 'Not a RutOS login answer');
    }
    this.token = login.token;
    const lifetime = (login.expires ?? INTERVALS.TOKEN_DEFAULT_S) * 1000;
    // The margin never eats more than half of a short token (a token of 20 s
    // stays usable 10 s: not a login before every request).
    this.tokenUntil = this.now() + lifetime - Math.min(INTERVALS.TOKEN_MARGIN_MS, lifetime / 2);
  }

  /** A token valid for a while yet, renewed when it is not. */
  async ensureToken(deadline) {
    if (this.token && this.now() < this.tokenUntil) return;
    await this.login(deadline);
  }

  /** An authenticated GET; a rejected session is renewed once. Resolves the parsed JSON. */
  async get(path, deadline) {
    await this.ensureToken(deadline);
    let response = await this.send('GET', path, { deadline });
    let body = json(response);
    if (sessionRejected(response, parseEnvelope(body))) {
      await this.login(deadline);
      response = await this.send('GET', path, { deadline });
      body = json(response);
      if (sessionRejected(response, parseEnvelope(body))) {
        this.token = null;
        throw new RouterError(CODES.ACCESS, 'Session refused after a new login', {
          status: response.status,
        });
      }
    }
    if (response.status === 403) {
      throw new RouterError(CODES.ACCESS, 'HTTP 403', { status: 403 });
    }
    if (response.status < 200 || response.status > 299) {
      throw new RouterError(CODES.HTTP, `HTTP ${response.status}`, { status: response.status });
    }
    if (body === undefined) throw new RouterError(CODES.BAD_ANSWER, 'Not JSON');
    const envelope = parseEnvelope(body);
    if (envelope && !envelope.success) {
      const code = envelope.errors[0]?.code ?? null;
      throw new RouterError(CODES.API_ERROR, `API error (code ${code ?? 'none'})`, {
        apiCode: code,
      });
    }
    return body;
  }

  /** The router: { model, firmware, name, identity }. */
  async deviceStatus(deadline) {
    const parsed = parseDeviceStatus(await this.get(PATHS.DEVICE_STATUS, deadline));
    if (!parsed) throw new RouterError(CODES.BAD_ANSWER, 'Not a RutOS device status');
    return parsed;
  }

  /** The modems: { modems, invalid }. */
  async modems(deadline) {
    const parsed = parseModems(await this.get(PATHS.MODEMS, deadline));
    if (!parsed) throw new RouterError(CODES.BAD_ANSWER, 'Not a list of modems');
    return parsed;
  }

  /**
   * POST /api/system/actions/reboot, once, never retried, never preceded by
   * a login (the token was made valid by the fresh reading just before).
   * Refused unsent (LATE) after `sendBy`; answered by `answerBy`.
   * Resolves when the router says success; rejects a RouterError otherwise.
   */
  async reboot({ sendBy, answerBy, beforeSend }) {
    if (!this.token || this.now() >= this.tokenUntil) {
      throw Object.assign(new RouterError(CODES.LATE, 'No valid session', { notSent: true }), {
        noSession: true,
      });
    }
    if (this.now() > sendBy) throw new RouterError(CODES.LATE, 'Too late', { notSent: true });
    const response = await this.send('POST', PATHS.REBOOT, { deadline: answerBy, beforeSend });
    const envelope = parseEnvelope(json(response));
    if (sessionRejected(response, envelope) || response.status === 403) {
      throw new RouterError(CODES.ACCESS, `HTTP ${response.status}`, { status: response.status });
    }
    if (response.status < 200 || response.status > 299) {
      throw new RouterError(CODES.HTTP, `HTTP ${response.status}`, { status: response.status });
    }
    if (!envelope) throw new RouterError(CODES.BAD_ANSWER, 'Not JSON');
    if (!envelope.success) {
      const code = envelope.errors[0]?.code ?? null;
      throw new RouterError(CODES.API_ERROR, `API error (code ${code ?? 'none'})`, {
        apiCode: code,
      });
    }
  }
}
