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
| `index.ts` | Starts it: database migration, listening, periodic clean-up, graceful shutdown. |
| `config.ts` | Environment variables. |
| `db.ts` | Connection pool, the schema (applied at every start), SQL visibility functions, start-up data fixes. |
| `auth.ts` | Sessions, Outline sign-in (OAuth and API keys), e-mail sign-up, sign-in links and TOTP. |
| `outline.ts` | Outline API client, validation of other Outline servers (https, no internal addresses). |
| `routes.ts` | The JSON API under `/api`: spaces, pipes, tasks, sub-tasks, files, invitations, designer… |
| `pipeTypes.ts` | Built-in catalog of pipe and task types, and the custom types made with the designer. |
| `designer.ts` | Validation of custom pipe and task types. |
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
| `users`, `user_avatars` | Outline accounts (keyed by Outline server and id) and e-mail accounts; preferences; uploaded pictures. |
| `spaces`, `space_members` | Personal spaces (one per person) and team spaces, with roles. |
| `pipes`, `pipe_pins` | Pipes (type, visibility, archiving) and the pipes people pinned. |
| `tasks` | Tasks: place (space, pipe or incoming), column and generic status, owner, due date, type and field values. |
| `task_items`, `task_files` | Sub-tasks and files of tasks. |
| `task_events` | History of every task, with the state before and after each change. |
| `custom_types` | Pipe and task types made with the designer. |
| `sessions`, `login_tokens`, `invitations` | Sessions, e-mail sign-in links and TOTP steps, invitations and requests to connect (pending, accepted, refused). |

Ids are UUIDv7 (`gen_uuidv7()`), except for accounts of the configured Outline server, which keep their Outline id.

A task's **column** (`stage`) depends on its pipe type; its **status** is the generic state of that column, which
the rest of the application relies on. When a pipe type changes, tasks go to the column matching their status, or
the nearest one.

## Access

Who sees what is decided in SQL, so lists and single reads follow the same rules:

- `user_visible(viewer, target)`: oneself; Outline accounts of the same server; and people linked by an accepted
  invitation.
- `space_visible(viewer, space)`: personal spaces of visible people; teams one belongs to, or, for an Outline
  account, the teams created by an account of the same server.

Permissions on a task (`taskPermissions` in `routes.ts`) then depend on membership of its space and on the
visibility of its pipe.
