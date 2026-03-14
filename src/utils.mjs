import { execSync } from 'node:child_process';

/**
 * Nudge a tmux session by sending a specific text and Enter key.
 * Used to wake up sleeping IDE agents.
 */
export function nudgeTmux(session, text = 'check rooms') {
  try {
    // Check if session exists
    execSync(`tmux has-session -t ${JSON.stringify(session)} 2>/dev/null`);
    
    // Send the nudge text
    execSync(`tmux send-keys -t ${JSON.stringify(session)} -l ${JSON.stringify(text)}`);
    
    // Small delay before sending Enter to ensure the text is processed
    setTimeout(() => {
      try {
        execSync(`tmux send-keys -t ${JSON.stringify(session)} Enter`);
      } catch {}
    }, 300);
    
    return true;
  } catch (e) {
    // Session not found or other tmux error
    return false;
  }
}

/**
 * Run an arbitrary command as a nudge bridge (for non-tmux IDEs, e.g. GUI apps).
 * Command runs with IAK_NUDGE_TEXT and IAK_TMUX_SESSION in env.
 */
export function nudgeCommand(command, { text = 'check rooms', session = '' } = {}) {
  if (!command || typeof command !== 'string') return false;
  try {
    execSync(command, {
      stdio: 'ignore',
      env: {
        ...process.env,
        IAK_NUDGE_TEXT: text,
        IAK_TMUX_SESSION: session
      }
    });
    return true;
  } catch {
    return false;
  }
}
