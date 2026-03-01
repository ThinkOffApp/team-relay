// SPDX-License-Identifier: AGPL-3.0-only

import { execSync } from 'node:child_process';

/**
 * OpenClaw Gateway Client — uses `openclaw` CLI for reliable communication.
 *
 * The gateway uses WebSocket (not HTTP) for RPC, so we shell out to the
 * `openclaw` CLI which handles auth and transport correctly.
 *
 * For environments where `openclaw` runs under a different user (e.g., family),
 * set openclaw.ssh in config to route via SSH.
 *
 * Config:
 *   openclaw.home  — OPENCLAW_HOME path (env: OPENCLAW_HOME)
 *   openclaw.ssh   — SSH target for remote execution (e.g., "user@localhost")
 *   openclaw.bin   — Path to openclaw binary (env: OPENCLAW_BIN, default: "openclaw")
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

function ocExec(oc, subcommand, timeoutMs = 30000) {
  const envPrefix = `export PATH=/opt/homebrew/bin:$PATH && export OPENCLAW_HOME=${oc.home}`;
  const cmd = oc.ssh
    ? `ssh ${oc.ssh} '${envPrefix} && ${oc.bin} ${subcommand}'`
    : `${envPrefix} && ${oc.bin} ${subcommand}`;

  try {
    const result = execSync(cmd, { encoding: 'utf8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] });
    // Try to parse as JSON, fall back to raw text
    try {
      return { ok: true, data: JSON.parse(result) };
    } catch {
      return { ok: true, data: result.trim() };
    }
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    const stdout = e.stdout ? e.stdout.toString().trim() : '';
    return { ok: false, error: stderr || stdout || e.message };
  }
}

/**
 * Trigger an agent turn via CLI.
 * `openclaw agent --message <text> --agent <id> --json`
 */
export async function triggerAgent(config, params, options = {}) {
  const oc = resolveOC(config, options);
  const agentArg = params.agentId ? `--agent ${params.agentId}` : '';
  const modelArg = params.model ? `--model ${params.model}` : '';
  // Escape the message for shell
  const safeMsg = params.message.replace(/'/g, "'\\''");
  return ocExec(oc, `agent --message '${safeMsg}' ${agentArg} ${modelArg} --json`, 120000);
}

/**
 * Check gateway health.
 * `openclaw status`
 */
export async function healthCheck(config, options = {}) {
  const oc = resolveOC(config, options);
  return ocExec(oc, 'status', 15000);
}

/**
 * Deep health check with probes.
 * `openclaw status --deep`
 */
export async function healthDeep(config, options = {}) {
  const oc = resolveOC(config, options);
  return ocExec(oc, 'status --deep', 30000);
}

/**
 * List all configured agents.
 * `openclaw agents list`
 */
export async function agentsList(config, options = {}) {
  const oc = resolveOC(config, options);
  return ocExec(oc, 'agents list', 15000);
}

/**
 * Get gateway configuration.
 * Reads openclaw.json directly.
 */
export async function configGet(config, options = {}) {
  const oc = resolveOC(config, options);
  const cmd = oc.ssh
    ? `ssh ${oc.ssh} 'cat ${oc.home}/openclaw.json'`
    : `cat ${oc.home}/openclaw.json`;
  try {
    const result = execSync(cmd, { encoding: 'utf8', timeout: 10000 });
    return { ok: true, data: JSON.parse(result) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Patch gateway configuration (merge into openclaw.json).
 * Reads current, deep-merges patch, writes back.
 */
export async function configPatch(config, patch, options = {}) {
  const current = await configGet(config, options);
  if (!current.ok) return current;

  const oc = resolveOC(config, options);
  const merged = deepMerge(current.data, patch);
  const json = JSON.stringify(merged, null, 2);
  const safeJson = json.replace(/'/g, "'\\''");

  const cmd = oc.ssh
    ? `ssh ${oc.ssh} "echo '${safeJson}' > ${oc.home}/openclaw.json"`
    : `echo '${safeJson}' > ${oc.home}/openclaw.json`;
  try {
    execSync(cmd, { encoding: 'utf8', timeout: 10000 });
    return { ok: true, data: merged, action: 'patched' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Restart the gateway.
 * `openclaw gateway --force &`
 */
export async function gatewayRestart(config, options = {}) {
  const oc = resolveOC(config, options);
  const envPrefix = `export PATH=/opt/homebrew/bin:$PATH && export OPENCLAW_HOME=${oc.home}`;
  const cmd = oc.ssh
    ? `ssh ${oc.ssh} '${envPrefix} && nohup ${oc.bin} gateway --force > /tmp/gw_restart.log 2>&1 &'`
    : `${envPrefix} && nohup ${oc.bin} gateway --force > /tmp/gw_restart.log 2>&1 &`;
  try {
    execSync(cmd, { encoding: 'utf8', timeout: 10000 });
    return { ok: true, action: 'restart initiated' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
