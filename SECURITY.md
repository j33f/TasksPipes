# Security Policy

## Supported versions

TasksPipes upgrades its database on start and is meant to run on the latest release, so security fixes land in the
next release rather than being backported.

| Version | Supported |
| --- | --- |
| Latest release (`0.12.x`) | ✅ |
| Anything older | ❌ — please upgrade |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.** Report it privately through GitHub's *Report a
vulnerability* button on the [Security tab](https://github.com/j33f/TasksPipes/security/advisories/new), which opens
a private advisory visible only to you and the maintainers.

Helpful things to include:

- what the issue lets an attacker do, and how serious you think it is;
- the affected version or commit, and the configuration it needs (for example which sign-in method, or which
  `OUTLINE_*` / `ALLOW_*` settings);
- the smallest steps or proof of concept that show it — no need for a weaponised exploit.

## What to expect

TasksPipes is maintained by one person, so responses are best effort. We will acknowledge your report, confirm the
issue, agree a fix and a disclosure timeline with you, and credit you in the release notes and the advisory unless
you would rather stay anonymous. Please give us a reasonable chance to ship a fix before disclosing publicly.

## Scope

In scope: anything that lets someone read or change data they should not, bypass sign-in or authorisation, reach
the server's internal network (SSRF), inject SQL or scripts, or take over an account or instance.

Usually out of scope: findings against a misconfigured instance that the [hosting documentation](docs/HOSTING.md)
warns against, missing security headers with no concrete impact, and reports produced only by automated scanners
without a realistic attack path.
