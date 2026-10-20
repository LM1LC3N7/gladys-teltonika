// -----------------------------------------------------------------------------
// The only network access of the integration: one request to the router, on
// node:https (or node:http when the user chose it). A deadline for the whole
// exchange, a size cap on the body, no redirect followed (the password and
// the token never go anywhere else).
//
// HTTPS: Teltonika routers ship a self-signed certificate, so no authority
// can vouch for it. The certificate is pinned instead: its SHA-256
// fingerprint is checked right after the TLS handshake, BEFORE a single byte
// of the request (password, token) is written. `pin: null` accepts any
// certificate and reports its fingerprint (the first connection, learned by
// the app). `beforeSend()` runs at that same moment, the very last check of a
// command: what it throws is rethrown marked `notSent`.
//
// Resolves { status, headers, body, fingerprint } for any status; rejects a
// RouterError for the transport failures, whose message never holds the
// address (Node's messages do).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { CODES, RouterError } from './errors.js';

function transportError(err, sent) {
  const code = String(err?.code ?? '');
  // Something answered, but not in HTTP or TLS (a wrong port, the wrong protocol).
  if (code.startsWith('HPE_') || code === 'EPROTO' || code.startsWith('ERR_SSL')) {
    return new RouterError(CODES.BAD_ANSWER, `Not the expected protocol (${code})`, {
      notSent: !sent,
    });
  }
  return new RouterError(
    CODES.UNREACHABLE,
    /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'Connection failed',
    { notSent: !sent },
  );
}

/**
 * @param {{ protocol: 'https'|'http', host: string, port: number, method: string, path: string }} target
 * @param {object} options
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body] JSON text
 * @param {number} options.timeout ms for the whole exchange
 * @param {number} options.maxBytes body size cap
 * @param {string|null} [options.pin] the expected SHA-256 fingerprint (https)
 * @param {() => void} [options.beforeSend]
 */
export function httpRequest(
  { protocol, host, port, method, path },
  { headers = {}, body, timeout, maxBytes, pin = null, beforeSend } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sent = false;
    let req = null;
    let fingerprint = null;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        req?.destroy();
        reject(error);
      } else {
        resolve(value);
      }
    };
    const timer = setTimeout(
      () =>
        finish(
          new RouterError(CODES.TIMEOUT, `No answer within ${Math.round(timeout / 1000)} s`, {
            notSent: !sent,
          }),
        ),
      timeout,
    );

    /** The connection is up (TLS checked): the last checks, then the request. */
    const ready = (socket) => {
      if (settled) return;
      if (protocol === 'https') {
        fingerprint = socket.getPeerCertificate?.()?.fingerprint256 ?? null;
        if (!fingerprint) {
          finish(new RouterError(CODES.CERTIFICATE, 'No certificate', { notSent: true }));
          return;
        }
        if (pin && fingerprint !== pin) {
          finish(
            Object.assign(
              new RouterError(CODES.CERTIFICATE, 'Another certificate', { notSent: true }),
              { fingerprint },
            ),
          );
          return;
        }
      }
      if (beforeSend) {
        try {
          beforeSend();
        } catch (err) {
          finish(Object.assign(err, { notSent: true, beforeSend: true }));
          return;
        }
      }
      sent = true;
      req.end(body);
    };

    try {
      const bare = host.replace(/^\[(.*)\]$/, '$1');
      const options = {
        method,
        host: bare,
        port,
        path,
        agent: false,
        headers: {
          accept: 'application/json',
          ...(body !== undefined
            ? {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(body)),
              }
            : {}),
          ...headers,
        },
      };
      if (protocol === 'https') {
        // Self-signed: checked by the pin above, not by an authority.
        options.rejectUnauthorized = false;
        if (!isIP(bare)) options.servername = bare;
      }
      req = (protocol === 'https' ? https : http).request(options, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            finish(new RouterError(CODES.TOO_LARGE, `Answer above ${maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () =>
          finish(null, {
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
            fingerprint,
          }),
        );
        res.on('error', (err) => finish(transportError(err, sent)));
      });
      req.on('socket', (socket) => {
        if (protocol === 'https') socket.once('secureConnect', () => ready(socket));
        else if (socket.connecting) socket.once('connect', () => ready(socket));
        else ready(socket);
      });
      req.on('error', (err) => finish(transportError(err, sent)));
    } catch (err) {
      // http.request throws synchronously on a value it refuses: a failure,
      // never a crash.
      finish(transportError(err, false));
    }
  });
}
