// SPDX-License-Identifier: AGPL-3.0-only

import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { nudgeTmux, nudgeCommand } from './utils.mjs';

/**
 * Room Poller — polls Ant Farm room API directly and nudges IDE tmux session.
 * Works for any IDE agent (Claude Code, Codex, Gemini, Cursor).
 * No webhooks required — just an API key and a tmux session.
 *
 * Usage:
 *   ide-agent-kit poll --rooms thinkoff-development,feature-admin-planning \
 *     --api-key <key> --handle @myhandle [--interval 30] [--config <path>]
 */

const SEEN_FILE_DEFAULT = '/tmp/iak-seen-ids.txt';

function loadSeenIds(path) {
  try {
    return new Set(readFileSync(path, 'utf8').split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

function saveSeenIds(path, ids) {
  // Keep last 1000 IDs to prevent unbounded growth
  const arr = [...ids].slice(-1000);
  writeFileSync(path, arr.join('\n') + '\n');
}

async function fetchRoomMessages(room, apiKey, limit = 10) {
  const url = `https://antfarm.world/api/v1/rooms/${room}/messages?limit=${limit}`;
  try {
    const result = execSync(
      `curl -sS -H "Authorization: Bearer ${apiKey}" "${url}"`,
      { encoding: 'utf8', timeout: 15000 }
    );
    const data = JSON.parse(result);
    return data.messages || (Array.isArray(data) ? data : []);
  } catch (e) {
    console.error(`  fetch ${room} failed: ${e.message}`);
    return [];
  }
}

export async function startRoomPoller({ rooms, apiKey, handle, interval, config }) {
  const seenFile = config?.poller?.seen_file || SEEN_FILE_DEFAULT;
  const queuePath = config?.queue?.path || './ide-agent-queue.jsonl';
  const session = config?.tmux?.ide_session || config?.tmux?.default_session || 'claude';
  const nudgeText = config?.tmux?.nudge_text || 'check rooms';
  const nudgeMode = config?.poller?.nudge_mode || 'tmux';
  const nudgeCommandText = config?.poller?.nudge_command || '';
  const pollInterval = interval || config?.poller?.interval_sec || 30;
  const selfHandle = handle || config?.poller?.handle || '@unknown';

  console.log('Room poller started');
  console.log(`  rooms: ${rooms.join(', ')}`);
  console.log(`  handle: ${selfHandle} (messages from self are ignored)`);
  console.log(`  interval: ${pollInterval}s`);
  console.log(`  nudge mode: ${nudgeMode}`);
  if (nudgeMode === 'tmux') {
    console.log(`  tmux session: ${session}`);
  } else if (nudgeMode === 'command') {
    console.log(`  nudge command: ${nudgeCommandText || '(missing)'}`);
  }
  console.log(`  seen file: ${seenFile}`);
  console.log(`  queue: ${queuePath}`);
  console.log('  auto-ack: disabled (real replies only)');

  const seen = loadSeenIds(seenFile);

  // Seed: mark current messages as seen on first run
  if (seen.size === 0) {
    console.log('  seeding seen IDs from current messages...');
    for (const room of rooms) {
      const msgs = await fetchRoomMessages(room, apiKey, 50);
      for (const m of msgs) {
        if (m.id) seen.add(m.id);
      }
    }
    saveSeenIds(seenFile, seen);
    console.log(`  seeded ${seen.size} IDs`);
  }

  async function poll() {
    let newCount = 0;
    for (const room of rooms) {
      const msgs = await fetchRoomMessages(room, apiKey);
      for (const m of msgs) {
        const mid = m.id;
        if (!mid || seen.has(mid)) continue;
        seen.add(mid);

        const sender = m.from || m.sender || '?';
        // Skip own messages
        if (sender === selfHandle || sender === selfHandle.replace('@', '')) continue;

        const body = (m.body || '').slice(0, 500);
        const ts = m.created_at || new Date().toISOString();

        // Write to queue
        const event = {
          trace_id: randomUUID(),
          event_id: mid,
          source: 'antfarm',
          kind: 'antfarm.message.created',
          timestamp: ts,
          room,
          actor: { login: sender },
          payload: { body, room }
        };
        appendFileSync(queuePath, JSON.stringify(event) + '\n');
        newCount++;

        console.log(`  [${ts.slice(0, 19)}] ${sender} in ${room}: ${body.slice(0, 80)}...`);
      }
    }

    saveSeenIds(seenFile, seen);

    if (newCount > 0) {
      let nudged = false;
      if (nudgeMode === 'command') {
        nudged = nudgeCommand(nudgeCommandText, { text: nudgeText, session });
      } else if (nudgeMode === 'none') {
        nudged = true;
      } else {
        nudged = nudgeTmux(session, nudgeText);
      }
      console.log(`  ${newCount} new message(s) → ${nudged ? 'nudged' : 'nudge failed'}`);
    }
  }

  // Initial poll
  await poll();

  // Start interval
  const timer = setInterval(poll, pollInterval * 1000);

  // Anti-sleep heartbeat (keeps terminal pseudo-active to prevent display-sleep freeze)
  const heartbeat = nudgeMode === 'tmux'
    ? setInterval(() => {
      try {
        execSync(`tmux send-keys -t ${JSON.stringify(session)} Escape`);
      } catch {
        // no-op
      }
    }, 4 * 60 * 1000)
    : null;

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\nPoller stopped.');
    clearInterval(timer);
    if (heartbeat) clearInterval(heartbeat);
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    clearInterval(timer);
    if (heartbeat) clearInterval(heartbeat);
    process.exit(0);
  });

  return timer;
}
