import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Simple file-based memory for IDE agents.
 * Inspired by OpenClaw's session-memory hook.
 *
 * Memory is stored as markdown files in a `memory/` directory.
 * Each file is a topic (e.g., memory/room-context.md, memory/decisions.md).
 * Agents can read, write, append, and list memory files.
 *
 * CLI:
 *   ide-agent-kit memory list [--config <path>]
 *   ide-agent-kit memory get --key <topic> [--config <path>]
 *   ide-agent-kit memory set --key <topic> --value <text> [--config <path>]
 *   ide-agent-kit memory append --key <topic> --value <text> [--config <path>]
 *   ide-agent-kit memory delete --key <topic> [--config <path>]
 */

const DEFAULT_MEMORY_DIR = './memory';

function resolveMemoryDir(config) {
  const dir = config?.memory?.dir || DEFAULT_MEMORY_DIR;
  const resolved = resolve(dir);
  if (!existsSync(resolved)) {
    mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

function sanitizeKey(key) {
  // Allow alphanumeric, hyphens, underscores, dots
  return key.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
}

function keyToPath(memDir, key) {
  const safe = sanitizeKey(key);
  const filename = safe.endsWith('.md') ? safe : `${safe}.md`;
  return join(memDir, filename);
}

export function memoryList(config) {
  const memDir = resolveMemoryDir(config);
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

export function memoryGet(config, key) {
  const memDir = resolveMemoryDir(config);
  const path = keyToPath(memDir, key);
  try {
    return { key, path, content: readFileSync(path, 'utf8') };
  } catch {
    return { key, path, content: null, error: 'not found' };
  }
}

export function memorySet(config, key, value) {
  const memDir = resolveMemoryDir(config);
  const path = keyToPath(memDir, key);
  writeFileSync(path, value);
  return { key, path, action: 'set', size: value.length };
}

export function memoryAppend(config, key, value) {
  const memDir = resolveMemoryDir(config);
  const path = keyToPath(memDir, key);
  let existing = '';
  try { existing = readFileSync(path, 'utf8'); } catch { /* new file */ }
  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const entry = `${separator}\n## ${timestamp}\n\n${value}\n`;
  writeFileSync(path, existing + entry);
  return { key, path, action: 'append', size: (existing + entry).length };
}

export function memoryDelete(config, key) {
  const memDir = resolveMemoryDir(config);
  const path = keyToPath(memDir, key);
  try {
    unlinkSync(path);
    return { key, path, action: 'deleted' };
  } catch {
    return { key, path, action: 'not found' };
  }
}
