# Architecture

TasksPipes is a TypeScript application in two parts, built into a single Docker image:

```
server/   Fastify 5 API, Node 24 — also serves the built web app
web/      Svelte 5 single-page app, built with Vite
dev/      development stack: fake Outline server and compose overrides
docs/     documentation
.github/  continuous integration (see TESTING.md)
```

## Server

The server is a [Fastify](https://fastify.dev) application. It talks to PostgreSQL with `pg` and plain SQL, and to
Outline through its RPC-style API.

| File | Role |
| --- | --- |
| `app.ts` | Builds the Fastify app: error handler (translates errors), plugins, API, static files and the SPA fallback. |
| `index.ts` | Starts it: database migration, listening, periodic clean-up, report sending, graceful shutdown. |
| `config.ts` | Environment variables. |
| `db.ts` | Connection pool, the schema (applied at every start), SQL visibility functions, start-up data fixes. |
| `auth.ts` | Sessions, Outline sign-in (OAuth and API keys), e-mail sign-up, sign-in links and TOTP. |
| `outline.ts` | Outline API client, validation of other Outline servers (https, no internal addresses). |
| `routes.ts` | The JSON API under `/api`: spaces, pipes, tasks, sub-tasks, files, invitations, designer… |
| `access.ts` | Who may see and do what on a task (`taskPermissions`), shared by the API and the notifications. |
| `pipe-io.ts`, `csv.ts` | Export of a pipe's tasks (CSV, JSON) and their import (CSV with column mapping, Trello JSON), checked line by line; a CSV reader and writer without dependency. |
| `api.ts` | Personal access tokens and `/api/v1`: the app's own routes, those documented answering (OpenAPI with [@fastify/swagger](https://github.com/fastify/fastify-swagger), Swagger UI). |
| `webhooks.ts` | Outgoing webhooks of pipes: deliveries queued with the history, signed, sent and retried in the background. |
| `net.ts` | Requests to servers people choose (Outline servers, webhooks): internal addresses refused when connecting. |
| `recurrence.ts` | Recurring tasks: the dates of a rule, and the scheduler pass making each occurrence once. |
| `search.ts` | Global search: full text in PostgreSQL, the view rule of `taskPermissions` applied in the query. |
| `notifications.ts` | E-mail notifications: queued with the history, sent at once, in a daily digest or as morning due-date reminders; unsubscribe links. |
| `admin.ts` | Administrators of the instance (`ADMIN_EMAILS`), the account list, disabling and enabling accounts. |
| `account.ts` | One's data: the zip export, and the deletion of e-mail accounts (history moved to a placeholder account). |
| `zip.ts` | A small zip writer on `node:zlib`, for the export. |
| `rate-limit.ts` | Rate limits ([@fastify/rate-limit](https://github.com/fastify/fastify-rate-limit), opted in per route) with a growing block, counted in Redis (or in memory without `REDIS_URL`). |
| `pipeTypes.ts` | Built-in catalog of pipe and task types, and the custom types made with the designer. |
| `designer.ts` | Validation of custom pipe and task types. |
| `models-io.ts` | Export and import of models as YAML files. |
| `reports.ts`, `time.ts` | Time per step, daily and weekly reports (computed from the history), their e-mails and scheduled sending; local times and periods. |
| `git.ts` | GitHub / GitLab webhooks: task keys, signatures, what events mean (the routes are in `routes.ts`). |
| `fields.ts` | Validation of task field values. |
| `realtime.ts` | WebSocket at `/api/events`, notifying people of tasks sent to them or refused. |
| `calendar.ts` | iCalendar feed at `/cal/<token>.ics`. |
| `mail.ts`, `totp.ts` | E-mail sending (nodemailer) and TOTP codes. |
| `i18n.ts`, `catalog-en.ts` | Server-side translations (see [TRANSLATION.md](TRANSLATION.md)). |

## Web app

The web app is a [Svelte 5](https://svelte.dev) single-page app using runes, with no UI framework: its styles
follow Outline's design tokens (`web/src/app.css`).

| Path | Role |
| --- | --- |
| `App.svelte` | Routing, layout, theme and language on `<html>`, live updates. |
| `pages/` | Dashboard, my tasks, next action, spaces, pipe boards, models, sign-in. |
| `components/` | Dialogs (task, pipe, team, account…), sidebar, cards, fields, checklist, editors. |
| `lib/app.svelte.ts` | Shared state: the signed-in person, spaces, people, catalog, sidebar. |
| `lib/api.ts` | API client (sends the page's language). |
| `lib/i18n.svelte.ts`, `lib/locales/` | Translations, language and theme preferences. |
| `lib/realtime.svelte.ts` | WebSocket connection, closed when the page is idle. |

## Data model

| Table | Holds |
| --- | --- |
| `users`, `user_avatars` | Outline accounts (keyed by Outline server and id), e-mail accounts and the "GitHub" / "GitLab" system accounts that author automatic moves; the "Deleted account" placeholders (`auth_kind = 'deleted'`) that keep the history of deleted accounts; preferences; disabled accounts (`disabled_at`, `disabled_reason`, `disabled_by`); uploaded pictures. |
| `spaces`, `space_members` | Personal spaces (one per person) and team spaces, with roles. |
| `pipes`, `pipe_pins` | Pipes (type, visibility, archiving) and the pipes people pinned. |
| `tasks` | Tasks: place (space, pipe or incoming), column and generic status, owner, due date, type and field values. |
| `task_items`, `task_files` | Sub-tasks and files of tasks. |
| `task_events` | History of every task, with the state before and after each change. |
| `custom_types` | Pipe and task types made with the designer. |
| `report_runs` | Scheduled report and digest sendings already done (one per period). |
| `task_search` | The search index: one `tsvector` per task, kept up to date by triggers on tasks, sub-tasks and history. |
| `task_recurrences` | Recurring series (rule, mode, lead time, end, next date); tasks point to theirs (`recurrence_id`, `occurrence_on`, unique together). |
| `api_tokens` | Access tokens of the public API (hash, scope, expiry, revocation). |
| `pipe_webhooks`, `webhook_deliveries` | Outgoing webhooks of pipes (encrypted secret) and their deliveries, with attempts and answers. |
| `notifications` | E-mail notifications waiting, sent or dropped; people's choices are in `users.notification_prefs`. |
| `pipe_integrations`, `task_links` | Repositories connected to pipes (webhook token, encrypted secret), and the pull/merge requests and commits linked to tasks. |
| `sessions`, `login_tokens`, `invitations` | Sessions, e-mail sign-in links and TOTP steps, invitations and requests to connect (pending, accepted, refused). |

Ids are UUIDv7 (`gen_uuidv7()`), except for accounts of the configured Outline server, which keep their Outline id.

A task's **column** (`stage`) depends on its pipe type; its **status** is the generic state of that column, which
the rest of the application relies on. When a pipe type changes, tasks go to the column matching their status, or
the nearest one.

## Access

Who sees what is decided in SQL, so lists and single reads follow the same rules:

- `user_visible(viewer, target)`: oneself; Outline accounts of the same server; and people linked by an accepted
  invitation — never a disabled account.
- `space_visible(viewer, space)`: personal spaces of visible people; teams one belongs to, or, for an Outline
  account, the teams created by an account of the same server.

Permissions on a task (`taskPermissions` in `access.ts`) then depend on membership of its space and on the
visibility of its pipe. The search applies the same view rule in its SQL (`taskVisibleSql`); a functional test
checks that both agree.

## Search

`task_search` holds one `tsvector` per task: title, then field values and linked document, then description and
sub-tasks, then comments, by decreasing weight. Each text is indexed twice, with `tp_fr` and `tp_en`: copies of
PostgreSQL's French and English configurations that drop accents first (`unaccent`). A search uses the configuration
of the person's language, as a prefix query (`'plan':* & 'stag':*`) built from letters and digits only, so the
same index serves both languages.

Triggers on `tasks`, `task_items` and `task_events` (entries with a comment) rebuild a task's row when its text
changes. At start, tasks missing from the index, or indexed by an older `version` of `task_search_refresh`, are
indexed: changing what is indexed means changing that function and its version number.
