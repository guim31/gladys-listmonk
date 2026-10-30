// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// `campaign_control` starts or pauses a campaign: the newsletter goes out when
// a scene says so (the morning after it is ready, when nobody is home to
// answer the replies…). Starting a campaign sends mail to real people, so the
// action stays refused until the user turns on "Allow starting and pausing
// campaigns" in the configuration (off by default).
//
// The campaign is named by its exact name or its ID (a scene field cannot list
// the campaigns: the only dynamic source is the devices). Starting a campaign
// already sending, or pausing one already paused, is not an error.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { missingCredentials } from './config.js';
import { ListmonkError } from './listmonk/client.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, pick } from './texts.js';

const logger = createLogger({ name: 'listmonk-scenes' });

// Values of the `command` field: permanent once published.
export const COMMANDS = Object.freeze({ START: 'start', PAUSE: 'pause' });

const RULES = {
  [COMMANDS.START]: { target: 'running', from: ['draft', 'paused'], refused: 'cannotStart' },
  [COMMANDS.PAUSE]: { target: 'paused', from: ['running'], refused: 'cannotPause' },
};

/**
 * The campaign named by an exact name (case and spaces ignored) or an ID.
 * `#12` is an ID only; a bare number is also a name ("2025"): when the name
 * and the ID point to two campaigns, nothing is started.
 */
async function findCampaign(client, raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return { error: 'notFound' };
  }
  const campaigns = await client.allCampaigns();
  const wanted = text.toLowerCase();
  const byName = campaigns.filter((campaign) => campaign.name.toLowerCase() === wanted);
  const id = /^#?\d+$/.test(text) ? Number(text.replace(/^#/, '')) : null;
  const byId = id === null ? [] : campaigns.filter((campaign) => campaign.id === id);
  const found = text.startsWith('#') ? byId : [...new Set([...byName, ...byId])];
  if (found.length > 1) {
    return { error: 'ambiguous' };
  }
  return found.length === 1 ? { campaign: found[0] } : { error: 'notFound' };
}

export const SCENE_ACTIONS = {
  async campaign_control(hub, { fields = {} }) {
    const language = hub.config.language;
    const fail = (text) => {
      throw new Error(pick(text, language));
    };
    if (!hub.config.campaignControl) {
      fail(ACTION_TEXT.disabled);
    }
    const missing = missingCredentials(hub.config);
    if (missing) {
      fail(CONNECTION_TEXT[missing]);
    }
    const rule = RULES[fields.command];
    if (!rule) {
      fail(ACTION_TEXT.badCommand);
    }
    try {
      const { campaign, error } = await findCampaign(hub.client, fields.campaign);
      if (error) {
        fail(ACTION_TEXT[error]);
      }
      let status = campaign.status;
      if (status !== rule.target) {
        if (!rule.from.includes(status)) {
          fail(ACTION_TEXT[rule.refused]);
        }
        await hub.client.setCampaignStatus(campaign.id, rule.target);
        status = rule.target;
        logger.info(`Campaign "${campaign.name}": ${fields.command} (scene)`);
        // The feature and the widget show the new status soon; not awaited:
        // a slow read must not time the action out once the campaign has started.
        hub.pollNow().catch(() => {});
      }
      return { campaign: campaign.name, campaign_id: campaign.id, status };
    } catch (err) {
      if (!(err instanceof ListmonkError)) {
        throw err;
      }
      logger.warn(`Campaign ${fields.command} failed: ${err.message}`);
      throw new Error(pick(ERROR_TEXT[err.kind], language), { cause: err });
    }
  },
};
