# TasksPipes

[Français](README.fr.md)

Multi-user task management built around [Outline](https://github.com/outline/outline): sign in with your Outline
account, link Outline documents to tasks, in an interface that follows Outline's design system (tokens from
`shared/styles/theme.ts`, light and dark themes).

The interface is available in **English and French**: the language follows the browser and can be chosen in the
profile, as can a light or dark theme. The built-in catalog of pipe and task types is designed for French adult
training centres (Qualiopi, RNCP, OPCO…); its labels are translated, and the designer lets you build your own types.

## Features

- **Spaces**: everyone in the Outline workspace has a personal space; everyone else's is visible too.
  **Team spaces** are created by picking their members; governance is shared by promoting other members to *admin*
  (at least one admin always remains).
- **Pipes**: extended kanban boards with drag and drop. Each column belongs to a generic state — *Backlog, Ready to
  start, Started, In progress, Blocked, Done, Dropped* — which the dashboard, due dates and archiving rely on.
  - **Personal** / **Team** (private): only the person (personal space) or the team's members see it.
  - **Open** (public): everyone sees it; anyone can add tasks and comment, only the space's members move them forward.
  - Every personal space always has a **"Personal"** pipe (general tasks), which cannot be archived or deleted.
  - **Archiving**: an archived pipe leaves the lists, pickers and "My tasks", and takes no new tasks; it can still be
    viewed ("Show archived pipes") and unarchived.
  - **Types** for an adult training centre (`server/src/pipeTypes.ts`): general tasks, sales, prospecting,
    communication, instructional design, documentation, trainers & schedule, learner follow-up, disability follow-up
    (reserved to a team), quality & Qualiopi, admin & finance, and **processes** (recruitment / admission, session
    start, exams / certification, session end) that can fill the first column with their starter tasks.
    Each type has **its own columns** (e.g. sales: Request › Needs analysis › Quote sent › Negotiation ›
    Waiting for funding › Won / Lost).
- **Task types** specific to each pipe type (course design, opportunity, application, Qualiopi indicator, invoice…),
  with their fields: text, amount, choice list, date, RNCP / RS qualification (link to France Compétences), Outline
  documents, and **files** (syllabus, materials, quizzes…, 50 MB max per file, stored in the database).
- **Models** (designer): anyone can design pipe types (columns and their state, offered task types,
  confidentiality, starter tasks) and task types (fields, with a live preview), from scratch or from an existing
  model. A model starts private (seen and used by its author only), can be made public, and is filed in a category.
  Only its author changes it; a type in use cannot be deleted, and the kind of a saved field cannot change.
- **Owner**: a task in a personal space belongs to its holder, with no assignee; to hand it to someone, send it to
  their incoming. Only tasks in a team space have an owner, chosen among the team's members, including when sending
  them to the team.
- **Sub-tasks**: every task can hold a checklist (add on the fly, paste several lines to add several, rename,
  reorder by drag and drop); progress (3/5) shows on cards, and checking is recorded in the history.
- **My tasks**: everything assigned to me and still to do, across all pipes, grouped by state (in progress, blocked,
  ready, coming up) or by pipe.
- **Next action** (GTD): quick capture into "Personal", tasks in progress (check the next sub-task, finish), and a
  suggestion of the next task to start — late or due soon first, then ready, already begun or waiting for long — with
  "Start" or "Another suggestion". Beyond 3 tasks in progress, it suggests finishing one first.
- **Incoming bucket** for every person and team: it receives tasks sent by others. A member can **accept** them
  (choosing the pipe and column) or **refuse them with a reason**: the task then goes back to the sender's incoming.
- **Live updates**: a task sent or refused shows up at once for its recipients (WebSocket), with a "View"
  notification. The connection closes after 5 minutes of inactivity or 1 minute in the background, and reopens when
  the page is used again (data is then reloaded). The number of waiting tasks shows in the tab title and, on mobile,
  as a badge on the menu button.
- **Invitations by e-mail**: people without an Outline account (trainers, partners…) can be invited. They sign in
  with one-time links received by e-mail (7 days for an invitation, 20 minutes for a link asked from the sign-in
  page), and can add TOTP two-factor authentication (Google Authenticator), then asked at every sign-in (5 attempts
  per link). An invited account only sees the people who invited it and those it invited; Outline accounts do not
  see invited accounts, except those they invited themselves — and the member list of a team they share. Invited
  accounts only see their own teams and have no access to Outline.
- **Calendar subscription**: "My account" gives a personal link (iCalendar feed) to subscribe to one's tasks with a
  due date in Google Calendar, Apple Calendar or any calendar app; it can be reset if it leaks.
