// -----------------------------------------------------------------------------
// Listmonk client: the REST API of a self-hosted Listmonk. Checked against a
// real Listmonk 6.2.0 (PostgreSQL 17) in Docker; the API users and their
// `token user:token` authentication exist since Listmonk 4.0.
//
//   GET /api/health                           { data: true }
//   GET /api/dashboard/counts                 subscribers (total, blocklisted),
//                                             lists, campaigns by status, messages
//   GET /api/lists?per_page=all               every list, with
//                                             `subscriber_statuses` per status
//   GET /api/campaigns?order_by=created_at&order=desc&no_body=true
//                                             the newest campaigns: status,
//                                             to_send, sent, views, clicks
//   GET /api/subscribers?order_by=id&order=desc   the newest subscribers
//   GET /api/subscribers?per_page=1&query=<SQL>   a count (`total`); needs the
//                                             `subscribers:sql_query` permission
//   GET /api/campaigns/<id>                   one campaign
//   PUT /api/campaigns/<id>/status            { status: running | paused }
//
// Errors: 403 for a refused token ("invalid API credentials") or a missing
// permission, 400 with { message } for a refused request (an unknown
// campaign, a status change not allowed), 404 for an unknown route.
//
// Redirects are not followed: the token would be sent wherever the address
// points (an http:// address redirected to https:// is reported).
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // token refused, or a permission missing
  NOT_LISTMONK: 'not_listmonk', // something answers, not the Listmonk API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  REFUSED: 'refused', // Listmonk refused the request (400, with its reason)
  HTTP: 'http', // any other HTTP error
});

export class ListmonkError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'ListmonkError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

export const MAX_BODY_BYTES = 8 * 1024 * 1024;
// The campaigns read at every cycle, the newest first.
export const CAMPAIGNS_PER_READ = 20;

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory Listmonk
 * (test/helpers/fakeListmonk.js).
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 10_000 }) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  return { status: response.status, body: await response.text() };
}

/** A count of the API: 0 when unusable. */
export function count(raw) {
  const number = typeof raw === 'string' ? Number(raw) : raw;
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** One list, normalized; null without an id. */
export function normalizeList(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.id)) {
    return null;
  }
  const statuses =
    raw.subscriber_statuses && typeof raw.subscriber_statuses === 'object'
      ? raw.subscriber_statuses
      : {};
  return {
    id: raw.id,
    name: text(raw.name) || `#${raw.id}`,
    // Confirmed and unconfirmed: the subscriptions that still receive mail
    // (a double opt-in list sends campaigns to the confirmed ones only).
    subscribers: count(statuses.confirmed) + count(statuses.unconfirmed),
    unsubscribed: count(statuses.unsubscribed),
  };
}

/** One campaign, normalized; null without an id. */
export function normalizeCampaign(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.id)) {
    return null;
  }
  return {
    id: raw.id,
    name: text(raw.name) || `#${raw.id}`,
    subject: text(raw.subject),
    status: text(raw.status),
    lists: Array.isArray(raw.lists)
      ? raw.lists.map((list) => text(list?.name)).filter(Boolean)
      : [],
    toSend: count(raw.to_send),
    sent: count(raw.sent),
    views: count(raw.views),
    clicks: count(raw.clicks),
    bounces: count(raw.bounces),
  };
}

/** One subscriber, normalized; null without an id. */
export function normalizeSubscriber(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.id)) {
    return null;
  }
  return {
    id: raw.id,
    email: text(raw.email),
    name: text(raw.name),
    // The lists the subscriber is (still) subscribed to.
    lists: (Array.isArray(raw.lists) ? raw.lists : [])
      .filter((list) => Number.isInteger(list?.id) && list.subscription_status !== 'unsubscribed')
      .map((list) => ({ id: list.id, name: text(list.name) || `#${list.id}` })),
  };
}

