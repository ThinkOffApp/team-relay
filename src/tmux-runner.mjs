// SPDX-License-Identifier: AGPL-3.0-only

import { execSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReceipt, appendReceipt } from './receipt.mjs';

function tmuxSessionExists(session) {
  try {
    execSync(`tmux has-session -t ${JSON.stringify(session)} 2>/dev/null`);
    return true;
  } catch { return false; }
}

function ensureTmuxSession(session) {
  if (!tmuxSessionExists(session)) {
    execSync(`tmux new-session -d -s ${JSON.stringify(session)}`);
  }
}

function isAllowed(cmd, allowlist) {
  if (!allowlist || allowlist.length === 0) return true;
  return allowlist.some(pattern => {
    if (cmd === pattern) return true;
    if (cmd.startsWith(pattern + ' ')) return true;
    return false;
  });
}

export async function tmuxRun({ session, cmd, cwd, timeoutSec, config }) {
  const startedAt = new Date().toISOString();
  const traceId = randomUUID();
  const receiptPath = config.receipts.path;
  const tailLines = config.receipts.stdout_tail_lines || 80;
  const sessionName = session || config.tmux.default_session;

  // Check allowlist
  if (!isAllowed(cmd, config.tmux.allow)) {
    const receipt = createReceipt({
      traceId,
      action: { kind: 'tmux.run', session: sessionName, cmd, cwd: cwd || process.cwd() },
      status: 'error',
      notes: `Command not in allowlist: ${cmd}`,
      startedAt
    });
    appendReceipt(receiptPath, receipt);
    return receipt;
  }

  ensureTmuxSession(sessionName);

  // Create a unique output marker and temp file for capturing output
  const marker = `__IAK_${traceId.slice(0, 8)}__`;
  const outFile = `/tmp/iak-out-${traceId.slice(0, 8)}`;
  const errFile = `/tmp/iak-err-${traceId.slice(0, 8)}`;
  const exitFile = `/tmp/iak-exit-${traceId.slice(0, 8)}`;

  // Build the command to run inside tmux
  const cdPart = cwd ? `cd ${JSON.stringify(cwd)} && ` : '';
  const wrappedCmd = `${cdPart}( ${cmd} ) > ${outFile} 2> ${errFile}; echo $? > ${exitFile}`;

  try {
    execSync(`tmux send-keys -t ${JSON.stringify(sessionName)} ${JSON.stringify(wrappedCmd)} C-m`);
  } catch (e) {
    const receipt = createReceipt({
      traceId,
      action: { kind: 'tmux.run', session: sessionName, cmd, cwd: cwd || process.cwd() },
      status: 'error',
      notes: `Failed to send command to tmux: ${e.message}`,
      startedAt
    });
    appendReceipt(receiptPath, receipt);
    return receipt;
  }

  // Poll for completion
  const timeout = (timeoutSec || 120) * 1000;
  const pollInterval = 500;
  const deadline = Date.now() + timeout;
  let exitCode = null;
  let stdout = '';
  let stderr = '';

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));
    try {
      const code = execSync(`cat ${exitFile} 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (code !== '') {
        exitCode = parseInt(code, 10);
        break;
      }
    } catch { /* not done yet */ }
  }

  const finishedAt = new Date().toISOString();
  let status = 'ok';

  if (exitCode === null) {
    status = 'timeout';
  } else if (exitCode !== 0) {
    status = 'error';
  }

  // Read output
  try { stdout = execSync(`tail -${tailLines} ${outFile} 2>/dev/null`, { encoding: 'utf8' }); } catch {}
  try { stderr = execSync(`tail -${tailLines} ${errFile} 2>/dev/null`, { encoding: 'utf8' }); } catch {}

  // Cleanup temp files
  try { execSync(`rm -f ${outFile} ${errFile} ${exitFile}`); } catch {}

  const receipt = createReceipt({
    traceId,
    action: {
      kind: 'tmux.run',
      session: sessionName,
      cmd,
      cwd: cwd || process.cwd(),
      timeout_sec: timeoutSec || 120
    },
    status,
    exitCode,
    stdoutTail: stdout,
    stderrTail: stderr,
    startedAt,
    finishedAt
  });

  appendReceipt(receiptPath, receipt);
  return receipt;
}
