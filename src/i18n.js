// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, button, errors). Errors
// thrown to Gladys are English (one language per message, like the core's);
// the statuses and button answers are { en, fr }. No text ever holds the
// password, the token, a serial number, an IMEI, an IMSI nor a phone number.
// -----------------------------------------------------------------------------

import { CODES } from './teltonika/errors.js';

const plural = (n, one, many) => (n === 1 ? one : many);
/** French: 0 and 1 take the singular. */
const pluralFr = (n, one, many) => (n <= 1 ? one : many);
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));

/** Why the router failed, in a few words. */
export function reasonOf(err) {
  switch (err?.code) {
    case CODES.UNREACHABLE:
      return { en: 'no connection', fr: 'pas de connexion' };
    case CODES.TIMEOUT:
      return { en: 'no answer in time', fr: 'pas de réponse à temps' };
    case CODES.HTTP:
      return { en: `HTTP error ${err.status}`, fr: `erreur HTTP ${err.status}` };
    case CODES.BAD_ANSWER:
      return { en: 'unexpected answer', fr: 'réponse inattendue' };
    case CODES.TOO_LARGE:
      return { en: 'answer too large', fr: 'réponse trop grande' };
    case CODES.API_ERROR:
      return {
        en: `RutOS error ${err.apiCode ?? ''}`.trim(),
        fr: `erreur RutOS ${err.apiCode ?? ''}`.trim(),
      };
    case CODES.CREDENTIALS:
      return { en: 'user name or password refused', fr: 'identifiants refusés' };
    case CODES.ACCESS:
      return { en: 'access refused to this account', fr: 'accès refusé à ce compte' };
    case CODES.CERTIFICATE:
      return { en: 'another HTTPS certificate', fr: 'autre certificat HTTPS' };
    case CODES.REDIRECT:
      return { en: 'redirection', fr: 'redirection' };
    case CODES.CLOSED:
      return { en: 'configuration changed', fr: 'configuration changée' };
    default:
      return { en: 'error', fr: 'erreur' };
  }
}

const RETRY = (delay) => ({
  en: `Retried in ${minutes(delay)} min.`,
  fr: `Nouvel essai dans ${minutes(delay)} min.`,
});

export const join = (...parts) => ({
  en: parts
    .map((p) => p.en)
    .filter(Boolean)
    .join(' '),
  fr: parts
    .map((p) => p.fr)
    .filter(Boolean)
    .join(' '),
});

