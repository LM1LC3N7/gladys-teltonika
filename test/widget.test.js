// -----------------------------------------------------------------------------
// The "Mobile router" widget content (pure): the vocabulary of the core, its
// budget, unknown values shown as unknown.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { INTERVALS } from '../src/constants.js';
import { withoutRetry } from '../src/i18n.js';
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
  assert.deepEqual(rateValue(999.4), { value: 999, unit: 'kbit/s' });
  assert.deepEqual(rateValue(999.6), { value: 1, unit: 'Mbit/s' }, 'never "1000 kbit/s"');
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

test('a reboot sent: nothing of the modem, the router in orange, the button kept', () => {
  const content = buildWidgetContent(view({ rebooting: true, allowReboot: true }));
  assert.deepEqual(validateWidgetContent(content), []);
  assert.ok(!JSON.stringify(content).includes('Orange F'));
  const status = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(status[1].value, 'Reboot sent');
  assert.deepEqual(status[1].color, 'warning');
  assert.equal(content.components.filter((c) => c.type === 'button').length, 1);
});

test('the modem hint only when the modem was not chosen', () => {
  const caption = (chosen) =>
    buildWidgetContent(view({ count: 2, index: 2, chosen })).components.find(
      (c) => c.variant === 'caption',
    ).text;
  assert.match(caption(false), /choose it in the widget settings/);
  assert.equal(caption(true), 'Modem 2/2: Internal modem');
});

test('the status in the widget loses its retry countdown, nothing else', () => {
  assert.deepEqual(
    withoutRetry({
      en: 'No answer. Retried in 5 min.',
      fr: 'Pas de réponse. Nouvel essai dans 5 min.',
    }),
    { en: 'No answer.', fr: 'Pas de réponse.' },
  );
  assert.deepEqual(
    withoutRetry({
      en: 'No answer: no connection — Retried in 2 min.',
      fr: 'Pas de réponse : pas de connexion — Nouvel essai dans 2 min.',
    }),
    { en: 'No answer: no connection', fr: 'Pas de réponse : pas de connexion' },
  );
  assert.deepEqual(withoutRetry({ en: 'OK.', fr: 'OK.' }), { en: 'OK.', fr: 'OK.' });
  assert.equal(withoutRetry(null), null);
});

test('the nudges keep a margin over the 10 s of Gladys', () => {
  assert.ok(INTERVALS.WIDGET_NUDGE_MS > 10_000 && INTERVALS.WIDGET_NUDGE_MS <= 11_000);
});
