// SPDX-License-Identifier: AGPL-3.0-only

import { execSync } from 'node:child_process';

/**
 * OpenClaw Sessions — Agent-to-agent communication via CLI.
 *
 * Uses `openclaw agent` and `openclaw sessions` CLI commands since
 * the gateway uses WebSocket (not HTTP) for RPC.
 *
 * Config:
 *   openclaw.home  — OPENCLAW_HOME path
 *   openclaw.ssh   — SSH target (e.g., "family@localhost")
 *   openclaw.bin   — Path to openclaw binary
 */

const DEFAULTS = {
  home: process.env.OPENCLAW_HOME || '',
  bin: process.env.OPENCLAW_BIN || 'openclaw',
  ssh: process.env.OPENCLAW_SSH || ''
};

function resolveOC(config, options = {}) {
  return {
    home: options.home || config?.openclaw?.home || DEFAULTS.home,
    bin: options.bin || config?.openclaw?.bin || DEFAULTS.bin,
    ssh: options.ssh || config?.openclaw?.ssh || DEFAULTS.ssh
  };
}

function ocExec(oc, subcommand, timeoutMs = 60000) {
  const envPrefix = `export PATH=/opt/homebrew/bin:$PATH && export OPENCLAW_HOME=${oc.home}`;
  const cmd = oc.ssh
    ? `ssh ${oc.ssh} '${envPrefix} && ${oc.bin} ${subcommand}'`
    : `${envPrefix} && ${oc.bin} ${subcommand}`;

  try {
    const result = execSync(cmd, { encoding: 'utf8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] });
    try { return { ok: true, data: JSON.parse(result) }; }
    catch { return { ok: true, data: result.trim() }; }
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    const stdout = e.stdout ? e.stdout.toString().trim() : '';
    return { ok: false, error: stderr || stdout || e.message };
  }
}

/**
 * Send a message to another agent.
 * `openclaw agent --message <text> --agent <id> --json`
 */
export async function sessionsSend(config, params, options = {}) {
  const oc = resolveOC(config, options);
  const agentArg = params.agentId ? `--agent ${params.agentId}` : '';
  const safeMsg = params.message.replace(/'/g, "'\\''");
  const timeout = (params.timeoutSeconds || 60) * 1000 + 5000;
  return ocExec(oc, `agent --message '${safeMsg}' ${agentArg} --json`, timeout);
}

/**
 * Spawn a sub-agent task.
 * `openclaw agent --message <task> --agent <id> --json`
 */
export async function sessionsSpawn(config, params, options = {}) {
  const oc = resolveOC(config, options);
  const agentArg = params.agentId ? `--agent ${params.agentId}` : '';
  const modelArg = params.model ? `--model ${params.model}` : '';
  const safeTask = params.task.replace(/'/g, "'\\''");
  const timeout = (params.runTimeoutSeconds || 120) * 1000 + 5000;
  return ocExec(oc, `agent --message '${safeTask}' ${agentArg} ${modelArg} --json`, timeout);
}

/**
 * List active sessions.
 * `openclaw sessions --json`
 */
export async function sessionsList(config, params = {}, options = {}) {
  const oc = resolveOC(config, options);
  return ocExec(oc, 'sessions --json', 15000);
}

/**
 * Fetch session history.
 * Reads session transcript files directly from the agent's sessions dir.
 */
export async function sessionsHistory(config, params, options = {}) {
  const oc = resolveOC(config, options);
  const dataDir = oc.home.replace(/\/openclaw$/, '/.openclaw');

  // Parse session key: agent:<agentId>:<type>
  const key = params.sessionKey || '';
  const parts = key.split(':');
  const agentId = parts[1] || 'main';
  const limit = params.limit || 20;

  const readCmd = oc.ssh
    ? `ssh ${oc.ssh} 'ls -t ${dataDir}/agents/${agentId}/sessions/*.jsonl 2>/dev/null | head -1 | xargs tail -${limit}'`
    : `ls -t ${dataDir}/agents/${agentId}/sessions/*.jsonl 2>/dev/null | head -1 | xargs tail -${limit}`;

  try {
    const result = execSync(readCmd, { encoding: 'utf8', timeout: 15000 });
    const lines = result.trim().split('\n').filter(Boolean);
    const messages = lines.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
    return { ok: true, data: { sessionKey: key, messages } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Get session status via `openclaw status`.
 */
export async function sessionsStatus(config, params, options = {}) {
  return ocExec(resolveOC(config, options), 'status', 15000);
}
