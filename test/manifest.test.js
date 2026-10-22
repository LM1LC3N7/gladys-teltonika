// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULTS } from '../src/config.js';
import { ACTIONS, FEATURES, POLL_INTERVALS, PROTOCOLS, SCENE_TRIGGERS } from '../src/constants.js';
import { buildModemDevice, buildRouterDevice } from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const handlers = read('src/handlers.js');
const app = read('src/app.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* texts(item, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

const keys = (list) => (list ?? []).map((item) => item.key);
const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
const DOCS = () => [
  ['manifest', JSON.stringify(manifest)],
  ['docs/en.md', read('docs/en.md')],
  ['docs/fr.md', read('docs/fr.md')],
  ['README.md', read('README.md')],
  ['src/i18n.js', read('src/i18n.js')],
];

test('the store basics; version 0.1.0 set by hand everywhere', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/, 'scene triggers need 5.1');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-teltonika:${manifest.version}`);
  assert.equal(pkg.name, 'gladys-teltonika');
  assert.equal(lock.name, 'gladys-teltonika');
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-teltonika/main/cover.png',
  );
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(fields.intro.description.en, /Unofficial integration, not affiliated/);
  assert.match(fields.intro.description.fr, /non officielle, sans lien/);
  assert.match(read('docs/en.md'), /never been tested with a real router/i);
  assert.match(read('docs/fr.md'), /jamais été testée avec un vrai routeur/i);
});

test('the license (no personal name) and the notices ship in the image', () => {
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/, 'the standard text');
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /teltasync/);
  assert.match(notices, /Apache License/);
  assert.match(dockerfile, /COPY[^\n]*LICENSE[^\n]*THIRD_PARTY_NOTICES\.md/);
});

test('every text is bilingual', () => {
  for (const [path, text] of texts(manifest)) {
    assert.ok(text.en?.trim() && text.fr?.trim(), `${path} needs en and fr`);
  }
});

test('the configuration matches the code; the secret is never said encrypted', () => {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.equal(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.poll_interval.options.map((o) => o.value),
    POLL_INTERVALS,
  );
  assert.deepEqual(
    fields.protocol.options.map((o) => o.value),
    PROTOCOLS,
  );
  assert.deepEqual(keys(manifest.config_schema), [
    'intro',
    'host',
    'protocol',
    'port',
    'username',
    'password',
    'poll_interval',
    'commands',
    'allow_reboot',
  ]);
  assert.equal(fields.password.type, 'secret');
  assert.match(fields.password.description.en, /Kept by Gladys in its database, never shown again/);
  assert.match(fields.password.description.fr, /Gardé par Gladys dans sa base, jamais réaffiché/);
  assert.equal(fields.allow_reboot.type, 'boolean');
  assert.equal(fields.allow_reboot.default, false, 'the reboot is off by default');
  for (const [name, text] of DOCS()) {
    assert.doesNotMatch(text, /chiffr|encrypt/i, `${name}: a secret is not encrypted`);
  }
});

test('sections store nothing; links https', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined, section.key);
    assert.equal(section.default, undefined, section.key);
    assert.equal(section.placeholder, undefined, section.key);
    assert.ok(!(section.key in DEFAULTS), section.key);
    for (const link of section.links ?? []) assert.match(link.url, /^https:\/\//);
    for (const text of Object.values(section.description)) {
      assert.ok(text.length <= 1000, `${section.key}: ${text.length} characters`);
    }
  }
});

test('the keys of the manifest are the keys of the code, all registered', () => {
  assert.deepEqual(keys(manifest.actions).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), name);
  }
  assert.ok(manifest.actions.every((a) => a.timeout_seconds >= 5 && a.timeout_seconds <= 120));
  assert.equal(manifest.scene_actions, undefined, 'no scene action');
  assert.equal(manifest.widgets, undefined, 'no widget in v1');
  assert.deepEqual(keys(manifest.scene_triggers).sort(), Object.values(SCENE_TRIGGERS).sort());
  for (const name of Object.keys(SCENE_TRIGGERS)) {
    assert.ok(app.includes(`SCENE_TRIGGERS.${name}`), `${name} is never fired`);
  }
  for (const handler of ['onScanRequest(', 'onSetValue(', 'onConfigUpdated(', "on('connected'"]) {
    assert.ok(handlers.includes(handler), handler);
  }
});

test('the triggers: filters and variables are keys of the event, no identifier', () => {
  const data = ['device', 'modem_name', 'operator'];
  for (const trigger of manifest.scene_triggers) {
    for (const key of keys([...(trigger.fields ?? []), ...trigger.variables])) {
      assert.ok(data.includes(key), `${trigger.key}: ${key} is not in the event`);
    }
    const device = (trigger.fields ?? []).find((f) => f.key === 'device');
    assert.equal(device.source, 'devices');
    assert.equal(device.required, false);
    assert.doesNotMatch(JSON.stringify(trigger.variables), /imei|imsi|iccid|serial|phone/i);
  }
});

test('placeholders are multi-language objects', () => {
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
    assert.ok(field.placeholder.en && field.placeholder.fr, field.key);
  }
});

test('features: readings read only, the reboot a button, no switch; units of the core; keys fixed', () => {
  const gladys = createFakeGladys({ selector: 'teltonika' });
  const router = buildRouterDevice(gladys, { model: 'RUTX50' });
  const modem = buildModemDevice(gladys, { id: '2-1' });
  const features = [...router.features, ...modem.features];
  // Pairs and units of server/utils/constants.js of the core
  // (DEVICE_FEATURE_UNITS_BY_CATEGORY).
  const allowed = {
    unknown: { types: ['binary', 'unknown'], units: [undefined] },
    signal: { types: ['integer'], units: [undefined] },
    text: { types: ['text'], units: [undefined] },
    button: { types: ['push'], units: [undefined] },
    'device-temperature-sensor': { types: ['decimal'], units: ['celsius', 'fahrenheit'] },
    datarate: { types: ['rate'], units: ['kilobits-per-second'] },
    data: { types: ['size'], units: ['megabyte'] },
  };
  for (const feature of features) {
    const rule = allowed[feature.category];
    assert.ok(
      rule?.types.includes(feature.type),
      `${feature.name}: ${feature.category}/${feature.type}`,
    );
    assert.ok(rule.units.includes(feature.unit), `${feature.name}: unit ${feature.unit}`);
    assert.notEqual(feature.category, 'switch');
    if (feature.category === 'button') assert.equal(feature.read_only, false);
    else assert.equal(feature.read_only, true, feature.name);
  }
  assert.deepEqual(
    features.map((f) => f.external_id.split(':').at(-1)).sort(),
    Object.values(FEATURES).sort(),
  );
  assert.equal(router.external_id, 'ext:teltonika:router:main', 'the external id shape is forever');
  assert.equal(modem.external_id, 'ext:teltonika:modem:2-1');
});
