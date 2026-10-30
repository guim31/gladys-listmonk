// -----------------------------------------------------------------------------
// The Listmonk hub: Listmonk read on a timer of the container (the interval
// chosen in the configuration); the states of the added devices published when
// they change, the scene events fired on transitions, and the views the widget
// and the scene action read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 10 minutes, beyond the fixed list of the core scheduler.
//
// Requests per cycle, whatever the size of the instance: the dashboard counts,
// the lists, the 20 newest campaigns, the 20 newest subscribers, and two
// counts of the day (SQL queries of the subscribers API).
//
// What the triggers remember is kept in /data (src/store.js): a restart
// neither announces a subscriber, an unsubscription or a finished campaign
// twice, nor misses one.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  DONE_STATUSES,
  buildInstanceDevice,
  buildListDevice,
  instanceIds,
  instanceValues,
  listIds,
  listValues,
} from './devices.js';
import { ERROR_KINDS, ListmonkClient, ListmonkError } from './listmonk/client.js';
import { hostOf, missingCredentials, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'listmonk-hub' });

export const WIDGET_KEY = 'listmonk_campaigns';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  NEW_SUBSCRIBER: 'new_subscriber',
  UNSUBSCRIBED: 'unsubscribed',
  CAMPAIGN_FINISHED: 'campaign_finished',
});

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action or the widget reads Listmonk again when the last read is older.
  freshMs: 15_000,
};

// Failed reads in a row before the instance counts as unreachable: one lost
// answer is not an outage.
export const FAILURES_FOR_DOWN = 2;
// The newest subscribers read per cycle: more new subscribers than this
// between two reads (an import) are counted, not all announced.
export const SUBSCRIBERS_PER_READ = 20;

// Errors that mean Listmonk cannot be reached (the others are a
// configuration to fix: token refused, redirect).
const DOWN_KINDS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.TLS,
  ERROR_KINDS.NOT_LISTMONK,
  ERROR_KINDS.HTTP,
]);

const MAX_TRANSPORTS_PER_REQUEST = 100;

