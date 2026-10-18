# Hosting TasksPipes

TasksPipes is a single Node.js container serving both the API and the web app, with a PostgreSQL database. The
`docker-compose.yml` at the root of the repository runs both.

## Quick start

1. Copy the configuration and fill it in:

   ```shell
   cp .env.example .env
   ```

   At least `APP_URL` (the public URL), `APP_SECRET` (`openssl rand -hex 32`) and `POSTGRES_PASSWORD`.
   No Outline server needs to be configured: people type theirs on the sign-in page.

2. Choose how people sign in (see below), then start:

   ```shell
   docker compose up -d --build
   ```

3. Open `APP_URL`. On first sign-in, the members of the Outline workspace are imported (`users.list`) so that tasks
   can be sent to them before they ever sign in.

Put the application behind an HTTPS reverse proxy (Caddy, Traefik, nginx…): with an `https://` `APP_URL`, cookies
are `Secure`. The proxy must pass WebSocket upgrades through for live updates (`/api/events`); Caddy and Traefik do
it by default.

The web app loads its styles, scripts and font from the instance itself: the Inter font is bundled with it (SIL Open
Font License, `web/src/assets/fonts/OFL.txt`). Browsers only reach the Outline server besides, for the profile
pictures of Outline accounts.

The port is published on `127.0.0.1` only (`APP_BIND`), so the app is reached through the proxy alone. This
matters: the app trusts the client address the proxy sends in `X-Forwarded-For`, for logs and rate limits, and a
client reaching the port directly could forge it. If the proxy runs on another machine, set `APP_BIND=0.0.0.0` and
let only the proxy reach the port (firewall). A proxy in a container on the same Docker network reaches the app at
`app:3000` and needs neither.

## Configuration

The e-mail, Outline and sign-in settings below can also be managed in the app, by an administrator
(*Administration › Settings*). A variable set here (and not empty) wins and shows locked there; leave it out to manage
the setting in the app. Those settings are: `SMTP_*`, `MAIL_FROM`, `OUTLINE_ENABLED`, `OUTLINE_URL`, `OUTLINE_API_URL`,
`OUTLINE_ALLOWED_HOSTS`, `OUTLINE_ALLOW_PRIVATE`, `OUTLINE_TEAM_ID`, `ALLOW_API_KEY_LOGIN`, `OUTLINE_OAUTH_*`,
`ALLOW_EMAIL_SIGNUP`, `ALLOW_EMAIL_INVITATIONS`, `EMAIL_DOMAINS` and `OIDC_*`.

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public URL of TasksPipes (OAuth callback, links in e-mails and calendars). |
| `APP_PORT` | Port published on the host, 3000 by default. |
| `APP_BIND` | Address that port is published on: `127.0.0.1` by default (only the proxy on this machine). |
| `APP_SECRET` | At least 32 characters. Encrypts Outline tokens, TOTP secrets and calendar links in the database. |
| `POSTGRES_PASSWORD` | Password of the bundled database (`DATABASE_URL` when running the server yourself). With a database of your own, the account must be allowed to create the `pgcrypto` and `unaccent` extensions (both ship with PostgreSQL). |
| `OUTLINE_ENABLED` | `false` turns Outline off: no sign-in with Outline, no Outline documents. `true` by default. |
| `OUTLINE_URL` | Optional Outline server known to the instance: needed for OAuth sign-in. It is never suggested on the sign-in page. |
| `OUTLINE_API_URL` | Optional internal URL the server uses to reach Outline (e.g. `http://outline:3000`). |
| `OUTLINE_OAUTH_CLIENT_ID`, `OUTLINE_OAUTH_CLIENT_SECRET` | OAuth sign-in, see below. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Company sign-in with an OpenID Connect provider (its issuer URL, and the client registered there, confidential, with the redirect URI `APP_URL/auth/oidc/callback`). Off without them. |
| `OIDC_NAME` | Label of the sign-in button (*Continue with …*). Default: `SSO`. |
| `OIDC_SCOPES` | Scopes asked. Default: `openid email profile`. |
| `OIDC_ALLOWED_DOMAINS` | Comma-separated e-mail domains allowed to sign in this way (all by default). |
| `OIDC_ENABLED` | `false` turns company sign-in off while keeping its settings. |
| `ALLOW_API_KEY_LOGIN` | `true` (default) lets people sign in with a personal Outline API key. |
| `OUTLINE_TEAM_ID` | Optional: only accept accounts of one workspace of the server set in `OUTLINE_URL`. |
| `OUTLINE_ALLOWED_HOSTS` | Outline servers people may type on the sign-in page (comma-separated, `*.example.com` allowed). Empty: any public https server. |
| `OUTLINE_ALLOW_PRIVATE` | `true` also accepts servers over http or on internal addresses (self-hosting on the same network, tests). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Key pair (base64url) identifying the server to push services, e.g. from `npx web-push generate-vapid-keys`. Optional: without them, a key is derived from `APP_SECRET` (devices subscribe again if `APP_SECRET` changes). |
| `VAPID_SUBJECT` | A contact for push services, `mailto:` or `https:`. Default: `APP_URL` when it is https, else `mailto:admin@localhost`. |
| `WEBHOOK_ALLOW_PRIVATE` | `true` lets outgoing webhooks (and push messages) reach http addresses and internal networks (a receiver on the same network, tests). Off by default: https and public addresses only, checked when connecting. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | E-mail for accounts without Outline and invitations, see below. |
| `ALLOW_EMAIL_SIGNUP` | `true` (default) lets anyone create an account with an e-mail address and a name (needs SMTP). |
| `EMAIL_DOMAINS` | E-mail domains allowed to sign up or be invited, comma-separated (all by default). |
| `ALLOW_EMAIL_INVITATIONS` | `true` (default) lets people invite others by e-mail and send requests to connect. |
| `ADMIN_EMAILS` | Administrators of the instance (comma-separated addresses): e-mail accounts, Outline accounts of `OUTLINE_URL`, or company sign-in accounts whose address the provider vouches for (`email_verified`), with these addresses. They can disable and enable accounts. |
| `REDIS_URL` | Redis holding the rate limit counters (the bundled one: `redis://redis:6379`). Without it, they are kept in memory, per process. |
| `RATE_LIMIT_BACKOFF_FACTOR` | A client over a limit is blocked for a minute, then this many times longer at each new offence (2 by default; 1 keeps it the same). |
| `TIMEZONE` | Time zone of the reports (e.g. `Europe/Paris`); `UTC` by default. |
| `REPORT_HOUR` | Hour (0–23) at which daily reports, and on Fridays weekly time reports, are due: 18 by default. |
| `DEFAULT_LOCALE` | Language used when neither the profile nor the browser gives one: the code of a file of `locales/` (`en` by default, `fr`, `es`…). |
| `LOCALES_DIR` | Folder of the language files, when they are not next to the server (`locales/`, found by default). |
| `SESSION_DAYS` | Session length, 30 days by default. |
| `LOG_LEVEL` | `info` by default. |

