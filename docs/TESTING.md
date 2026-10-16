# Testing

TasksPipes is tested with [Vitest](https://vitest.dev) on both sides, at three levels:

| Suite | Where | What it covers | Needs |
| --- | --- | --- | --- |
| Server unit tests | `server/src/**/*.test.ts` | Pure modules: TOTP (RFC 6238 vectors), field validation, designer rules, the catalog and column resolution, translations, iCalendar text, internal address filtering. | Nothing |
| Server functional tests | `server/test/functional/*.test.ts` | The whole API on a real database, against the fake Outline of `dev/mock-outline.mjs`: sign-in and servers, tasks and history, incoming buckets, sub-tasks, pipes and archiving, teams and visibility, invitations and requests to connect, TOTP, avatars, models, calendar feed, live updates over WebSocket. | PostgreSQL |
| Web unit tests | `web/src/**/*.test.ts` | Translations and preferences, dates, history texts, the Next action suggestions, the API client, the version check, and components (checklist, badges, About) with Testing Library. | Nothing (jsdom) |

Translation checks run with the unit tests (`server/src/translations.test.ts`, `web/src/lib/locales/fr.test.ts`): every
text sent by the server or shown by the app must have its French version, no dictionary entry may be stale,
placeholders must match, French typography is checked, and every label of the built-in catalog needs its English
version. Add the translation when you add a text (see [TRANSLATION.md](TRANSLATION.md)).

## Running the tests

### Unit tests

```shell
cd server && npm test        # server unit tests
cd web && npm test           # web unit tests
```

`npm run test:watch` re-runs them on change.

### Functional tests

They need a disposable PostgreSQL database: **its schema is wiped** at the start of the run. The simplest way is
the test stack, which starts one in memory:

```shell
docker compose -f dev/docker-compose.test.yml run --rm tests
docker compose -f dev/docker-compose.test.yml down -v
```

Or point them to a database of your own:

```shell
cd server
TEST_DATABASE_URL=postgres://postgres:test@localhost:5432/taskspipes_test npm run test:functional
```

The fake Outline is started on port 4100 (`MOCK_OUTLINE_PORT` to change it). It knows three people, whose API keys
are `alice-token`, `bob-token` and `carol-token`; it answers on both `localhost` and `127.0.0.1`, which the tests
use as two different Outline servers.

Files run one after the other on the same database, so a test must not rely on another file having run, nor on the
database being empty: create what you need, and use addresses or names of your own.

## Coverage

Coverage is measured with the V8 provider:

```shell
cd server && npx vitest run --coverage                                     # → server/coverage/unit
cd server && npx vitest run -c vitest.functional.config.ts --coverage      # → server/coverage/functional
cd web && npx vitest run --coverage                                        # → web/coverage
```

Each run prints a summary and writes an HTML report (`index.html`) and an `lcov.info` file in its folder.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

1. **Server — types and unit tests**: `npm run typecheck`, then the unit tests with coverage;
2. **Server — functional tests**: against a PostgreSQL service, with coverage;
3. **Web — types, unit tests and build**: `svelte-check`, the unit tests with coverage, then `vite build`;
4. **Docker image**: builds the production image once the three jobs above pass.

Coverage reports are sent to [Codecov](https://about.codecov.io), one flag per suite (`server-unit`,
`server-functional`, `web`; see `codecov.yml`). Coverage is informational: it does not fail the build.

## Writing tests

- **Server unit tests** sit next to the module they test (`fields.ts` → `fields.test.ts`). The configuration only
  needs plausible environment values (`vitest.config.ts`); no database is reached.
- **Functional tests** use the helpers of `test/functional/helpers.ts`: `startApp()` builds the app in-process
  (`buildApp` from `src/app.ts`, without listening, unless a test needs a real port), `signIn("alice-token")` returns
  an agent with a session, `signInWithLink(link)` signs in an e-mail account with an invitation link (no SMTP in
  tests, so the API returns the link). Agents send JSON and a language (`agent(cookie, "fr")`).
- **Web tests** run in jsdom with the browser build of Svelte, so runes react as in the app. Render components with
  `@testing-library/svelte` and drive them with `@testing-library/user-event`. `prefs.set({ locale: "en" })` fixes
  the language of a test; reset it afterwards.
- Error messages are checked in their English source form on the server (`"{field}: invalid date"`), and in the
  language of the agent through the API.
