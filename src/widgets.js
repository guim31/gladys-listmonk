// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `listmonk_campaigns`.
//
// The use case: a glance at the wall tablet tells how the newsletter does —
// subscribers, who joined and who left today — and where the latest campaigns
// stand: sending (messages sent / to send), sent (open rate), drafts. The
// figures are sent as values, not bound to device features: the widget works
// before any device is added.
//
// Budget (8 components, 2 texts): three tiles, one text when Listmonk does not
// answer or has no campaign, one status list, a Refresh button. Settings: how
// many campaigns, and hide the tiles or the button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { rate } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, STATUS_TEXT, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

// Values of the `campaigns` setting.
export const CAMPAIGN_COUNTS = ['3', '5', '8'];
export const DEFAULT_SETTINGS = { campaigns: '5', show_figures: true, show_refresh: true };

export const TEXT = {
  pick: {
    en: 'Fill in your Listmonk in the configuration of the integration.',
    fr: "Renseignez votre Listmonk dans la configuration de l'intégration.",
    de: 'Trage dein Listmonk in der Konfiguration der Integration ein.',
    es: 'Indique su Listmonk en la configuración de la integración.',
  },
  noCampaign: {
    en: 'No campaign yet: create one in Listmonk.',
    fr: 'Aucune campagne pour le moment : créez-en une dans Listmonk.',
    de: 'Noch keine Kampagne: Lege eine in Listmonk an.',
    es: 'Todavía no hay ninguna campaña: cree una en Listmonk.',
  },
  subscribers: { en: 'Subscribers', fr: 'Abonnés', de: 'Abonnenten', es: 'Suscriptores' },
  joined: { en: 'New today', fr: 'Nouveaux auj.', de: 'Neu heute', es: 'Nuevos hoy' },
  left: { en: 'Left today', fr: 'Partis auj.', de: 'Abgemeldet heute', es: 'Bajas hoy' },
  opened: { en: 'opened', fr: 'ouverture', de: 'geöffnet', es: 'aperturas' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Listmonk read again.',
    fr: 'Listmonk relu.',
    de: 'Listmonk neu gelesen.',
    es: 'Listmonk leído de nuevo.',
  },
};

const ICONS = {
  draft: ['edit-3', WIDGET_COLORS.NEUTRAL],
  scheduled: ['clock', WIDGET_COLORS.INFO],
  running: ['send', WIDGET_COLORS.INFO],
  paused: ['pause-circle', WIDGET_COLORS.WARNING],
  finished: ['check-circle', WIDGET_COLORS.SUCCESS],
  cancelled: ['x-circle', WIDGET_COLORS.NEUTRAL],
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** The settings of one widget, with the defaults of the manifest. */
export function normalizeSettings(raw) {
  const settings = raw && typeof raw === 'object' ? raw : {};
  const flag = (key) =>
    typeof settings[key] === 'boolean' ? settings[key] : DEFAULT_SETTINGS[key];
  const campaigns = CAMPAIGN_COUNTS.includes(String(settings.campaigns))
    ? Number(settings.campaigns)
    : Number(DEFAULT_SETTINGS.campaigns);
  return { campaigns, showFigures: flag('show_figures'), showRefresh: flag('show_refresh') };
}

/** One row of the status list: the campaign and where it stands. */
export function campaignRow(campaign, language) {
  const status = pick(STATUS_TEXT, language)[campaign.status] ?? campaign.status;
  let value = status;
  if (campaign.status === 'running' || campaign.status === 'paused') {
    value = `${status} ${campaign.sent}/${campaign.toSend}`;
  } else if (campaign.status === 'finished') {
    // A decimal comma outside English (66,7 %).
    const open = String(rate(campaign.views, campaign.sent)).replace(
      '.',
      language === 'en' ? '.' : ',',
    );
    value = `${campaign.sent} · ${open} % ${pick(TEXT.opened, language)}`;
  }
  const [icon, color] = ICONS[campaign.status] ?? ['mail', WIDGET_COLORS.NEUTRAL];
  return { label: fit(campaign.name, 40), value: fit(value, 40), icon, color };
}

const message = (text, language) => ({
  ttl_seconds: 300,
  components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
});

async function get(hub, { language = 'en', settings: raw } = {}) {
  if (!hub.client) {
    return message(TEXT.pick, language);
  }
  const settings = normalizeSettings(raw);
  const view = hub.view;
  const components = [];

  if (settings.showFigures && view) {
    components.push({
      type: 'value',
      value: view.counts.subscribers,
      label: pick(TEXT.subscribers, language),
      icon: 'users',
      color: WIDGET_COLORS.INFO,
    });
    if (view.today) {
      components.push(
        {
          type: 'value',
          value: view.today.created,
          label: pick(TEXT.joined, language),
          icon: 'user-plus',
          color: view.today.created > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
        },
        {
          type: 'value',
          value: view.today.unsubscribed,
          label: pick(TEXT.left, language),
          icon: 'user-minus',
          color: view.today.unsubscribed > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
        },
      );
    }
  }

  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }

  const campaigns = (view?.campaigns ?? []).slice(0, settings.campaigns);
  if (campaigns.length > 0) {
    components.push({ type: 'status', items: campaigns.map((c) => campaignRow(c, language)) });
  } else if (view && !hub.error) {
    components.push({ type: 'text', variant: 'body', text: pick(TEXT.noCampaign, language) });
  }

  if (settings.showRefresh) {
    components.push({
      type: 'button',
      label: pick(TEXT.refresh, language),
      icon: 'refresh-cw',
      style: 'secondary',
      action: { key: ACTIONS.REFRESH },
    });
  }

  return { ttl_seconds: 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  if (hub.error) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