## Signing in with Outline

People type the address of their Outline server on the sign-in page; it is then kept in their browser, and they can
add others and switch between them. No server is suggested by the instance.

### OAuth (recommended)

People sign in with their Outline account, without pasting an API key. It works with the server set in
`OUTLINE_URL` only, and needs an admin of the Outline workspace.

1. In Outline, go to **Settings › Applications** and click **New application**:
   - **Name**: `TasksPipes`
   - **Redirect URL**: `<APP_URL>/auth/outline/callback`, e.g. `https://tasks.example.com/auth/outline/callback`
2. Save, then open the application to copy its **Client ID** and **Client secret**.
3. Set them in `.env` and restart:

   ```dotenv
   OUTLINE_OAUTH_CLIENT_ID=<client id>
   OUTLINE_OAUTH_CLIENT_SECRET=<client secret>
   ```

The "Continue with Outline" button then shows on the sign-in page. Set `ALLOW_API_KEY_LOGIN=false` to allow OAuth
only.

- No **Applications** menu: the account is not an admin, or the Outline version is too old for OAuth.
- The redirect URL must match **exactly** (including `https`), otherwise sign-in fails on the way back.

### API keys

With `ALLOW_API_KEY_LOGIN=true`, everyone can paste a personal API key created in Outline (**Settings › API**).
The key needs read and write access to documents. The sign-in page links to the right Outline page.

### Several Outline servers

Accounts are tied to their server: the same Outline account id on two
servers makes two accounts, and accounts of one server see neither the people nor the teams of another.

As the server contacts the addresses people type, only public `https` servers are accepted, checked on every call;
internal addresses (`localhost`, `10.x`, `192.168.x`…) are refused unless `OUTLINE_ALLOW_PRIVATE=true`. The address
is checked again when each connection opens, so a name that resolves elsewhere between the check and the call (DNS
rebinding) is refused too. Redirects are not followed. Use
`OUTLINE_ALLOWED_HOSTS` to accept only some servers.

## E-mail accounts and invitations

People without an Outline account sign in with one-time links sent by e-mail and can turn on two-factor
authentication. They get an account by **signing up** on the sign-in page (e-mail address and display name; the link
confirms the address, valid 24 hours) or by being **invited**. Inviting someone already on TasksPipes sends them a
request to connect, which they accept or refuse.

