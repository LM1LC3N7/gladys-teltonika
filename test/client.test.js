// -----------------------------------------------------------------------------
// The RutOS client (src/teltonika/client.js) against the fake router: login,
// token, a rejected session renewed once, refusals, pauses, the reboot.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TeltonikaClient } from '../src/teltonika/client.js';
import { CODES } from '../src/teltonika/errors.js';
import { PASSWORD, USERNAME, createFakeRouter } from './helpers/fakeRouter.js';

function client(router, extra = {}) {
  const clock = extra.clock ?? { now: 1_000_000 };
  return {
    clock,
    client: new TeltonikaClient({
      protocol: 'https',
      host: '192.168.1.1',
      port: 443,
      username: USERNAME,
      password: PASSWORD,
      request: router.request,
      now: () => clock.now,
      ...extra,
    }),
  };
}

test('login, then the Bearer token; the certificate learned once', async () => {
  const router = createFakeRouter();
  const pins = [];
  const { client: c } = client(router, { onPin: async (fp) => pins.push(fp) });
  const { modems } = await c.modems();
  assert.equal(modems.length, 1);
  assert.deepEqual(JSON.parse(router.requests[0].body), { username: USERNAME, password: PASSWORD });
  assert.equal(router.requests[0].headers.authorization, undefined);
  assert.match(router.requests[1].headers.authorization, /^Bearer fakeTokenJWT1/);
  assert.deepEqual(pins, [router.fingerprint]);
  await c.deviceStatus();
  assert.equal(router.logins().length, 1);
  assert.equal(router.requests[2].pin, router.fingerprint);
});

test('credentials refused: HTTP 401 or code 121 at login', async () => {
  const router = createFakeRouter();
  router.password = 'other';
  const { client: c } = client(router);
  await assert.rejects(c.modems(), (err) => err.code === CODES.CREDENTIALS);
  router.failures.push({
    status: 200,
    body: '{"success":false,"errors":[{"code":121,"error":"Login failed"}]}',
  });
  await assert.rejects(c.modems(), (err) => err.code === CODES.CREDENTIALS);
});

test('a rejected session: one new login, then ACCESS (no loop)', async () => {
  const router = createFakeRouter();
  const { client: c } = client(router);
  await c.modems();
  router.dropSessions();
  await c.modems();
  assert.equal(router.logins().length, 2);
  const refused = { status: 200, body: '{"success":false,"errors":[{"code":123}]}' };
  router.failuresOn.set('/api/modems/status', [refused, refused]);
  await assert.rejects(c.modems(), (err) => err.code === CODES.ACCESS);
  assert.equal(router.logins().length, 3);
});

test('429 with Retry-After, 5xx, a redirect, an unexpected answer', async () => {
  const router = createFakeRouter();
  const { client: c } = client(router);
  router.failures.push({ status: 429, headers: { 'retry-after': '120' } });
  await assert.rejects(c.modems(), (err) => err.status === 429 && err.retryAfterMs === 120_000);
  router.failures.push({ status: 503 });
  await assert.rejects(c.modems(), (err) => err.code === CODES.HTTP && err.status === 503);
  router.failures.push({ status: 301 });
  await assert.rejects(c.modems(), (err) => err.code === CODES.REDIRECT);
  await c.modems();
  router.failuresOn.set('/api/modems/status', [{ status: 200, body: '<html>' }]);
  await assert.rejects(c.modems(), (err) => err.code === CODES.BAD_ANSWER);
  router.failuresOn.set('/api/modems/status', [
    { status: 200, body: '{"success":true,"data":{}}' },
  ]);
  await assert.rejects(c.modems(), (err) => err.code === CODES.BAD_ANSWER);
});

test('the token is renewed 30 s before it expires', async () => {
  const router = createFakeRouter();
  const { client: c, clock } = client(router);
  await c.modems();
  clock.now += 268_000;
  await c.modems();
  assert.equal(router.logins().length, 1);
  clock.now += 2_000;
  await c.modems();
  assert.equal(router.logins().length, 2);
});

test('reboot: never without a valid token, never late, never retried', async () => {
  const router = createFakeRouter();
  const { client: c, clock } = client(router);
  await assert.rejects(
    c.reboot({ sendBy: clock.now + 1000, answerBy: clock.now + 2000 }),
    (err) => err.code === CODES.LATE && err.notSent,
  );
  await c.deviceStatus();
  await assert.rejects(
    c.reboot({ sendBy: clock.now - 1, answerBy: clock.now + 2000 }),
    (err) => err.code === CODES.LATE && err.notSent,
  );
  assert.equal(router.reboots, 0);
  await c.reboot({ sendBy: clock.now + 1000, answerBy: clock.now + 2000 });
  assert.equal(router.reboots, 1);
  router.reboot = 'refused';
  await assert.rejects(
    c.reboot({ sendBy: clock.now + 1000, answerBy: clock.now + 2000 }),
    (err) => err.code === CODES.API_ERROR,
  );
  router.dropSessions();
  router.reboot = 'ok';
  await assert.rejects(
    c.reboot({ sendBy: clock.now + 1000, answerBy: clock.now + 2000 }),
    (err) => err.code === CODES.ACCESS,
  );
  assert.equal(router.reboots, 2, 'no login nor retry after a rejected session');
  assert.equal(router.logins().length, 1);
});

test('a closed client sends nothing', async () => {
  const router = createFakeRouter();
  const { client: c } = client(router);
  c.close();
  await assert.rejects(c.modems(), (err) => err.code === CODES.CLOSED && err.notSent);
  assert.equal(router.requests.length, 0);
});

test('M2 single flight: two readings that need a new token share one login', async () => {
  const router = createFakeRouter();
  const { client: c, clock } = client(router);
  await c.modems();
  clock.now += 300_000;
  await Promise.all([c.modems(), c.deviceStatus(), c.modems()]);
  assert.equal(router.logins().length, 2);
});

test('M1 a short token keeps half of its life: no login before every request', async () => {
  const router = createFakeRouter();
  router.expires = 20;
  const { client: c, clock } = client(router);
  await c.deviceStatus();
  await c.modems();
  assert.equal(router.logins().length, 1);
  clock.now += 9_000;
  await c.modems();
  assert.equal(router.logins().length, 1);
  clock.now += 2_000;
  await c.modems();
  assert.equal(router.logins().length, 2);
});
