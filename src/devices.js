// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab (the user adds what to follow,
// nothing is created on their behalf):
//
// The Listmonk instance (one per integration):
//   reachable           presence-sensor/binary   1 when Listmonk answers
//   subscribers         counter-sensor/integer   subscribers, all lists
//   blocklisted         counter-sensor/integer   blocklisted subscribers
//   new_today           counter-sensor/integer   subscribers created today
//   unsubscribed_today  counter-sensor/integer   subscribers who left a list today
//   messages            counter-sensor/integer   campaign messages sent, ever
//   campaign            text/text                the current (or last) campaign
//                                                and its status
//   campaign_progress   unknown/unknown, %       its messages sent / to send
//   open_rate           unknown/unknown, %       views / messages sent of the
//   click_rate          unknown/unknown, %       last finished campaign (clicks)
//
// One device per mailing list, identified by its Listmonk id:
//   subscribers         counter-sensor/integer   confirmed + unconfirmed
//   unsubscribed        counter-sensor/integer   unsubscribed from the list
//
// "Today" starts at midnight in the time zone of Gladys (the supervisor
// injects TZ). Published with should_poll: false: the integration reads
// Listmonk on its own timer (src/hub.js), at the interval of the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { CAMPAIGN_TEXT, STATUS_TEXT, labelled } from './texts.js';

