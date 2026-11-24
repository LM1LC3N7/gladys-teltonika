// -----------------------------------------------------------------------------
// The "Mobile router" dashboard widget (pure): one modem of the router at a
// glance, in the declarative vocabulary the core renders (SDK, "Dashboard
// widgets").
//
//   heading   the operator
//   tiles     signal bars (like a phone), network type, download, upload
//   status    the router answers / does not; mobile data connected / not
//   text      which modem (several), or why nothing is read, or a reboot
//             sent (nothing shown until a reading after it works)
//   button    Reboot, only when "Allow rebooting the router" is on, with the
//             core's confirmation; it goes through the reboot button's path
//
// Only what the integration already reads. A value it does not know (the
// router not read, a modem without it, a rate before two readings) is shown
// as unknown: never the last value, never a guess.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { SIGNAL_BARS, WIDGET_ACTIONS } from './constants.js';

const MAX_BARS = SIGNAL_BARS.length;
/** The core's limits: a tile value string, a heading, a caption. */
const VALUE_LENGTH = 12;
const HEADING_LENGTH = 40;
const CAPTION_LENGTH = 80;
const BODY_LENGTH = 300;

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const known = (value) => value !== null && value !== undefined;

const WORDS = {
  unknown: { en: 'unknown', fr: 'inconnu' },
  unknownOperator: { en: 'Operator unknown', fr: 'Opérateur inconnu' },
  answers: { en: 'Answers', fr: 'Répond' },
  notRead: { en: 'Not read', fr: 'Non lu' },
  rebooting: { en: 'Reboot sent', fr: 'Redémarrage envoyé' },
  connected: { en: 'Connected', fr: 'Connectée' },
  notConnected: { en: 'Not connected', fr: 'Non connectée' },
};

/** The texts of the widget: labels are { en, fr }, values one language (the content is per language). */
export const W = {
  router: { en: 'Router', fr: 'Routeur' },
  mobileData: { en: 'Mobile data', fr: 'Données mobiles' },
  signal: (bars) =>
    known(bars)
      ? { en: `Signal ${bars}/${MAX_BARS}`, fr: `Signal ${bars}/${MAX_BARS}` }
      : { en: 'Signal', fr: 'Signal' },
  network: { en: 'Network', fr: 'Réseau' },
  download: { en: 'Download', fr: 'Descendant' },
  upload: { en: 'Upload', fr: 'Montant' },
  reboot: { en: 'Reboot', fr: 'Redémarrer' },
  modemOf: (name, index, count, chosen) => ({
    en: `Modem ${index}/${count}: ${name ?? 'no name'}${chosen ? '' : ' (choose it in the widget settings)'}`,
    fr: `Modem ${index}/${count} : ${name ?? 'sans nom'}${chosen ? '' : ' (à choisir dans les réglages du widget)'}`,
  }),
  rebootPending: {
    en: 'Reboot sent: the router restarts, values back at the next reading.',
    fr: 'Redémarrage envoyé : le routeur redémarre, valeurs à la prochaine lecture.',
  },
  problems: {
    other: {
      en: 'The chosen device is not a modem of this router: choose another one in the widget settings.',
      fr: 'L’appareil choisi n’est pas un modem de ce routeur : choisissez-en un autre dans les réglages du widget.',
    },
    missing: {
      en: 'The chosen modem is not in the last reading of the router.',
      fr: 'Le modem choisi n’est pas dans la dernière lecture du routeur.',
    },
    none: {
      en: 'The router lists no mobile modem.',
      fr: 'Le routeur ne liste aucun modem mobile.',
    },
    notRead: {
      en: 'The router is not read: see the integration.',
      fr: 'Le routeur n’est pas lu : voir l’intégration.',
    },
  },
};

/** Bars like a phone: ▮ for each bar, ▯ for the rest; null when unknown. */
export function signalText(bars) {
  if (!Number.isInteger(bars) || bars < 0 || bars > MAX_BARS) return null;
  return '▮'.repeat(bars) + '▯'.repeat(MAX_BARS - bars);
}

function signalColor(bars) {
  if (!known(bars)) return WIDGET_COLORS.NEUTRAL;
  if (bars <= 1) return WIDGET_COLORS.DANGER;
  if (bars === 2) return WIDGET_COLORS.WARNING;
  return WIDGET_COLORS.SUCCESS;
}

