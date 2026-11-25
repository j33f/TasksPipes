# AI agents (MCP)

TasksPipes can let an AI assistant (Claude, Cursor, any client of the [Model Context Protocol](https://modelcontextprotocol.io))
work on your tasks for you: find what is due, sum up a pipe, create and update tasks, comment, log time.

It is **off until an administrator turns it on** (*Administration › Settings › AI agents*, or `MCP_ENABLED=true` in
the server's environment; see [HOSTING.md](HOSTING.md#configuration)).

## What an agent can and cannot do

- **It acts as you, never more.** Every tool goes through the same routes and checks as the app, with your rights.
- **It reads; the rest is up to you.** When you connect an agent you choose what it may do besides reading: create
  and change tasks, comment, log your time, send tasks to other people. Nothing it can do deletes anything.
- **Only where you allow it.** All your spaces, or only the ones you pick: the others do not exist for it.
- **Confidential content stays in the app.** Tasks of confidential and team-only pipes are never shown to an agent,
  even yours: what it is given goes to the company running the AI model. Lists say how many tasks were left out.
- **What it does is visible.** It appears in the task's history as done by you, *via* the agent's name — a name
  everyone who can open the task sees, so choose it accordingly — and the notifications others get are the usual ones.
- **Sending tasks reaches beyond its spaces.** *Send tasks to other people* lets the agent send a task of its spaces
  to anyone you could send it to yourself, and *Comment* lets it @mention people: grant them only when you need them.
- **You can disconnect it at any time** (*Settings › AI agents › Disconnect*). An agent token lasts 7, 30 or 90 days,
  or never expires if you choose so; it stops working when you disconnect it, when your account is disabled, or when
  the administrator turns AI agents off.

An agent reads text written by other people (titles, descriptions, comments). A malicious text could try to steer it
(*prompt injection*). TasksPipes tells the agent that this text is data, never instructions, and keeps what an agent
may do small, but cannot rule it out: give an agent no more than it needs, and keep an eye on its history.

## Connecting an agent

1. *Account menu › Settings › AI agents (MCP)*: name the agent, choose what it may do and where, then *Connect an agent*.
2. Copy the token: it is shown once.
3. Give your client the MCP address, `https://<your instance>/mcp`, and the token as a bearer token.

With **Claude Code**:

```shell
claude mcp add --transport http taskspipes https://tasks.example.com/mcp --header "Authorization: Bearer tp_…"
```

Other clients take the same two things: the address (Streamable HTTP transport) and the header
`Authorization: Bearer tp_…`. Clients that only speak stdio can go through a bridge such as
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote).

### Without a token: connectors that sign in (OAuth)

Clients that sign in by themselves — **claude.ai** custom connectors (also used by Claude Desktop and mobile), and
other MCP clients supporting OAuth — need no token to copy: give them the address `https://<your instance>/mcp` only.

1. In claude.ai: *Settings › Connectors › Add custom connector*, the address above, then *Connect*.
2. TasksPipes opens: sign in if needed, then the consent page shows **which application asks** and **where it will
   send you back** (for claude.ai, `claude.ai`). Choose what it may do besides reading, and where, as for an agent
   token, then **Allow**.
3. The connection shows in *Settings › AI agents*, marked *Connected with OAuth*; *Disconnect* ends it.

Only allow a connection you started yourself: a name such as "Claude" is chosen by the application, the address it
sends you back to is what tells it apart (applications that registered on the fly are marked *unverified name*).

## Tools

| Tool | What it does | Needs |
| --- | --- | --- |
| `whoami` | Who the agent acts for, and what it may do | — |
| `docs_contents`, `read_docs` | The documentation of the version running (how TasksPipes works), by section or by a few words | — |
| `list_spaces`, `get_space` | Your spaces and their pipes | — |
| `get_pipe` | A pipe: its columns (with their status), the task types it offers and their fields, its tasks | — |
| `get_sprints` | The sprints of a pipe in sprints, its velocity, the points left and the end they point to | — |
| `my_tasks` | Your tasks still to do | — |
| `search_tasks` | Search the tasks you can see | — |
| `get_task` | A task with its column, description, field values, sub-tasks and history | — |
| `create_task`, `update_task`, `move_task` | Create a task in a pipe, change it (also its points, start date, sprint, estimate, task type and fields — files excepted), move it to another pipe | *Create and change tasks* |
| `add_comment` | Comment on a task | *Comment* |
| `log_time` | Log your time on a task | *Log my time* |
| `send_task` | Send a task to someone's incoming | *Send tasks to other people* |

## For administrators

- **OAuth.** TasksPipes is the authorization server of its own `/mcp` (OAuth 2.1): protected resource metadata at
  `/.well-known/oauth-protected-resource/mcp`, server metadata at `/.well-known/oauth-authorization-server`, clients
  by metadata document (CIMD) or registered on the fly (`/oauth/register`), the authorization code with PKCE (S256),
  access tokens of an hour for `/mcp` only and rotated refresh tokens (90 days unused). A refresh token or a code
  used twice disconnects the connection. Everything answers 404 while AI agents are off. Claude reaches the instance
  from `160.79.104.0/21`: a firewall must let it reach `/mcp`, `/.well-known/…` and `/oauth/…`.

- The endpoint is `POST /mcp`, stateless: it works the same with [several instances](HOSTING.md#several-instances).
- It only takes agent tokens; personal access tokens are refused there, and agent tokens are refused on `/api/v1`.
- Agent requests count in the API rate limit of their token.
- Turning AI agents off makes `/mcp` answer 404 at once; existing agent tokens stop working until it is turned on again.