export const INSTANCE_TYPE = 'instance';
export const INSTANCE_ID = 'listmonk';
export const LIST_TYPE = 'list';
export const MODEL = 'Listmonk';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  REACHABLE: 'reachable',
  SUBSCRIBERS: 'subscribers',
  BLOCKLISTED: 'blocklisted',
  NEW_TODAY: 'new_today',
  UNSUBSCRIBED_TODAY: 'unsubscribed_today',
  MESSAGES: 'messages',
  CAMPAIGN: 'campaign',
  CAMPAIGN_PROGRESS: 'campaign_progress',
  OPEN_RATE: 'open_rate',
  CLICK_RATE: 'click_rate',
  UNSUBSCRIBED: 'unsubscribed',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.REACHABLE]: 'Reachable',
    [FEATURE_KEYS.SUBSCRIBERS]: 'Subscribers',
    [FEATURE_KEYS.BLOCKLISTED]: 'Blocklisted',
    [FEATURE_KEYS.NEW_TODAY]: 'New subscribers today',
    [FEATURE_KEYS.UNSUBSCRIBED_TODAY]: 'Unsubscriptions today',
    [FEATURE_KEYS.MESSAGES]: 'Messages sent',
    [FEATURE_KEYS.CAMPAIGN]: 'Campaign',
    [FEATURE_KEYS.CAMPAIGN_PROGRESS]: 'Campaign progress',
    [FEATURE_KEYS.OPEN_RATE]: 'Open rate (last campaign)',
    [FEATURE_KEYS.CLICK_RATE]: 'Click rate (last campaign)',
    [FEATURE_KEYS.UNSUBSCRIBED]: 'Unsubscribed',
  },
  fr: {
    [FEATURE_KEYS.REACHABLE]: 'Joignable',
    [FEATURE_KEYS.SUBSCRIBERS]: 'Abonnés',
    [FEATURE_KEYS.BLOCKLISTED]: 'Bloqués',
    [FEATURE_KEYS.NEW_TODAY]: "Nouveaux abonnés aujourd'hui",
    [FEATURE_KEYS.UNSUBSCRIBED_TODAY]: "Désinscriptions aujourd'hui",
    [FEATURE_KEYS.MESSAGES]: 'Messages envoyés',
    [FEATURE_KEYS.CAMPAIGN]: 'Campagne',
    [FEATURE_KEYS.CAMPAIGN_PROGRESS]: 'Avancement de la campagne',
    [FEATURE_KEYS.OPEN_RATE]: "Taux d'ouverture (dernière campagne)",
    [FEATURE_KEYS.CLICK_RATE]: 'Taux de clics (dernière campagne)',
    [FEATURE_KEYS.UNSUBSCRIBED]: 'Désinscrits',
  },
  de: {
    [FEATURE_KEYS.REACHABLE]: 'Erreichbar',
    [FEATURE_KEYS.SUBSCRIBERS]: 'Abonnenten',
    [FEATURE_KEYS.BLOCKLISTED]: 'Gesperrt',
    [FEATURE_KEYS.NEW_TODAY]: 'Neue Abonnenten heute',
    [FEATURE_KEYS.UNSUBSCRIBED_TODAY]: 'Abmeldungen heute',
    [FEATURE_KEYS.MESSAGES]: 'Gesendete Nachrichten',
    [FEATURE_KEYS.CAMPAIGN]: 'Kampagne',
    [FEATURE_KEYS.CAMPAIGN_PROGRESS]: 'Kampagnenfortschritt',
    [FEATURE_KEYS.OPEN_RATE]: 'Öffnungsrate (letzte Kampagne)',
    [FEATURE_KEYS.CLICK_RATE]: 'Klickrate (letzte Kampagne)',
    [FEATURE_KEYS.UNSUBSCRIBED]: 'Abgemeldet',
  },
  es: {
    [FEATURE_KEYS.REACHABLE]: 'Accesible',
    [FEATURE_KEYS.SUBSCRIBERS]: 'Suscriptores',
    [FEATURE_KEYS.BLOCKLISTED]: 'Bloqueados',
    [FEATURE_KEYS.NEW_TODAY]: 'Nuevos suscriptores hoy',
    [FEATURE_KEYS.UNSUBSCRIBED_TODAY]: 'Bajas hoy',
    [FEATURE_KEYS.MESSAGES]: 'Mensajes enviados',
    [FEATURE_KEYS.CAMPAIGN]: 'Campaña',
    [FEATURE_KEYS.CAMPAIGN_PROGRESS]: 'Progreso de la campaña',
    [FEATURE_KEYS.OPEN_RATE]: 'Tasa de apertura (última campaña)',
    [FEATURE_KEYS.CLICK_RATE]: 'Tasa de clics (última campaña)',
    [FEATURE_KEYS.UNSUBSCRIBED]: 'Dados de baja',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_SUBSCRIBERS = 1_000_000_000;
export const MAX_DAILY = 100_000_000;
export const MAX_MESSAGES = 1_000_000_000_000;

// Campaign statuses of Listmonk.
export const ACTIVE_STATUSES = new Set(['running', 'paused']);
export const DONE_STATUSES = new Set(['finished', 'cancelled']);

export const instanceIds = (gladys) => gladys.externalIds(INSTANCE_TYPE, INSTANCE_ID);
export const listIds = (gladys, listId) => gladys.externalIds(LIST_TYPE, String(listId));

/** The Listmonk list id of a device external id, null when it is not a list of ours. */
export function parseListId(gladys, externalId) {
  const prefix = gladys.externalIds(LIST_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return /^\d+$/.test(id) ? Number(id) : null;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const counter = (name, externalId, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max },
  );

// No percentage category fits (gladys-umami does the same for its bounce rate).
const percent = (name, externalId) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.UNKNOWN,
    DEVICE_FEATURE_TYPES.UNKNOWN.UNKNOWN,
    { unit: DEVICE_FEATURE_UNITS.PERCENT, keep_history: true, min: 0, max: 100 },
  );

/** The discovery payload of the instance. */
export function buildInstanceDevice(gladys, host, language = 'en') {
  const ids = instanceIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  const name = (key) => names[key];
  return {
    name: `Listmonk ${host}`.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [],
    features: [
      sensor(
        name(FEATURE_KEYS.REACHABLE),
        ids.feature(FEATURE_KEYS.REACHABLE),
        DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
        DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        { keep_history: true, min: 0, max: 1 },
      ),
      counter(
        name(FEATURE_KEYS.SUBSCRIBERS),
        ids.feature(FEATURE_KEYS.SUBSCRIBERS),
        MAX_SUBSCRIBERS,
      ),
      counter(
        name(FEATURE_KEYS.BLOCKLISTED),
        ids.feature(FEATURE_KEYS.BLOCKLISTED),
        MAX_SUBSCRIBERS,
      ),
      counter(name(FEATURE_KEYS.NEW_TODAY), ids.feature(FEATURE_KEYS.NEW_TODAY), MAX_DAILY),
      counter(
        name(FEATURE_KEYS.UNSUBSCRIBED_TODAY),
        ids.feature(FEATURE_KEYS.UNSUBSCRIBED_TODAY),
        MAX_DAILY,
      ),
      counter(name(FEATURE_KEYS.MESSAGES), ids.feature(FEATURE_KEYS.MESSAGES), MAX_MESSAGES),
      sensor(
        name(FEATURE_KEYS.CAMPAIGN),
        ids.feature(FEATURE_KEYS.CAMPAIGN),
        DEVICE_FEATURE_CATEGORIES.TEXT,
        DEVICE_FEATURE_TYPES.TEXT.TEXT,
        { keep_history: false, min: 0, max: 0 },
      ),
      percent(name(FEATURE_KEYS.CAMPAIGN_PROGRESS), ids.feature(FEATURE_KEYS.CAMPAIGN_PROGRESS)),
      percent(name(FEATURE_KEYS.OPEN_RATE), ids.feature(FEATURE_KEYS.OPEN_RATE)),
      percent(name(FEATURE_KEYS.CLICK_RATE), ids.feature(FEATURE_KEYS.CLICK_RATE)),
    ],
  };
}

/** The discovery payload of a list. */
export function buildListDevice(gladys, list, language = 'en') {
  const ids = listIds(gladys, list.id);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: list.name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [],
    features: [
      counter(
        names[FEATURE_KEYS.SUBSCRIBERS],
        ids.feature(FEATURE_KEYS.SUBSCRIBERS),
        MAX_SUBSCRIBERS,
      ),
      counter(
        names[FEATURE_KEYS.UNSUBSCRIBED],
        ids.feature(FEATURE_KEYS.UNSUBSCRIBED),
        MAX_SUBSCRIBERS,
      ),
    ],
  };
}

