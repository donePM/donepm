# Intent

Product: **donePM**. Repository: `donePM/donepm`.

## Problem

A developer gets work from many places: assigned tickets, review requests, Dependabot PRs,
errors in logs, reports in mail or chat. Each source has its own UI. None of them can use the
coding agents that run on the developer's machine.

Existing agent tools (Claude Code, Bloom, Conductor, Codex, Copilot Coding Agent) start with a
prompt. The human writes the task. But the task is already written in the ticket. Cloud tools
also cannot reach company systems behind a VPN, and company code is often not allowed to leave
the machine.

## What donePM is

A local daemon with a web UI. It:

1. **collects work** from its sources (GitHub first; later Jira, GitLab, schedules),
2. shows the work as cards on a **board**,
3. starts a **coding agent** in its own git worktree when the user clicks a card, with the ticket
   as the task,
4. shows every outward action (PR, comment, merge, ticket) as a **draft**. The user approves the
   draft. Only then does anything leave the machine.

The user does not write prompts. The user does not open a terminal. The user decides.

## Principles

**The human is always in control.** Agents have no credentials for GitHub or Jira. All outward
actions go through drafts. The daemon runs them only after approval. This is enforced by
architecture, not by prompt text.

**Local first.** Daemon, agents, worktrees, database and UI run on the developer's machine.
Sources are accessed through CLIs that are already logged in (`gh`; later `glab`, `jira`). These
CLIs work behind the same VPN and SSO as the developer. A server is a later option for teams. It
is not part of the core.

**Work has a type. A type has a playbook.** Implement, review, check dependency update: each is
a playbook. A playbook defines the task text, the model, allowed tools and allowed drafts.
Playbooks are Markdown files. They exist globally and can be overridden per repository. There are
no separate "personas".

**Everything is traceable.** Every decision by a human or an agent is an event with a timestamp
and an actor. Events are append-only. The card shows them as a timeline.

**Start small. Throw nothing away.** The web UI can later be wrapped as a Safari web app or a
thin native shell. The domain module can later sync to a server. Both work without a rewrite if
the boundaries are set from the start.

## Users

First: the author, for his own open-source repositories. Then: developers with similar daily
work, installing via Homebrew. Teams are a possible third step. That would need a server
component. This is not decided now.

## What donePM is not

- Not a replacement for Claude Code or an IDE. It starts and controls agents. It does not edit
  code.
- Not a chat tool. The user works with cards and drafts, not with free text. The user answers
  agent questions, nothing more.
- Not a cloud service. Nothing runs on remote machines except the model calls.
- Not a ticket system. Tickets stay in GitHub or Jira.

## MVP success criterion

Handle all issues of the author's open-source repositories for one week using only donePM. No
terminal for git or `gh`. If the terminal is needed, something is missing on the card.

## After the MVP, in this order

1. Review playbook: draft comments on other people's PRs. Read only. Never write code.
2. Review feedback on own PRs: comments come back, the same agent session resumes, the agent
   drafts a reply or a code change.
3. Schedules. Dependabot is the first case.
4. Jira adapter.
5. Log analysis with duplicate detection. Nice to have.
