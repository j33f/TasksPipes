# Contributing to TasksPipes

Thanks for taking the time to help. Bug reports, ideas, translations and pull requests are all welcome. If you are
new to the project, the [README](README.md) explains what TasksPipes is and how it is put together.

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- [Translation](docs/TRANSLATION.md) into other languages
- Pipe and task types for other kinds of organisations
- Bugs, quality fixes and documentation

## Reporting bugs and ideas

Open a [GitHub issue](https://github.com/j33f/TasksPipes/issues). For a bug, say what you did, what you expected and
what happened, with the version (see the footer, or `server/package.json`) and any relevant logs.

**Before a larger change, please open an issue first** so we can agree on the approach — it saves you building
something that turns out not to fit.

**Security issues:** please do not open a public issue. Report them privately through GitHub's *Report a
vulnerability* button on the [Security tab](https://github.com/j33f/TasksPipes/security), so a fix can ship before
the details are public.

## Development setup

The quickest way to work on TasksPipes is the development stack, which runs the server, the web app, PostgreSQL and
a fake Outline server (sign in with the API keys `alice-token`, `bob-token` or `carol-token`):

```shell
docker compose --env-file dev/.env.dev -f docker-compose.yml -f dev/docker-compose.dev.yml up --build
```

Or run the two parts locally with **Node 24**:

```shell
cd server && npm install && OUTLINE_URL=… DATABASE_URL=… APP_SECRET=… npm run dev   # API on :3000
cd web && npm install && npm run dev                                                 # app on :5173, proxied to :3000
```

See the [architecture document](docs/ARCHITECTURE.md) for how the server, the web app, the data model and access
control fit together, and the [hosting documentation](docs/HOSTING.md) for the production configuration.

## Project layout

| Path | What it holds |
| --- | --- |
| `server/` | the Fastify API (TypeScript); the schema lives in `server/src/db.ts` |
| `web/` | the Svelte web app (TypeScript, Vite) |
| `locales/` | one `<code>.json` per language ([translation guide](docs/TRANSLATION.md)) |
| `docs/` | architecture, hosting, testing, translation and feature documentation |
| `dev/` | development and test Compose files, and the fake Outline server |
| `scripts/` | the installer and update script for servers (`install.sh`, `update.sh`), and the release helper |
| `updater/` | the optional service behind one-click updates ([hosting guide](docs/HOSTING.md#one-click-updates)) |

There is no root `package.json`: `server` and `web` are installed and run separately.

## Running the tests

Unit tests (server and web) and functional tests (the whole API on PostgreSQL, against the fake Outline) run with
Vitest. GitHub Actions runs them on every push and pull request; please make sure they pass locally first.

```shell
cd server && npm test                                          # server unit tests
cd web && npm test                                             # web unit tests
docker compose -f dev/docker-compose.test.yml run --rm tests   # server functional tests
```

The server also has `npm run typecheck`, and the web app `npm run check` (svelte-check); both must pass. More detail
is in the [testing documentation](docs/TESTING.md).

## Coding conventions

- **TypeScript throughout.** Keep `npm run typecheck` (server) and `npm run check` (web) clean.
- **Match the surrounding code** — its naming, comment density and idioms — rather than introducing a new style.
- **Cover behaviour with tests.** A bug fix is clearest as a failing test that your change makes pass.
- **User-facing text is translatable.** Wrap new strings in `t()` (web) or `tr()` (server) and add them to
  `locales/`; `locales/fr.json` must stay complete. See the [translation guide](docs/TRANSLATION.md).
- **Migrations are idempotent.** Schema changes in `server/src/db.ts` use `IF NOT EXISTS` / `ADD COLUMN IF NOT
  EXISTS` so that starting a new version upgrades the database on its own.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org): a `type(scope): summary` subject, with an
optional body explaining the why, and `!` for a breaking change.

```
feat(webhooks): post task events to Discord channels
fix(invitations): match only trusted addresses when inviting by e-mail
docs: explain the language-matching rules
test: stop shared-database state leaking between functional files
```

Common types are `feat`, `fix`, `docs`, `test`, `refactor`, `chore` and `ci`. Keep each commit focused.

## Pull requests

- **Target the `dev` branch.** `dev` is where changes integrate; `main` holds releases only.
- Branch from `dev`, keep the pull request to **one focused change**, and update tests and documentation alongside
  the code.
- All CI checks must be green: server unit and functional tests, the web build, CodeQL, GitGuardian and the Docker
  image build.
- Pull requests are squash-merged into `dev`, so the subject follows Conventional Commits too.

## Releases (maintainers)

Versions follow [semver](https://semver.org). To cut a release from `dev`:

```shell
node scripts/release.mjs 0.12.0     # sets the version in both packages, both lockfiles and the LICENSE
git commit -am "chore(release): 0.12.0"
```

Then fast-forward `main` to `dev`, tag the release, and push:

```shell
git checkout main && git merge --ff-only dev
git tag -a v0.12.0 -m "TasksPipes 0.12.0"
git push origin main dev v0.12.0
```

The tag publishes the images (`ghcr.io/j33f/taskspipes`, `ghcr.io/j33f/taskspipes-updater`; amd64 and arm64) once
CI passes. Finally create the [GitHub release](https://github.com/j33f/TasksPipes/releases) for the tag — instances,
the installer and `taskspipes-update` all look for the **latest release**, so a tag without one is never offered —
with notes grouped into **Features**, **Security**/**Fixes** and **Upgrading** (database and environment-variable
changes). A test fails if
the LICENSE and the package versions disagree, so the whole set is bumped together.

## License of contributions

TasksPipes is licensed under the [Business Source License 1.1](LICENSE); it becomes Apache 2.0 on 2030-10-16. By
contributing, you agree that your contributions are provided under those same terms.
