// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// -----------------------------------------------------------------------------

import { DEFAULT_PORTS, POLL_INTERVALS, PROTOCOLS } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = Object.freeze({
  protocol: 'https',
  username: 'admin',
  poll_interval: '60',
  allow_reboot: false,
});

const text = (value) => (typeof value === 'string' ? value.trim() : '');

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const HOSTNAME =
  /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;
const IPV6 = /^[0-9A-Fa-f:.]{2,45}$/;
/** A RutOS user name: printable ASCII, no space. */
const USERNAME = /^[\x21-\x7e]{1,64}$/;
/** A control character (a newline pasted with the password). */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/;

/** The port typed by the user: an integer 1-65535, or null. */
export function parsePort(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(text(String(value)));
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

/**
 * The router: an IPv4 address, a host name or an IPv6 address (brackets
 * allowed), with an optional port. An address pasted from a browser
 * (`https://192.168.1.1`, `https://192.168.1.1/api`) is read as its
 * protocol, host and port. Credentials, a query or another path are refused.
 *   -> { host, port | null, protocol | null } or { error: 'missing' | 'invalid' }
 */
export function parseHost(value) {
  let raw = text(value);
  if (!raw) return { error: 'missing' };
  if (raw.length > 300) return { error: 'invalid' };
  let port = null;
  let protocol = null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return { error: 'invalid' };
    }
    protocol = url.protocol.slice(0, -1);
    if (!PROTOCOLS.includes(protocol)) return { error: 'invalid' };
    if (url.username || url.password || url.search || url.hash) return { error: 'invalid' };
    if (!['', '/', '/api', '/api/'].includes(url.pathname)) return { error: 'invalid' };
    port = url.port ? Number(url.port) : null;
    raw = url.hostname;
  } else {
    const match = /^([^:[\]]+):(\d{1,5})$/.exec(raw) ?? /^\[([^\]]+)\]:(\d{1,5})$/.exec(raw);
    if (match) {
      raw = match[1];
      port = parsePort(match[2]);
      if (port === null) return { error: 'invalid' };
    }
  }
  const host = raw.replace(/^\[(.*)\]$/, '$1');
  if (IPV4.test(host)) {
    if (!host.split('.').every((n) => Number(n) <= 255)) return { error: 'invalid' };
    return { host, port, protocol };
  }
  if (host.includes(':')) {
    return IPV6.test(host) ? { host: host.toLowerCase(), port, protocol } : { error: 'invalid' };
  }
  return HOSTNAME.test(host)
    ? { host: host.toLowerCase().replace(/\.$/, ''), port, protocol }
    : { error: 'invalid' };
}

/** A boolean of the configuration: true only for true (or "true"). */
const flag = (value) => value === true || value === 'true';

export function normalizeConfig(raw = {}) {
  raw = raw ?? {};
  const target = parseHost(raw.host);
  const typedPort = parsePort(raw.port);
  const portInvalid =
    raw.port !== undefined && raw.port !== null && raw.port !== '' && typedPort === null;
  const pick = (key, list) => (list.includes(String(raw[key])) ? String(raw[key]) : DEFAULTS[key]);
  // A protocol in the address wins over the protocol field.
  const protocol = target.protocol ?? pick('protocol', PROTOCOLS);
  const username = text(raw.username) || DEFAULTS.username;
  // The password is kept as typed (a space may belong to it), never trimmed.
  const password = typeof raw.password === 'string' ? raw.password : '';
  return {
    host: target.error ? null : target.host,
    hostError: target.error ?? null,
    protocol,
    // A port in the address wins over the port field.
    port: target.port ?? typedPort ?? DEFAULT_PORTS[protocol],
    portInvalid: !target.port && portInvalid,
    username,
    usernameInvalid: !USERNAME.test(username),
    password,
    // A newline or a control character pasted with it: said, never sent.
    passwordInvalid: password !== '' && (CONTROL.test(password) || password.length > 256),
    pollSeconds: Number(pick('poll_interval', POLL_INTERVALS)),
    allowReboot: flag(raw.allow_reboot),
  };
}
