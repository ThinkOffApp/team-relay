// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/**
 * Task Queue — lightweight agent task tracking for mission control.
 *
 * Each agent has a queue of tasks ordered by priority (oldest first by default).
 * Tasks have states: queued → in_progress → done | failed | cancelled.
 * The queue is persisted to a JSON file for visibility and crash recovery.
 *
 * This is intentionally simple — most teams will use their own mission control.
 * This module provides the data layer; the webhook server exposes the dashboard.
 */

const DEFAULT_FILE = '.iak-tasks.json';

let tasksFile = DEFAULT_FILE;
let tasks = {};  // { [taskId]: { id, agent, title, status, priority, created, updated, result } }

export function initTaskQueue(filePath) {
  tasksFile = filePath || DEFAULT_FILE;
  if (existsSync(tasksFile)) {
    try {
      tasks = JSON.parse(readFileSync(tasksFile, 'utf8'));
    } catch {
      tasks = {};
    }
  }
}

function save() {
  writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
}

export function addTask(agent, title, { priority = 0 } = {}) {
  const id = randomUUID().slice(0, 8);
  tasks[id] = {
    id,
    agent,
    title,
    status: 'queued',
    priority,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    result: null
  };
  save();
  return tasks[id];
}

export function startTask(taskId) {
  if (!tasks[taskId]) return null;
  tasks[taskId].status = 'in_progress';
  tasks[taskId].updated = new Date().toISOString();
  save();
  return tasks[taskId];
}

export function completeTask(taskId, result = null) {
  if (!tasks[taskId]) return null;
  tasks[taskId].status = 'done';
  tasks[taskId].result = result;
  tasks[taskId].updated = new Date().toISOString();
  save();
  return tasks[taskId];
}

export function failTask(taskId, reason = null) {
  if (!tasks[taskId]) return null;
  tasks[taskId].status = 'failed';
  tasks[taskId].result = reason;
  tasks[taskId].updated = new Date().toISOString();
  save();
  return tasks[taskId];
}

export function cancelTask(taskId) {
  if (!tasks[taskId]) return null;
  tasks[taskId].status = 'cancelled';
  tasks[taskId].updated = new Date().toISOString();
  save();
  return tasks[taskId];
}

export function getTask(taskId) {
  return tasks[taskId] || null;
}

export function listTasks({ agent, status } = {}) {
  let result = Object.values(tasks);
  if (agent) result = result.filter(t => t.agent === agent);
  if (status) result = result.filter(t => t.status === status);
  // Oldest first, then by priority (higher = more important)
  result.sort((a, b) => b.priority - a.priority || new Date(a.created) - new Date(b.created));
  return result;
}

export function nextTask(agent) {
  const queued = listTasks({ agent, status: 'queued' });
  return queued[0] || null;
}

export function agentStatus(agent) {
  const all = listTasks({ agent });
  const current = all.find(t => t.status === 'in_progress') || null;
  const queued = all.filter(t => t.status === 'queued');
  const done = all.filter(t => t.status === 'done');
  const failed = all.filter(t => t.status === 'failed');
  return { agent, current, queued: queued.length, done: done.length, failed: failed.length, next: queued[0] || null };
}

export function missionControlData() {
  const agents = [...new Set(Object.values(tasks).map(t => t.agent))];
  return {
    agents: agents.map(a => agentStatus(a)),
    total: Object.keys(tasks).length,
    active: Object.values(tasks).filter(t => t.status === 'in_progress').length,
    queued: Object.values(tasks).filter(t => t.status === 'queued').length
  };
}
