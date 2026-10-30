// -----------------------------------------------------------------------------
// The whole integration against the SDK's fake Gladys and an in-memory
// Listmonk: discovery, states, scene events (and what a restart remembers),
// failures, the scene action, the widget, the logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { FEATURE_KEYS } from '../src/devices.js';
import { WIDGET_KEY } from '../src/hub.js';
import { campaignRow } from '../src/widgets.js';
import {
  BASE,
  CONFIG,
  createClock,
  createDevices,
  createWorld,
  instanceIdsOf,
  listIdsOf,
  FakeListmonk,
  sampleListmonk,
} from './helpers/world.js';

const tick = async (world, ms = 120_000) => {
  world.clock.advance(ms);
  await world.hub.pollNow();
};

/** The last state published per feature external id. */
function lastStates(world) {
  const states = new Map();
  for (const state of world.fake.states) {
    states.set(state.device_feature_external_id, state.text ?? state.state);
  }
  return states;
}

const events = (world, key) =>
  world.fake.sceneEvents.filter((event) => event.key === key).map((event) => event.data);

test('discovery: the instance and one device per list, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Listmonk 192.0.2.30:9000', 'Club members', 'Newsletter'],
  );
  assert.equal(devices[0].external_id, instanceIdsOf(world).device);
  assert.equal(devices[1].external_id, listIdsOf(world, 2).device);
  assert.ok(devices.every((device) => device.should_poll === false));
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('the added devices get every state, with the daily counts', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const states = lastStates(world);
  const instance = instanceIdsOf(world);
  const expected = {
    [FEATURE_KEYS.REACHABLE]: 1,
    [FEATURE_KEYS.SUBSCRIBERS]: 3,
    [FEATURE_KEYS.BLOCKLISTED]: 0,
    // Bob and Chloé joined today, Bob left the newsletter today.
    [FEATURE_KEYS.NEW_TODAY]: 2,
    [FEATURE_KEYS.UNSUBSCRIBED_TODAY]: 1,
    [FEATURE_KEYS.MESSAGES]: 40,
    [FEATURE_KEYS.CAMPAIGN]: 'Sent: September news',
    [FEATURE_KEYS.CAMPAIGN_PROGRESS]: 100,
    [FEATURE_KEYS.OPEN_RATE]: 45,
    [FEATURE_KEYS.CLICK_RATE]: 12.5,
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(states.get(instance.feature(key)), value, key);
  }
  const newsletter = listIdsOf(world, 1);
  assert.equal(states.get(newsletter.feature(FEATURE_KEYS.SUBSCRIBERS)), 1);
  assert.equal(states.get(newsletter.feature(FEATURE_KEYS.UNSUBSCRIBED)), 1);
  assert.equal(states.get(listIdsOf(world, 2).feature(FEATURE_KEYS.SUBSCRIBERS)), 2);
});

test('the campaign feature follows a campaign being sent, in the chosen language', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, language: 'fr' } });
  t.after(() => world.app.stop());
  await createDevices(world);
  Object.assign(world.listmonk.campaigns[1], { status: 'running', toSend: 8, sent: 2 });
  await tick(world);
  const instance = instanceIdsOf(world);
  let states = lastStates(world);
  assert.equal(
    states.get(instance.feature(FEATURE_KEYS.CAMPAIGN)),
    "En cours d'envoi : October news",
  );
  assert.equal(states.get(instance.feature(FEATURE_KEYS.CAMPAIGN_PROGRESS)), 25);
  // The rates stay the ones of the last finished campaign.
  assert.equal(states.get(instance.feature(FEATURE_KEYS.OPEN_RATE)), 45);
  world.listmonk.campaigns[1].status = 'paused';
  await tick(world);
  states = lastStates(world);
  assert.equal(states.get(instance.feature(FEATURE_KEYS.CAMPAIGN)), 'En pause : October news');
});

