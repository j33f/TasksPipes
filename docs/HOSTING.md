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

## Configuration

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public URL of TasksPipes (OAuth callback, links in e-mails and calendars). |
| `APP_SECRET` | At least 32 characters. Encrypts Outline tokens, TOTP secrets and calendar links in the database. |
| `POSTGRES_PASSWORD` | Password of the bundled database (`DATABASE_URL` when running the server yourself). |
| `OUTLINE_URL` | Optional Outline server known to the instance: needed for OAuth sign-in. It is never suggested on the sign-in page. |
| `OUTLINE_API_URL` | Optional internal URL the server uses to reach Outline (e.g. `http://outline:3000`). |
| `OUTLINE_OAUTH_CLIENT_ID`, `OUTLINE_OAUTH_CLIENT_SECRET` | OAuth sign-in, see below. |
| `ALLOW_API_KEY_LOGIN` | `true` (default) lets people sign in with a personal Outline API key. |
| `OUTLINE_TEAM_ID` | Optional: only accept accounts of one workspace of the server set in `OUTLINE_URL`. |
| `OUTLINE_ALLOWED_HOSTS` | Outline servers people may type on the sign-in page (comma-separated, `*.example.com` allowed). Empty: any public https server. |
| `OUTLINE_ALLOW_PRIVATE` | `true` also accepts servers over http or on internal addresses (self-hosting on the same network, tests). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | E-mail for accounts without Outline and invitations, see below. |
| `ALLOW_EMAIL_SIGNUP` | `true` (default) lets anyone create an account with an e-mail address and a name (needs SMTP). |
| `ALLOW_EMAIL_INVITATIONS` | `true` (default) lets people invite others by e-mail and send requests to connect. |
| `DEFAULT_LOCALE` | `en` (default) or `fr`: language used when neither the profile nor the browser gives one. |
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
internal addresses (`localhost`, `10.x`, `192.168.x`…) are refused unless `OUTLINE_ALLOW_PRIVATE=true`. Use
`OUTLINE_ALLOWED_HOSTS` to accept only some servers.

## E-mail accounts and invitations

People without an Outline account sign in with one-time links sent by e-mail and can turn on two-factor
authentication. They get an account by **signing up** on the sign-in page (e-mail address and display name; the link
confirms the address, valid 24 hours) or by being **invited**. Inviting someone already on TasksPipes sends them a
request to connect, which they accept or refuse.

Set `SMTP_HOST`, `SMTP_PORT` (587 with STARTTLS, or 465 with `SMTP_SECURE=true`), `SMTP_USER`, `SMTP_PASS` and
`MAIL_FROM` (e.g. `TasksPipes <tasks@example.com>`). Without SMTP nothing is sent: sign-up is not offered, an
invitation shows the sign-in link for the inviter to pass on, and people cannot ask for a new link themselves.

- `ALLOW_EMAIL_SIGNUP=false` removes sign-up from the sign-in page: accounts without Outline then come from
  invitations only.
- `ALLOW_EMAIL_INVITATIONS=false` turns invitations and requests to connect off; existing connections are kept.

The sign-up and invitation forms give the same answer whether or not an address already has an account, so they
cannot be used to find out who uses TasksPipes.

## Calendar subscription

Each person can subscribe to their tasks with a due date from **Calendar** in the account menu. The feed is served at
`<APP_URL>/cal/<token>.ics`, outside the API, because calendar apps fetch it without a session: the token is its
only credential. It can be renewed from the same place, and it is masked in the logs.

Open tasks carry reminders (five days before, the day before and on the due date, at 9:00). Apple Calendar removes
the alerts of subscribed calendars unless "Alerts" is unticked under "Remove" when subscribing; Google Calendar
ignores them and applies its own default notifications.

## Upgrading

Pull the new version and rebuild: the database schema is upgraded at start-up.

```shell
git pull
docker compose up -d --build
```
