# Features

## Spaces

Everyone in the Outline workspace has a **personal space**; everyone else's is visible too. **Team spaces** are
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

## Tasks

- **Owner**: a task in a personal space belongs to its holder; to hand it to someone, send it to their incoming. In a
  team space, the owner is chosen among the team's members.
- **Sub-tasks**: a checklist inside the task. Paste several lines to add several items, rename, reorder by drag and
  drop; progress shows on cards.
- **History**: every change is recorded with the state before and after — place, column, owner, due date, linked
  document, fields, files, checked items — and its comment. Tasks are never deleted, they are moved to *Dropped*.
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

## Calendar

**My account** gives a personal link to subscribe to your tasks with a due date in Google Calendar, Apple Calendar or
any calendar app. Each task is an all-day event with a link back to it, and open tasks carry reminders at 9:00 five
days before, the day before and on the due date. The link can be renewed if it leaks.

## Invited guests

People without an Outline account (trainers, partners…) can be invited by e-mail and added to a team. They sign in
with one-time links and can turn on two-factor authentication (TOTP, e.g. Google Authenticator).

An invited guest only sees the people who invited them and the people they invited. Outline accounts do not see
guests, except those they invited themselves — and the member list of a team they share. Guests only see their own
teams and have no access to Outline.

## Personal settings

The interface is in English or French, following the browser unless chosen in **My account**, where the theme can
also be set to automatic, light or dark.

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