test('"New subscriber" once per list joined, never for the subscribers already there', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(events(world, 'new_subscriber'), []);
  world.clock.advance(60_000);
  world.listmonk.subscribe('Dan Roux', 'dan@example.com', [1, 2]);
  world.listmonk.subscribe('Eve Blanc', 'eve@example.com');
  await tick(world);
  assert.deepEqual(events(world, 'new_subscriber'), [
    {
      name: 'Dan Roux',
      email: 'dan@example.com',
      device: listIdsOf(world, 1).device,
      list: 'Newsletter',
    },
    {
      name: 'Dan Roux',
      email: 'dan@example.com',
      device: listIdsOf(world, 2).device,
      list: 'Club members',
    },
    { name: 'Eve Blanc', email: 'eve@example.com', device: null, list: '' },
  ]);
  await tick(world);
  assert.equal(events(world, 'new_subscriber').length, 3);
});

test('"Unsubscription" carries the list and how many left', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.clock.advance(60_000);
  world.listmonk.unsubscribe(3, 2);
  await tick(world);
  assert.deepEqual(events(world, 'unsubscribed'), [
    {
      device: listIdsOf(world, 2).device,
      list: 'Club members',
      count: 1,
      unsubscribed: 1,
      subscribers: 1,
    },
  ]);
});

test('"Campaign finished": a campaign seen sending, or created and sent between two reads', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  // September news was already finished: no event.
  assert.deepEqual(events(world, 'campaign_finished'), []);
  const october = world.listmonk.campaigns[1];
  Object.assign(october, { status: 'running', toSend: 2, sent: 1 });
  await tick(world);
  Object.assign(october, { status: 'finished', sent: 2, views: 1 });
  await tick(world);
  world.clock.advance(1000);
  const flash = world.listmonk.addCampaign('Flash sale', { lists: [2], status: 'finished' });
  Object.assign(flash, { toSend: 2, sent: 2 });
  await tick(world);
  await tick(world);
  assert.deepEqual(events(world, 'campaign_finished'), [
    {
      campaign: 'October news',
      subject: 'October news subject',
      lists: 'Newsletter, Club members',
      sent: 2,
      views: 1,
      clicks: 0,
    },
    {
      campaign: 'Flash sale',
      subject: 'Flash sale subject',
      lists: 'Club members',
      sent: 2,
      views: 0,
      clicks: 0,
    },
  ]);
});

test('a restart neither repeats nor misses an event (state in /data)', async (t) => {
  const clock = createClock();
  const first = await createWorld({ clock });
  await first.app.stop();
  const { listmonk, dataDir } = first;
  clock.advance(60_000);
  listmonk.subscribe('Dan Roux', 'dan@example.com', [1]);
  listmonk.campaigns[1].status = 'finished';
  const second = await createWorld({ clock, listmonk, dataDir });
  t.after(() => second.app.stop());
  assert.equal(events(second, 'new_subscriber').length, 1);
  // Seen as a draft before the restart, finished after it.
  assert.equal(events(second, 'campaign_finished').length, 1);
  await second.app.stop();
  const third = await createWorld({ clock, listmonk, dataDir });
  t.after(() => third.app.stop());
  assert.equal(events(third, 'new_subscriber').length, 0);
});

test('another address starts again without announcing what it has', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.listmonk.subscribe('Dan Roux', 'dan@example.com', [1]);
  await world.fake.configUpdated({ ...CONFIG, url: 'http://192.0.2.30:9000/listmonk' });
  assert.deepEqual(events(world, 'new_subscriber'), []);
});

test('an API user without subscribers:sql_query reads everything but the daily counts', async (t) => {
  const clock = createClock();
  const listmonk = sampleListmonk(clock);
  listmonk.sqlQuery = false;
  const world = await createWorld({ clock, listmonk });
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  const states = lastStates(world);
  const instance = instanceIdsOf(world);
  assert.equal(states.get(instance.feature(FEATURE_KEYS.SUBSCRIBERS)), 3);
  assert.equal(states.has(instance.feature(FEATURE_KEYS.NEW_TODAY)), false);
  const ack = await world.fake.action('test_connection', {});
  assert.match(ack.data?.message?.en ?? JSON.stringify(ack), /subscribers:sql_query/);
});

test('a token refused: the connection status says so, in four languages', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, api_token: 'wrong' } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /jeton refusé/);
  assert.deepEqual(Object.keys(world.fake.connectionStatus.message), ['en', 'fr', 'de', 'es']);
});