/** A share in percent, one decimal, at most 100 (views count the repeated opens). */
export function rate(part, whole) {
  if (!whole) {
    return 0;
  }
  return Math.min(100, Math.round((part / whole) * 1000) / 10);
}

/**
 * The campaign the instance shows: the newest one sending or paused, else the
 * newest finished or cancelled one; null when there is none.
 * @param {object[]} campaigns newest first
 */
export function currentCampaign(campaigns) {
  return (
    campaigns.find((campaign) => ACTIVE_STATUSES.has(campaign.status)) ??
    campaigns.find((campaign) => DONE_STATUSES.has(campaign.status)) ??
    null
  );
}

/** The newest finished campaign, null when there is none. */
export const lastFinished = (campaigns) =>
  campaigns.find((campaign) => campaign.status === 'finished') ?? null;

/** Messages sent of a campaign, in percent of the ones to send. */
export function progress(campaign) {
  if (campaign.status === 'finished') {
    return 100;
  }
  return campaign.toSend ? rate(campaign.sent, campaign.toSend) : 0;
}

/** "Sending: October news", never empty. */
export function campaignText(campaign, language) {
  if (!campaign) {
    return (CAMPAIGN_TEXT[language] ?? CAMPAIGN_TEXT.en).none;
  }
  const status = (STATUS_TEXT[language] ?? STATUS_TEXT.en)[campaign.status] ?? campaign.status;
  return labelled(status, campaign.name, language).slice(0, 255);
}

const withIds = (ids, values) =>
  values.map(({ key, ...value }) => ({ device_feature_external_id: ids.feature(key), ...value }));

/**
 * The states of the instance, `reachable` alone when Listmonk does not
 * answer. The daily counts are left out when the API user may not run them.
 */
export function instanceValues(gladys, view, reachable, language) {
  const values = [{ key: FEATURE_KEYS.REACHABLE, state: reachable ? 1 : 0 }];
  if (reachable && view) {
    const { counts, campaigns, today } = view;
    values.push(
      { key: FEATURE_KEYS.SUBSCRIBERS, state: counts.subscribers },
      { key: FEATURE_KEYS.BLOCKLISTED, state: counts.blocklisted },
      { key: FEATURE_KEYS.MESSAGES, state: counts.messages },
    );
    if (today) {
      values.push(
        { key: FEATURE_KEYS.NEW_TODAY, state: today.created },
        { key: FEATURE_KEYS.UNSUBSCRIBED_TODAY, state: today.unsubscribed },
      );
    }
    const current = currentCampaign(campaigns);
    values.push({ key: FEATURE_KEYS.CAMPAIGN, text: campaignText(current, language) });
    if (current) {
      values.push({ key: FEATURE_KEYS.CAMPAIGN_PROGRESS, state: progress(current) });
    }
    const finished = lastFinished(campaigns);
    if (finished) {
      values.push(
        { key: FEATURE_KEYS.OPEN_RATE, state: rate(finished.views, finished.sent) },
        { key: FEATURE_KEYS.CLICK_RATE, state: rate(finished.clicks, finished.sent) },
      );
    }
  }
  return withIds(instanceIds(gladys), values);
}

/** The states of a list. */
export const listValues = (gladys, list) =>
  withIds(listIds(gladys, list.id), [
    { key: FEATURE_KEYS.SUBSCRIBERS, state: list.subscribers },
    { key: FEATURE_KEYS.UNSUBSCRIBED, state: list.unsubscribed },
  ]);
