// SPDX-License-Identifier: AGPL-3.0-only

import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function createReceipt({ traceId, actor, action, status, exitCode, stdoutTail, stderrTail, notes, inputRefs, outputRefs, startedAt, finishedAt }) {
  return {
    trace_id: traceId || randomUUID(),
    idempotency_key: randomUUID(),
    actor: {
      name: actor?.name || 'ide-agent-kit',
      kind: actor?.kind || 'ide-agent'
    },
    action,
    input_refs: inputRefs || [],
    output_refs: outputRefs || [],
    status,
    exit_code: exitCode ?? null,
    stdout_tail: stdoutTail || '',
    stderr_tail: stderrTail || '',
    notes: notes || '',
    started_at: startedAt || new Date().toISOString(),
    finished_at: finishedAt || new Date().toISOString()
  };
}

export function appendReceipt(receiptPath, receipt) {
  appendFileSync(receiptPath, JSON.stringify(receipt) + '\n');
  return receipt;
}

export function tailReceipts(receiptPath, n = 5) {
  if (!existsSync(receiptPath)) return [];
  const lines = readFileSync(receiptPath, 'utf8').trim().split('\n').filter(Boolean);
  return lines.slice(-n).map(l => JSON.parse(l));
}
