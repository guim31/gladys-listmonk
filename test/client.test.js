// -----------------------------------------------------------------------------
// The Listmonk client on the real answers of Listmonk 6.2.0
// (test/fixtures/listmonk/v6.2.0.json), and its errors by kind.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ERROR_KINDS, ListmonkClient, ListmonkError } from '../src/listmonk/client.js';
import { parseServerUrl } from '../src/config.js';

const real = JSON.parse(
  await readFile(new URL('./fixtures/listmonk/v6.2.0.json', import.meta.url), 'utf8'),
);

/** A client answered by one recorded answer, and the requests it sent. */
function clientOf(name) {
  const sent = [];
  const client = new ListmonkClient({
    url: 'http://192.0.2.30:9000',
    user: 'gladys',
    token: 'secret-token',
    request: async (url, options) => {
      sent.push({ url, ...options });
      const { status, body } = real[name];
      return { status, body: JSON.stringify(body) };
    },
  });
  return { client, sent };
}

test('the counts, the lists and the campaigns of a real Listmonk', async () => {
  assert.deepEqual(await clientOf('counts').client.counts(), {
    subscribers: 7,
    blocklisted: 1,
    lists: 4,
    campaigns: 3,
    messages: 3,
  });
  const lists = await clientOf('lists').client.lists();
  assert.deepEqual(
    lists.find((list) => list.name === 'Newsletter'),
    { id: 3, name: 'Newsletter', subscribers: 2, unsubscribed: 2 },
  );
  assert.deepEqual(
    lists.find((list) => list.name === 'Opt-in list'),
    { id: 2, name: 'Opt-in list', subscribers: 1, unsubscribed: 0 },
  );
  const campaigns = await clientOf('campaigns').client.campaigns();
  assert.deepEqual(campaigns[0], {
    id: 3,
    name: 'November draft',
    subject: 'November',
    status: 'finished',
    lists: ['Newsletter', 'Club members'],
    toSend: 3,
    sent: 3,
    views: 2,
    clicks: 0,
    bounces: 0,
  });
});

test('the newest subscribers keep the lists they are still subscribed to', async () => {
  const subscribers = await clientOf('subscribers_newest').client.newestSubscribers(3);
  assert.deepEqual(subscribers[0], {
    id: 7,
    email: 'user5@example.com',
    name: 'Emma Blanc',
    lists: [{ id: 4, name: 'Club members' }],
  });
  // David Roux is blocklisted: unsubscribed from both his lists.
  assert.deepEqual(subscribers[1].lists, []);
});

test('the daily counts are SQL queries of the subscribers API, with a date only', async () => {
  const { client, sent } = clientOf('count_unsubscribed_today');
  assert.equal(await client.unsubscribedSince(Date.UTC(2026, 9, 29, 23)), 2);
  const query = new URL(sent[0].url).searchParams.get('query');
  assert.equal(
    query,
    "subscribers.id IN (SELECT subscriber_id FROM subscriber_lists WHERE status = 'unsubscribed' AND updated_at >= '2026-10-29T23:00:00.000Z')",
  );
  assert.equal(sent[0].headers.authorization, 'token gladys:secret-token');
  assert.equal(await clientOf('count_created_today').client.createdSince(0), 7);
});

test('a status change is a PUT with the new status', async () => {
  const { client, sent } = clientOf('campaign');
  await client.setCampaignStatus(2, 'paused');
  assert.equal(sent[0].method, 'PUT');
  assert.equal(sent[0].url, 'http://192.0.2.30:9000/api/campaigns/2/status');
  assert.equal(sent[0].body, '{"status":"paused"}');
});

test('the errors of a real Listmonk, by kind, without the token', async () => {
  const kinds = {
    bad_token: ERROR_KINDS.AUTH,
    no_token: ERROR_KINDS.AUTH,
    unknown_route: ERROR_KINDS.NOT_LISTMONK,
    campaign_not_found: ERROR_KINDS.REFUSED,
    start_refused: ERROR_KINDS.REFUSED,
  };
  for (const [name, kind] of Object.entries(kinds)) {
    const error = await clientOf(name)
      .client.counts()
      .catch((err) => err);
    assert.ok(error instanceof ListmonkError, name);
    assert.equal(error.kind, kind, name);
    assert.ok(!error.message.includes('secret-token'));
  }
  const refused = await clientOf('start_refused')
    .client.counts()
    .catch((err) => err);
  assert.match(refused.message, /Only paused campaigns and drafts can be started/);
});

test('no answer, a bad certificate, a redirect, a page that is not the API', async () => {
  const failing = (request) =>
    new ListmonkClient({ url: 'http://192.0.2.30:9000', user: 'u', token: 't', request })
      .counts()
      .catch((err) => err.kind);
  const thrown = (code) => async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code } });
  };
  assert.equal(await failing(thrown('ECONNREFUSED')), ERROR_KINDS.UNREACHABLE);
  assert.equal(await failing(thrown('DEPTH_ZERO_SELF_SIGNED_CERT')), ERROR_KINDS.TLS);
  assert.equal(await failing(async () => ({ status: 301, body: '' })), ERROR_KINDS.REDIRECT);
  assert.equal(
    await failing(async () => ({ status: 200, body: '<html></html>' })),
    ERROR_KINDS.NOT_LISTMONK,
  );
  assert.equal(await failing(async () => ({ status: 502, body: '' })), ERROR_KINDS.HTTP);
});

test('the address typed by the user', () => {
  assert.equal(parseServerUrl('192.0.2.30:9000'), 'http://192.0.2.30:9000');
  assert.equal(
    parseServerUrl('https://lists.example.org/admin/campaigns/'),
    'https://lists.example.org',
  );
  assert.equal(parseServerUrl('https://example.org/listmonk/api/'), 'https://example.org/listmonk');
  assert.equal(parseServerUrl('https://user:pass@example.org'), null);
  assert.equal(parseServerUrl('ftp://example.org'), null);
  assert.equal(parseServerUrl('  '), '');
});