/** Midnight of the day of `time`, in the time zone of Gladys (TZ). */
export function startOfDay(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const emptySaved = () => ({ lists: {}, campaigns: {} });

export class ListmonkHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/listmonk/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {{ counts: object, lists: object[], campaigns: object[], today: object|null }|null} */
    this.view = null;
    this.readAt = 0;
    this.error = null;
    this.failures = 0;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = emptySaved();
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop, the
    // daily counts refused): one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    const object = (value) => (value && typeof value === 'object' ? value : {});
    this.saved = {
      url: typeof saved?.url === 'string' ? saved.url : undefined,
      subscriberId: Number.isInteger(saved?.subscriberId) ? saved.subscriberId : undefined,
      campaignId: Number.isInteger(saved?.campaignId) ? saved.campaignId : undefined,
      lists: object(saved?.lists),
      campaigns: object(saved?.campaigns),
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.signature !== null && this.config.language !== config.language;
    this.config = config;
    if (config.url && this.saved.url !== config.url) {
      // Another instance (or the first one): start again without announcing
      // what it already has.
      this.saved = { ...emptySaved(), url: config.url };
    }
    const signature = JSON.stringify([config.url, config.apiUser, config.apiToken]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client =
        missingCredentials(config) === null
          ? new ListmonkClient({
              url: config.url,
              user: config.apiUser,
              token: config.apiToken,
              request: this.request,
            })
          : null;
      this.view = null;
      this.readAt = 0;
      this.error = null;
      this.failures = 0;
      this.polling = null;
    }
    if (languageChanged) {
      this.discovered = null; // new names for the Discovery tab
      this.gladys.forgetPublishedStates?.(); // the campaign text changes language
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Listmonk works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading Listmonk ------------------------------------------------------

  /** Read Listmonk now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read failed or is older than `freshMs`. */
  async refreshIfStale() {
    if (this.client && (this.error || this.now() - this.readAt >= this.timings.freshMs)) {
      await this.pollNow();
    }
  }

  /**
   * Read Listmonk and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let result;
    try {
      result = await this.fetchAll(client);
    } catch (err) {
      if (!(err instanceof ListmonkError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    return client === this.client && this.applySuccess(result);
  }

  async fetchAll(client) {
    const counts = await client.counts();
    const lists = await client.lists();
    const campaigns = await client.campaigns();
    const subscribers = await client.newestSubscribers(SUBSCRIBERS_PER_READ);
    const start = startOfDay(this.now());
    let today = null;
    try {
      today = {
        created: await client.createdSince(start),
        unsubscribed: await client.unsubscribedSince(start),
      };
      this.problems.recover('daily', 'Daily counts readable again');
    } catch (err) {
      // An API user without `subscribers:sql_query` reads everything else.
      if (!(err instanceof ListmonkError) || DOWN_KINDS.has(err.kind)) {
        throw err;
      }
      this.problems.fail('daily', `Daily counts unavailable: ${err.message}`);
    }
    return { counts, lists, campaigns, subscribers, today };
  }

  async applySuccess({ counts, lists, campaigns, subscribers, today }) {
    const firstRead = this.readAt === 0;
    if (this.error) {
      logger.info('Listmonk answers again');
    }
    if (firstRead) {
      logger.info(
        `Listmonk (${hostOf(this.config.url)}): ${counts.subscribers} subscriber(s), ${lists.length} list(s)`,
      );
    }
    const hadError = this.error !== null;
    this.error = null;
    this.failures = 0;
    this.readAt = this.now();
    this.view = { counts, lists, campaigns, today };

    let dirty = false;
    dirty = (await this.announceSubscribers(subscribers)) || dirty;
    dirty = (await this.announceUnsubscriptions(lists)) || dirty;
    dirty = (await this.announceCampaigns(campaigns)) || dirty;
    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.store.save(this.saved);
    }
    await this.publishStates();

    const signature = JSON.stringify(this.view);
    const widgetChanged = hadError || firstRead || signature !== this.widgetSignature;
    this.widgetSignature = signature;
    return widgetChanged;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Listmonk: ${err.message}`);
    }
    if (DOWN_KINDS.has(err.kind)) {
      this.failures += 1;
      if (this.failures === FAILURES_FOR_DOWN) {
        logger.info('Listmonk is unreachable');
      }
    }
    await this.publishStates();
    return wasError !== err.kind;
  }

  /** Whether the instance counts as reachable (one failed read is not an outage). */
  get reachable() {
    return this.failures < FAILURES_FOR_DOWN;
  }

  /**
   * "New subscriber" for the subscribers created since the last read (oldest
   * first), once per list they joined. The first read only records the newest.
   * @returns {Promise<boolean>} whether the saved state changed
   */
  async announceSubscribers(subscribers) {
    const newest = subscribers.reduce((max, subscriber) => Math.max(max, subscriber.id), 0);
    const seen = this.saved.subscriberId;
    if (seen === undefined) {
      this.saved.subscriberId = newest;
      return true;
    }
    const fresh = subscribers.filter((subscriber) => subscriber.id > seen).reverse();
    if (fresh.length === 0) {
      return false;
    }
    this.saved.subscriberId = Math.max(seen, newest);
    // Who subscribed stays out of the logs.
    logger.debug(`${fresh.length} new subscriber(s)`);
    for (const subscriber of fresh) {
      const base = { name: subscriber.name, email: subscriber.email };
      if (subscriber.lists.length === 0) {
        await this.fire(TRIGGERS.NEW_SUBSCRIBER, { ...base, device: null, list: '' });
      }
      for (const list of subscriber.lists) {
        await this.fire(TRIGGERS.NEW_SUBSCRIBER, {
          ...base,
          device: listIds(this.gladys, list.id).device,
          list: list.name,
        });
      }
    }
    return true;
  }

  /**
   * "Unsubscription" for every list whose unsubscribed count went up. A list
   * seen for the first time only records its count.
   * @returns {Promise<boolean>} whether the saved state changed
   */
  async announceUnsubscriptions(lists) {
    const before = JSON.stringify(this.saved.lists);
    const next = {};
    for (const list of lists) {
      const previous = this.saved.lists[list.id];
      next[list.id] = list.unsubscribed;
      if (Number.isInteger(previous) && list.unsubscribed > previous) {
        await this.fire(TRIGGERS.UNSUBSCRIBED, {
          device: listIds(this.gladys, list.id).device,
          list: list.name,
          count: list.unsubscribed - previous,
          unsubscribed: list.unsubscribed,
          subscribers: list.subscribers,
        });
      }
    }
    this.saved.lists = next;
    return JSON.stringify(next) !== before;
  }

  /**
   * "Campaign finished" for a campaign seen before in another status, or
   * created and sent between two reads.
   * @returns {Promise<boolean>} whether the saved state changed
   */
  async announceCampaigns(campaigns) {
    const before = JSON.stringify([this.saved.campaigns, this.saved.campaignId]);
    const known = this.saved.campaignId;
    const next = {};
    for (const campaign of [...campaigns].reverse()) {
      const previous = this.saved.campaigns[campaign.id];
      next[campaign.id] = campaign.status;
      const newSinceLastRead = previous === undefined && known !== undefined && campaign.id > known;
      const changed = previous !== undefined && !DONE_STATUSES.has(previous);
      if (campaign.status === 'finished' && (changed || newSinceLastRead)) {
        logger.info(`Campaign "${campaign.name}" finished`);
        await this.fire(TRIGGERS.CAMPAIGN_FINISHED, {
          campaign: campaign.name,
          subject: campaign.subject,
          lists: campaign.lists.join(', '),
          sent: campaign.sent,
          views: campaign.views,
          clicks: campaign.clicks,
        });
      }
    }
    this.saved.campaigns = next;
    this.saved.campaignId = campaigns.reduce(
      (max, campaign) => Math.max(max, campaign.id),
      known ?? 0,
    );
    return JSON.stringify([next, this.saved.campaignId]) !== before;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys --------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** Publish the Discovery list when it changed (a list added, renamed…). */
  async publishDevices({ force = false } = {}) {
    let devices;
    if (!this.client) {
      devices = [];
    } else if (!this.view) {
      return; // nothing read: keep the list Gladys has
    } else {
      const language = this.config.language;
      devices = [
        buildInstanceDevice(this.gladys, hostOf(this.config.url), language),
        ...this.view.lists.map((list) => buildListDevice(this.gladys, list, language)),
      ];
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read again, publish the list. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: send all its states (the SDK forgot
   * what it had published for it), and its badge.
   */
  async onDeviceCreated(device) {
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0) {
      return;
    }
    const states = [];
    if (this.isCreated(instanceIds(this.gladys).device)) {
      const view = this.error ? null : this.view;
      states.push(...instanceValues(this.gladys, view, this.reachable, this.config.language));
    }
    if (!this.error && this.view) {
      for (const list of this.view.lists) {
        if (this.isCreated(listIds(this.gladys, list.id).device)) {
          states.push(...listValues(this.gladys, list));
        }
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const transport = this.error ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.LOCAL;
    const ids = [
      instanceIds(this.gladys).device,
      ...(this.view?.lists ?? []).map((list) => listIds(this.gladys, list.id).device),
    ];
    const entries = ids
      .filter((id) => this.isCreated(id) && this.transports.get(id) !== transport)
      .map((id) => ({ external_id: id, transport }));
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    const missing = missingCredentials(this.config);
    if (missing) {
      return { connected: false, message: CONNECTION_TEXT[missing] };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene action, report) ----------------------------------

  /** Throws the reason Listmonk cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** "Test the connection": read Listmonk now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    const status = this.connectionStatus();
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const { counts, lists, today } = this.view;
      const parts = [
        text.ok,
        text.subscribers(counts.subscribers),
        text.lists(lists.length),
        text.campaigns(counts.campaigns),
      ];
      if (!today) {
        parts.push(text.noDaily);
      }
      message[language] = labelled('Listmonk', parts.join(', '), language);
    }
    return message;
  }
}
