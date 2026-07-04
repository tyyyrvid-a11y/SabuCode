const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { runAgent, runMultiAgent, COMMANDS } = require('../lib/nim');

const router = express.Router();

function getSupabaseClient(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.split(' ')[1];
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}

const COMMAND_NAMES = Object.keys(COMMANDS).concat('agent').join('|');
const LEADING_COMMANDS_RE = new RegExp(`^(?:\\s*/(?:${COMMAND_NAMES})\\b[ \\t]*)+`, 'i');

function summarizeToolResult(name, result) {
  if (result?.error) return { error: result.error };
  if (name === 'web_search') return { count: result?.results?.length || 0 };
  if (name === 'fetch_url') return { url: result?.url, title: result?.title, chars: result?.text?.length || 0 };
  if (name === 'get_current_datetime') return result;
  if (name === 'write_file') return { path: result?.path, bytes: result?.bytes };
  return {};
}

// tool_end mirrors args back for display, but write_file args carry the full file
// content — no need to duplicate that over the wire a second time.
function slimArgsForEcho(name, args) {
  if (name === 'write_file') return { path: args?.path };
  return args;
}

router.post('/', async (req, res) => {
  const { command = null, commands = null, history = [], tools = true, thinkingBudget = 0 } = req.body || {};

  if (!Array.isArray(history) || !history.length) {
    return res.status(400).json({ error: 'history must be a non-empty array' });
  }

  // accept either the legacy single `command` string or the new merged `commands` array
  const cmdList = Array.isArray(commands) && commands.length ? commands : (command ? [command] : []);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let fullAssistantText = '';

  const send = (event, data) => {
    if (res.writableEnded) return;
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      // Ignore write errors to let the agent finish in background
    }
  };

  const sources = [];
  const toolsEnabled = Boolean(tools);

  try {
    if (cmdList.includes('agent')) {
      const lastUser = [...history].reverse().find((t) => t.role === 'user');
      const task = (lastUser?.content || '').replace(LEADING_COMMANDS_RE, '').trim();
      if (!task) throw new Error('Describe the task for /agent to work on.');

      // other merged commands (e.g. /agent /think) layer their guidance on top of the
      // multi-agent flow's own system prompts instead of replacing them
      const extraCommands = cmdList.filter((c) => c !== 'agent' && COMMANDS[c]);
      const extraSystem = extraCommands.map((c) => COMMANDS[c].extra).join('\n\n') || null;

      await runMultiAgent(
        { task, toolsEnabled, extraSystem },
        {
          onPlan: (agents) => send('agent_plan', { agents }),
          onAgentStart: (d) => send('agent_start', d),
          onAgentDelta: (d) => send('agent_delta', d),
          onAgentToolStart: ({ id, name, args }) => send('agent_tool_start', { id, name, args }),
          onAgentToolEnd: ({ id, name, args, result }) => {
            if (name === 'write_file' && args?.path && typeof args?.content === 'string') {
              const ext = args.path.split('.').pop() || '';
              fullAssistantText += `\n\`\`\`${ext} path=${args.path}\n${args.content}\n\`\`\`\n`;
            }
            send('agent_tool_end', { id, name, args: slimArgsForEcho(name, args), result: summarizeToolResult(name, result) });
          },
          onAgentEnd: (d) => send('agent_end', d),
          onAgentFileStart: (d) => send('agent_file_start', d),
          onAgentFileDelta: (d) => send('agent_file_delta', d),
          onDelta: (text) => { fullAssistantText += text; send('delta', { text }); }
        }
      );
    } else {
      await runAgent(
        { commands: cmdList, history, toolsEnabled, thinkingBudget },
        {
          onDelta: (text) => { fullAssistantText += text; send('delta', { text }); },
          onReasoning: (text) => send('thinking', { text }),
          onFileStart: ({ path }) => send('file_start', { path }),
          onFileDelta: ({ path, text }) => send('file_delta', { path, text }),
          onToolStart: ({ name, args }) => send('tool_start', { name, args }),
          onToolEnd: ({ name, args, result }) => {
            if (name === 'write_file' && args?.path && typeof args?.content === 'string') {
              const ext = args.path.split('.').pop() || '';
              fullAssistantText += `\n\`\`\`${ext} path=${args.path}\n${args.content}\n\`\`\`\n`;
            }
            send('tool_end', { name, args: slimArgsForEcho(name, args), result: summarizeToolResult(name, result) });
            if (name === 'web_search' && Array.isArray(result?.results)) {
              sources.push(...result.results);
            }
          }
        }
      );
    }

    if (sources.length) send('sources', { sources });
    send('done', { ok: true });

    // Background sync: save the response even if the browser disconnected
    const sessionId = req.body.sessionId;
    if (sessionId && fullAssistantText) {
      const supabase = getSupabaseClient(req);
      if (supabase) {
        const finalHistory = [...history, { role: 'assistant', content: fullAssistantText }];
        await supabase.from('sessions').update({ messages: finalHistory, updated_at: new Date().toISOString() }).eq('id', sessionId);
      }
    }
  } catch (err) {
    send('error', { message: err.message || 'Unexpected error' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
