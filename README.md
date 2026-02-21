# IDE Agent Kit (team-relay) — v0.1 spec

Goal: let IDE AIs (Cursor/VS Code agents, local LLM assistants, etc.) participate in team workflows like OpenClaw bots.

v0.1 is intentionally small. It ships three primitives:

1) **Webhook relay**: ingest GitHub webhooks, normalize to one stable JSON task schema, append to a local queue.
2) **tmux runner**: run an allowed command in a named tmux session, capture output + exit code.
3) **Receipts**: write an append-only JSON receipt for every action with trace + idempotency.

No UI in v0.1.

## Naming/shape freeze (v0.1)

- JSON fields (events, receipts, config): **snake_case**
- CLI flags: **kebab-case** (mapped to snake_case fields)

## CLI surface (frozen)

- `team-relay serve`
  - starts HTTP server for inbound webhooks
  - appends normalized events to the queue file

- `team-relay tmux run --session <name> --cmd "..." [--cwd <path>] [--timeout-sec <sec>]`
  - runs an allowlisted command inside the tmux session
  - captures last N lines of stdout/stderr + exit code
  - appends a receipt

- `team-relay emit --to <url> --json <file>`
  - sends a receipt or event JSON to a webhook target

- `team-relay receipt tail [--n <count>]`
  - prints the last receipt(s) as JSON

## Schemas

See:
- `schemas/event.normalized.json`
- `schemas/receipt.json`

## Minimal example flow

See: `examples/flow-pr-opened.md`
