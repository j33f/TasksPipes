# Features

> This guide is also online at [doc.taskspipes.com](https://doc.taskspipes.com) (and the project at [taskspipes.com](https://taskspipes.com)).

TasksPipes was designed for an adult training centre, but fits other uses just as well:

- **Training centres** — the built-in types cover course design, admissions, session starts, exams, learner and
  disability follow-up, Qualiopi quality, funding and invoicing.
- **Business** — sales (quotes, negotiation, won / lost), prospecting, communication and admin pipes, with fields for
  clients, amounts and documents, and incoming buckets to pass work between people and teams.
- **Software teams** — UX research, UI design, product documentation, translation / i18n, R&D, software development
  and QA pipes, with user stories, bugs, experiments, mock-ups, translation batches, releases and test campaigns, and the
  [GitHub / GitLab integration](GIT-INTEGRATION.md).
- **Personal organisation** — a Personal pipe in every space, *My tasks* across all pipes, a GTD *Next action* view,
  a calendar view, sub-tasks and a calendar subscription with reminders, and [personal life](#pipe-types) pipes for the household,
  moving house, shared custody, home improvement, parties, job and house hunting, health care, paperwork and trips.

Other needs are covered by the [models](#models): design your own pipe and task types.

## People

Once TasksPipes is connected to Outline, everyone in the Outline workspace is there straight away, imported at the
first sign-in. Colleagues who have not signed in to TasksPipes yet show greyed out: they get no task, join no team
and get no e-mail until they sign in once. **Invite** them from the sidebar or their page: they get an e-mail asking
them to sign in with their Outline account (on their Outline server), or, when the instance sends no e-mail, the
link to give them is copied.

When the instance is connected to its Outline server with OAuth, the sign-in page needs no address: "Continue with
Outline" signs you in on that server. Otherwise, or for an API key on another server, you type the address of your
Outline server; it is kept in your browser for next time, and you can add others and switch between them. Each server keeps its own people and teams: accounts of one server do not
see those of another.

You can also use TasksPipes [without Outline](#e-mail-accounts), and [invite people by e-mail](#invitations-and-connections):
once connected, you see each other in the app and can send each other tasks.

**Company sign-in (OpenID Connect)** — with a provider set up on the instance (Keycloak, Okta, Entra ID, Google
Workspace, Authentik…), the sign-in page offers *Continue with …*: authorization code with PKCE, the ID token checked
against the provider's keys. The first sign-in creates the account (no Outline features, like an e-mail account),
unless an e-mail account has the address and the provider vouches for it (`email_verified`): that account is then
linked and kept, with its tasks and teams. `OIDC_ALLOWED_DOMAINS` can limit the addresses. An account with a second
factor still asks for it. People signing in this way see others once connected (invitations), as e-mail accounts do.
Such an account is disabled by an administrator, not deleted from the app.

## Spaces

Everyone has a **personal space**; the personal spaces of the people you can see are visible too. **Team spaces** are
created by picking their members. Governance is shared by promoting other members to *admin*; a team always keeps
at least one admin.

A team's **colour** (its avatar's) is one of Outline's palette or any other: its admins change it from the avatar at the
top of the team's page, or in its settings.

## Pipes

Pipes are extended kanban boards with drag and drop. Each column belongs to a generic state — *Backlog, Ready to
start, Started, In progress, Blocked, Done, Dropped* — which the dashboard, due dates and archiving rely on.

**Dropping a task on a pipe of the sidebar** passes it on: to a pipe of the same space, it moves there (its first
column); to a pipe of another space, it is sent to that space's incoming once you confirm — its members are told,
and accept or refuse it. A confidential task cannot leave its space.

- **Personal** / **Team** (private): only the person, or the team's members, see the pipe.
- **Open** (public): everyone sees it; anyone can add tasks and comment, only the space's members move them forward.
- Every personal space has a **Personal** pipe for general tasks, which cannot be archived or deleted.
- **Work in progress limits**: a column of a pipe type can have a limit (in the designer); its header shows
  `tasks / limit` and turns red once the column holds more tasks. The limit only warns, it never blocks a move.
- **Swimlanes**: a board can show one row of columns per owner (team pipes) or per task type, remembered in the
  browser. Dropping a task in another lane gives it that lane's owner or type.
- **Archiving**: an archived pipe leaves the lists, pickers and "My tasks", and takes no new tasks. It can still be
  viewed and unarchived. A pipe can be archived once all its tasks are done or dropped.
- **Linked documents**: a pipe holds links to its documents (specification, brief, mock-ups, repository…), shown
  under its description. Its members add them by choosing where the document lives, among the sources fitting the
  pipe type — GitHub, GitLab and Figma first for development, Figma, Miro and Canva for design, Outline, Google Docs,
  OneDrive / SharePoint, Dropbox, Notion, Confluence… — or any other address. **Outline** (when it is on, for
  Outline accounts) is searched like for tasks, and a document can be **created in an Outline collection** from the
  pipe: titled like it, with its description and a link back. Other sources take the document's address, whose
  source is recognised and shown with its icon. Up to 50 links per pipe; Outline documents are hidden while Outline
  is turned off.

### Pipe types

Each pipe has a type, with its own columns, task types and starter tasks. The built-in catalog
(`server/src/pipeTypes.ts`) is designed for adult training centres: general tasks, sales, prospecting,
communication, instructional design, documentation, trainers & schedule, learner follow-up, disability follow-up,
quality & Qualiopi, admin & finance, and processes (recruitment / admission, session start, exams / certification,
session end) that can fill their first column with starter tasks.

The *Software* group covers product teams: UX research, UI design, product documentation, translation / i18n,
R&D (hypotheses, experiments and prototypes), software development (with an *In review* column), **Sprint**
(software development in [sprints](#sprints)) and testing / QA. R&D, software development and Sprint pipes get the
weekly time report.

The *Personal life* group covers everyday life: chores in a flat share, as a couple or as a family (who does it,
room, frequency, points for the kids), moving house, shared custody (swaps agreed with the other parent), home
improvement (projects, quotes, supplies), party planning (guests and their answers), job search (one card per
offer), house hunting (listings and viewings), health care (appointments, treatments, refunds), paperwork & budget
(contracts and subscriptions with their renewal dates) and trips (bookings). Shared expenses can be tracked in the
household, custody, party and trip pipes. Shared custody, job search, house hunting, health care and paperwork
pipes are confidential.

- **Confidential** types (learner follow-up, and personal life types holding private data) are always private.
- **Team-only** types (disability follow-up) exist only in team spaces; their tasks cannot be sent or moved out of
  the team, and people who leave the team lose access to them, even as authors.

### Task types

Pipe types offer task types with their own fields: short and long text, number, amount, date, link, e-mail, phone,
choice list, multiple choices, checkbox, person, RNCP / RS qualification (linked to France Compétences), Outline
documents and files (50 MB max per file, stored in the database).

### Models

Anyone can design pipe types (columns and their state, offered task types, confidentiality, starter tasks) and task
types (fields, with a live preview), from scratch or from an existing model. A model starts **private** — seen and
used by its author only — and can be made **public**; it is filed in a category. Only its author can change it.
A type in use cannot be deleted, and the kind of a saved field cannot change.

Models can be **exported and imported as YAML files**, to share them between instances or keep them under version
control (see [model files](MODELS.md)).

Each person can **turn off** the pipe types they do not need (all but *General tasks*): they are no longer offered
when creating a pipe, and the task types offered only by turned-off pipe types are turned off too. Existing pipes of
those types keep working. This is a personal choice: others still see every type.

## Tasks

- **Owner**: a task in a personal space belongs to its holder; to hand it to someone, send it to their incoming. In a
  team space, the owner is chosen among the team's members.
- **Sub-tasks**: a checklist inside the task. Paste several lines to add several items, rename, reorder by drag and
  drop; progress shows on cards.
- **History**: every change is recorded with the state before and after — place, column, owner, due date, linked
  document, fields, files, checked items — and its comment. Tasks are never deleted, they are moved to *Dropped*.
- **GitHub / GitLab**: a pipe connected to repositories links the pull/merge requests and commits naming a task (its key,
  `TP-123`) and moves the task along: in progress for a draft, in review for an open request, done when merged. See
  [the integration guide](GIT-INTEGRATION.md).
- **Outline**: search documents or paste a URL, link and unlink, or create an Outline document from a task.
- **Markdown** in descriptions, comments and refusal reasons, with a preview.
- **@mentions** in comments, descriptions and refusal reasons: typing `@` suggests the people who can open the task
  (among those you see), and the mention shows as a link to their space. The person mentioned is told at once in
  the app, and by e-mail if they are not in the app then; in a description, only people newly mentioned are told.
  Mentioning someone who cannot open the task tells them nothing.
- **Priority** of any task: *urgent*, *high*, *medium*, *low* or none, shown as a colored flag on cards and lists.
  (The *Priority* field of user stories became this priority: its values were copied once.)
- **Points** of any task, for its complexity: a value of the planning poker scale — 0, 1, 2, 3, 5, 8, 13, 21, 40,
  100 — or none. A card shows them in a small badge; once a task of a pipe has points, each column's header adds up
  those of the tasks shown, and the filters offer them. Set like the priority, kept in the history, copied to the next
  task of a series, exported, imported (rounded up to the scale: 4 gives 5), sent with webhooks and through MCP.
  (The *Points* field of user stories and technical tasks became these points: its values were copied once, rounded
  up; the *Points / reward* field of household chores stays a field.)
- **Labels** of a space (*a space's page › Labels*): a name, unique in the space, and a color. Members of the space
  create, rename, recolor and delete them; a task gets labels of its space only, and loses them when it is sent to
  another space (noted in its history). Priority and labels are set by those who edit the task's fields, recorded in
  its history, copied to the next task of a series, exported with the pipe and sent with webhooks.
- **Estimate and logged time**: a task's *Time* section holds its estimate (typed as `2h30`, `1.5` or `45min`) and
  the time logged by hand — who, which day (today or one of the last 90 days), how long, an optional note — with
  its total against the estimate (red once over), also shown on cards. Those who edit the task's fields set the
  estimate and log their own time; an entry is changed by its author, and deleted by its author or an admin of the
  task's team (noted in the history). Whoever sees the task sees its entries. The time computed per step stays
  beside it. Logged time counts in the **weekly report** (per person and per task, against estimates; durations
  only in the e-mail), the pipe export (in hours) and one's data export.
- **Filters**: a pipe filters its tasks by text, label, priority, points, owner and task type; *My tasks* by label and
  priority, and groups them by priority too; the search filters by label (by name, across spaces) and priority.
- **Dependencies**: a task can wait for other tasks (*Dependencies › Add a task it waits for*), from any space or
  pipe, among the tasks you can open; loops are refused. While one of them is not done (or dropped), the task shows
  *Blocked* on its card and in its page, which also lists the tasks it blocks. Moving a blocked task on (started,
  in progress, done) asks for confirmation and is noted in its history. Once the last one is finished, the task's
  owner and author are told, in the app at once and by e-mail if they are not in the app then. A linked task someone
  cannot open shows them only its title and owner, without a link; a confidential or team-only one shows as *Task not
  accessible*. Those who may edit the task can unlink any task it waits for, even one they cannot open.
- **Repeat** — recurring tasks (a task in a pipe, for those who manage it): a new task is made on each date of a rule —
  - every *n* days;
  - every *n* weeks, on chosen days;
  - every *n* months, on a day of the month (the 31st falls on the last day of shorter months), on the first,
    second, third, fourth or last weekday (*the first Monday*, *the last Friday*), or on the last business day
    (Monday to Friday; public holidays are not known);
  - every *n* years, on the task's date (29 February on the 28th in other years);

  until an optional end date. **At fixed dates**, each task is made on its date or a chosen number of days ahead
  (up to 90), whatever happens to the previous one; dates missed while the instance was off are skipped but the
  latest. **Once the previous one is done**, the next is made as soon as it is done (or dropped), for the first date
  still to come. Each new task copies the latest one — title, description, type, fields, owner, linked document and
  sub-tasks (unchecked) — in the first column, due on its date, and is recorded like any creation (notifications,
  webhooks). The task shows the rule in words and the next dates; stopping the repetition keeps the tasks made. A
  series stops by itself when its pipe is archived.

## Sprints

Pipes whose type works in sprints — the built-in *Sprint* type, or a model with *Work in sprints* checked in the
designer — plan their tasks in sprints of a few weeks.

- **Settings** (*Edit the pipe › Sprints*): the length of a sprint (1 to 4 weeks), the day it starts, the days
  worked, and the velocity: learned from the last sprints, or set by hand (points per sprint, also used until
  enough sprints are closed).
- **A sprint** has a name (*Sprint 1*, *Sprint 2*… by default), a goal and dates: a new one follows the last one,
  or starts on the next start day. It is *planned*, then *under way* — one at a time per pipe: starting it commits
  the points of its tasks — then *closed*. Closing it keeps the points done and a short report (committed, done,
  carried over, dropped); its unfinished tasks go to the next sprint (made if there is none) or back to the backlog.
  Only a planned sprint can be deleted (its tasks go back to the backlog). A closed sprint can be marked
  *exceptional* (holidays, an incident…), to leave it out of the learned velocity.
- **The board** shows the sprint under way by default, under a banner: its dates, goal, day of work, points done
  out of planned, against the velocity, and the tasks still without points. A selector shows another sprint, all of
  them, or the backlog (tasks in no sprint). A task added while a sprint is shown goes in it.
- **Planning** (a view beside *Board* and *Agenda*): the backlog beside the sprints still open, with their points
  against the velocity. Tasks go from one to another by drag and drop or with their *Sprint* menu (on a phone too),
  and their points are set there. A task's page also offers its sprint.
- **Velocity**: set by hand, or learned from the last 6 closed sprints, as points done per week (sprints of other
  lengths compare): the sprints marked exceptional are left out, and so are outliers (a modified z-score above 3.5:
  0.6745 × distance to the median ÷ median absolute deviation); the velocity is the mean of the values left that
  are not above their median — a cautious figure — times the length of a sprint. Until 3 sprints count, the velocity
  typed in the settings is used. The planning shows it with where it comes from; *Progress of the work* shows how it
  was learned, sprint by sprint.
- **Burndown** of a sprint (*Burndown* on its banner): the points still to do at the end of each working day, against
  the ideal line, and the points of all its tasks (*scope*, which rises when tasks are added during the sprint); a day
  shows its figures on hover, and all the figures are in a table below. It is read from the tasks' history (their
  sprint, points and status at each moment), so it is right even when opened later.
- **Report** of a closed sprint (*Report* on its banner): points committed, done, carried over and added during the
  sprint, its burndown as it ended, what was done per person and per task type, and the velocity it leads to. It is
  frozen when the sprint closes. With *E-mail the report of each closed sprint* in the settings, the space's members
  get it by e-mail (in their language), without the chart. It can also be published to Outline (see
  [In Outline](#time-and-reports)).
- **Progress of the work** (in the planning): at the start, then at the end of each sprint, the points of the pipe
  done and still to do; the points left, the tasks still without points, and the expected end: the sprint under way
  finishes its own tasks, the rest takes whole sprints at the velocity.
- **Timeline** (a view beside *Planning*), with the same sprint selector as the board: all the sprints — a band each,
  their tasks below, the closed ones folded — one sprint, or the backlog. A task is a bar from its **start date**
  (set on its page, by those who move tasks forward; never after its due date) to its due date; a missing date comes
  from its sprint, and the bar is then dashed. Releases are milestones, with a line down the timeline. Arrows join a
  task to the tasks of the pipe it waits for, in red when it starts before they end. Days off are shaded, today is
  marked, a bar shows its dates, column, points and owner on hover. Members drag a bar to move it, or its ends to
  change its dates (on a phone, the timeline is read only: dates are set on the task's page). Tasks with no date and
  no sprint are counted under it. The start date is also in the task's history, the export and import, webhooks and
  MCP.
- Each change of sprint is kept in the task's history; a task moved to another pipe or sent leaves its sprint
  (noted too).

### Planning Poker

In team pipes only — on by default in *Sprint* pipes (and in model types with *Planning Poker on by default*), turned
on or off per pipe in its settings — the members of the team estimate tasks together.

- **A session** is opened from the planning (*Planning Poker*) with the tasks to estimate, those without points
  chosen first; whoever opens it leads it. One session at a time per pipe: the others see a banner to join it.
- **For the task under estimation**, everyone picks a card — 0, 1, 2, 3, 5, 8, 13, 21, 40, 100, *?* or ☕ — and can
  change it until the cards are shown. The others only see *who* picked one: **no one's card leaves the server
  before**. Those at the table are shown (their page says so every few seconds); those away are faded.
- **The one who leads** shows the cards — with their spread, median, and a suggestion (the median rounded up to the
  scale), or *Everyone agrees* — starts another round if needed, then sets the points: they go on the task, noted
  in its history *(Planning Poker)*, and the next task not yet estimated comes. They can also pick the task to
  estimate. Anyone of the team can take the lead (if the one leading left) or close the session.
- Every page at the table follows at once through the live connection.
- The members of the pipe's space plan sprints and put tasks in them; whoever sees the pipe sees its sprints.

## Time and reports

- **Time per step**: each task shows how long it spent in each column (and in incoming buckets), the step it is in
  and for how long, its lead time (creation to done) and the time it was worked on (first start to done). It is
  computed from the history, so it covers tasks created before the feature too; times are calendar times.
- **Daily activity report** (*Reports* on a pipe, or in its menu): for a day, from the day before at the report hour
  to that day at the report hour — tasks new in the pipe, started, done, blocked, dropped, and those still in
  progress or blocked at the end. Any day can be shown.
- **Weekly time report** (development pipes): over a week ending on Friday at the report hour, the time tasks spent
  in progress and blocked, per task type, the tasks done, and the tasks that took the most time.
- **By e-mail**: members of a pipe's space can have its daily report sent to them every day at the report hour, and
  for development pipes the weekly time report every Friday. Each member gets it in their language; a day without
  any activity sends nothing.
- **In Outline**: the daily activity of a day, the weekly time report and the report of a closed sprint can be
  **published to Outline** as a document (headings, task lists linking back to TasksPipes, tables for the sprint), under a parent document — the
  one the pipe publishes under, or any document picked. This is done with one's own Outline account (*Publish to
  Outline* in the report). A pipe can also **publish by itself** (*Reports* › *In Outline*, for its space's
  members): the daily activity every day at the report hour (days with activity only), for development pipes the
  weekly time report every Friday — under its own document when one is chosen, else under the parent — and, for
  pipes in sprints, each sprint's report when it closes. It needs a parent document and an **Outline API key** (Outline › Settings ›
  API), stored encrypted and never shown again; reports are published as that key's account, in the language of the
  member who set it up. If Outline refuses the key, publishing stops, the settings say why, and the member who gave
  the key is told by e-mail once; a new key starts it again.

The report hour (18:00 by default) and time zone are set by the instance (`REPORT_HOUR`, `TIMEZONE`).

## Export and import

**Export and import** on a pipe's page:

- **Export** — every task of the pipe as **CSV** (key, title, description, column, owner, start date, due date, task type,
  sub-tasks, one column per field of its task types, priority, points, labels, author, dates; semicolons in French for spreadsheets) or as
  **JSON** (the fields' values as stored, with their labels). Anyone who sees the pipe can export it. A cell that a
  spreadsheet would run as a formula (`=`, `+`, `-`, `@`) is written as text.
- **Import** (members of the space, pipes not archived) — a **CSV** file, its separator guessed (comma, semicolon or
  tab): each column of the file is matched to a task property or a field, suggested from its header (in English or
  French, and the usual words of other tools: *Name*, *List*, *Due*, *Checklist*, *Story points*…), or ignored. Values that match no
  column of the pipe (a state from another tool) are placed by hand. Owners are found by name or e-mail among the
  space's members, dates are read as `2026-03-09` or `09/03/2026`, choices without minding case or accents,
  sub-tasks one per line (`[x]` for done ones). An exported file imports back as is.
- **Trello** — a board exported as JSON (*Menu › Print, export and share › Export as JSON*): open cards of open
  lists, with their description, due date, checklists as sub-tasks and comments (written under your name, with their
  author and date). Lists are placed in columns like the values above.
- A **preview** shows how columns map, the first tasks and every line to correct. Nothing is imported while a line is
  wrong; then all lines are created at once, in one transaction (up to 2,000), recorded in their history, without
  e-mail notifications.

## Public API and webhooks

- **Access tokens** (*Settings › Access tokens*) — for scripts and other tools. A token is shown once, at creation,
  and only its hash is kept; it has a name, an expiry (30 days, 90 days, a year, or never) and a scope: **read only**, or
  **read and write**. It acts with exactly your rights, through the same checks as the app, and can be revoked at
  any time; a disabled account's tokens stop working.
- **API `/api/v1`** — the documented, versioned part of the API: your account, people, spaces, pipes and their tasks,
  your tasks, the calendar, search, creating, changing, moving, sending and commenting tasks, dependencies, labels, logged time, sub-tasks, and the
  sprints of a pipe with its velocity, progress and their burndowns. Send the token as
  `Authorization: Bearer tp_…`. Its OpenAPI description is at `/api/v1/openapi.json`, browsable at **`/api/v1/docs`**
  (Swagger UI). Tokens are accepted on `/api/v1` only, and never manage tokens, account settings, data export,
  deletion or administration: those need a signed-in session.
- **AI agents (MCP)** (*Settings › AI agents*, once an administrator turned them on) — let an AI assistant (Claude,
  Cursor…) work on your tasks over MCP, at `/mcp`. It acts with your rights, reads, and does only what you allow
  besides (create and change tasks, comment, log time, send tasks to others), in all your spaces or only those you
  pick; it never sees confidential or team-only pipes and deletes nothing. What it does shows in the history as done
  *via* it; tasks changed through an access token show it too. Connect it with an agent token, or let a connector
  that signs in (claude.ai, OAuth) ask for your consent. See [MCP.md](MCP.md).
- **Webhooks** (*a pipe's page › Webhooks*, members of its space) — task events of the pipe are POSTed as JSON to an
  https address: task created, moved (column or pipe), given an owner, commented, done — and, in pipes in sprints, a
  sprint started (its points committed) or closed (its report: points done, carried over, the velocity it leads to).
  Each task delivery carries the task (key, title, column, owner, start and due dates, points, link), who acted and the
  change; a sprint delivery carries the sprint and who acted. Each one is signed:
  `X-TasksPipes-Signature: sha256=<HMAC-SHA256 of "<X-TasksPipes-Timestamp>.<body>" with the webhook's secret>`.
  A failed delivery is retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours, then given up; the last
  deliveries show in the dialog, with their answer. A *Test* button sends a `ping`. Addresses on internal networks
  are refused (`WEBHOOK_ALLOW_PRIVATE` lifts it). **Confidential and team-only pipes have no webhooks**: their
  content stays in the app.
- **Incoming webhook** (*a pipe's settings › Incoming webhook*, members of its space) — another application (a form, a
  CRM, Zapier, n8n, a script…) creates tasks in the pipe by POSTing JSON to an address of its own, with the secret in
  `X-TasksPipes-Token` (or `Authorization: Bearer`), or a signature of the body in `X-TasksPipes-Signature:
  sha256=<HMAC-SHA256 of the body with the secret>`. The body's `title`, `description`, `dueDate`, `priority` and
  `externalId` are used, or **templates** pick them out of any body (`Lead: {{contact.name}}`); an `externalId`
  already received makes no second task. Tasks are made as the member who set it up (or last changed its templates),
  with their rights: once they may no longer add to the pipe, the webhook is refused. At most 60 tasks a minute.
- **Slack, Mattermost, Microsoft Teams, Discord** — a webhook can post to a chat channel instead: choose its format
  and paste the channel's incoming webhook address (for Teams, a *Workflows* webhook). Each event becomes a short
  message with a link to the task (*Alice moved TP-12 “Quote” to Done*), comments quoted up to 300 characters, in the
  language of the webhook (its creator's by default, changeable); Discord messages never ping anyone. Same events,
  retries, delivery log and address checks as JSON webhooks.

## Incoming buckets

Every person and team has an incoming bucket that receives tasks sent by others. A member **accepts** a task into a
pipe and column, or **refuses** it with a reason: it then goes back to the sender's incoming.

A task sent to an incoming can have the plain *Task* type or a type offered by the recipient's pipes that the sender
can see: the **open** pipes of someone else's space (private pipes never show through), every pipe of one's own space
or team; archived pipes do not count. When accepting a task, it can be **turned into another type** offered by the
chosen pipe (the dialog says when the pipe does not offer its current type); fields both types share are kept, and
the change is recorded in the history. In a pipe, a task's page turns it into any type the pipe offers.

## Search

**Search** at the top of the sidebar, or **Ctrl + K** (**⌘ + K** on a Mac) anywhere, finds tasks in every pipe and
incoming bucket you can see:

- by **title**, **description**, **sub-tasks**, **field values**, the title of the **linked Outline document** and
  **comments** (refusal reasons included), or by **number** (`TP-123`, `tp123` or `123`);
- results come as you type: each word is the start of a word to find, all of them must match, accents do not
  matter, and words are matched in your language — French or English stemming, English for other languages (*inscription* also finds *inscriptions*);
- each result shows its key, title, owner and path (space › pipe › column, or the incoming bucket), and an excerpt
  of what matched, the words found highlighted; tasks of archived pipes are marked as such;
- filters: status (or *not finished*), owner, task type, label and priority; ↑ ↓ and Enter open a task from the keyboard.

A search only finds what you could open in the app, checked in the database query itself. **Confidential** and
**team-only** tasks are found only by those who see them, and show no excerpt: their content stays on their page.

## My tasks and Next action

- **My tasks** lists everything assigned to you and still to do, across all pipes, grouped by state, by pipe or by priority, and filtered by label and priority.
- **Next action** follows Getting Things Done: capture an idea into your Personal pipe, see the tasks in progress
  (check their next sub-task, finish them), and get a suggestion of the next task to start — late or due soon first,
  then ready, already begun or waiting for long; a task still waiting for other tasks is never suggested. Beyond
  three tasks in progress, it suggests finishing one first.

## Live updates

A task sent or refused shows up at once for its recipients, with a notification. In a team pipe, what a member
does (a task created, moved, given to someone, commented…) shows at once on the other members' open pages. The
connection closes after five minutes of inactivity or one minute in the background, and reopens when the page is
used again. The number of waiting tasks shows in the tab title and, on mobile, as a badge on the menu button.

## Notifications in the app

The **bell** (at the top of the menu, and of the screen on mobile) shows how many notifications are unread. It opens
them as a list in the middle of the page, newest first:

- what happened, by whom, on which task and where (team › pipe, or the incoming), with an excerpt of the comment;
- the news of your teams — a task created by someone else in one of their pipes — and what concerns you: a task
  received, given to you or refused, a comment on a task you wrote or own, a mention, a task no longer blocked;
- a click (or a tap) goes to the task's pipe, scrolled to the task, which shines in yellow a moment (the board is
  shown, and the filters are cleared, so that it can be seen); the notification is then read;
- the ✓ icon marks one as read; on a touch screen, swiping it to the left or the right does the same;
  **Mark all as read** empties the list.

Notifications are for everyone, with or without e-mail or push, and come live. Someone who can no longer see a
task no longer sees what happened on it. Read ones are forgotten after 30 days, unread ones after 90.

After the server is updated, open pages notice the new version and reload themselves — at once if nothing is being
edited, otherwise once the edit is over, with a banner offering to reload.

## Installable app and push notifications

- TasksPipes can be **installed** as an app (on a phone's home screen, or from the browser's address bar on a
  computer): it opens in its own window, with its icon. Its service worker keeps only the interface (the page,
  scripts, styles, fonts and icons) for quick starts; data — tasks, files, avatars, every `/api` request — always
  comes from the server and is never kept by it.
- **Notifications on this device** (*Settings*): once turned on, a device gets a notification for what you chose to
  get *at once* (task received, owned, refused, mention, task no longer blocked…), while TasksPipes is not open — in
  the app, the notification shows live. A click opens the task. Confidential and team-only tasks are only named by
  their key; access is checked again when sending. E-mails follow their own settings. Without e-mail on the
  instance, the choices of notifications are offered to those who turned push on.
- A bar at the top of the app **offers to turn them on** on each device the browser has not asked yet: the browser's
  own prompt opens from its button. "Not now" asks again a month later; *Settings* keeps the switch.
- Signing out turns push off for that device. A device the push service no longer knows is forgotten.

## E-mail notifications

Every e-mail (notifications, reports, sign-in links and invitations) has the look of the app — its colours, a white
card on a blue-grey background, the blue button — and turns **dark** when the mail app is in dark mode; a theme forced
in one's profile (light or dark) applies to one's notifications and reports too.

With e-mail set up on the instance, TasksPipes tells people by e-mail what needs them, even with the app closed:

| Notification | Who gets it | By default |
| --- | --- | --- |
| A task arrives in an incoming | the person, or the members of the team | at once |
| A task becomes yours | its new owner | at once |
| A task you sent is refused | the sender, with the reason | at once |
| A comment (also one written while moving or sending a task) | the task's author and owner | daily digest |
| A mention (`@name` in a comment or a description) | the person mentioned | at once, unless they are in the app then |
| A task is no longer blocked (the last task it waited for is finished) | its author and owner | at once, unless they are in the app then |
| Due dates | the owner: overdue tasks (once), and those due today and tomorrow | in the morning, at 8:00 |

- **Settings** (account menu) let each person choose, for each kind, *at once*, *daily digest* (sent at the report
  hour, with the reports) or *off*, and the hour of the morning reminder.
- E-mails sent at once wait two minutes, so that what follows (a comment after sending a task…) comes in the same
  e-mail, and a task sends at most one e-mail every 15 minutes to a person; what happens meanwhile is grouped in the
  next one.
- Nothing is sent for what you do yourself, nor to accounts that never signed in (an invitation not taken up, an
  Outline colleague who never came); the same goes for reports.
- Access is checked again when sending: someone who can no longer see a task (who left the team, for instance) gets
  nothing about it.
- **Confidential** and **team-only** tasks are only named by their key (`TP-123`) and a link: their title, place,
  comments and reasons stay in the app.
- Every e-mail has an **unsubscribe** link, and supports the one-click unsubscribe of mail apps.
- Without e-mail on the instance, nothing is sent and the settings are not shown.

## Calendar

The **Calendar** page (menu) shows the tasks with a due date, by **month** or **week** (weeks start on Monday): your
own tasks, or everything you see, in the pipes you can see (archived pipes and incoming buckets left out), filtered
by space and pipe, finished tasks on demand. A task shows its priority and title, and opens on a click; overdue tasks are
marked. **Dragging a task to another day changes its due date**, for those who may change it (members of its space).
It shows up to 62 days and 1,000 tasks at a time.

- **Create from a day**: clicking an empty day (or the **+** that appears on it) opens the new-task form with that day
  already set as the due date — in the pipe, on a pipe's agenda, or to a space's incoming on the global calendar.
- **Pipe agenda**: every pipe's page has a **Board / Agenda** switch; the agenda is the same calendar, scoped to that
  pipe, so you can see and reschedule its tasks on the days they are due.
- **Future occurrences**: a scheduled [repeat](#tasks) (*at fixed dates*) shows its upcoming occurrences as faint
  ghosts, before the tasks are actually made, so the calendar reads ahead. A ghost cannot be dragged and opens the
  series' latest task. Repeats made *once the previous one is done* have no fixed future dates, so they show none.

**Calendar**, in the account menu, also gives a personal link to subscribe to your tasks with a due date in Google Calendar, Apple Calendar or
any calendar app. Each task is an all-day event with a link back to it, and open tasks carry reminders at 9:00 five
days before, the day before and on the due date. The link can be renewed if it leaks.

## E-mail accounts

People without an Outline account can **create an account** from the sign-in page with just their e-mail address
and a display name: a link sent by e-mail confirms the address and signs them in. They can also be created by an
[invitation](#invitations-and-connections).

E-mail accounts sign in with one-time links (20 minutes when asked from the sign-in page), can turn on two-factor
authentication (TOTP, e.g. Google Authenticator), change their name and upload a **profile picture**, cropped and
shrunk in the browser. They have no access to Outline documents.

## Invitations and connections

From **Invite people** in the account menu (or the *People* section of the sidebar), invite someone by e-mail, optionally into one of your
teams:

- **a new address**: an e-mail account is created and gets a sign-in link valid for 48 hours; you are connected at once.
  If the link is not used in time, the account is **disabled**: the link no longer works, nobody sees the account any
  more (lists, teams, owner pickers) and it gets no e-mail. Your settings show the invitation as expired: sending a
  new link, or inviting the address again, turns it back on — and so does the person signing up with that address,
  once they use the link they get;
- **someone already on TasksPipes**: they get a **request to connect**, by e-mail, live notification and on their
  dashboard, which they **accept or refuse**. If they had already asked you, your invitation accepts their request.
  The answer is the same whether or not the address has an account, so invitations do not reveal who uses TasksPipes;
  a refused request stays refused without telling you.

Connected people see each other in the app and can send each other tasks; the team you chose is joined on acceptance.
An e-mail account only sees the people it is connected to. Outline accounts of a same server see each other, but
not e-mail accounts, except those they are connected to — and the member list of a team they share. E-mail accounts
only see their own teams.

Invitations can be turned off for the whole instance (`ALLOW_EMAIL_INVITATIONS=false`).

## Account menu and settings

Your name at the bottom of the sidebar opens a menu, like Outline's:

- **Invite people** — invite someone by e-mail (when invitations are on);
- **Settings** — language (English, French, Spanish or Portuguese of Brazil or Portugal — one file per language, see [TRANSLATION.md](TRANSLATION.md) — following the browser unless chosen), theme (automatic, light or
  dark), name and picture of e-mail accounts, two-factor authentication, invitations and requests to connect;
- **Calendar** — your calendar subscription link;
- **About** — the version, a link to the source code on GitHub and the license;
- **Administration** — for the administrators of the instance (see below);
- **Sign out**.

## Your data

In **Settings › Your data**:

- **Download my data** gives a zip archive: `data.json` (your profile, teams, the tasks you wrote, sent or own with
  their history and sub-tasks, and every comment you wrote) and the files of those tasks. Only tasks you can still
  see are included; on others, only your own comments are, without the task.
- **Delete my account** (e-mail accounts; an Outline account comes from your Outline workspace and is not deleted
  here) is confirmed by a two-factor code, or else by a link sent by e-mail, valid 30 minutes and once. It deletes
  your account, your personal space and its tasks (tasks others sent you included), and the teams you were alone
  in. What you did elsewhere stays in the history under **Deleted account**, a placeholder of its own that nothing
  links back to you; teams you alone administered get their oldest other member as admin.

## Administration

Administrators of the instance are named by `ADMIN_EMAILS`, never in the app. Only an e-mail account (its address
proven by sign-in links), an Outline account of the server set in `OUTLINE_URL`, or a company sign-in account whose
address the provider vouches for can be one: another Outline server could claim any address. Their **Administration** page lists every account (kind, Outline server, last sign-in,
state) and can **disable** one — its sessions and open pages are closed at once, it can no longer sign in, its tasks
and history stay, and teams show it as disabled — or enable it again. An administrator cannot disable themselves or
another administrator.

Its **Settings** tab manages the instance while it runs, without a restart:

- **E-mail (SMTP)**: server, port, TLS, user, password, sender, and a *Send me a test e-mail* button;
- **Outline**: turn it on or off (off, Outline accounts are signed out and can no longer sign in, their tasks stay, and
  the Outline documents of tasks are hidden), main server, its API address, other servers allowed, internal
  addresses, a single workspace, sign-in with an API key;
- **Outline OAuth**: client id and secret, with the redirect URL to copy;
- **accounts without Outline**: sign-up with an e-mail address, invitations by e-mail, and the **e-mail domains**
  allowed to sign up or be invited;
- **company sign-in (OpenID Connect)**: on or off, issuer, client, secret, button label, scopes, domains;
- **updates**: check for new versions (on by default).

A setting given by the server's environment (`.env`) wins and shows locked. Secrets are kept encrypted with
`APP_SECRET` and never shown again: they can only be replaced or removed. A change that would leave the administrator
making it, or every administrator, unable to sign in is refused. Every change is listed in **History of changes**
(who, when, before and after; never a secret).

Its **Backups** tab shows how the instance is backed up on its server (backups are made and planned there, with
`scripts/backup.sh`, not in the app): the plan — when, how many kept, encrypted or not, the copy on S3-compatible
storage — the last good backup, and the recent ones (planned, by hand, before an update or a restore) with their size
and errors. The tab is marked when something is wrong, and the administrators are told once, by e-mail and push
notification, when a backup fails, when its off-site copy fails, or when planned backups stop coming (see
*Backups, restore and moving* in [HOSTING.md](HOSTING.md)).

Every hour, the sessions of Outline accounts are checked with Outline: when Outline no longer accepts their access
(revoked, account suspended or deleted), they are closed.

**New versions.** Every hour, the server asks GitHub for the latest release of TasksPipes. When a newer one comes out,
the administrators are told once, by e-mail and on their devices (push notifications); the **About** dialog then shows
the new version to everyone, with a link to its release notes. A release is only offered (and told) once it can be installed: its
images are published on ghcr.io, a few minutes after the release. Opening About checks again at once (at most once a
minute for the instance); administrators see there when it last checked, or why it could not (GitHub unreachable,
an error answer). Turn it off in Settings › Updates (or `UPDATE_CHECK=false`).
Where the host set up the updater, an administrator installs it **in one click** from About: the app restarts with
it, goes back to the previous version by itself if the new one does not start, and open pages reload once it is
running (see *One-click updates* in [HOSTING.md](HOSTING.md)).

## Privacy

The app's styles, scripts and font (Inter) are served by TasksPipes itself, so opening the app sends no visitor's
address to a third party. The only other server the browser reaches is your Outline server, for the profile pictures
of Outline accounts; links you click (Outline documents, France Compétences pages…) open other sites, of course.
On the server side, the check for new versions asks GitHub (`api.github.com`) for the latest release every hour,
sending nothing but the server's version in its User-Agent, and, when there is a newer one, GitHub's registry
(`ghcr.io`) whether its images are published, anonymously; it can be turned off.

## Access rules

| Action | Who |
| --- | --- |
| See a private pipe, a space's incoming | members of the space |
| See an open pipe, add a task to it, comment | everyone who can see its space |
| Find a task with the search | whoever may see it |
| Export a pipe's tasks | everyone who can see the pipe |
| Import tasks into a pipe | members of the space holding the pipe |
| Be suggested in an @mention, be told of it | people who can open the task |
| Make a task wait for another one, or stop it | those who may edit the task, among the tasks they can open |
| See a linked task one cannot open | its title and owner only; nothing of a confidential or team-only one |
| Use the API with a token | the token's owner, with their own rights (read only for a read token) |
| Act through an AI agent (MCP) | the token's owner, with their own rights, limited to its scopes and spaces; never confidential or team-only pipes |
| Manage a pipe's webhooks | members of its space (not on confidential pipes) |
| Add or remove a pipe's linked documents | members of its space (Outline documents: Outline accounts) |
| Move, change the column, assign, due date, document, send | members of the space holding the task |
| Plan sprints (create, start, close, delete) and put tasks in them | members of the pipe's space |
| Play Planning Poker (open a session, vote, lead, close) | members of the pipe's team (team spaces only) |
| Edit title, description and fields, priority, points and labels | members, or the author of a task in an open pipe |
| Manage a space's labels | members of the space (whoever sees the space sees them) |
| Set an estimate, log one's own time | as for fields: members, or the author of a task in an open pipe |
| Change or delete a time entry | its author; an admin of the task's team may delete it too |
| Refuse | members of the space whose incoming holds the task (unless they sent it themselves) |
| Manage a team (name, members, roles, deletion) | the team's admins |
| Add someone to a team, send them a task | team admins / members, among the people they can see who have signed in once |
| Invite an Outline colleague who never signed in | anyone who sees them |
| See every account, disable or enable one | administrators of the instance (`ADMIN_EMAILS`) |
| Export one's data; delete one's e-mail account | the person |