test('an outage: unreachable after two failed reads, back after one good read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const reachable = instanceIdsOf(world).feature(FEATURE_KEYS.REACHABLE);
  world.listmonk.down = true;
  await tick(world);
  assert.equal(lastStates(world).get(reachable), 1, 'one lost answer is not an outage');
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  await tick(world);
  assert.equal(lastStates(world).get(reachable), 0);
  assert.equal(world.fake.connectionStatus.connected, false);
  world.listmonk.down = false;
  await tick(world);
  assert.equal(lastStates(world).get(reachable), 1);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('"Start or pause a campaign" is refused until allowed in the configuration', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('campaign_control', {
    campaign: 'October news',
    command: 'start',
  });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Campaign control is off/);
  assert.equal(world.listmonk.campaigns[1].status, 'draft');
});

test('"Start or pause a campaign" by name or ID, with clear refusals', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, campaign_control: true } });
  t.after(() => world.app.stop());
  const run = (fields) => world.fake.sceneAction('campaign_control', fields);

  let ack = await run({ campaign: ' october NEWS ', command: 'start' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(ack.data.outputs, {
    campaign: 'October news',
    campaign_id: 2,
    status: 'running',
  });
  assert.equal(world.listmonk.campaigns[1].status, 'running');
  assert.ok(world.listmonk.requests.includes('PUT /api/campaigns/2/status'));

  ack = await run({ campaign: 'October news', command: 'start' });
  assert.equal(ack.success, true, 'already sending: nothing to do');

  ack = await run({ campaign: '#2', command: 'pause' });
  assert.equal(ack.data.outputs.status, 'paused');
  assert.equal(world.listmonk.campaigns[1].status, 'paused');

  ack = await run({ campaign: '1', command: 'start' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Only a draft or a paused campaign/);
  ack = await run({ campaign: 'September news', command: 'pause' });
  assert.match(ack.error, /Only a campaign being sent/);
  ack = await run({ campaign: '99', command: 'start' });
  assert.match(ack.error, /No Listmonk campaign/);
  ack = await run({ campaign: 'October', command: 'start' });
  assert.match(ack.error, /No Listmonk campaign/, 'a part of the name is not enough');
  world.listmonk.addCampaign('October news');
  ack = await run({ campaign: 'October news', command: 'start' });
  assert.match(ack.error, /Several campaigns/);
  ack = await run({ campaign: 'October news', command: 'delete' });
  assert.match(ack.error, /Unknown command/);
});

test('a campaign named with a number: never another campaign by its ID', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, campaign_control: true } });
  t.after(() => world.app.stop());
  const run = (fields) => world.fake.sceneAction('campaign_control', fields);
  // Campaign #3 is named "2", campaign #2 is a draft: "2" means both.
  world.listmonk.addCampaign('2');
  let ack = await run({ campaign: '2', command: 'start' });
  assert.match(ack.error, /Several campaigns match/);
  assert.equal(world.listmonk.campaigns[1].status, 'draft');
  ack = await run({ campaign: '#2', command: 'start' });
  assert.equal(ack.data.outputs.campaign, 'October news');
  // A name with the characters Listmonk's own search chokes on.
  world.listmonk.addCampaign('a & b | c');
  ack = await run({ campaign: 'A & B | C', command: 'start' });
  assert.equal(ack.data.outputs.campaign_id, 4);
});

test('an address changed during a read: the new instance inherits nothing', async (t) => {
  // Two instances behind two addresses; the second one has two campaigns
  // already sent. (Scenario of the independent review.)
  const clock = createClock();
  const first = sampleListmonk(clock);
  const second = new FakeListmonk({ now: clock.now });
  second.addList('Other');
  second.addCampaign('B one', { status: 'finished' });
  second.addCampaign('B two', { status: 'finished' });
  const OTHER = 'http://198.51.100.7:9000';
  const request = (url, options) =>
    url.startsWith(OTHER)
      ? second.request(url.replace(OTHER, BASE), options)
      : first.request(url, options);
  const world = await createWorld({ clock, listmonk: { request } });
  t.after(() => world.app.stop());
  first.campaigns[1].status = 'running';
  await world.hub.pollNow();
  // A read of the first instance held on a scene event…
  first.subscribe('Zed Roux', 'zed@example.com', [1]);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const publish = world.gladys.publishSceneEvent.bind(world.gladys);
  world.gladys.publishSceneEvent = async (key, data) => {
    await gate;
    return publish(key, data);
  };
  const reading = world.hub.pollNow();
  await new Promise((resolve) => setTimeout(resolve, 10));
  // …while the address changes.
  const reconfiguring = world.hub.reconfigure({ ...world.hub.config, url: OTHER });
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  await Promise.all([reading, reconfiguring]);
  const before = world.fake.sceneEvents.length;
  await tick(world);
  assert.deepEqual(world.fake.sceneEvents.slice(before), []);
  assert.deepEqual(world.hub.saved.campaigns, { 1: 'finished', 2: 'finished' });
});

