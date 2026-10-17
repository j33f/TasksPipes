# GitHub and GitLab integration

A pipe can be connected to GitHub and GitLab repositories, like Jira: pull requests, merge requests and commits that
name a task are linked to it, and the task moves along with its pull or merge request.

## Naming a task

Every task has a key, **`TP-<number>`** (shown in the task's *Development* section, with a button to copy a branch
name such as `tp-42-login-page`). Put the key, in any case, in:

- the **branch name** of a pull/merge request (`tp-42-login-page`, `feature/TP-42`…),
- its **title** or **description** (`Login page (TP-42)`),
- or a **commit message** (`TP-42: validate the form`).

Only the tasks of the connected pipe are concerned.

## What happens

| Event | GitHub | GitLab | The task |
| --- | --- | --- | --- |
| A draft is opened, or a request goes back to draft | `opened` (draft), `converted_to_draft` | `open` (draft), draft flag set | moves to the first *started* column (In progress) |
| A request is opened, reopened or marked ready | `opened`, `reopened`, `ready_for_review` | `open`, `reopen`, draft flag removed | moves to the first *ongoing* column (In review) |
| The request is merged | `closed` + merged | `merge` | moves to the first *done* column (Done) |
| The request is closed without merging | `closed` | `close` | stays where it is |
| Commits are pushed | `push` | `Push Hook` | the commits are linked, the task does not move |

Columns are found by their state, so this works with any pipe type; the *Software development* type has a
*In review* column for it. A dropped task is never moved. Each move and each new link is recorded in the task's
history, by *GitHub* or *GitLab*, and the task's card shows the state of its latest pull/merge request.

## Connecting a pipe

In the pipe's settings (*Icon, colour, type…* in its menu, or the gear on its board), open **GitHub / GitLab** and
click **Connect**. TasksPipes gives a webhook URL and a secret; only the members of the pipe's space see them.

**GitHub** — in the repository, *Settings › Webhooks › Add webhook*:

- *Payload URL*: the webhook URL;
- *Content type*: `application/json`;
- *Secret*: the secret;
- *Which events*: *Let me select individual events* → **Pull requests** and **Pushes**.

**GitLab** — in the project, *Settings › Webhooks › Add new webhook*:

- *URL*: the webhook URL;
- *Secret token*: the secret;
- *Trigger*: **Push events** and **Merge request events**.

Several repositories can send to the same pipe: use the same URL and secret in each. The pipe's settings show when
the last event was received. **New secret…** replaces the secret (update it on the other side), **Disconnect**
stops the integration.

## Security

- GitHub webhooks are checked with their HMAC-SHA256 signature (`X-Hub-Signature-256`), GitLab ones with their
  secret token (`X-Gitlab-Token`), compared in constant time; anything else is refused.
- The URL holds a random token naming the connection; the secret is stored encrypted with `APP_SECRET`.
- Webhooks are served at `<APP_URL>/hooks/github/…` and `<APP_URL>/hooks/gitlab/…`: GitHub or GitLab must be able to
  reach `APP_URL` (for a self-hosted GitLab on an internal network, allow it to call that address).
