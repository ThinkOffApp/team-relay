// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * File-based memory for IDE agents with two backends:
 *
 * Backend "local" (default):
 *   Stores markdown files in a local `memory/` directory.
 *   Good for IDE agents (Claude Code, Codex, Gemini, Cursor).
 *
 * Backend "openclaw":
 *   Reads/writes to OpenClaw agent workspace memory directories.
 *   Good for bots running on the OpenClaw gateway.
 *   Requires --agent <name> to resolve workspace path.
 *
 * CLI:
 *   ide-agent-kit memory list [--backend local|openclaw] [--agent <name>] [--config <path>]
 *   ide-agent-kit memory get --key <topic> [--backend ...] [--agent <name>]
 *   ide-agent-kit memory set --key <topic> --value <text> [--backend ...] [--agent <name>]
 *   ide-agent-kit memory append --key <topic> --value <text> [--backend ...] [--agent <name>]
 *   ide-agent-kit memory delete --key <topic> [--backend ...] [--agent <name>]
 */

const DEFAULT_MEMORY_DIR = './memory';
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || '/Users/family/openclaw';
const OPENCLAW_DATA = process.env.OPENCLAW_DATA || '/Users/family/.openclaw';

function resolveMemoryDir(config, options = {}) {
  const backend = options.backend || config?.memory?.backend || 'local';

  if (backend === 'openclaw') {
    const agent = options.agent || config?.memory?.agent;
    if (!agent) {
      throw new Error('OpenClaw backend requires --agent <name> (e.g., sally, ether, haruka)');
    }
    // OpenClaw stores memory in workspace-{agent}/memory/
    const wsDir = join(OPENCLAW_DATA, `workspace-${agent}`, 'memory');
    if (!existsSync(wsDir)) {
      mkdirSync(wsDir, { recursive: true });
    }
    return wsDir;
  }

  // Local backend
  const dir = config?.memory?.dir || DEFAULT_MEMORY_DIR;
  const resolved = resolve(dir);
  if (!existsSync(resolved)) {
    mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

function sanitizeKey(key) {
  return key.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
}

function keyToPath(memDir, key) {
  const safe = sanitizeKey(key);
  const filename = safe.endsWith('.md') ? safe : `${safe}.md`;
  return join(memDir, filename);
}

export function memoryList(config, options = {}) {
  const memDir = resolveMemoryDir(config, options);
  try {
    const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
    return files.map(f => ({
      key: f.replace(/\.md$/, ''),
      path: join(memDir, f),
      size: (() => { try { return readFileSync(join(memDir, f), 'utf8').length; } catch { return 0; } })()
    }));
  } catch {
    return [];
  }
}

export function memoryGet(config, key, options = {}) {
  const memDir = resolveMemoryDir(config, options);
  const path = keyToPath(memDir, key);
  try {
    return { key, path, content: readFileSync(path, 'utf8') };
  } catch {
    return { key, path, content: null, error: 'not found' };
  }
}

export function memorySet(config, key, value, options = {}) {
  const memDir = resolveMemoryDir(config, options);
  const path = keyToPath(memDir, key);
  writeFileSync(path, value);
  return { key, path, action: 'set', size: value.length };
}

export function memoryAppend(config, key, value, options = {}) {
  const memDir = resolveMemoryDir(config, options);
  const path = keyToPath(memDir, key);
  let existing = '';
  try { existing = readFileSync(path, 'utf8'); } catch { /* new file */ }
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const entry = `${separator}\n## ${timestamp}\n\n${value}\n`;
  writeFileSync(path, existing + entry);
  return { key, path, action: 'append', size: (existing + entry).length };
}

export function memoryDelete(config, key, options = {}) {
  const memDir = resolveMemoryDir(config, options);
  const path = keyToPath(memDir, key);
  try {
    unlinkSync(path);
    return { key, path, action: 'deleted' };
  } catch {
    return { key, path, action: 'not found' };
  }
}

/**
 * Semantic memory search via OpenClaw CLI.
 * Uses `openclaw memory search` for vector + BM25 hybrid search.
 *
 * Falls back to simple grep-based search of memory files if CLI is unavailable.
 *
 * @param {object} config
 * @param {string} query - natural language search query
 * @param {object} options - { agent?, maxResults?, ssh?, home?, bin? }
 * @returns {object} { ok, results: [{ path, score, snippet, line }] }
 */
export function memorySearch(config, query, options = {}) {
  const ssh = options.ssh || config?.openclaw?.ssh || 'family@localhost';
  const home = options.home || config?.openclaw?.home || '/Users/family/openclaw';
  const bin = options.bin || config?.openclaw?.bin || '/opt/homebrew/bin/openclaw';

  const safeQuery = query.replace(/'/g, "'\\''");
  const maxResults = options.maxResults || 10;
  const envPrefix = `export PATH=/opt/homebrew/bin:$PATH && export OPENCLAW_HOME=${home}`;
  const ocCmd = `${bin} memory search '${safeQuery}' --limit ${maxResults} --json 2>/dev/null`;

  const cmd = ssh
    ? `ssh ${ssh} '${envPrefix} && ${ocCmd}'`
    : `${envPrefix} && ${ocCmd}`;

  try {
    const result = execSync(cmd, { encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
    const data = JSON.parse(result);
    return { ok: true, results: data.results || data };
  } catch {
    // Fallback: simple grep over memory files
    return memorySearchFallback(config, query, options);
  }
}

function memorySearchFallback(config, query, options) {
  const memDir = resolveMemoryDir(config, options);
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  try {
    const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
    const results = [];

    for (const f of files) {
      const content = readFileSync(join(memDir, f), 'utf8');
      const lines = content.split('\n');
      let score = 0;

      for (const term of terms) {
        const count = (content.toLowerCase().match(new RegExp(term, 'g')) || []).length;
        score += count;
      }

      if (score > 0) {
        // Find best matching line
        let bestLine = 0;
        let bestScore = 0;
        for (let i = 0; i < lines.length; i++) {
          const lineScore = terms.reduce((s, t) => s + (lines[i].toLowerCase().includes(t) ? 1 : 0), 0);
          if (lineScore > bestScore) { bestScore = lineScore; bestLine = i + 1; }
        }

        results.push({
          path: join(memDir, f),
          score: score / (terms.length * 10),
          snippet: lines[bestLine - 1]?.slice(0, 200) || '',
          line: bestLine
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return { ok: true, results: results.slice(0, options.maxResults || 10), fallback: true };
  } catch (e) {
    return { ok: false, error: e.message, results: [] };
  }
}
