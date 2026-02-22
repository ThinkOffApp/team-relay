import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * OpenClaw Exec Approvals — Governance layer for agent command execution.
 *
 * Since the gateway uses WebSocket for RPC (not HTTP), this module manages
 * approvals via a local JSON file that both team-relay and judge-core can read/write.
 *
 * The approval workflow:
 *   1. Agent requests approval → written to approvals.json with status "pending"
 *   2. Judge (or admin) reviews → resolves with allow/deny
 *   3. Agent checks status before executing
 *
 * This also reads OpenClaw's native exec-approvals.json for allowlist integration.
 *
 * Files:
 *   ~/.openclaw/exec-approvals.json — OpenClaw native allowlist (per-agent, glob-based)
 *   ./exec-approvals.json           — team-relay approval queue
 */

const OPENCLAW_DATA = process.env.OPENCLAW_DATA || '/Users/family/.openclaw';

function resolveApprovalFile(config) {
  return config?.exec?.approvalFile || './exec-approvals.json';
}

function loadApprovals(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return { approvals: [] };
  }
}

function saveApprovals(filePath, data) {
  const dir = dirname(filePath);
  if (dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Request approval for a command execution.
 */
export async function execApprovalRequest(config, params, options = {}) {
  const filePath = resolveApprovalFile(config);
  const data = loadApprovals(filePath);

  const request = {
    requestId: randomUUID(),
    command: params.command,
    cwd: params.cwd || process.cwd(),
    agentId: params.agentId || 'unknown',
    reason: params.reason || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    decision: null,
    resolvedBy: null
  };

  data.approvals.push(request);
  saveApprovals(filePath, data);

  return { ok: true, data: { requestId: request.requestId, status: 'pending' } };
}

/**
 * Wait for a decision on a pending approval request (polls file).
 */
export async function execApprovalWait(config, params, options = {}) {
  const filePath = resolveApprovalFile(config);
  const timeout = params.timeoutMs || 60000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const data = loadApprovals(filePath);
    const req = data.approvals.find(a => a.requestId === params.requestId);
    if (!req) return { ok: false, error: 'Request not found' };
    if (req.status !== 'pending') {
      return { ok: true, data: { decision: req.decision, resolvedBy: req.resolvedBy, resolvedAt: req.resolvedAt } };
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  return { ok: false, error: 'Timeout waiting for decision' };
}

/**
 * Resolve a pending approval request.
 */
export async function execApprovalResolve(config, params, options = {}) {
  const filePath = resolveApprovalFile(config);
  const data = loadApprovals(filePath);

  const req = data.approvals.find(a => a.requestId === params.requestId);
  if (!req) return { ok: false, error: 'Request not found' };
  if (req.status !== 'pending') return { ok: false, error: `Already resolved: ${req.decision}` };

  req.status = 'resolved';
  req.decision = params.decision;
  req.resolvedBy = params.resolvedBy || 'admin';
  req.resolvedAt = new Date().toISOString();
  if (params.reason) req.resolveReason = params.reason;

  saveApprovals(filePath, data);

  return { ok: true, data: { requestId: req.requestId, decision: req.decision } };
}

/**
 * List approval requests.
 */
export async function execApprovalList(config, params = {}, options = {}) {
  const filePath = resolveApprovalFile(config);
  const data = loadApprovals(filePath);

  let results = data.approvals || [];
  if (params.agentId) results = results.filter(a => a.agentId === params.agentId);
  if (params.status && params.status !== 'all') results = results.filter(a => a.status === params.status);

  return { ok: true, data: results };
}

/**
 * Read OpenClaw's native exec-approvals.json (allowlists).
 */
export async function execAllowlistGet(config, options = {}) {
  const filePath = join(OPENCLAW_DATA, 'exec-approvals.json');
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'No OpenClaw exec-approvals.json found' };
  }
}
