import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createReceipt, appendReceipt, tailReceipts } from '../src/receipt.mjs';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';

describe('receipt', () => {
  const testPath = '/tmp/iak-test-receipts.jsonl';

  it('createReceipt returns valid receipt', () => {
    const r = createReceipt({
      action: { kind: 'tmux.run', session: 'test', cmd: 'echo hi' },
      status: 'ok',
      exitCode: 0,
      stdoutTail: 'hi\n'
    });
    assert.equal(r.status, 'ok');
    assert.equal(r.exit_code, 0);
    assert.equal(r.action.kind, 'tmux.run');
    assert.ok(r.trace_id);
    assert.ok(r.idempotency_key);
    assert.ok(r.started_at);
  });

  it('appendReceipt + tailReceipts round-trip', () => {
    if (existsSync(testPath)) unlinkSync(testPath);
    const r1 = createReceipt({ action: { kind: 'tmux.run' }, status: 'ok' });
    const r2 = createReceipt({ action: { kind: 'webhook.emit' }, status: 'error' });
    appendReceipt(testPath, r1);
    appendReceipt(testPath, r2);
    const tail = tailReceipts(testPath, 2);
    assert.equal(tail.length, 2);
    assert.equal(tail[0].action.kind, 'tmux.run');
    assert.equal(tail[1].action.kind, 'webhook.emit');
    unlinkSync(testPath);
  });

  it('tailReceipts returns empty for missing file', () => {
    const tail = tailReceipts('/tmp/iak-nonexistent.jsonl');
    assert.deepEqual(tail, []);
  });
});
