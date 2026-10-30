# Listmonk for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings your self-hosted [Listmonk](https://listmonk.app/) newsletter into
Gladys.

- **The Listmonk instance as a device**: reachable or not, subscribers,
  blocklisted, new subscribers and unsubscriptions of the day, messages sent,
  the current campaign with its status and progress, open and click rates of
  the last campaign sent.
- **One device per mailing list you follow**: subscribers and unsubscribed.
- **Scene triggers**: new subscriber (once per list joined), unsubscription,
  campaign finished.
- **Scene action**: start or pause a campaign — off until allowed in the
  configuration, since it sends real emails.
- **Dashboard widget**: the figures of the day and the latest campaigns.
- Texts in English, French, German and Spanish.

Tested against a real self-hosted Listmonk 6.2.0 (Docker, PostgreSQL 17), with
a campaign really sent to a test SMTP server, paused and resumed, and real
opens. Developed without a Gladys instance in production: feedback welcome on
[the issues](https://github.com/guim31/gladys-listmonk/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- Listmonk 4.0 or later reachable from Gladys, and an API user (Admin → Users →
  New, type API) with its token. The counts of the day need the
  `subscribers:sql_query` permission.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-listmonk`. Then open its configuration, enter
the address of your Listmonk, the API user and its token, and add the instance
and the lists to follow from the Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

At the chosen interval (two minutes by default), the container sends six
requests, whatever the size of the instance: `GET /api/dashboard/counts`,
`/api/lists`, the 20 newest campaigns, the 20 newest subscribers, and two
counts of the day through the SQL `query` of `/api/subscribers`. It publishes
the states of the added devices when they change and fires the scene events.
What the triggers remember (newest subscriber, unsubscribed count per list,
status of the recent campaigns) is kept in `/data`, so a restart announces
nothing twice. Redirects are not followed, so the token is never sent to
another host. The logs never hold a subscriber's name or address.

## Limits

- One Listmonk instance per configuration.
- Up to 20 new subscribers per refresh are announced (an import is counted, not
  announced); "Unsubscription" gives a count per list, not who left.
- The open rate counts the opens Listmonk records, repeated opens included.
- A self-signed HTTPS certificate is not accepted (use `http://` on the local
  network).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the Listmonk
API.

## Credits

- [Listmonk](https://github.com/knadh/listmonk) by Kailash Nadh and
  contributors (AGPL-3.0): the API answers in `test/fixtures/listmonk` come
  from its Docker image, and the logo of the cover from its repository.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-shlink](https://github.com/guim31/gladys-shlink).

Not affiliated with Listmonk or its authors.

## License

Apache-2.0, see [LICENSE](LICENSE).
