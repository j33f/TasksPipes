# Hosting TasksPipes

> This guide is also online at [doc.taskspipes.com](https://doc.taskspipes.com) (and the project at [taskspipes.com](https://taskspipes.com)).

TasksPipes is a single Node.js container serving both the API and the web app, with a PostgreSQL database. The
`docker-compose.yml` at the root of the repository runs both.

## Install in one command

On a Linux server (Debian, Ubuntu, Raspberry Pi OS, Fedora, RHEL, CentOS, Rocky, AlmaLinux; amd64 or arm64):

```shell
curl -fsSL https://raw.githubusercontent.com/j33f/TasksPipes/main/scripts/install.sh | sudo bash
```

The installer (`scripts/install.sh`, read it first if you like):

1. installs **Docker** Engine and its Compose plugin from **Docker's official repositories** when they are missing;
2. asks for the public address, the administrator's e-mail and your Outline server (optional), and how to serve
   HTTPS: **Caddy** in front (automatic certificate; ports 80 and 443 must reach the server, and the address must
   point to it) or **your own reverse proxy** (the app then listens on `127.0.0.1:3000`);
3. installs in `/opt/taskspipes` the latest release — its published image, or built from the sources when there is
   none for the machine — and writes `.env` with fresh secrets (`chmod 600`);
4. sets up updates: [in one click from the app](#one-click-updates) when the published image is used, and in any
   case the **`taskspipes-update`** command (an alias for bash and zsh, for root and the person who ran `sudo`), with
   `taskspipes-backup`, `taskspipes-restore` and `taskspipes-transfer` (see [Backups](#backups-restore-and-moving));
5. asks whether to back the instance up automatically — none (the suggestion), daily or weekly; then how many backups
   to keep, encryption and a copy on S3-compatible storage;
6. starts the stack and waits until the app is healthy.

E-mail, Outline OAuth and the other settings are then made in the app (Administration › Settings). Running the
installer again keeps the configuration. Without questions, every answer as an option:

```shell
curl -fsSL https://raw.githubusercontent.com/j33f/TasksPipes/main/scripts/install.sh | sudo bash -s -- --yes \
  --domain tasks.example.com --admin-email admin@example.com --proxy caddy --updates auto
```

Other options: `--dir`, `--outline-url`, `--port`, `--version` (a release), `--ref` (build a branch or tag from the
sources), `--backups none|daily|weekly`, and `--restore` to start from a backup of another server (see
[Move to another server](#move-to-another-server)); `--help` lists them.

### An existing installation

The installer also takes over an installation made before it — by hand, from a clone of this repository, whatever
its version — to give it the published image and one-click updates. Run it from that directory (or give it with
`--dir`):

```shell
cd /path/to/TasksPipes
curl -fsSL https://raw.githubusercontent.com/j33f/TasksPipes/main/scripts/install.sh | sudo bash
```

It backs the database up first (`backups/taskspipes-before-install-….sql.gz`), then moves the clone to the latest
release's tag and runs its published image, with the updater (or rebuilds from the sources when there is no image for
the machine). Everything of its own is kept: `.env` (the address and port the app was published on included — before
0.8.0 that was every address, kept with a warning), other Compose profiles, and a `compose.override.yml` or `Caddyfile`
not written by the installer. The project directory, hence the Compose project and its database volume, stays the
same. A clone with changes to the repository's files is refused until they are committed, stashed or undone. Git runs
as the clone's owner, so that it can still be pulled by hand.

## Quick start (by hand)

1. Copy the configuration and fill it in:

   ```shell
   cp .env.example .env
   ```

   At least `APP_URL` (the public URL), `APP_SECRET` (`openssl rand -hex 32`) and `POSTGRES_PASSWORD`.
   No Outline server needs to be configured: people type theirs on the sign-in page (or, with OAuth set up, sign in
   with the instance's one straight away).

2. Choose how people sign in (see below), then start — with the image published for each release:

   ```shell
   docker compose up -d
   ```

   (or build it from these sources with `docker compose up -d --build`). Add `--profile updater` to offer
   [one-click updates](#one-click-updates).

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
| `OUTLINE_URL` | Optional Outline server known to the instance: needed for OAuth sign-in. With OAuth set up, the sign-in page uses it without asking for a server. |
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
| `TASKSPIPES_VERSION` | Version of the published image to run (`ghcr.io/j33f/taskspipes`), e.g. `0.17.0`; `latest` by default. One-click updates set it. |
| `UPDATER_TOKEN` | Turns [one-click updates](#one-click-updates) on: a shared secret (`openssl rand -hex 32`) between the app and the updater. |
| `UPDATER_URL` | Address of the updater seen by the app; default `http://updater:8080` once `UPDATER_TOKEN` is set. |
| `PROJECT_DIR` | For the updater: this directory's absolute path on the host; default the directory `docker compose` is run from. |
| `UPDATER_SERVICE` | For the updater: its own service in the compose file, which it moves to the new version after the app (`updater` by default; empty to never touch itself). |
| `UPDATE_CHECK` | `false` to stop asking GitHub every hour for a new version (on by default; also in Administration › Settings). |
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

With [OAuth](#oauth-recommended) set up, the sign-in page uses the server set in `OUTLINE_URL`: people click
"Continue with Outline" without typing any address. Otherwise (or after "Another Outline server?", for an API key),
they type the address of their Outline server; it is then kept in their browser, and they can add others and switch
between them.

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

## Backups, restore and moving

Three commands, set up by the [installer](#install-in-one-command) for root and for the person who ran it:

| Command | What it does |
| --- | --- |
| `taskspipes-backup` | backs the instance up now; `--setup` plans backups, encrypts them, copies them to S3-compatible storage |
| `taskspipes-restore` | puts a backup back, on this server or on a new one |
| `taskspipes-transfer` | moves the instance to another server, over SSH |

They are scripts of the repository (`scripts/backup.sh`, `restore.sh`, `transfer.sh`): installed by hand, run them
with `sudo` from the installation's directory instead (`sudo ./scripts/backup.sh`). Each command has a `--help`.

Backups are made **on the server**, never by the app: the app only shows them, in **Administration › Backups**, and
tells the administrators when one fails.

### What a backup holds

One archive, `backups/taskspipes-backup-<version>-<date>.tar.gz` — `.tar.gz.gpg` once encrypted:

- **the database**, all of it: tasks, comments, history, settings made in the app, **and the attached files** (they
  are kept in the database);
- **`.env`**, with **`APP_SECRET`**: the Outline sessions, two-factor keys and secret settings kept in the database
  are encrypted with it, and cannot be read without it;
- `backup.env` (the settings of the backups) and, when the installer set up Caddy, `Caddyfile` and
  `compose.override.yml`;
- a manifest (date, server, version) and checksums, checked before anything is restored.

Nothing else is needed: Redis only holds rate-limit counters, Caddy gets its certificate again, and Docker downloads
the images again.

`.env` holds every secret of the instance: an archive that is not encrypted must stay as private as `.env` itself.
Archives are written readable by root only, in a directory only root can open.

### Back up now

```shell
taskspipes-backup
```

```
==> Backing up TasksPipes 0.21.0 (/opt/taskspipes)
==> Backup written: /opt/taskspipes/backups/taskspipes-backup-0.21.0-20261110-153012.tar.gz.gpg (2481352 bytes, encrypted)
==> Copying it to s3:my-bucket/taskspipes
==> Copied.
```

The app keeps running. `--db-only` leaves `.env` out (no secret in the archive), `--no-upload` keeps the backup on
the server, `--output DIR` writes it elsewhere. `taskspipes-backup --list` lists the backups kept on the server.

Updates back the instance up too, before they change anything: `taskspipes-update` with this same script, the
[one-click update](#one-click-updates) with a dump of the database
(`backups/taskspipes-before-update-<version>-<date>.dump`). The last five of each are kept.

### Plan backups

Nothing is planned until you choose to: the installer asks (`--backups none|daily|weekly`), and you can set it up, or
change it, at any time:

```shell
taskspipes-backup --setup
```

It asks, each answer with a suggestion that Enter keeps:

| Question | Suggestion |
| --- | --- |
| Automatic backups: `none`, `daily` or `weekly` (on Sundays) | `none` |
| At what time (the server's time) | `03:30` |
| How many backups to keep on the server | `14` |
| Encrypt backups with a passphrase | `yes` once an S3 copy is set up |
| Copy each backup to S3-compatible storage — then its endpoint, region, bucket, folder, keys, and how many to keep there | `no` |

Then it checks that the storage can be written to, writes `backup.env` (readable by root only, never read by the app),
sets up a **systemd timer** (or a cron entry where systemd is missing), shows the passphrase if it made one, and offers
to make a first backup at once.

```shell
taskspipes-backup --status       # the plan, the next run, the latest backups
```

Run `--setup` again to change anything; `--schedule none` stops the planned backups. Without questions:

```shell
sudo /opt/taskspipes/scripts/backup.sh --setup --yes --schedule daily --at 02:00 --keep 14 --generate-passphrase
```

#### Encryption

With a passphrase, archives are encrypted with **gpg** (AES-256, symmetric) before they are written: the passphrase
is all it takes to open them, on any machine.

- Leave it empty and one is made for you (32 characters), or type your own (12 characters or more).
- **Keep it away from the server**, in a password manager: a copy is in `backup.env` so that planned backups run
  unattended, but it goes with the server if the server goes — and an encrypted backup cannot be restored without it.
- A new passphrase applies to the next backups; older ones keep theirs.

Opening an archive by hand: `gpg -d taskspipes-backup-….tar.gz.gpg | tar -xz`.

#### A copy on S3-compatible storage

A backup kept only on the server is lost with the server. To copy each one elsewhere:

1. At your provider, create a **bucket** and an **access key** allowed to list, read, write and delete in it (and
   nothing else).
2. Run `taskspipes-backup --setup`, answer `yes` to the copy, then give the endpoint and region of the bucket's
   location (shown by the provider), the **bucket**, a **folder** in it (`taskspipes`), the keys, and how many backups
   to keep there (`30`). For instance:

   | Provider | Endpoint | Region |
   | --- | --- | --- |
   | AWS S3 | *(empty)* | e.g. `eu-west-3` |
   | Scaleway | `https://s3.fr-par.scw.cloud` | `fr-par` |
   | OVHcloud | `https://s3.gra.io.cloud.ovh.net` | `gra` |
   | Backblaze B2 | `https://s3.eu-central-003.backblazeb2.com` | `eu-central-003` |
   | Wasabi | `https://s3.eu-central-1.wasabisys.com` | `eu-central-1` |
   | Cloudflare R2 | `https://<account id>.r2.cloudflarestorage.com` | `auto` |
   | MinIO, Garage… | your server's URL | as set there |

The copy is made with [rclone](https://rclone.org), run in a container: nothing to install. Only **encrypted**
backups are sent: setting up a copy asks for a passphrase. The oldest are deleted beyond the count to keep.
`taskspipes-backup --list --remote` lists them.

To be safe from someone holding the server's keys (who could delete the copies too), turn on your provider's
**versioning** or **object lock** on the bucket.

#### Other copies

The backups are plain files: any tool can take them elsewhere. From another machine, for instance:

```shell
rsync -a root@tasks.example.com:/opt/taskspipes/backups/ ./taskspipes-backups/
```

### When a backup fails

- **Administration › Backups** shows the plan, the last good backup and the recent ones, with their errors; the tab
  is marked when something is wrong.
- The administrators get an **e-mail and a push notification**, once, when a backup fails, when its copy to the
  storage fails, or when planned backups stop coming (no good one for 50 hours with daily backups, 8 days with weekly
  ones).
- On the server: `taskspipes-backup --status`, and the log of planned runs, `journalctl -u taskspipes-backup` (or
  `/var/log/taskspipes-backup.log` with cron).

### Restore a backup

A restore **replaces every piece of data of the instance** with the backup's. The state of the server is backed up
first, so that a restore can always be undone.

```shell
taskspipes-restore --list                    # the backups here, and on the storage
taskspipes-restore --latest                  # the latest one kept here
taskspipes-restore /opt/taskspipes/backups/taskspipes-backup-0.21.0-20261110-153012.tar.gz.gpg
taskspipes-restore --from-s3 latest          # download it from the storage first (or give its name)
```

It shows what the backup holds and asks you to type `restore`. Then it:

1. opens the backup — the passphrase comes from `backup.env`, or is asked — and checks its checksums;
2. backs this server up (`backups/taskspipes-before-restore-…`);
3. stops the app, replaces the database, starts everything again and waits until the app is healthy;
4. prints the command that undoes it.

It keeps this server's `.env`, unless there is none, or you give `--with-config` — it then puts back the backup's
(`.env`, `backup.env`, Caddy files; the replaced ones are kept as `*.before-restore`). When the backup was made with
another `APP_SECRET`, it says so and offers to take the backup's: with another secret, people must sign in to Outline
again and set up two-factor authentication anew.

A backup made by a newer version of TasksPipes makes the instance move to that version first (the published image);
built from the sources, update first (`taskspipes-update --version X`). An older backup is upgraded when the app
starts.

The dumps made before updates restore the same way (`.dump`, `.sql.gz`): they hold the database only.

### Move to another server

The new server needs Linux (as for the [installation](#install-in-one-command)); Docker is
installed when missing. Lower the time-to-live (TTL) of the address in your DNS a day before, so that the switch
spreads quickly.

#### In one command

From the current server, with SSH access to the new one (as root, or as a user allowed to use `sudo`):

```shell
taskspipes-transfer admin@new-server.example.com
```

It shows what it will do and asks for a go, then:

1. **stops the app here**, so that nothing changes while it moves (the database keeps running);
2. backs everything up — encrypted when backups are — and copies the backup to the new server, over SSH;
3. installs TasksPipes there from it: the same version, the same `.env` and secrets, the same settings, Caddy if this
   server had it, the planned backups of `backup.env`;
4. once the new server answers, offers to **stop TasksPipes here for good** (its data stays here) and turns its
   planned backups off.

If anything fails on the way, the app starts again here and nothing changed here. Options: `--domain` when the
address changes, `--dir` on the new server (`/opt/taskspipes`), `--port` and `--identity` for SSH, `--keep-running`
to leave the app running here meanwhile (what changes after the backup is then not moved).

Then point the address to the new server in your DNS, and sign in there.

#### Step by step

The same, by hand:

1. On the current server, stop the app and back up:

   ```shell
   cd /opt/taskspipes && sudo docker compose stop app
   taskspipes-backup --no-upload
   ```

2. Copy the backup (its name was printed) to the new server:

   ```shell
   sudo scp /opt/taskspipes/backups/taskspipes-backup-….tar.gz.gpg admin@new-server:/tmp/
   ```

3. On the new server, install from it — the passphrase is asked when the backup is encrypted:

   ```shell
   curl -fsSL https://raw.githubusercontent.com/j33f/TasksPipes/main/scripts/install.sh | sudo bash -s -- \
     --restore /tmp/taskspipes-backup-….tar.gz.gpg
   ```

4. Point the address to the new server, check that everything is there, then stop the old one
   (`sudo docker compose stop` in its directory).

#### From S3, when the old server is gone

With a copy on S3-compatible storage, a new server starts from the latest backup there:

```shell
curl -fsSL https://raw.githubusercontent.com/j33f/TasksPipes/main/scripts/install.sh | sudo bash -s -- \
  --restore s3:latest
```

It asks where the backups are (endpoint, region, bucket, folder, keys) and their passphrase — or give them with
`--backup-env backup.env`, a copy of the old server's `backup.env`, or `--passphrase-file`. `s3:NAME` restores
another backup than the latest.

#### When the address changes

Give the new address with `--domain tasks.example.org` (to `taskspipes-transfer`, `install.sh --restore` or
`taskspipes-restore`): `APP_URL` and Caddy follow. Then, outside TasksPipes:

- the **Outline OAuth** application: redirect URL `https://<new address>/auth/outline/callback`;
- the **OpenID Connect** provider, if any: redirect URI `https://<new address>/auth/oidc/callback`;
- **GitHub and GitLab webhooks** of connected pipes call the old address: update them, or connect the pipes again;
- **calendar subscriptions** (`.ics` links) and installed apps: people subscribe or install again from the new
  address;
- **push notifications**: people turn them on again in Settings (a browser ties them to an address).

Links in e-mails sent before the move still point to the old address.

### Reference

| File | What it is |
| --- | --- |
| `backups/` | the backups (root only); `.last` names the latest |
| `backup.env` | the settings of the backups (root only, not read by the app) |
| `/etc/systemd/system/taskspipes-backup.timer` | when backups run (`/etc/cron.d/taskspipes-backup` without systemd) |

`backup.env`, written by `--setup`:

| Variable | Meaning |
| --- | --- |
| `BACKUP_SCHEDULE`, `BACKUP_AT` | `none`, `daily` or `weekly`; the time, `HH:MM` |
| `BACKUP_KEEP` | backups kept on the server |
| `BACKUP_PASSPHRASE` | encrypts them (empty: not encrypted) |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_REGION`, `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX` | where the copies go |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | the storage's keys |
| `BACKUP_S3_KEEP` | copies kept there |

The updater dumps the database before each one-click update; `BACKUP_BEFORE_UPDATE=false` in its environment turns
it off.

## Upgrading

The server checks every hour for a new release on GitHub: administrators are told by e-mail and push notification,
and the About dialog shows it (`UPDATE_CHECK=false` to turn it off). Read the release notes, then update — in one
click if the updater is set up (below), or by hand. The database schema is upgraded at start-up.

Installed with the installer, one command does it all:

```shell
taskspipes-update            # or: sudo /opt/taskspipes/scripts/update.sh
taskspipes-update --check    # only tell whether a new release exists
```

It backs the instance up first (`backups/`, the last five kept), moves to the latest release (`--version X` for
another one) — the published image, or the release's tag rebuilt from the sources — waits until the app is healthy,
and puts the previous version back if it is not.

By hand, without the installer:

With the published images, set the version in `.env` and restart:

```shell
sed -i 's/^TASKSPIPES_VERSION=.*/TASKSPIPES_VERSION=0.18.0/' .env   # or add the line
docker compose pull app && docker compose up -d app
```

Built from the sources:

```shell
git pull
docker compose up -d --build
```

## One-click updates

With the **updater** set up, an administrator updates the instance from the app: **About** shows the new version with
an **Update to …** button; the app restarts with it, and open pages reload by themselves once it answers.

### Setting it up

The [installer](#install-in-one-command) does it (`--updates auto`, the default). By hand:

1. Add to `.env` a shared secret, pin the version you run, and keep the `updater` profile on:

   ```shell
   UPDATER_TOKEN=…              # openssl rand -hex 32
   TASKSPIPES_VERSION=0.18.0
   COMPOSE_PROFILES=updater     # so that a plain `docker compose up -d` keeps the updater
   ```

2. Start the stack, from this directory:

   ```shell
   docker compose up -d
   ```

The app finds the updater at `http://updater:8080` (`UPDATER_URL` otherwise). The updater moves the app and itself to
the new version, but leaves the compose file as it is; when a release also changes `docker-compose.yml` (its notes say so, under **Upgrading**), update with
`taskspipes-update`, which fetches the release's compose file too. One-click updates use the images
published for each release on GitHub's registry (`ghcr.io/j33f/taskspipes`): an instance built from its sources
(`build:`) keeps updating by hand, or switches to the images by setting `TASKSPIPES_VERSION`.

### How it works

```
 Administrator ── About › "Update to 0.18.0" ──▶ app ── POST /update {"version":"0.18.0"} ──▶ updater ──▶ Docker
                                                   (admin, latest release only)  (Bearer UPDATER_TOKEN)
```

1. The app checks every hour for the latest release on GitHub (see [Upgrading](#upgrading)).
2. When an administrator clicks **Update to X**, the app checks that they are an administrator and that X is the
   latest release it found — no other version can be asked — then calls the updater with the shared token.
3. The **updater** (`updater/`, a small Node service with the Docker CLI) dumps the database into
   `backups/taskspipes-before-update-<version>-<date>.dump` (the last five kept; `BACKUP_BEFORE_UPDATE=false` in its
   environment to skip it; when it fails, nothing changes), writes `TASKSPIPES_VERSION=X` in `.env`, runs
   `docker compose pull app`, then `docker compose up -d --no-build app`, and waits for the app's health check.
4. If the image cannot be downloaded, `.env` is put back and nothing changes (**failed**). If the new version does
   not become healthy within `HEALTH_TIMEOUT` seconds (180), the previous version is put back in `.env` and started
   again (**rolled back**).
5. Meanwhile the About dialog follows the updater (`GET /api/admin/update`: state and last log line) and reloads
   once the server answers in the new version.
6. Once the app runs the new version, the **updater moves to it too**. It cannot restart its own container (that would
   stop the command doing it), so it pulls its new image and starts a short-lived container of it, detached, which
   runs `docker compose up -d --no-deps updater` and goes away; Compose recreates the updater only when its image
   changed. After a failed or rolled-back update it leaves itself alone. Its service is named by `UPDATER_SERVICE`
   (`updater` by default; empty to never touch itself). An updater older than 0.20.1 does not do it: once, move it
   by hand (`docker compose up -d updater`) or with `taskspipes-update`.

The database is migrated by the new version at start-up. Migrations are written to add (tables, columns) rather than
remove, so that the previous version keeps working after a rollback; back up the database before updating all the
same, especially across a major version.

### Security

- Only the **updater** holds the Docker socket — which amounts to root on the host — never the app. It is reachable on
  the compose network only (no published port), answers nothing without the token (compared in constant time), and
  takes nothing but a version number (`X.Y.Z`): it runs fixed commands, without a shell.
- The app only lets **administrators** (`ADMIN_EMAILS`) start an update, and only to the latest published release.
- The updater mounts this directory at the same path as on the host, so that Compose finds the same files; it
  changes nothing there but the `TASKSPIPES_VERSION` line of `.env`, and writes its backups in `backups/`.
- Without `UPDATER_TOKEN`, or without the `updater` profile, there is no one-click update and nothing holds the socket.

