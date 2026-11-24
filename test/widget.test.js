// -----------------------------------------------------------------------------
// The "Mobile router" widget content (pure): the vocabulary of the core, its
// budget, unknown values shown as unknown.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { buildWidgetContent, rateValue, signalText } from '../src/widget.js';

const MODEM = {
  name: 'Internal modem',
  operator: 'Orange F',
  networkType: '4G (LTE)',
  dataConnected: true,
  bars: 3,
  down: 25_400,
  up: 512.4,
};
const view = (overrides = {}) => ({
  language: 'en',
  ttlSeconds: 60,
  online: true,
  status: null,
  allowReboot: false,
  modem: MODEM,
  problem: null,
  index: 1,
  count: 1,
  ...overrides,
});

test('signal bars like a phone; anything else is unknown', () => {
  assert.equal(signalText(0), '▯▯▯▯▯');
  assert.equal(signalText(3), '▮▮▮▯▯');
  assert.equal(signalText(5), '▮▮▮▮▮');
  for (const bad of [null, undefined, -1, 6, 2.5, '3', NaN]) assert.equal(signalText(bad), null);
});

test('rates: kbit/s below 1000, Mbit/s above; unknown is null, never 0', () => {
  assert.deepEqual(rateValue(0), { value: 0, unit: 'kbit/s' });
  assert.deepEqual(rateValue(512.4), { value: 512, unit: 'kbit/s' });
  assert.deepEqual(rateValue(25_400), { value: 25.4, unit: 'Mbit/s' });
  for (const bad of [null, undefined, -1, NaN, Infinity, '12']) assert.equal(rateValue(bad), null);
});

test('every shape is rendered exactly as sent, within the budget', () => {
  const long = 'x'.repeat(200);
  const cases = [
    view(),
    view({ allowReboot: true, count: 2, modem: { ...MODEM, name: long } }),
    view({ language: 'fr', allowReboot: true, problem: 'other', modem: null }),
    view({ online: false, status: { en: long.repeat(2), fr: long.repeat(2) }, allowReboot: true }),
    view({ modem: { ...MODEM, operator: long, networkType: '5G (NSA) long name here' } }),
    view({
      modem: { name: null, operator: null, networkType: null, dataConnected: null, bars: null },
    }),
  ];
  for (const c of cases) {
    const content = buildWidgetContent(c);
    assert.deepEqual(validateWidgetContent(content), [], JSON.stringify(c).slice(0, 80));
    assert.ok(content.components.length <= 8);
  }
});

test('the values of the modem, in the language of the dashboard', () => {
  const content = buildWidgetContent(view({ language: 'fr', allowReboot: true }));
  const values = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    values.map((c) => [c.label.fr, c.value, c.unit ?? null, c.color]),
    [
      ['Signal 3/5', '▮▮▮▯▯', null, 'success'],
      ['Réseau', '4G (LTE)', null, 'primary'],
      ['Descendant', 25.4, 'Mbit/s', 'neutral'],
      ['Montant', 512, 'kbit/s', 'neutral'],
    ],
  );
  const status = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    status.map((i) => [i.label.fr, i.value, i.color]),
    [
      ['Données mobiles', 'Connectée', 'success'],
      ['Routeur', 'Répond', 'success'],
    ],
  );
  const button = content.components.find((c) => c.type === 'button');
  assert.deepEqual(button.action, { key: 'reboot', confirm: true });
});

test('not online: the modem in memory is never shown', () => {
  const content = buildWidgetContent(view({ online: false }));
  assert.ok(!JSON.stringify(content).includes('Orange F'));
  assert.ok(!JSON.stringify(content).includes('LTE'));
  const values = content.components.filter((c) => c.type === 'value').map((c) => c.value);
  assert.deepEqual(values, ['unknown', 'unknown', 'unknown', 'unknown']);
  assert.equal(content.components.filter((c) => c.type === 'button').length, 0);
});

test('signal colors: red at 0 or 1 bar, orange at 2, green above, grey unknown', () => {
  const color = (bars) =>
    buildWidgetContent(view({ modem: { ...MODEM, bars } })).components.find(
      (c) => c.type === 'value',
    ).color;
  assert.deepEqual([0, 1, 2, 3, 5, null].map(color), [
    'danger',
    'danger',
    'warning',
    'success',
    'success',
    'neutral',
  ]);
});