test('the widget: figures, the latest campaigns, the Refresh button, within the budget', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  Object.assign(world.listmonk.campaigns[1], { status: 'running', toSend: 8, sent: 2 });
  await tick(world);
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.equal(ack.success, true, ack.error);
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.deepEqual(
    content.components.map((c) => c.type),
    ['value', 'value', 'value', 'status', 'button'],
  );
  assert.deepEqual(
    content.components.slice(0, 3).map((c) => c.value),
    [3, 2, 1],
  );
  assert.deepEqual(
    content.components[3].items.map((item) => [item.label, item.value]),
    [
      ['October news', "En cours d'envoi 2/8"],
      ['September news', '40 · 45 % ouverture'],
    ],
  );

  const bare = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { show_figures: false, show_refresh: false, campaigns: '3' },
    language: 'en',
  });
  assert.deepEqual(
    bare.data.content.components.map((c) => c.type),
    ['status'],
  );

  const refreshed = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {}, { settings: {} });
  assert.equal(refreshed.success, true, refreshed.error);
});

test('the widget asks for the configuration, then tells an outage', async (t) => {
  const empty = await createWorld({ config: {} });
  t.after(() => empty.app.stop());
  const ask = await empty.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.match(ask.data.content.components[0].text, /Fill in your Listmonk/);

  const world = await createWorld();
  t.after(() => world.app.stop());
  world.listmonk.down = true;
  await tick(world);
  await tick(world);
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  assert.ok(ack.data.content.components.some((c) => c.text === 'Listmonk does not answer'));
});

test('"Test the connection" reports the instance', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.fr, 'Listmonk : Connecté, 3 abonné(s), 2 liste(s), 2 campagne(s)');
});

test('the container reads Listmonk on its own timer, without onPoll', async (t) => {
  const world = await createWorld({
    clock: createClock(Date.now()),
    timers: true,
  });
  t.after(() => world.app.stop());
  // A one-minute interval at least would make this test slow: shorten the timer.
  world.hub.config.pollIntervalMs = 20;
  world.hub.schedulePoll();
  const before = world.listmonk.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(world.listmonk.requests.length > before);
});

test('a normal cycle writes nothing at the info level, and no subscriber in the logs', async (t) => {
  const lines = [];
  const original = process.stdout.write.bind(process.stdout);
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const level = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  process.stdout.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  let quiet;
  try {
    world.listmonk.subscribe('Dan Roux', 'dan@example.com', [1]);
    await tick(world);
    await tick(world);
    quiet = [...lines];
    // The capture works: an outage is a lifecycle line.
    world.listmonk.down = true;
    await tick(world);
    await tick(world);
  } finally {
    process.stdout.write = original;
    process.env.LOG_LEVEL = level;
  }
  assert.deepEqual(quiet, []);
  assert.ok(
    lines.some((line) => line.includes('Listmonk is unreachable')),
    lines.join(''),
  );
  const all = lines.join('');
  assert.ok(!all.includes('dan@example.com') && !all.includes(CONFIG.api_token));
  assert.ok(!all.includes(BASE.replace('http://', 'x')));
});

test('a widget row writes the decimal comma outside English', () => {
  const campaign = { name: 'N', status: 'finished', sent: 3, toSend: 3, views: 2 };
  assert.equal(campaignRow(campaign, 'fr').value, '3 · 66,7 % ouverture');
  assert.equal(campaignRow(campaign, 'en').value, '3 · 66.7 % opened');
});