Set `SMTP_HOST`, `SMTP_PORT` (587 with STARTTLS, or 465 with `SMTP_SECURE=true`), `SMTP_USER`, `SMTP_PASS` and
`MAIL_FROM` (e.g. `TasksPipes <tasks@example.com>`). Without SMTP nothing is sent: sign-up is not offered, an
invitation shows the sign-in link for the inviter to pass on, and people cannot ask for a new link themselves.

- Invitation links are valid 48 hours. Accounts created by an invitation and never used are then disabled (checked
  at start and every hour): they cannot sign in, get no e-mail and no longer appear in the app, until someone sends
  them a new link or invites them again, or they sign up with that address and use the link. Accounts made by signing
  up are not concerned. Invitations are limited to 30 per person and hour, new links to 10.
- `ALLOW_EMAIL_SIGNUP=false` removes sign-up from the sign-in page: accounts without Outline then come from
  invitations only.
- `ALLOW_EMAIL_INVITATIONS=false` turns invitations and requests to connect off; existing connections are kept.

The sign-up and invitation forms give the same answer whether or not an address already has an account, so they
cannot be used to find out who uses TasksPipes.

## Reports by e-mail

Pipes can send their daily activity report every day at `REPORT_HOUR` (local to `TIMEZONE`), and development pipes
their weekly time report on Fridays. The server checks every minute and records each sending in the database, so a
report goes out once, even across restarts; if the server was down at the report hour, it sends on start-up the same
day. Sending needs SMTP (see above).

## Notifications by e-mail

With SMTP set up, people get e-mails about tasks sent to them, given to them or refused, comments and due dates (see
[the features](FEATURES.md#e-mail-notifications)); each person chooses what they get in their settings. The server
checks every minute: e-mails sent at once go out about two minutes after what caused them; the daily digest goes out
once at `REPORT_HOUR`, even across restarts; due-date reminders go out in the morning at each person's hour (8:00 by
default, in `TIMEZONE`). Unsubscribe links are signed with `APP_SECRET`: changing it makes the links of e-mails
already sent invalid.

## Rate limits

Routes that sign people in, accept a secret or check a code are rate limited: past the limit, the client is blocked for
the length of the window, then longer at each new offence (`RATE_LIMIT_BACKOFF_FACTOR`), up to
a day. Counters live in the Redis service of `docker-compose.yml`, which keeps nothing on disk; with several instances
of the app, they share it. If Redis cannot be reached, requests go through and a warning is logged.

| Routes | Limit | Counted per |
| --- | --- | --- |
| Sign-in with an API key, a sign-in link or a two-factor code; asking for a sign-in link | 20 per 15 minutes each | address |
| Outline OAuth sign-in | 30 per 15 minutes | address |
| Sign-up | 10 per hour | address |
| Unsubscribe links | 20 per minute | address |
| Two-factor settings (set up, turn on or off) | 10 per 15 minutes | person |
| Invitations, new invitation links | 30 and 10 per hour | person |
| Invitations of Outline colleagues | 20 per hour | person |
| GitHub / GitLab webhooks | 600 per minute | pipe token |
| Calendar feeds | 60 per minute | feed |
| Search | 120 per minute | person |
| Pipe exports; import previews; imports | 60, 300 and 20 per hour | person |
| Public API (`/api/v1`) | 600 per minute | token (address for a wrong token) |
| Access token creation; webhook changes | 20 and 60 per hour | person |
| Data export | 5 per hour | person |
| Account deletion (asking, confirming by code) | 10 per 15 minutes | person |
| Account deletion links | 20 per 15 minutes | address |
| `/healthz` | 120 per minute | address |

The client address comes from the reverse proxy (`X-Forwarded-For`): keep the app reachable only through it
(`APP_BIND`, see above).

## Calendar subscription

Each person can subscribe to their tasks with a due date from **Calendar** in the account menu. The feed is served at
`<APP_URL>/cal/<token>.ics`, outside the API, because calendar apps fetch it without a session: the token is its
only credential. It can be renewed from the same place, and it is masked in the logs.

Open tasks carry reminders (five days before, the day before and on the due date, at 9:00). Apple Calendar removes
the alerts of subscribed calendars unless "Alerts" is unticked under "Remove" when subscribing; Google Calendar
ignores them and applies its own default notifications.

## GitHub and GitLab webhooks

Pipes connected to repositories receive webhooks at `<APP_URL>/hooks/github/…` and `<APP_URL>/hooks/gitlab/…`:
GitHub or GitLab must be able to reach `APP_URL`. See [the integration guide](GIT-INTEGRATION.md).

## Upgrading

Pull the new version and rebuild: the database schema is upgraded at start-up.

```shell
git pull
docker compose up -d --build
```
