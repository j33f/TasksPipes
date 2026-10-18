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
  <a href="docs/TRANSLATION.md"><img src="https://img.shields.io/badge/i18n-English%20%7C%20French%20%7C%20Spanish-%233ad984.svg" alt="English, French and Spanish"></a>
  <a href="https://github.com/j33f/TasksPipes/actions/workflows/ci.yml"><img src="https://github.com/j33f/TasksPipes/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/j33f/TasksPipes"><img src="https://codecov.io/gh/j33f/TasksPipes/graph/badge.svg" alt="Coverage"></a>
</p>

This is the source code of **TasksPipes**, a multi-user task manager built around [Outline](https://www.getoutline.com):
people sign in with their Outline account, link Outline documents to their tasks, and work in an interface that
follows Outline's look and feel.

- **Pipes** — kanban boards with their own columns, personal or shared with a team, private or open to everyone.
- **Incoming buckets** — send a task to someone or to a team; they accept it into a pipe or refuse it with a reason.
- **My tasks** and **Next action** — everything assigned to you across pipes, and a GTD view suggesting what to start next.
- **Task types and fields** — course design, sales opportunity, user story, bug… with dates, amounts, files and Outline documents.
- **Software teams** — UX research, UI design, product documentation, translation, development and QA pipes, with
  [GitHub and GitLab integration](docs/GIT-INTEGRATION.md): pull/merge requests naming a task move it to review,
  then to done when merged.
- **Personal life** — chores (flat share, couple, family), moving house, shared custody, home improvement, party
  planning, job search, house hunting, health care, paperwork and trips, with shared expenses and starter tasks.
- **Models** — design your own pipe and task types, from scratch or from an existing one, and share them as
  [YAML files](docs/MODELS.md).
- **Calendar** — subscribe to your tasks with a due date in Google Calendar, Apple Calendar or any calendar app,
  with reminders five days before, the day before and on the day.
- **Your Outline workspace, ready** — once connected to Outline, everyone in the workspace is there straight away:
  invite the colleagues who have not signed in yet, and send them tasks or build teams with them once they have.
- **Any Outline server** — you type the address of your Outline server when signing in; it is then remembered in
  your browser, and you can switch between several servers.
- **Without Outline too** — anyone can create an account with just an e-mail address and a display name, sign in
  with links sent by e-mail (optionally with two-factor authentication) and set a profile picture.
- **Invitations and connections** — invite people by e-mail (trainers, clients, partners…): a new person gets a
  sign-in link, someone already on TasksPipes gets a request they accept or refuse. Once connected, you see each
  other in the app; the rest of the workspace does not see them, unless you add them to a team.
- **Time and reports** — time spent in each step of a task, a daily activity report per pipe and a weekly time
  report per task type for development pipes, readable in the app and sent by e-mail at 18:00 if asked.
- **Notifications by e-mail** — tasks sent to you, given to you or refused, comments and due dates, at once, in a
  daily digest or not at all, as each person chooses.
- **Recurring tasks** — every day, chosen weekdays, a day or the first Monday of the month, the last business day,
  every year…, at fixed dates (made ahead if wanted) or once the previous one is done.
- **Search** — every task you can see, by text, field values, comments or number (`TP-123`), from the sidebar
  or with Ctrl/⌘ + K, filtered by status, owner and task type.
- **Import and export** — a pipe's tasks as CSV or JSON, fields included; import a CSV file (columns matched,
  previewed, checked line by line) or a Trello board.
- **API and webhooks** — personal access tokens for a documented API (`/api/v1`, OpenAPI and Swagger UI), and
  signed webhooks sending a pipe's task events to your tools.
- **Your data, your account** — download everything about you as a zip, delete your e-mail account (the history
  keeps a “Deleted account”), and administrators of the instance can disable accounts.
- **Sub-tasks, history, live updates**, English, French and Spanish (a language is one file), light and dark themes.

TasksPipes was designed for an adult training centre, and its built-in pipe and task types follow that world:
course design, admissions, exams, Qualiopi quality, funding… But nothing ties it to training: the general,
sales, prospecting, communication and admin pipes fit any business, the software pipes fit product teams, the
personal life pipes and the Next action view make it a good household and personal to-do list, and the designer lets you create the
pipe and task types you need.
See [the feature guide](docs/FEATURES.md) for the details.

# Installation

TasksPipes runs as a single container next to a PostgreSQL database, behind an HTTPS reverse proxy.

```shell
cp .env.example .env        # then set APP_URL, APP_SECRET and POSTGRES_PASSWORD
docker compose up -d --build
```

Please see the [hosting documentation](docs/HOSTING.md) for the configuration in production: sign-in with Outline
(OAuth or API keys), e-mail accounts and invitations, language and security notes.

# Contributing

Bug reports and ideas are welcome in [GitHub issues](https://github.com/j33f/TasksPipes/issues). Before writing a
larger change, please open an issue to agree on the approach first. Pull requests need passing tests (see
[testing](docs/TESTING.md)), and commit messages follow [Conventional Commits](https://www.conventionalcommits.org)
(`feat:`, `fix:`, `docs:`, `test:`…).

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

## Tests

Unit tests (server and web) and functional tests (the whole API on PostgreSQL, against a fake Outline) run with
Vitest, with coverage; GitHub Actions runs them on every push. See the [testing documentation](docs/TESTING.md).

```shell
cd server && npm test                                          # server unit tests
cd web && npm test                                             # web unit tests
docker compose -f dev/docker-compose.test.yml run --rm tests   # server functional tests
```

## Releases

Versions follow [semver](https://semver.org). To release, set the version everywhere it appears — the server and
web packages, and the Licensed Work of the [LICENSE](LICENSE) — then commit and tag:

```shell
node scripts/release.mjs 0.5.0
git commit -am "chore(release): 0.5.0" && git tag -a v0.5.0 -m "TasksPipes 0.5.0"
```

A test fails if the LICENSE and the packages disagree.

## Migrations

The database schema lives in `server/src/db.ts` and is applied at every start. Changes are written to be
idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`…), so a new version upgrades the
database by simply starting.

# License

TasksPipes is [BSL 1.1 licensed](LICENSE), like Outline. It becomes Apache 2.0 licensed on 2030-10-16.
