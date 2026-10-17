# Features

TasksPipes was designed for an adult training centre, but fits other uses just as well:

- **Training centres** — the built-in types cover course design, admissions, session starts, exams, learner and
  disability follow-up, Qualiopi quality, funding and invoicing.
- **Business** — sales (quotes, negotiation, won / lost), prospecting, communication and admin pipes, with fields for
  clients, amounts and documents, and incoming buckets to pass work between people and teams.
- **Software teams** — UX research, UI design, product documentation, translation / i18n, software development and
  QA pipes, with user stories, bugs, mock-ups, translation batches, releases and test campaigns, and the
  [GitHub / GitLab integration](GIT-INTEGRATION.md).
- **Personal organisation** — a Personal pipe in every space, *My tasks* across all pipes, a GTD *Next action* view,
  sub-tasks and a calendar subscription with reminders.

Other needs are covered by the [models](#models): design your own pipe and task types.

## People

Once TasksPipes is connected to Outline, everyone in the Outline workspace is there straight away, imported at the
first sign-in: you can send them tasks, see their open pipes or build teams with them before they have signed in.

On the sign-in page, you type the address of your Outline server; it is kept in your browser for next time, and you
can add others and switch between them. Each server keeps its own people and teams: accounts of one server do not
see those of another.

You can also use TasksPipes [without Outline](#e-mail-accounts), and [invite people by e-mail](#invitations-and-connections):
once connected, you see each other in the app and can send each other tasks.

## Spaces

Everyone has a **personal space**; the personal spaces of the people you can see are visible too. **Team spaces** are
created by picking their members. Governance is shared by promoting other members to *admin*; a team always keeps
at least one admin.

## Pipes

Pipes are extended kanban boards with drag and drop. Each column belongs to a generic state — *Backlog, Ready to
start, Started, In progress, Blocked, Done, Dropped* — which the dashboard, due dates and archiving rely on.

- **Personal** / **Team** (private): only the person, or the team's members, see the pipe.
- **Open** (public): everyone sees it; anyone can add tasks and comment, only the space's members move them forward.
- Every personal space has a **Personal** pipe for general tasks, which cannot be archived or deleted.
- **Archiving**: an archived pipe leaves the lists, pickers and "My tasks", and takes no new tasks. It can still be
  viewed and unarchived. A pipe can be archived once all its tasks are done or dropped.

### Pipe types

Each pipe has a type, with its own columns, task types and starter tasks. The built-in catalog
(`server/src/pipeTypes.ts`) is designed for adult training centres: general tasks, sales, prospecting,
communication, instructional design, documentation, trainers & schedule, learner follow-up, disability follow-up,
quality & Qualiopi, admin & finance, and processes (recruitment / admission, session start, exams / certification,
session end) that can fill their first column with starter tasks.

The *Software* group covers product teams: UX research, UI design, product documentation, translation / i18n,
software development (with an *In review* column) and testing / QA.

- **Confidential** types (learner follow-up) are always private.
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

## Incoming buckets

Every person and team has an incoming bucket that receives tasks sent by others. A member **accepts** a task into a
pipe and column, or **refuses** it with a reason: it then goes back to the sender's incoming.

## My tasks and Next action

- **My tasks** lists everything assigned to you and still to do, across all pipes, grouped by state or by pipe.
- **Next action** follows Getting Things Done: capture an idea into your Personal pipe, see the tasks in progress
  (check their next sub-task, finish them), and get a suggestion of the next task to start — late or due soon first,
  then ready, already begun or waiting for long. Beyond three tasks in progress, it suggests finishing one first.

## Live updates

A task sent or refused shows up at once for its recipients, with a notification. The connection closes after five
minutes of inactivity or one minute in the background, and reopens when the page is used again. The number of
waiting tasks shows in the tab title and, on mobile, as a badge on the menu button.

After the server is updated, open pages notice the new version and reload themselves — at once if nothing is being
edited, otherwise once the edit is over, with a banner offering to reload.

## Calendar

**Calendar**, in the account menu, gives a personal link to subscribe to your tasks with a due date in Google Calendar, Apple Calendar or
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

- **a new address**: an e-mail account is created and gets a sign-in link valid for 7 days; you are connected at once;
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
- **Settings** — language (English or French, following the browser unless chosen), theme (automatic, light or
  dark), name and picture of e-mail accounts, two-factor authentication, invitations and requests to connect;
- **Calendar** — your calendar subscription link;
- **About** — the version, a link to the source code on GitHub and the license;
- **Sign out**.

## Access rules

| Action | Who |
| --- | --- |
| See a private pipe, a space's incoming | members of the space |
| See an open pipe, add a task to it, comment | everyone who can see its space |
| Move, change the column, assign, due date, document, send | members of the space holding the task |
| Edit title, description and fields | members, or the author of a task in an open pipe |
| Refuse | members of the space whose incoming holds the task (unless they sent it themselves) |
| Manage a team (name, members, roles, deletion) | the team's admins |
| Add someone to a team, send them a task | team admins / members, among the people they can see |
