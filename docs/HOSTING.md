# Hosting TasksPipes

TasksPipes is a single Node.js container serving both the API and the web app, with a PostgreSQL database. The
`docker-compose.yml` at the root of the repository runs both.

## Quick start

1. Copy the configuration and fill it in:

   ```shell
   cp .env.example .env
   ```

   At least `APP_URL` (the public URL), `APP_SECRET` (`openssl rand -hex 32`), `POSTGRES_PASSWORD` and `OUTLINE_URL`.

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
| `OUTLINE_URL` | Public URL of your Outline instance. |
| `OUTLINE_API_URL` | Optional internal URL the server uses to reach Outline (e.g. `http://outline:3000`). |
| `OUTLINE_OAUTH_CLIENT_ID`, `OUTLINE_OAUTH_CLIENT_SECRET` | OAuth sign-in, see below. |
| `ALLOW_API_KEY_LOGIN` | `true` (default) lets people sign in with a personal Outline API key. |
| `OUTLINE_TEAM_ID` | Optional: only accept accounts of one workspace of the configured Outline server. |
| `OUTLINE_ALLOWED_HOSTS` | Other Outline servers allowed on the sign-in page (comma-separated, `*.example.com` allowed). Empty: any public https server. |
| `OUTLINE_ALLOW_PRIVATE` | `true` also accepts other servers over http or on internal addresses (self-hosting on the same network, tests). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | E-mail for invited guests, see below. |
| `DEFAULT_LOCALE` | `en` (default) or `fr`: language used when neither the profile nor the browser gives one. |
| `SESSION_DAYS` | Session length, 30 days by default. |
| `LOG_LEVEL` | `info` by default. |

## Signing in with Outline

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

### Other Outline servers

The sign-in page lets people add other Outline servers and pick one; the list is kept in their browser. They then
sign in with an API key of that server. Accounts are tied to their server: the same Outline account id on two
servers makes two accounts, and accounts of one server see neither the people nor the teams of another.

As the server contacts the addresses people type, only public `https` servers are accepted, checked on every call;
internal addresses (`localhost`, `10.x`, `192.168.x`…) are refused unless `OUTLINE_ALLOW_PRIVATE=true`. Use
`OUTLINE_ALLOWED_HOSTS` to accept only some servers.

## E-mail and invited guests

People without an Outline account can be invited by e-mail. They sign in with one-time links (7 days for an
invitation, 20 minutes for a link asked from the sign-in page) and can turn on two-factor authentication.

Set `SMTP_HOST`, `SMTP_PORT` (587 with STARTTLS, or 465 with `SMTP_SECURE=true`), `SMTP_USER`, `SMTP_PASS` and
`MAIL_FROM` (e.g. `TasksPipes <tasks@example.com>`). Without SMTP nothing is sent: an invitation shows the sign-in
link for the inviter to pass on, and guests cannot ask for a new link themselves.

## Calendar subscription

Each person can subscribe to their tasks with a due date from **My account**. The feed is served at
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