/** A rate in kbit/s as a tile value: kbit/s below 1000, Mbit/s above; null when unknown. */
export function rateValue(kbps) {
  if (typeof kbps !== 'number' || !Number.isFinite(kbps) || kbps < 0) return null;
  // Rounded first: 999.6 kbit/s is 1 Mbit/s, never "1000 kbit/s".
  if (Math.round(kbps) < 1000) return { value: Math.round(kbps), unit: 'kbit/s' };
  return { value: Math.round(kbps / 100) / 10, unit: 'Mbit/s' };
}

/**
 * The content of the widget.
 * @param {object} view
 * @param {string} view.language the dashboard's language
 * @param {number} view.ttlSeconds how long the core keeps the content
 * @param {boolean} view.online the last reading of the router worked
 * @param {boolean} [view.rebooting] a reboot sent, no reading after it yet
 * @param {object|null} view.status the connection status { en, fr }, shown when not online
 * @param {boolean} view.allowReboot "Allow rebooting the router"
 * @param {object|null} view.modem { name, operator, networkType, dataConnected, bars, down, up }
 * @param {'other'|'missing'|'none'|null} view.problem why there is no modem
 * @param {boolean} [view.chosen] the modem was chosen in the settings
 * @param {number} view.index the place of the modem (from 1), view.count of how many
 */
export function buildWidgetContent({
  language,
  ttlSeconds,
  online: read,
  rebooting = false,
  status,
  allowReboot,
  modem,
  problem,
  chosen = false,
  index,
  count,
}) {
  // A reboot sent: the router is restarting, nothing of the last reading holds.
  const online = read && !rebooting;
  const lang = typeof language === 'string' && language.startsWith('fr') ? 'fr' : 'en';
  const say = (text) => text[lang] ?? text.en;
  const unknown = say(WORDS.unknown);
  // Nothing known about a modem the router does not answer for.
  const m = online && modem ? modem : null;

  const operator = m && typeof m.operator === 'string' && m.operator ? m.operator : null;
  const network = m && typeof m.networkType === 'string' && m.networkType ? m.networkType : null;
  const bars = m && Number.isInteger(m.bars) ? m.bars : null;
  const dataConnected = m && typeof m.dataConnected === 'boolean' ? m.dataConnected : null;
  const down = rateValue(m?.down);
  const up = rateValue(m?.up);

  const components = [
    {
      type: 'text',
      variant: 'heading',
      text: cut(operator ?? say(WORDS.unknownOperator), HEADING_LENGTH),
    },
  ];
  // The second text: why nothing is shown, else which modem (only with several).
  let note = null;
  if (rebooting) note = say(W.rebootPending);
  else if (!online) note = cut(status ? say(status) : say(W.problems.notRead), BODY_LENGTH);
  else if (problem) note = say(W.problems[problem]);
  else if (count > 1) {
    note = cut(say(W.modemOf(modem?.name ?? null, index, count, chosen)), CAPTION_LENGTH);
  }
  if (note) {
    const variant = online && !problem ? 'caption' : 'body';
    components.push({ type: 'text', variant, text: note });
  }

  components.push(
    {
      type: 'value',
      label: W.signal(bars),
      icon: 'bar-chart-2',
      value: signalText(bars) ?? unknown,
      color: signalColor(bars),
    },
    {
      type: 'value',
      label: W.network,
      icon: 'radio',
      value: network ? cut(network, VALUE_LENGTH) : unknown,
      color: network ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      label: W.download,
      icon: 'arrow-down',
      ...(down ? { value: down.value, unit: down.unit } : { value: unknown }),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      label: W.upload,
      icon: 'arrow-up',
      ...(up ? { value: up.value, unit: up.unit } : { value: unknown }),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'status',
      items: [
        {
          label: W.mobileData,
          value:
            dataConnected === null
              ? unknown
              : say(dataConnected ? WORDS.connected : WORDS.notConnected),
          color:
            dataConnected === null
              ? WIDGET_COLORS.NEUTRAL
              : dataConnected
                ? WIDGET_COLORS.SUCCESS
                : WIDGET_COLORS.DANGER,
        },
        rebooting
          ? { label: W.router, value: say(WORDS.rebooting), color: WIDGET_COLORS.WARNING }
          : {
              label: W.router,
              value: say(online ? WORDS.answers : WORDS.notRead),
              color: online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
            },
      ],
    },
  );
  if (allowReboot) {
    components.push({
      type: 'button',
      label: W.reboot,
      icon: 'refresh-cw',
      style: 'danger',
      action: { key: WIDGET_ACTIONS.REBOOT, confirm: true },
    });
  }
  return { ttl_seconds: ttlSeconds, components };
}
