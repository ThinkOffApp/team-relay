import { execSync } from 'node:child_process';

/**
 * OpenClaw Cron — Scheduled task management via CLI.
 *
 * Uses `openclaw cron` CLI commands since the gateway uses WebSocket for RPC.
 *
 * Config:
 *   openclaw.home  — OPENCLAW_HOME path
 *   openclaw.ssh   — SSH target (e.g., "family@localhost")
 *   openclaw.bin   — Path to openclaw binary
 */

const DEFAULTS = {
  home: '/Users/family/openclaw',
  bin: '/opt/homebrew/bin/openclaw',
  ssh: 'family@localhost'
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
    try { return { ok: true, data: JSON.parse(result) }; }
    catch { return { ok: true, data: result.trim() }; }
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    const stdout = e.stdout ? e.stdout.toString().trim() : '';
    return { ok: false, error: stderr || stdout || e.message };
  }
}

/**
 * List all cron jobs.
 */
export async function cronList(config, options = {}) {
  return ocExec(resolveOC(config, options), 'cron list', 15000);
}

/**
 * Add a new cron job.
 */
export async function cronAdd(config, params, options = {}) {
  const oc = resolveOC(config, options);
  const safeTask = params.task.replace(/'/g, "'\\''");
  let scheduleArg = '';
  if (params.schedule.cron) scheduleArg = `--cron '${params.schedule.cron}'`;
  else if (params.schedule.every) scheduleArg = `--every ${params.schedule.every}`;
  else if (params.schedule.at) scheduleArg = `--at '${params.schedule.at}'`;

  const agentArg = params.agentId ? `--agent ${params.agentId}` : '';
  const modeArg = params.mode ? `--mode ${params.mode}` : '';

  return ocExec(oc, `cron add --name '${params.name}' --task '${safeTask}' ${scheduleArg} ${agentArg} ${modeArg}`, 15000);
}

/**
 * Remove a cron job.
 */
export async function cronRemove(config, params, options = {}) {
  return ocExec(resolveOC(config, options), `cron remove --id '${params.jobId}'`, 15000);
}

/**
 * Trigger immediate execution of a cron job.
 */
export async function cronRun(config, params, options = {}) {
  return ocExec(resolveOC(config, options), `cron run --id '${params.jobId}'`, 60000);
}

/**
 * Get cron system status.
 */
export async function cronStatus(config, options = {}) {
  return ocExec(resolveOC(config, options), 'cron status', 15000);
}
