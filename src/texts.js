// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, the campaign
// feature, scene action errors. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks every
// table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './listmonk/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

// What is missing in the configuration (src/config.js missingCredentials).
export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Fill in the address of your Listmonk and an API user.',
    fr: "Indiquez l'adresse de votre Listmonk et un utilisateur d'API.",
    de: 'Gib die Adresse deines Listmonk und einen API-Benutzer an.',
    es: 'Indique la dirección de su Listmonk y un usuario de API.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.10:9000',
    fr: 'Adresse incomprise, ex. http://192.168.1.10:9000',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.10:9000',
    es: 'Dirección no válida, p. ej. http://192.168.1.10:9000',
  },
  noUser: {
    en: 'Fill in the name of the API user (Admin → Users).',
    fr: "Indiquez le nom de l'utilisateur d'API (Admin → Utilisateurs).",
    de: 'Gib den Namen des API-Benutzers an (Admin → Benutzer).',
    es: 'Indique el nombre del usuario de API (Admin → Usuarios).',
  },
  noToken: {
    en: 'Paste the token of the API user.',
    fr: "Collez le jeton de l'utilisateur d'API.",
    de: 'Füge das Token des API-Benutzers ein.',
    es: 'Pegue el token del usuario de API.',
  },
};

// One short explanation per error kind (src/listmonk/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Listmonk does not answer',
    fr: 'Listmonk ne répond pas',
    de: 'Listmonk antwortet nicht',
    es: 'Listmonk no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API user or token refused, or a permission is missing',
    fr: "utilisateur d'API ou jeton refusé, ou permission manquante",
    de: 'API-Benutzer oder Token abgelehnt, oder eine Berechtigung fehlt',
    es: 'usuario de API o token rechazado, o falta un permiso',
  },
  [ERROR_KINDS.NOT_LISTMONK]: {
    en: 'no Listmonk API at this address',
    fr: 'aucune API Listmonk à cette adresse',
    de: 'keine Listmonk-API unter dieser Adresse',
    es: 'no hay ninguna API de Listmonk en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'Listmonk refused the request, see the logs',
    fr: 'Listmonk a refusé la demande, voir les logs',
    de: 'Listmonk hat die Anfrage abgelehnt, sieh in den Protokollen nach',
    es: 'Listmonk ha rechazado la solicitud, consulte los registros',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The campaign statuses of Listmonk, as the feature and the widget show them.
export const STATUS_TEXT = {
  en: {
    draft: 'Draft',
    scheduled: 'Scheduled',
    running: 'Sending',
    paused: 'Paused',
    finished: 'Sent',
    cancelled: 'Cancelled',
  },
  fr: {
    draft: 'Brouillon',
    scheduled: 'Programmée',
    running: "En cours d'envoi",
    paused: 'En pause',
    finished: 'Envoyée',
    cancelled: 'Annulée',
  },
  de: {
    draft: 'Entwurf',
    scheduled: 'Geplant',
    running: 'Wird gesendet',
    paused: 'Pausiert',
    finished: 'Gesendet',
    cancelled: 'Abgebrochen',
  },
  es: {
    draft: 'Borrador',
    scheduled: 'Programada',
    running: 'Enviándose',
    paused: 'En pausa',
    finished: 'Enviada',
    cancelled: 'Cancelada',
  },
};

export const CAMPAIGN_TEXT = {
  en: { none: 'No campaign sent yet' },
  fr: { none: 'Aucune campagne envoyée' },
  de: { none: 'Noch keine Kampagne gesendet' },
  es: { none: 'Ninguna campaña enviada todavía' },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    subscribers: (n) => `${n} subscriber(s)`,
    lists: (n) => `${n} list(s)`,
    campaigns: (n) => `${n} campaign(s)`,
    noDaily: 'no daily counts (permission subscribers:sql_query)',
  },
  fr: {
    ok: 'Connecté',
    subscribers: (n) => `${n} abonné(s)`,
    lists: (n) => `${n} liste(s)`,
    campaigns: (n) => `${n} campagne(s)`,
    noDaily: 'pas de chiffres du jour (permission subscribers:sql_query)',
  },
  de: {
    ok: 'Verbunden',
    subscribers: (n) => `${n} Abonnent(en)`,
    lists: (n) => `${n} Liste(n)`,
    campaigns: (n) => `${n} Kampagne(n)`,
    noDaily: 'keine Tageszahlen (Berechtigung subscribers:sql_query)',
  },
  es: {
    ok: 'Conectado',
    subscribers: (n) => `${n} suscriptor(es)`,
    lists: (n) => `${n} lista(s)`,
    campaigns: (n) => `${n} campaña(s)`,
    noDaily: 'sin cifras del día (permiso subscribers:sql_query)',
  },
};

// Errors of the "Start or pause a campaign" scene action.
export const ACTION_TEXT = {
  disabled: {
    en: 'Campaign control is off: turn on "Allow starting and pausing campaigns" in the configuration.',
    fr: 'Le pilotage des campagnes est désactivé : activez « Autoriser le lancement et la pause des campagnes » dans la configuration.',
    de: 'Die Kampagnensteuerung ist aus: Aktiviere „Starten und Pausieren von Kampagnen erlauben“ in der Konfiguration.',
    es: 'El control de campañas está desactivado: active «Permitir iniciar y pausar campañas» en la configuración.',
  },
  notFound: {
    en: 'No Listmonk campaign has this ID or this exact name.',
    fr: "Aucune campagne Listmonk n'a cet identifiant ni ce nom exact.",
    de: 'Keine Listmonk-Kampagne hat diese ID oder genau diesen Namen.',
    es: 'Ninguna campaña de Listmonk tiene este ID ni este nombre exacto.',
  },
  ambiguous: {
    en: 'Several campaigns have this name: give the campaign ID instead.',
    fr: "Plusieurs campagnes portent ce nom : indiquez plutôt l'identifiant de la campagne.",
    de: 'Mehrere Kampagnen haben diesen Namen: Gib stattdessen die Kampagnen-ID an.',
    es: 'Varias campañas tienen este nombre: indique el ID de la campaña.',
  },
  cannotStart: {
    en: 'Only a draft or a paused campaign can be started.',
    fr: 'Seule une campagne en brouillon ou en pause peut être lancée.',
    de: 'Nur eine Kampagne im Entwurf oder in Pause kann gestartet werden.',
    es: 'Solo se puede iniciar una campaña en borrador o en pausa.',
  },
  cannotPause: {
    en: 'Only a campaign being sent can be paused.',
    fr: "Seule une campagne en cours d'envoi peut être mise en pause.",
    de: 'Nur eine Kampagne, die gerade gesendet wird, kann pausiert werden.',
    es: 'Solo se puede pausar una campaña que se está enviando.',
  },
  badCommand: {
    en: 'Unknown command: choose Start or Pause.',
    fr: 'Commande inconnue : choisissez Lancer ou Mettre en pause.',
    de: 'Unbekannter Befehl: Wähle Starten oder Pausieren.',
    es: 'Comando desconocido: elija Iniciar o Pausar.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
