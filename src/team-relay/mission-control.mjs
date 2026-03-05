// SPDX-License-Identifier: AGPL-3.0-only

import { createServer } from 'node:http';
import { initTaskQueue, addTask, startTask, completeTask, failTask, cancelTask, queueTask, draftTask, installTask, vote, reviewTask, setStatus, listTasks, getTask, missionControlData } from './task-queue.mjs';

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mission Control — IDE Agent Kit</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0d1117; color: #c9d1d9; padding: 20px; }
  h1 { color: #58a6ff; margin-bottom: 4px; font-size: 1.4em; }
  .subtitle { color: #8b949e; margin-bottom: 16px; font-size: 0.85em; }
  .stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 10px 14px; text-align: center; min-width: 70px; }
  .stat .num { font-size: 1.6em; font-weight: bold; }
  .stat .label { color: #8b949e; font-size: 0.75em; }
  .tabs { display: flex; gap: 4px; margin-bottom: 16px; flex-wrap: wrap; }
  .tab { padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.85em; border: 1px solid #30363d; background: #161b22; color: #8b949e; }
  .tab.active { color: #c9d1d9; border-color: #58a6ff; background: #1c2333; }
  .tab .count { margin-left: 4px; padding: 1px 6px; border-radius: 10px; font-size: 0.8em; background: #30363d; }
  .tab.proposed { border-color: #58a6ff; }
  .tab.recommended { border-color: #3fb950; }
  .tab.to_review { border-color: #d29922; }
  .tab.discarded { border-color: #f85149; }
  .tab.queued { border-color: #8b949e; }
  .tab.active_tab { border-color: #58a6ff; }
  .tab.drafted { border-color: #bc8cff; }
  .tab.to_install { border-color: #3fb950; }
  .tab.installed { border-color: #3fb950; }
  .panel { display: none; }
  .panel.visible { display: block; }
  .task-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; margin-bottom: 10px; }
  .task-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .task-title { font-weight: bold; flex: 1; }
  .task-title.recommended { color: #3fb950; }
  .task-title.to_review { color: #d29922; }
  .task-title.discarded { color: #f85149; }
  .task-meta { color: #8b949e; font-size: 0.8em; }
  .badge { padding: 2px 8px; border-radius: 12px; font-size: 0.75em; font-weight: bold; display: inline-block; margin-left: 4px; }
  .badge.feature { background: #1f6feb; color: #fff; }
  .badge.bug { background: #f85149; color: #fff; }
  .badge.approve { background: #238636; color: #fff; }
  .badge.reject { background: #da3633; color: #fff; }
  .badge.changes_requested { background: #d29922; color: #0d1117; }
  .badge.escalated { background: #f85149; color: #fff; }
  .votes, .reviews { margin-top: 6px; font-size: 0.85em; }
  .votes span, .reviews span { margin-right: 8px; }
  .agent-tag { color: #58a6ff; }
  .empty { color: #8b949e; padding: 20px; text-align: center; font-style: italic; }
  .refresh { color: #8b949e; font-size: 0.75em; margin-top: 16px; }
</style>
</head>
<body>
<h1>Mission Control</h1>
<p class="subtitle">IDE Agent Kit — team-relay</p>
<div class="stats" id="stats"></div>
<div class="tabs" id="tabs"></div>
<div id="panels"></div>
<p class="refresh">Auto-refreshes every 5s</p>
<script>
const TAB_ORDER = ['proposed','recommended','to_review','discarded','queued','active','drafted','to_install','installed','done'];
const TAB_LABELS = {proposed:'Proposed',recommended:'Recommended',to_review:'To Review',discarded:'Discarded',queued:'Queued',active:'Active',drafted:'Drafted',to_install:'To Install',installed:'Installed',done:'Done'};
let currentTab = 'proposed';

function voteColor(status) {
  return {proposed:'#58a6ff',recommended:'#3fb950',to_review:'#d29922',discarded:'#f85149',queued:'#8b949e',active:'#58a6ff',drafted:'#bc8cff',to_install:'#3fb950',installed:'#3fb950',done:'#388bfd'}[status]||'#8b949e';
}

async function load() {
  const data = await fetch('/api/status').then(r=>r.json());
  // Stats
  document.getElementById('stats').innerHTML =
    '<div class="stat"><div class="num" style="color:#58a6ff">'+data.proposed+'</div><div class="label">Proposed</div></div>'+
    '<div class="stat"><div class="num" style="color:#d29922">'+data.queued+'</div><div class="label">Queued</div></div>'+
    '<div class="stat"><div class="num" style="color:#3fb950">'+data.active+'</div><div class="label">Active</div></div>'+
    '<div class="stat"><div class="num" style="color:#c9d1d9">'+data.total+'</div><div class="label">Total</div></div>';
  // Tabs
  let tabsHtml = '';
  for (const t of TAB_ORDER) {
    const count = (data.tabs[t]||[]).length;
    const cls = t === currentTab ? 'tab active '+t : 'tab '+t;
    tabsHtml += '<div class="'+cls+'" onclick="switchTab(\\''+t+'\\')">'+TAB_LABELS[t]+'<span class="count">'+count+'</span></div>';
  }
  document.getElementById('tabs').innerHTML = tabsHtml;
  // Panels
  let panelsHtml = '';
  for (const t of TAB_ORDER) {
    const items = data.tabs[t]||[];
    const vis = t === currentTab ? 'panel visible' : 'panel';
    panelsHtml += '<div class="'+vis+'" id="panel-'+t+'">';
    if (items.length === 0) {
      panelsHtml += '<div class="empty">No tasks in '+TAB_LABELS[t]+'</div>';
    }
    for (const task of items) {
      const titleCls = ['recommended','to_review','discarded'].includes(task.status) ? 'task-title '+task.status : 'task-title';
      panelsHtml += '<div class="task-card">';
      panelsHtml += '<div class="task-header"><span class="'+titleCls+'">'+task.title+'</span>';
      panelsHtml += '<span class="badge '+task.type+'">'+task.type+'</span>';
      if (task.escalated) panelsHtml += '<span class="badge escalated">escalated</span>';
      panelsHtml += '</div>';
      panelsHtml += '<div class="task-meta"><span class="agent-tag">@'+task.agent+'</span> · '+task.id+' · '+task.updated.slice(0,16)+'</div>';
      // Votes
      if (Object.keys(task.votes||{}).length > 0) {
        panelsHtml += '<div class="votes">Votes: ';
        for (const [a,v] of Object.entries(task.votes)) {
          panelsHtml += '<span><span class="agent-tag">@'+a+'</span> <span class="badge '+v+'">'+v+'</span></span>';
        }
        panelsHtml += '</div>';
      }
      // Reviews
      if (Object.keys(task.reviews||{}).length > 0) {
        panelsHtml += '<div class="reviews">Reviews (round '+task.review_round+'): ';
        for (const [a,v] of Object.entries(task.reviews)) {
          panelsHtml += '<span><span class="agent-tag">@'+a+'</span> <span class="badge '+v+'">'+v.replace('_',' ')+'</span></span>';
        }
        panelsHtml += '</div>';
      }
      panelsHtml += '</div>';
    }
    panelsHtml += '</div>';
  }
  document.getElementById('panels').innerHTML = panelsHtml;
}
function switchTab(t) { currentTab = t; load(); }
load();
setInterval(load, 5000);
</script>
</body>
</html>`;

export function startMissionControl(config, port = 4800) {
  const tasksFile = config?.tasks?.file || '.iak-tasks.json';
  initTaskQueue(tasksFile);

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(HTML);
      return;
    }

    if (url.pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(missionControlData()));
      return;
    }

    if (url.pathname === '/api/tasks' && req.method === 'GET') {
      const status = url.searchParams.get('status');
      const agent = url.searchParams.get('agent');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listTasks({ status, agent })));
      return;
    }

    if (url.pathname === '/api/tasks' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { agent, title, priority, type } = JSON.parse(body);
          const task = addTask(agent, title, { priority: priority || 0, type: type || 'feature' });
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(task));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Task actions: POST /api/tasks/:id/:action
    const actionMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(\w+)$/);
    if (actionMatch && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const [, taskId, action] = actionMatch;
        let parsed = {};
        try { parsed = body ? JSON.parse(body) : {}; } catch {}

        let task;
        switch (action) {
          case 'vote':
            task = vote(taskId, parsed.agent, parsed.decision);
            break;
          case 'queue':
            task = queueTask(taskId);
            break;
          case 'start':
            task = startTask(taskId);
            break;
          case 'draft':
            task = draftTask(taskId);
            break;
          case 'review':
            task = reviewTask(taskId, parsed.reviewer, parsed.decision);
            break;
          case 'install':
            task = installTask(taskId);
            break;
          case 'done':
            task = completeTask(taskId, parsed.result);
            break;
          case 'fail':
            task = failTask(taskId, parsed.reason);
            break;
          case 'cancel':
            task = cancelTask(taskId);
            break;
          case 'status':
            task = setStatus(taskId, parsed.status);
            break;
          default:
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unknown action: ' + action }));
            return;
        }

        if (!task) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task not found or invalid params' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(task));
      });
      return;
    }

    // GET single task
    const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === 'GET') {
      const task = getTask(taskMatch[1]);
      if (!task) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(task));
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Mission Control: http://127.0.0.1:${port}/`);
  });

  return server;
}
