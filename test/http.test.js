// -----------------------------------------------------------------------------
// The transport (src/teltonika/http.js) against loopback servers: HTTP and
// HTTPS with a self-signed certificate, the pin checked before anything is
// written, the size cap, the deadline, no redirect followed.
// -----------------------------------------------------------------------------

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { CODES } from '../src/teltonika/errors.js';
import { httpRequest } from '../src/teltonika/http.js';
import { selfSigned } from './helpers/selfSigned.js';

const CERT = selfSigned();
const OTHER = selfSigned('Impostor');
const received = [];
let routes = {};

function handler(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: Buffer.concat(chunks).toString(),
    });
    const route = routes[req.url] ?? { status: 200, body: '{"success":true,"data":{}}' };
    if (route.hang) return;
    res.writeHead(route.status, route.headers ?? { 'content-type': 'application/json' });
    res.end(route.body);
  });
}

const servers = {};
async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
before(async () => {
  servers.http = http.createServer(handler);
  servers.https = https.createServer({ key: CERT.key, cert: CERT.cert }, handler);
  servers.other = https.createServer({ key: OTHER.key, cert: OTHER.cert }, handler);
  servers.ports = {
    http: await listen(servers.http),
    https: await listen(servers.https),
    other: await listen(servers.other),
  };
});
after(async () => {
  for (const server of [servers.http, servers.https, servers.other]) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

const OPTIONS = { timeout: 3_000, maxBytes: 64 * 1024 };
const target = (protocol, path = '/api/login', method = 'POST') => ({
  protocol,
  host: '127.0.0.1',
  port: servers.ports[protocol === 'other' ? 'other' : protocol],
  method,
  path,
});

test('HTTP: a JSON body is sent, the answer read', async () => {
  received.length = 0;
  routes = {};
  const response = await httpRequest(target('http'), { ...OPTIONS, body: '{"a":1}' });
  assert.equal(response.status, 200);
  assert.equal(response.fingerprint, null);
  assert.equal(received[0].body, '{"a":1}');
  assert.equal(received[0].headers['content-type'], 'application/json');
});

test('HTTPS: a self-signed certificate is accepted on first use and its fingerprint given', async () => {
  received.length = 0;
  const response = await httpRequest(target('https'), { ...OPTIONS, body: '{}' });
  assert.equal(response.status, 200);
  assert.equal(response.fingerprint, CERT.fingerprint256);
  // With the pin: accepted.
  const pinned = await httpRequest(target('https'), { ...OPTIONS, pin: CERT.fingerprint256 });
  assert.equal(pinned.status, 200);
});

test('HTTPS: another certificate than the pin: refused before a byte of the request is written', async () => {
  received.length = 0;
  const secret = '{"username":"admin","password":"secret"}';
  const other = { ...target('https'), port: servers.ports.other };
  await assert.rejects(
    httpRequest(other, { ...OPTIONS, body: secret, pin: CERT.fingerprint256 }),
    (err) =>
      err.code === CODES.CERTIFICATE &&
      err.notSent === true &&
      err.fingerprint === OTHER.fingerprint256,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(received.length, 0, 'the impostor received nothing');
});

test('beforeSend: what it throws stops the request unsent', async () => {
  received.length = 0;
  await assert.rejects(
    httpRequest(target('https'), {
      ...OPTIONS,
      body: '{}',
      beforeSend: () => {
        throw new Error('option off');
      },
    }),
    (err) => err.message === 'option off' && err.notSent && err.beforeSend,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(received.length, 0);
});

test('no redirect followed; a size cap; a deadline; a closed port', async () => {
  routes = {
    '/redirect': { status: 302, headers: { location: 'https://example.invalid/' }, body: '' },
    '/big': { status: 200, body: 'x'.repeat(70 * 1024) },
    '/hang': { hang: true },
  };
  const redirect = await httpRequest(target('http', '/redirect', 'GET'), OPTIONS);
  assert.equal(redirect.status, 302);
  await assert.rejects(
    httpRequest(target('http', '/big', 'GET'), OPTIONS),
    (err) => err.code === CODES.TOO_LARGE,
  );
  await assert.rejects(
    httpRequest(target('http', '/hang', 'GET'), { ...OPTIONS, timeout: 200 }),
    (err) => err.code === CODES.TIMEOUT && !err.notSent,
  );
  const closed = { ...target('http'), port: 1 };
  await assert.rejects(
    httpRequest(closed, OPTIONS),
    (err) => err.code === CODES.UNREACHABLE && err.notSent && !err.message.includes('127.0.0.1'),
  );
});

test('HTTP spoken to an HTTPS port is a protocol error', async () => {
  const wrong = { ...target('http'), port: servers.ports.https };
  await assert.rejects(httpRequest(wrong, OPTIONS), (err) =>
    [CODES.BAD_ANSWER, CODES.UNREACHABLE].includes(err.code),
  );
});