- **Several Outline servers**: the sign-in page can add other Outline servers and pick one (the list is kept in the
  browser); sign-in then uses an API key of that server. Accounts of one server see neither the people nor the
  teams of another.
- **History**: every change is recorded with the state before and after: place (pipe or incoming), column, owner,
  due date, linked Outline document, along with its comment.
- **Outline**: document search (or paste a URL), link / unlink, create an Outline document from a task.
- **Markdown** everywhere (descriptions, comments, refusal reasons, space and pipe descriptions) with a preview.

## Stack

| Layer | Technology |
| --- | --- |
| Front end | Svelte 5 (runes) + Vite, TypeScript, `marked` + `DOMPurify` |
| Back end | Fastify 5 (pino logger), TypeScript, Node 24 LTS, WebSocket (`@fastify/websocket`) |
| Data | PostgreSQL 17 (schema created at startup) |
| Hosting | Docker (multi-stage image) + docker compose |

## Deployment

1. Copy the configuration: `cp .env.example .env`, then set at least `APP_URL`, `APP_SECRET`
   (`openssl rand -hex 32`), `POSTGRES_PASSWORD` and `OUTLINE_URL`.
2. Choose how people sign in:
   - **OAuth (recommended)**: see [OAUTH-OUTLINE.md](OAUTH-OUTLINE.md).
   - **API key** (`ALLOW_API_KEY_LOGIN=true`): everyone pastes a personal API key created in Outline.
   - **Other Outline servers**: only public https servers are accepted (`OUTLINE_ALLOW_PRIVATE=true` for an internal
     one); `OUTLINE_ALLOWED_HOSTS` restricts the list. OAuth stays limited to the configured server.
   - **E-mail** (invited accounts): set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` to send
     invitations and sign-in links. Without SMTP, an invitation shows the link for the inviter to pass on.
3. Optionally set `DEFAULT_LOCALE` (`en` or `fr`), used when neither the browser nor the profile gives a language
   (e-mails, the default pipe of people imported from Outline).
4. `docker compose up -d --build`, then open `APP_URL`.

Put the application behind an HTTPS reverse proxy in production: with an `https://` `APP_URL`, cookies are `Secure`.
Outline tokens and TOTP secrets are encrypted in the database (AES-256-GCM) with `APP_SECRET`.

On first sign-in, the members of the Outline workspace are imported (`users.list`) so that tasks can be sent to
them before they ever sign in.

## Development

```bash
# Full stack with a fake Outline (API keys: alice-token, bob-token, carol-token)
docker compose --env-file dev/.env.dev -f docker-compose.yml -f dev/docker-compose.dev.yml up --build

# Or locally (Node 24):
cd server && npm install && OUTLINE_URL=… DATABASE_URL=… APP_SECRET=… npm run dev   # :3000
cd web && npm install && npm run dev                                                 # :5173, proxied to :3000
```

Checks: `npm run typecheck` (server), `npm run check` (web, svelte-check).

### Translations

Texts are written in English in the code and translated with `t("…")`:

- web app: `web/src/lib/i18n.svelte.ts`, French in `web/src/lib/locales/fr.ts`;
- server (error messages, e-mails): `server/src/i18n.ts`; the server answers in the language sent by the web app
  (`X-Locale` header), else the browser's (`Accept-Language`);
- the built-in catalog (`server/src/pipeTypes.ts`) is written in French and translated by
  `server/src/catalog-en.ts`; select options keep their stored (French) value and get a translated label.

A missing translation shows the source text. To add a language, add a dictionary and its code to `LOCALES` on both
sides.

## Access rules

| Action | Who |
| --- | --- |
| See a private pipe, a space's incoming | members of the space |
| See an open pipe, add a task to it, comment | everyone who can see its space |
| Move, change the column, assign, due date, document, send | members of the space holding the task |
| Edit title / description | members, or the author of a task in an open pipe |
| Refuse | members of the space whose incoming holds the task (unless they sent it themselves) |
| Manage a team (name, members, roles, deletion) | the team's admins |
| Add someone to a team, send them a task | team admins / members, among the people they can see |

Tasks are never deleted (to keep their history): they are moved to *Dropped*.

## License

TasksPipes is distributed under the [Business Source License 1.1](LICENSE), like Outline: you may use, modify and
host it, including for your own organisation, but not offer it as a commercial task management service to third
parties. On 2030-10-16 (the Change Date), the code becomes available under the Apache License 2.0. This is a
source-available license, not an OSI-approved open source license until that date.
