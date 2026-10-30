// -----------------------------------------------------------------------------
// An in-memory Listmonk: the REST API the integration reads and writes, with
// the shapes of the real answers of Listmonk 6.2.0
// (test/fixtures/listmonk/v6.2.0.json): `token user:token` authentication
// (403 otherwise), lists with `subscriber_statuses`, campaigns newest first,
// the two SQL counts of the subscribers API, the status changes and their
// refusals (400 with a message).
// -----------------------------------------------------------------------------

export const BASE = 'http://192.0.2.30:9000';
export const API_USER = 'gladys';
export const API_TOKEN = 'Xk3dTq0Lr8VbNw5ZsYh2JcPm7AeUf4Go';

const iso = (time) => new Date(time).toISOString();

export class FakeListmonk {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.lists = [];
    this.subscribers = [];
    this.campaigns = [];
    this.down = false;
    this.status = null; // forced HTTP status on every request
    this.sqlQuery = true; // the API user has `subscribers:sql_query`
    this.requests = [];
    this.request = this.request.bind(this);
  }

  addList(name, { type = 'public', optin = 'single' } = {}) {
    const list = { id: this.lists.length + 1, name, type, optin, at: this.now() };
    this.lists.push(list);
    return list;
  }

  /** A subscriber in `lists` (ids), created now. */
  subscribe(name, email, lists = []) {
    const subscriber = {
      id: this.subscribers.length + 1,
      name,
      email,
      at: this.now(),
      blocklisted: false,
      lists: new Map(lists.map((id) => [id, { status: 'confirmed', at: this.now() }])),
    };
    this.subscribers.push(subscriber);
    return subscriber;
  }

  unsubscribe(subscriberId, listId) {
    const subscription = this.subscribers[subscriberId - 1].lists.get(listId);
    Object.assign(subscription, { status: 'unsubscribed', at: this.now() });
  }

  addCampaign(name, { lists = [1], status = 'draft' } = {}) {
    const campaign = {
      id: this.campaigns.length + 1,
      name,
      subject: `${name} subject`,
      lists,
      status,
      toSend: 0,
      sent: 0,
      views: 0,
      clicks: 0,
      at: this.now(),
    };
    this.campaigns.push(campaign);
    return campaign;
  }

  listJson(list) {
    const statuses = {};
    for (const subscriber of this.subscribers) {
      const status = subscriber.lists.get(list.id)?.status;
      if (status) {
        statuses[status] = (statuses[status] ?? 0) + 1;
      }
    }
    return {
      id: list.id,
      created_at: iso(list.at),
      updated_at: iso(list.at),
      uuid: `00000000-0000-4000-8000-${String(list.id).padStart(12, '0')}`,
      name: list.name,
      type: list.type,
      optin: list.optin,
      status: 'active',
      tags: [],
      description: '',
      subscriber_count: Object.values(statuses).reduce((a, b) => a + b, 0),
      subscriber_statuses: statuses,
      subscription_created_at: null,
      subscription_updated_at: null,
    };
  }

  subscriberJson(subscriber) {
    return {
      id: subscriber.id,
      created_at: iso(subscriber.at),
      updated_at: iso(subscriber.at),
      uuid: `10000000-0000-4000-8000-${String(subscriber.id).padStart(12, '0')}`,
      email: subscriber.email,
      name: subscriber.name,
      attribs: {},
      status: subscriber.blocklisted ? 'blocklisted' : 'enabled',
      lists: [...subscriber.lists].map(([id, subscription]) => ({
        subscription_status: subscription.status,
        subscription_created_at: iso(subscriber.at),
        subscription_updated_at: iso(subscription.at),
        subscription_meta: {},
        id,
        name: this.lists[id - 1].name,
        type: this.lists[id - 1].type,
      })),
    };
  }

  campaignJson(campaign) {
    return {
      id: campaign.id,
      created_at: iso(campaign.at),
      updated_at: iso(campaign.at),
      views: campaign.views,
      clicks: campaign.clicks,
      bounces: 0,
      lists: campaign.lists.map((id) => ({ id, name: this.lists[id - 1]?.name ?? '' })),
      media: [],
      started_at: null,
      to_send: campaign.toSend,
      sent: campaign.sent,
      uuid: `20000000-0000-4000-8000-${String(campaign.id).padStart(12, '0')}`,
      type: 'regular',
      name: campaign.name,
      subject: campaign.subject,
      from_email: 'listmonk <noreply@listmonk.example.org>',
      body: '',
      status: campaign.status,
      content_type: 'richtext',
      tags: [],
      template_id: 1,
      messenger: 'email',
    };
  }

  static page(results, perPage) {
    return { results, query: '', total: results.length, per_page: perPage, page: 1 };
  }

  answer(status, body) {
    return { status, body: JSON.stringify(body) };
  }

  /** The two SQL counts the integration sends (src/listmonk/client.js). */
  sqlCount(query) {
    const created = query.match(/^subscribers\.created_at >= '([^']+)'$/);
    if (created) {
      const since = Date.parse(created[1]);
      return this.subscribers.filter((s) => s.at >= since).length;
    }
    const left = query.match(
      /^subscribers\.id IN \(SELECT subscriber_id FROM subscriber_lists WHERE status = 'unsubscribed' AND updated_at >= '([^']+)'\)$/,
    );
    if (left) {
      const since = Date.parse(left[1]);
      return this.subscribers.filter((s) =>
        [...s.lists.values()].some((l) => l.status === 'unsubscribed' && l.at >= since),
      ).length;
    }
    throw new Error(`Unexpected query ${query}`);
  }

  async request(url, { method = 'GET', headers = {}, body } = {}) {
    const { pathname, searchParams } = new URL(url);
    this.requests.push(`${method} ${pathname}${searchParams.size ? `?${searchParams}` : ''}`);
    if (this.down) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    if (this.status) {
      return this.answer(this.status, { message: 'Forced' });
    }
    if (headers.authorization !== `token ${API_USER}:${API_TOKEN}`) {
      return this.answer(403, { message: 'invalid API credentials' });
    }
    const perPage = Number(searchParams.get('per_page')) || 20;
    if (pathname === '/api/health') {
      return this.answer(200, { data: true });
    }
    if (pathname === '/api/dashboard/counts') {
      const byStatus = {};
      for (const campaign of this.campaigns) {
        byStatus[campaign.status] = (byStatus[campaign.status] ?? 0) + 1;
      }
      return this.answer(200, {
        data: {
          subscribers: {
            total: this.subscribers.length,
            blocklisted: this.subscribers.filter((s) => s.blocklisted).length,
            orphans: 0,
          },
          lists: { total: this.lists.length },
          campaigns: { total: this.campaigns.length, by_status: byStatus },
          messages: this.campaigns.reduce((sum, c) => sum + c.sent, 0),
        },
      });
    }
    if (pathname === '/api/lists') {
      const lists = [...this.lists].reverse().map((list) => this.listJson(list));
      return this.answer(200, { data: FakeListmonk.page(lists, lists.length) });
    }
    if (pathname === '/api/subscribers') {
      const query = searchParams.get('query');
      if (query) {
        if (!this.sqlQuery) {
          return this.answer(403, { message: 'Permission denied: subscribers:sql_query' });
        }
        return this.answer(200, {
          data: { results: [], query, total: this.sqlCount(query), per_page: 1, page: 1 },
        });
      }
      const newest = [...this.subscribers].sort((a, b) => b.id - a.id).slice(0, perPage);
      return this.answer(200, {
        data: FakeListmonk.page(
          newest.map((s) => this.subscriberJson(s)),
          perPage,
        ),
      });
    }
    if (pathname === '/api/campaigns') {
      const query = (searchParams.get('query') ?? '').toLowerCase();
      const found = [...this.campaigns]
        .sort((a, b) => b.at - a.at || b.id - a.id)
        .filter(
          (c) =>
            !query ||
            c.name.toLowerCase().includes(query) ||
            c.subject.toLowerCase().includes(query),
        )
        .slice(0, perPage);
      return this.answer(200, {
        data: FakeListmonk.page(
          found.map((c) => this.campaignJson(c)),
          perPage,
        ),
      });
    }
    const match = pathname.match(/^\/api\/campaigns\/(\d+)(\/status)?$/);
    if (match) {
      const campaign = this.campaigns[Number(match[1]) - 1];
      if (!campaign) {
        return this.answer(400, { message: 'Campaign not found' });
      }
      if (!match[2]) {
        return this.answer(200, { data: this.campaignJson(campaign) });
      }
      const { status } = JSON.parse(body);
      if (status === 'running' && !['draft', 'paused'].includes(campaign.status)) {
        return this.answer(400, { message: 'Only paused campaigns and drafts can be started.' });
      }
      if (status === 'paused' && campaign.status !== 'running') {
        return this.answer(400, { message: 'Only active campaigns can be paused.' });
      }
      // Listmonk answers with the campaign as it was before the change.
      const before = this.campaignJson(campaign);
      campaign.status = status;
      return this.answer(200, { data: before });
    }
    return this.answer(404, { message: '404 unknown endpoint' });
  }
}
