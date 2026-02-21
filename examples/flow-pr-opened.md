# Example flow: PR opened → task → tmux run → receipt

## 1) Inbound event
GitHub webhook: `pull_request` opened.

Team-relay verifies signature, normalizes to `TeamRelayNormalizedEvent`, and appends one JSON line to `team-relay-queue.jsonl`.

## 2) IDE agent picks up task
An IDE agent reads the queue file, sees a new event, and decides to run tests.

## 3) Execute via tmux
Command:

`team-relay tmux run --session ide-agent --cmd "npm test" --timeout 120`

The runner:
- ensures the command is allowlisted
- runs it in the tmux session
- captures exit code and last N lines of stdout/stderr

## 4) Receipt
Team-relay appends a receipt JSON to `team-relay-receipts.jsonl`.

Optionally emit it:

`team-relay emit --to <webhook-url> --json <receipt-file>`
