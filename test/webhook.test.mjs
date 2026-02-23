// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { startWebhookServer } from '../src/webhook-server.mjs';
import { readFileSync, unlinkSync, existsSync } from 'node:fs';

describe('webhook server', () => {
  const queuePath = '/tmp/iak-test-queue.jsonl';
  const testConfig = {
    listen: { host: '127.0.0.1', port: 0 }, // port 0 = random
    queue: { path: queuePath },
    receipts: { path: '/tmp/iak-test-receipts.jsonl', stdout_tail_lines: 80 },
    tmux: { default_session: 'test', allow: [] },
    github: { webhook_secret: 'test-secret', event_kinds: ['pull_request', 'issue_comment'] },
    outbound: { default_webhook_url: '' }
  };

  let server;
  let port;

  it('starts and handles health check', async () => {
    if (existsSync(queuePath)) unlinkSync(queuePath);

    server = startWebhookServer(testConfig, () => {});
    await new Promise(r => server.on('listening', r));
    port = server.address().port;

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await res.json();
    assert.equal(body.status, 'ok');
  });

  it('rejects invalid signature', async () => {
    const payload = JSON.stringify({ action: 'opened', pull_request: {} });
    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'pull_request',
        'X-Hub-Signature-256': 'sha256=bad'
      },
      body: payload
    });
    assert.equal(res.status, 401);
  });

  it('queues valid pull_request.opened event', async () => {
    const payload = JSON.stringify({
      action: 'opened',
      pull_request: {
        html_url: 'https://github.com/test/repo/pull/1',
        title: 'Test PR',
        number: 1,
        head: { sha: 'abc123', ref: 'feature-branch' }
      },
      repository: {
        name: 'repo',
        full_name: 'test/repo',
        html_url: 'https://github.com/test/repo',
        owner: { login: 'test' }
      },
      sender: { login: 'testuser', html_url: 'https://github.com/testuser' }
    });

    const sig = 'sha256=' + createHmac('sha256', 'test-secret').update(payload).digest('hex');

    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'pull_request',
        'X-Hub-Signature-256': sig
      },
      body: payload
    });

    const body = await res.json();
    assert.equal(body.status, 'queued');
    assert.ok(body.trace_id);

    // Verify queue file
    const lines = readFileSync(queuePath, 'utf8').trim().split('\n');
    const event = JSON.parse(lines[lines.length - 1]);
    assert.equal(event.kind, 'github.pull_request.opened');
    assert.equal(event.refs.head_sha, 'abc123');
    assert.equal(event.repo.name, 'repo');
  });

  it('ignores non-allowlisted events', async () => {
    const payload = JSON.stringify({ action: 'completed' });
    const sig = 'sha256=' + createHmac('sha256', 'test-secret').update(payload).digest('hex');

    const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'push',
        'X-Hub-Signature-256': sig
      },
      body: payload
    });

    const body = await res.json();
    assert.equal(body.status, 'ignored');
  });

  after(() => {
    if (server) server.close();
    if (existsSync(queuePath)) unlinkSync(queuePath);
  });
});
