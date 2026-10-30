# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the **API user and token** of Listmonk, stored by Gladys in the integration
  configuration (never written to `/data`, never logged); they are only sent
  to the address configured, and redirects are not followed so they never
  reach another host;
- the newest subscribers read from Listmonk (name, email address, lists):
  kept in memory and passed to the "New subscriber" scene event, never logged;
- the "Start or pause a campaign" scene action, which sends real emails: off
  until the user turns it on in the configuration, and limited to what the role
  of the API user allows;
- `/data/listmonk-state.json`: what the scene triggers remember (the id of
  the newest subscriber seen, the unsubscribed count of each list, the status
  of the recent campaigns; no secret, no personal data);
- network: HTTP(S) requests to Listmonk, nothing else; no port is opened.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Listmonk itself.
