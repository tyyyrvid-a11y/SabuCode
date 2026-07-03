const express = require('express');
const { runAgent, runMultiAgent, COMMANDS } = require('../lib/nim');

const router = express.Router();

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
  const { command = null, commands = null, history = [], tools = true } = req.body || {};

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

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
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
          onAgentToolEnd: ({ id, name, args, result }) =>
            send('agent_tool_end', { id, name, args: slimArgsForEcho(name, args), result: summarizeToolResult(name, result) }),
          onAgentEnd: (d) => send('agent_end', d),
          onDelta: (text) => send('delta', { text })
        }
      );
    } else {
      await runAgent(
        { commands: cmdList, history, toolsEnabled },
        {
          onDelta: (text) => send('delta', { text }),
          onReasoning: (text) => send('thinking', { text }),
          onToolStart: ({ name, args }) => send('tool_start', { name, args }),
          onToolEnd: ({ name, args, result }) => {
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
  } catch (err) {
    send('error', { message: err.message || 'Unexpected error' });
  } finally {
    res.end();
  }
});

module.exports = router;
