import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseHost, parsePort } from '../src/config.js';

test('defaults', () => {
  const config = normalizeConfig({ host: '192.168.1.1', password: 'p' });
  assert.equal(config.protocol, 'https');
  assert.equal(config.port, 443);
  assert.equal(config.username, 'admin');
  assert.equal(config.pollSeconds, 60);
  assert.equal(config.allowReboot, false, 'the reboot is off by default');
  assert.equal(DEFAULTS.allow_reboot, false);
  assert.equal(normalizeConfig({ host: 'x', protocol: 'http' }).port, 80);
});

test('hosts: IP, names, IPv6, a pasted URL', () => {
  assert.deepEqual(parseHost('192.168.1.1'), { host: '192.168.1.1', port: null, protocol: null });
  assert.deepEqual(parseHost('Router.lan.'), { host: 'router.lan', port: null, protocol: null });
  assert.deepEqual(parseHost('192.168.1.1:8443'), {
    host: '192.168.1.1',
    port: 8443,
    protocol: null,
  });
  assert.deepEqual(parseHost('[fe80::1]:443'), { host: 'fe80::1', port: 443, protocol: null });
  assert.deepEqual(parseHost('https://192.168.1.1/api'), {
    host: '192.168.1.1',
    port: null,
    protocol: 'https',
  });
  assert.deepEqual(parseHost('http://10.0.0.1:8080/'), {
    host: '10.0.0.1',
    port: 8080,
    protocol: 'http',
  });
  for (const bad of [
    '',
    '999.1.1.1',
    'ftp://x',
    'https://u:p@x',
    'https://x/cgi-bin/luci',
    'https://x/?a=1',
    'a b',
  ]) {
    assert.ok(parseHost(bad).error, bad);
  }
});

test('the protocol of a pasted URL wins; a port in the address wins', () => {
  const config = normalizeConfig({
    host: 'http://192.168.1.1:8080',
    protocol: 'https',
    port: 443,
    password: 'p',
  });
  assert.equal(config.protocol, 'http');
  assert.equal(config.port, 8080);
  assert.equal(normalizeConfig({ host: 'x', port: '70000' }).portInvalid, true);
  assert.equal(parsePort(' 443 '), 443);
});

test('user name and password', () => {
  assert.equal(normalizeConfig({ username: 'with space' }).usernameInvalid, true);
  assert.equal(normalizeConfig({ password: ' kept as typed ' }).password, ' kept as typed ');
  assert.equal(normalizeConfig({ password: 'line\nbreak' }).passwordInvalid, true);
  assert.equal(normalizeConfig({ password: 'x'.repeat(257) }).passwordInvalid, true);
  assert.equal(normalizeConfig({ password: 'ok' }).passwordInvalid, false);
});

test('options: only the listed values; the reboot only for true', () => {
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollSeconds, 60);
  assert.equal(normalizeConfig({ poll_interval: '30' }).pollSeconds, 30);
  assert.equal(normalizeConfig({ protocol: 'ftp' }).protocol, 'https');
  for (const value of [1, 'yes', 'on', {}]) {
    assert.equal(normalizeConfig({ allow_reboot: value }).allowReboot, false, String(value));
  }
  assert.equal(normalizeConfig({ allow_reboot: true }).allowReboot, true);
  assert.equal(normalizeConfig({ allow_reboot: 'true' }).allowReboot, true);
});
