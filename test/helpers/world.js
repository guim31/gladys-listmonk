// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake Listmonk, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read Listmonk with
// `world.hub.pollNow()`. (From guim31/gladys-shlink.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { instanceIds, listIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { API_TOKEN, API_USER, BASE, FakeListmonk } from './fakeListmonk.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

/** A manual clock, shared by the hub, the fake and the tests: 15/10/2026, 10:00 local. */
export function createClock(start = new Date(2026, 9, 15, 10, 0, 0).getTime()) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * Two lists, three subscribers (one yesterday, two today, one of them gone
 * from the newsletter), a sent campaign and a draft.
 */
export function sampleListmonk(clock) {
  const listmonk = new FakeListmonk({ now: clock.now });
  listmonk.addList('Newsletter');
  listmonk.addList('Club members', { type: 'private', optin: 'double' });
  clock.advance(-24 * 3600_000);
  listmonk.subscribe('Alice Martin', 'alice@example.com', [1]);
  const sent = listmonk.addCampaign('September news', { status: 'finished' });
  Object.assign(sent, { toSend: 40, sent: 40, views: 18, clicks: 5 });
  clock.advance(24 * 3600_000 - 2 * 3600_000);
  listmonk.subscribe('Bob Durand', 'bob@example.com', [1, 2]);
  listmonk.subscribe('Chloé Petit', 'chloe@example.com', [2]);
  listmonk.unsubscribe(2, 1);
  listmonk.addCampaign('October news', { lists: [1, 2] });
  clock.advance(2 * 3600_000);
  return listmonk;
}

export const CONFIG = {
  url: BASE,
  api_user: API_USER,
  api_token: API_TOKEN,
  language: 'en',
};

export async function createWorld({
  clock = createClock(),
  listmonk = sampleListmonk(clock),
  config = CONFIG,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-listmonk-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: listmonk.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, listmonk, app, hub: app.hub, clock, dataDir };
}

export const instanceIdsOf = (world) => instanceIds(world.gladys);
export const listIdsOf = (world, id) => listIds(world.gladys, id);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

export { API_TOKEN, API_USER, BASE, FakeListmonk };
