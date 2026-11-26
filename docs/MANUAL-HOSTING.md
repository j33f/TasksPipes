# Hosting TasksPipes without Docker

The [Docker Compose setup](HOSTING.md) is the simplest way to run TasksPipes, and the only one with the installer,
one-click updates and the backup scripts. This guide is for running it straight on a server instead: Node.js,
PostgreSQL, a service manager and a reverse proxy you already run. For several instances (Kubernetes, a load
balancer), see [KUBERNETES.md](KUBERNETES.md).

Everything in [HOSTING.md](HOSTING.md) about configuration (variables, sign-in, e-mail…) applies as is; only how the
app is built, started and updated differs.

## What you need

- **Node.js 26** or later, and npm.
- **PostgreSQL** 15 or later (the Docker setup uses 17). The database account must be able to create the `pgcrypto`
  and `unaccent` extensions — or a superuser creates them beforehand (see below).
- Optional: **Redis**, for the rate limit counters (without it, they are kept in memory, per process).
- A reverse proxy serving **https** (Caddy, nginx…), which passes WebSocket upgrades through.

## Build

As an unprivileged user (here `taskspipes`, home `/opt/taskspipes`), get the sources of a release:

```shell
git clone https://github.com/j33f/TasksPipes.git /opt/taskspipes/app
cd /opt/taskspipes/app
git checkout v0.36.0          # the latest release: https://github.com/j33f/TasksPipes/releases

cd web && npm ci && npm run build && cd ..
cd server && npm ci && npm run build && npm prune --omit=dev && cd ..
```

The server finds the built web app (`web/dist`), the language files (`locales/`) and the guides it gives AI agents
(`docs/`) next to it: keep the repository's layout.

## Database

As the PostgreSQL superuser:

```sql
CREATE ROLE taskspipes LOGIN PASSWORD '…';
CREATE DATABASE taskspipes OWNER taskspipes;
\c taskspipes
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

The schema is created, and brought up to date by each new version, when the server starts.

## Configuration

Put the variables in a file only the service can read, e.g. `/etc/taskspipes/env` (mode `600`):

```shell
NODE_ENV=production
# Behind a proxy on this machine: listen on the loopback only (see below).
HOST=127.0.0.1
PORT=3000
APP_URL=https://tasks.example.com
APP_SECRET=…                  # openssl rand -hex 32 — keep it: it opens the secrets stored in the database
DATABASE_URL=postgres://taskspipes:…@127.0.0.1:5432/taskspipes
# REDIS_URL=redis://127.0.0.1:6379
```

Then the rest of what you need from [the configuration table](HOSTING.md#configuration): e-mail, Outline, company
sign-in… (most can also be set in the app, *Administration › Settings*).

> **`HOST=127.0.0.1` matters.** The app trusts the client address the proxy sends (`X-Forwarded-For`), for its logs
> and rate limits. Reached directly, a client could forge it. Listen on the loopback, or let only the proxy reach the
> port (firewall).

## Service (systemd)

`/etc/systemd/system/taskspipes.service`:

```ini
[Unit]
Description=TasksPipes
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=taskspipes
Group=taskspipes
WorkingDirectory=/opt/taskspipes/app/server
EnvironmentFile=/etc/taskspipes/env
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=5

# Hardening: the app writes nothing on disk (files and pictures are in the database).
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
```

```shell
sudo systemctl daemon-reload
sudo systemctl enable --now taskspipes
journalctl -u taskspipes -f        # "TasksPipes ready" once started
curl -s http://127.0.0.1:3000/healthz
```

`/livez` answers as long as the process runs; `/healthz` also reaches the database.

## Reverse proxy

**Caddy** (https certificates included):

```
tasks.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

**nginx** — the WebSocket of live updates (`/api/events`) needs the upgrade headers:

```nginx
server {
  listen 443 ssl http2;
  server_name tasks.example.com;
  # ssl_certificate … ssl_certificate_key …
  client_max_body_size 30m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 1h;
  }
}

# In the http block:
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```

## Updating

Administrators are told of each new release (e-mail, *About*), but there is no one-click update without Docker:

```shell
cd /opt/taskspipes/app
git fetch --tags && git checkout v0.36.0       # the new release
cd web && npm ci && npm run build && cd ..
cd server && npm ci && npm run build && npm prune --omit=dev && cd ..
sudo systemctl restart taskspipes
```

Back up first (below). The database is brought up to date when the server starts; read the release notes for
anything to do by hand.

## Backups

The backup scripts of the Docker setup (`taskspipes-backup`…) need Docker. Without it, back up two things:

- the **database**, with everything in it (tasks, files, pictures, settings):
  `pg_dump -Fc -U taskspipes taskspipes > taskspipes-$(date +%F).dump` (e.g. daily, from a systemd timer or cron);
- the **configuration** (`/etc/taskspipes/env`), above all `APP_SECRET`: without it, the secrets kept in the database
  (Outline tokens, two-factor keys, settings) cannot be read.

To restore: stop the service, `pg_restore --clean --if-exists -d taskspipes taskspipes-….dump`, put the configuration
back, start the service.

The *Backups* tab of the administration only follows the backups made by the Docker scripts: here, it shows none.