export const T = {
  status: {
    ok: ({ model, modems, connected }) => ({
      en: `${model ?? 'The router'} answers: ${modems} ${plural(modems, 'modem', 'modems')}, mobile data ${connected > 0 ? 'connected' : 'not connected'}.`,
      fr: `${model ?? 'Le routeur'} répond : ${modems} ${pluralFr(modems, 'modem', 'modems')}, données mobiles ${connected > 0 ? 'connectées' : 'non connectées'}.`,
    }),
    noModem: (model) => ({
      en: `${model ?? 'The router'} answers, but lists no mobile modem.`,
      fr: `${model ?? 'Le routeur'} répond, mais ne liste aucun modem mobile.`,
    }),
    hostMissing: {
      en: 'Type the address of the router, e.g. 192.168.1.1.',
      fr: 'Saisissez l’adresse du routeur, ex. 192.168.1.1.',
    },
    hostInvalid: {
      en: 'The address of the router is not valid: type an IP address or a host name (e.g. 192.168.1.1), without a path or query.',
      fr: 'L’adresse du routeur n’est pas valide : saisissez une adresse IP ou un nom d’hôte (ex. 192.168.1.1), sans chemin ni paramètres.',
    },
    portInvalid: {
      en: 'The port must be a number between 1 and 65535 (empty: 443 in HTTPS, 80 in HTTP).',
      fr: 'Le port doit être un nombre entre 1 et 65535 (vide : 443 en HTTPS, 80 en HTTP).',
    },
    usernameInvalid: {
      en: 'The user name holds a space or an invisible character: type it again.',
      fr: 'Le nom d’utilisateur contient une espace ou un caractère invisible : saisissez-le de nouveau.',
    },
    missingPassword: {
      en: 'Type the password of the router account.',
      fr: 'Saisissez le mot de passe du compte du routeur.',
    },
    passwordInvalid: {
      en: 'The password holds a line break or an invisible character (copied with it?), or is too long: paste it again.',
      fr: 'Le mot de passe contient un retour à la ligne ou un caractère invisible (copié avec ?), ou est trop long : collez-le de nouveau.',
    },
    credentialsRefused: {
      en: 'The router refused the user name or the password. Gladys does not try again by itself (the router could lock the account): check them and save the configuration.',
      fr: 'Le routeur a refusé le nom d’utilisateur ou le mot de passe. Gladys ne réessaie pas seul (le routeur pourrait bloquer le compte) : vérifiez-les et enregistrez la configuration.',
    },
    certificateChanged: {
      en: 'The HTTPS certificate of the router is not the one Gladys met before (a reset, a new certificate, or another device at this address). Nothing was sent. If you changed it yourself, save the configuration to accept the new one.',
      fr: 'Le certificat HTTPS du routeur n’est pas celui que Gladys a connu (réinitialisation, nouveau certificat, ou autre appareil à cette adresse). Rien n’a été envoyé. Si vous l’avez changé vous-même, enregistrez la configuration pour accepter le nouveau.',
    },
    access: (delay) =>
      join(
        {
          en: 'The router accepts the login but refuses the readings: give this account read access to the API (System, Administration, User settings), or use the admin account.',
          fr: 'Le routeur accepte la connexion mais refuse les lectures : donnez à ce compte l’accès en lecture à l’API (Système, Administration, Utilisateurs), ou utilisez le compte admin.',
        },
        RETRY(delay),
      ),
    redirect: (protocol, delay) =>
      join(
        protocol === 'http'
          ? {
              en: 'The router redirects HTTP to HTTPS: choose HTTPS in the configuration.',
              fr: 'Le routeur redirige le HTTP vers le HTTPS : choisissez HTTPS dans la configuration.',
            }
          : {
              en: 'The router answers with a redirection: check the address and the port.',
              fr: 'Le routeur répond par une redirection : vérifiez l’adresse et le port.',
            },
        RETRY(delay),
      ),
    notRutos: (delay) =>
      join(
        {
          en: 'This address does not answer like the API of a Teltonika router (RutOS 7 or later): check the address, the protocol and the port.',
          fr: 'Cette adresse ne répond pas comme l’API d’un routeur Teltonika (RutOS 7 ou plus récent) : vérifiez l’adresse, le protocole et le port.',
        },
        RETRY(delay),
      ),
    busy: (delay) =>
      join(
        {
          en: 'The router asks Gladys to slow down (HTTP 429): every request is paused.',
          fr: 'Le routeur demande à Gladys de ralentir (HTTP 429) : toutes les requêtes sont suspendues.',
        },
        RETRY(delay),
      ),
    serverError: (status, delay) =>
      join(
        {
          en: `The router answers with a server error (HTTP ${status}): every request is paused.`,
          fr: `Le routeur répond par une erreur serveur (HTTP ${status}) : toutes les requêtes sont suspendues.`,
        },
        RETRY(delay),
      ),
    paused: (delay) =>
      join(
        {
          en: 'The router asked Gladys to wait (HTTP 429 or a server error): the pause goes on.',
          fr: 'Le routeur a demandé à Gladys d’attendre (HTTP 429 ou erreur serveur) : la pause continue.',
        },
        RETRY(delay),
      ),
    rebooting: (delay) =>
      join(
        {
          en: 'A reboot was sent: the router is restarting.',
          fr: 'Un redémarrage a été envoyé : le routeur redémarre.',
        },
        RETRY(delay),
      ),
    unreachable: (err, delay) =>
      join(
        { en: 'The router does not answer:', fr: 'Le routeur ne répond pas :' },
        reasonOf(err),
        { en: '—', fr: '—' },
        RETRY(delay),
      ),
  },
  test: {
    ok: (status) =>
      join(status, {
        en: 'Add the router and its modems from the Discovery tab.',
        fr: 'Ajoutez le routeur et ses modems depuis l’onglet Découverte.',
      }),
  },
  errors: {
    readOnly: 'This feature only reads the router: nothing can be changed from it',
    unknownDevice: 'This device is not part of this router',
    badValue: 'Invalid value for a button',
    rebootDisabled:
      'Rebooting is not allowed: turn on "Allow rebooting the router" in the configuration',
    notConnected: 'The router is not connected: see the configuration of the integration',
    paused: (delay) =>
      `The router asked Gladys to wait: nothing sent, try again in ${minutes(delay)} min`,
    stillRunning: 'A reboot is already being sent',
    cooldown: (ago) =>
      `A reboot was sent ${minutes(ago)} min ago: nothing sent (10 min between two reboots)`,
    tooSlow: 'The router did not answer in time: the reboot was not sent',
    noSession:
      'No valid session with the router just before sending: the reboot was not sent, try again',
    unknownState: (reason) =>
      `The router could not be read just before the reboot (${reason}): the reboot was not sent`,
    otherRouter:
      'The router at this address is not the one read before: the reboot was not sent (see Discovery)',
    notSent: (reason) => `The reboot was not sent (${reason})`,
    refused: (reason) => `The router refused the reboot (${reason})`,
    sentUnconfirmed: (reason) =>
      `The reboot was sent, without confirmation from the router (${reason}): check it in a few minutes`,
    testTooLong:
      'The router has not answered yet: see the connection status in a moment (nothing else to do)',
  },
};
