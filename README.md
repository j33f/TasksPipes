<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/logo-dark.svg" height="32">
    <source media="(prefers-color-scheme: light)" srcset="./docs/logo-light.svg" height="32">
    <img src="./docs/logo-light.svg" height="32" alt="TasksPipes" />
  </picture>
</p>
<p align="center">
  <i>Task pipes for teams that live in <a href="https://github.com/outline/outline">Outline</a>, built with Svelte and Node.js.<br/>
  Kanban boards, incoming buckets and a GTD view, signed in with your Outline account.</i>
</p>
<p align="center">
  <a href="http://www.typescriptlang.org" rel="nofollow"><img src="https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg" alt="TypeScript"></a>
  <a href="https://svelte.dev" rel="nofollow"><img src="https://img.shields.io/badge/Svelte-5-%23ff3e00.svg" alt="Svelte 5"></a>
  <a href="https://fastify.dev" rel="nofollow"><img src="https://img.shields.io/badge/Fastify-5-%23202020.svg" alt="Fastify 5"></a>
  <a href="docs/TRANSLATION.md"><img src="https://img.shields.io/badge/i18n-English%20%7C%20French-%233ad984.svg" alt="English and French"></a>
</p>

This is the source code of **TasksPipes**, a multi-user task manager built around [Outline](https://www.getoutline.com):
people sign in with their Outline account, link Outline documents to their tasks, and work in an interface that
follows Outline's look and feel.

- **Pipes** — kanban boards with their own columns, personal or shared with a team, private or open to everyone.
- **Incoming buckets** — send a task to someone or to a team; they accept it into a pipe or refuse it with a reason.
- **My tasks** and **Next action** — everything assigned to you across pipes, and a GTD view suggesting what to start next.
- **Task types and fields** — course design, sales opportunity, application… with dates, amounts, files and Outline documents.
- **Models** — design your own pipe and task types, from scratch or from an existing one.
- **Sub-tasks, history, live updates, calendar subscription**, guests invited by e-mail with two-factor authentication,
  English and French, light and dark themes.

The built-in catalog of pipe and task types is designed for French adult training centres (Qualiopi, RNCP, OPCO…).
See [the feature guide](docs/FEATURES.md) for the details.

# Installation

TasksPipes runs as a single container next to a PostgreSQL database, behind an HTTPS reverse proxy.

```shell
cp .env.example .env        # then set APP_URL, APP_SECRET, POSTGRES_PASSWORD and OUTLINE_URL
docker compose up -d --build
```

Please see the [hosting documentation](docs/HOSTING.md) for the configuration in production: sign-in with Outline
(OAuth or API keys), e-mail for invited guests, other Outline servers, language and security notes.

# Contributing

Bug reports and ideas are welcome in [GitHub issues](https://github.com/j33f/TasksPipes/issues). Before writing a
larger change, please open an issue to agree on the approach first.

Ways to help:

- [Translation](docs/TRANSLATION.md) into other languages
- Pipe and task types for other kinds of organisations
- Bugs, quality fixes and documentation

# Development

The quickest way to work on TasksPipes is the development stack, which comes with a fake Outline server
(sign in with the API keys `alice-token`, `bob-token` or `carol-token`):

```shell
docker compose --env-file dev/.env.dev -f docker-compose.yml -f dev/docker-compose.dev.yml up --build
```

Or run the two parts locally with Node 24:

```shell
cd server && npm install && OUTLINE_URL=… DATABASE_URL=… APP_SECRET=… npm run dev   # API on :3000
cd web && npm install && npm run dev                                                 # app on :5173, proxied to :3000
```

## Architecture

Please refer to the [architecture document](docs/ARCHITECTURE.md) for an overview of how the application is put
together: the server, the web app, the data model and how access is decided.

## Debugging

In development the server logs readable lines to the console; in production it writes JSON logs (pino), ready for
any log pipeline. Set `LOG_LEVEL=debug` for more detail. Session cookies, authorization headers and calendar tokens
are kept out of the logs.

## Checks

There is no automated test suite yet. Before submitting a change, run the type checks and try it on the
development stack:

```shell
cd server && npm run typecheck
cd web && npm run check        # svelte-check
```

## Migrations

The database schema lives in `server/src/db.ts` and is applied at every start. Changes are written to be
idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`…), so a new version upgrades the
database by simply starting.

# License

TasksPipes is [BSL 1.1 licensed](LICENSE), like Outline. It becomes Apache 2.0 licensed on 2030-10-16.