function parse(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** The `data` of an answer, or a NOT_LISTMONK error when there is none. */
function dataOf(json) {
  if (!json || typeof json !== 'object' || !('data' in json)) {
    throw new ListmonkError(ERROR_KINDS.NOT_LISTMONK, 'Not a Listmonk API answer');
  }
  return json.data;
}

const resultsOf = (data) => (Array.isArray(data?.results) ? data.results : []);

/** A SQL date literal: built from a number, nothing of the user's goes in. */
const sqlDate = (time) => `'${new Date(time).toISOString()}'`;

export class ListmonkClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL of the server
   * @param {string} options.user API user name
   * @param {string} options.token API user token
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, user, token, request, timeoutMs = 10_000 }) {
    this.base = url;
    this.authorization = `token ${user}:${token}`;
    this.request = request ?? httpRequest;
    this.timeoutMs = timeoutMs;
  }

  async send(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await this.request(`${this.base}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: this.authorization,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new ListmonkError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      throw new ListmonkError(ERROR_KINDS.UNREACHABLE, code ?? err.name ?? err.message);
    }
    return this.check(response);
  }

  check({ status, body }) {
    const json = parse(body);
    // Listmonk's own reason, short and free of secrets ("invalid API
    // credentials", "Campaign not found"…): kept for the logs.
    const reason = typeof json?.message === 'string' ? `: ${json.message.slice(0, 200)}` : '';
    if (status === 401 || status === 403) {
      throw new ListmonkError(ERROR_KINDS.AUTH, `Refused (HTTP ${status})${reason}`, { status });
    }
    if (status >= 300 && status < 400) {
      throw new ListmonkError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new ListmonkError(ERROR_KINDS.NOT_LISTMONK, `No Listmonk API here (HTTP 404)`, {
        status,
      });
    }
    if (status === 400) {
      throw new ListmonkError(ERROR_KINDS.REFUSED, `Refused (HTTP 400)${reason}`, { status });
    }
    if (status < 200 || status >= 300) {
      throw new ListmonkError(ERROR_KINDS.HTTP, `HTTP ${status}${reason}`, { status });
    }
    return dataOf(json);
  }

  /** The dashboard counts. */
  async counts() {
    const data = await this.send('/api/dashboard/counts');
    const subscribers = data?.subscribers ?? {};
    const campaigns = data?.campaigns ?? {};
    return {
      subscribers: count(subscribers.total),
      blocklisted: count(subscribers.blocklisted),
      lists: count(data?.lists?.total),
      campaigns: count(campaigns.total),
      messages: count(data?.messages),
    };
  }

  async lists() {
    const data = await this.send('/api/lists?per_page=all');
    return resultsOf(data).map(normalizeList).filter(Boolean);
  }

  /** The newest campaigns, newest first. */
  async campaigns(size = CAMPAIGNS_PER_READ) {
    const data = await this.send(
      `/api/campaigns?page=1&per_page=${size}&order_by=created_at&order=desc&no_body=true`,
    );
    return resultsOf(data).map(normalizeCampaign).filter(Boolean);
  }

  /**
   * Every campaign, without bodies. The `query` search of Listmonk is a
   * full-text query that fails (500) on a name with `&` or `|`: the exact
   * name is matched here instead.
   */
  async allCampaigns() {
    const data = await this.send('/api/campaigns?per_page=all&no_body=true');
    return resultsOf(data).map(normalizeCampaign).filter(Boolean);
  }

  async campaign(id) {
    return normalizeCampaign(await this.send(`/api/campaigns/${Number(id)}`));
  }

  /** Start (`running`) or pause (`paused`) a campaign. */
  async setCampaignStatus(id, status) {
    return normalizeCampaign(
      await this.send(`/api/campaigns/${Number(id)}/status`, { method: 'PUT', body: { status } }),
    );
  }

  /** The newest subscribers, newest first. */
  async newestSubscribers(size) {
    const data = await this.send(`/api/subscribers?page=1&per_page=${size}&order_by=id&order=desc`);
    return resultsOf(data).map(normalizeSubscriber).filter(Boolean);
  }

  async countSubscribers(query) {
    const data = await this.send(
      `/api/subscribers?page=1&per_page=1&query=${encodeURIComponent(query)}`,
    );
    return count(data?.total);
  }

  /** Subscribers created since `time` (ms). */
  createdSince(time) {
    return this.countSubscribers(`subscribers.created_at >= ${sqlDate(time)}`);
  }

  /** Subscribers who left at least one list since `time` (ms). */
  unsubscribedSince(time) {
    return this.countSubscribers(
      'subscribers.id IN (SELECT subscriber_id FROM subscriber_lists ' +
        `WHERE status = 'unsubscribed' AND updated_at >= ${sqlDate(time)})`,
    );
  }
}
