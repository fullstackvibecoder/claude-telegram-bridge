import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { config, getProject, getDefaultProject, type ProjectEntry } from './config.js';
import { formatToolUse } from './chunker.js';

interface SessionState {
  project: ProjectEntry;
  sessionId?: string;
  busy: boolean;
}

type StatusCallback = (status: string) => void;

// Per-user session state
const sessions = new Map<number, SessionState>();

export function getSession(userId: number): SessionState {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      project: getDefaultProject(),
      busy: false,
    });
  }
  return sessions.get(userId)!;
}

export function switchProject(userId: number, projectName: string): ProjectEntry | null {
  const proj = getProject(projectName);
  if (!proj) return null;

  const session = getSession(userId);
  session.project = proj;
  session.sessionId = undefined; // Reset session on project switch
  return proj;
}

export function getCurrentProject(userId: number): ProjectEntry {
  return getSession(userId).project;
}

export interface ClaudeResult {
  text: string;
  sessionId?: string;
  toolsUsed: string[];
}

/**
 * Send a prompt to Claude Code SDK and stream the result.
 * Calls onStatus with progress updates (tool use, etc.) during execution.
 */
export async function runPrompt(
  userId: number,
  prompt: string,
  onStatus?: StatusCallback
): Promise<ClaudeResult> {
  const session = getSession(userId);

  if (session.busy) {
    return {
      text: 'Claude is still working on your previous request. Please wait.',
      toolsUsed: [],
    };
  }

  session.busy = true;
  const toolsUsed: string[] = [];
  let resultText = '';
  let sessionId: string | undefined;

  try {
    const opts: Record<string, unknown> = {
      cwd: session.project.path,
      allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
      permissionMode: 'bypassPermissions',
      maxTurns: 50,
    };

    // Resume previous session if available
    if (session.sessionId) {
      opts.resume = session.sessionId;
    }

    const stream = query({ prompt, options: opts as any });

    for await (const message of stream) {
      // Capture session ID from init
      if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
        sessionId = message.session_id;
      }

      // Report tool progress as status
      if (message.type === 'tool_progress') {
        const status = `Working (${message.tool_name})...`;
        toolsUsed.push(message.tool_name);
        onStatus?.(status);
      }

      // Collect assistant text and detect tool use blocks
      if (message.type === 'assistant') {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              resultText += block.text;
            } else if (block.type === 'tool_use') {
              const status = formatToolUse(block.name, (block.input as Record<string, unknown>) || {});
              toolsUsed.push(block.name);
              onStatus?.(status);
            }
          }
        }
      }

      // Final result
      if (message.type === 'result') {
        if ('result' in message && message.result) {
          resultText = message.result;
        }
        sessionId = message.session_id;
      }
    }

    // Store session ID for conversation continuity
    if (sessionId) {
      session.sessionId = sessionId;
    }

    return {
      text: resultText || '(No output from Claude)',
      sessionId,
      toolsUsed: [...new Set(toolsUsed)],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      text: `Error: ${msg}`,
      toolsUsed,
    };
  } finally {
    session.busy = false;
  }
}

/**
 * Reset a user's session (clear conversation history).
 */
export function resetSession(userId: number): void {
  const session = getSession(userId);
  session.sessionId = undefined;
}
