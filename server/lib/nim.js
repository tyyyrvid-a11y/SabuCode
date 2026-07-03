const { searchDuckDuckGo, fetchUrlContent } = require('./search');

const BASE_URL = process.env.NVIDIA_NIM_BASE_URL || 'https://integrate.api.nvidia.com/v1';
const API_KEY = process.env.NVIDIA_NIM_API_KEY;
const MODEL = process.env.NVIDIA_NIM_MODEL || 'z-ai/glm-5.2';
const MAX_TOKENS = Number(process.env.NVIDIA_NIM_MAX_TOKENS) || 16384;

const MAX_TOOL_STEPS = 10;
const MAX_SUBAGENTS = 4;
const MAX_CONCURRENT_SUBAGENTS = 2; // cap parallel NIM calls so rate-limited keys don't 429

const FILE_TOOL_RULE = [
  'To create or update a file (code, a webpage, a document, anything file-shaped), you MUST call the',
  '`write_file` tool once per file — pass the full final contents in the `content` argument.',
  'Do NOT paste full file contents as plain text or inside fenced code blocks in your chat reply; the UI',
  'renders files exclusively from write_file tool calls, so anything only written as chat text will not be',
  'saved, downloadable, or previewable. Short inline snippets (a few lines) to explain something are fine.',
  'After calling write_file for everything needed, reply with a brief, friendly summary of what you built.'
].join('\n');

// single unified persona — replaces the old per-mode system prompts
const BASE_SYSTEM = [
  'You are SabuCode, an all-in-one AI assistant: an expert software engineer, a meticulous researcher, a sharp',
  'corporate/business assistant, and a witty creative writer, all at once. Read the user\'s request and adapt',
  'your tone, depth and format to whatever they actually need in the moment — you do not need to be told which',
  '"mode" to be in.',
  FILE_TOOL_RULE,
  'When asked for a website or app, prefer a single self-contained index.html (inline <style>/<script>) unless',
  'the user asks for a specific framework — the app has a live preview pane that renders index.html and',
  'React-style components directly, so keep generated sites dependency-free (no external CSS/JS files, no npm',
  'imports) so the preview can run them without a build step.',
  'You have web_search, fetch_url, and get_current_datetime tools — use them whenever you need current facts,',
  'documentation, or the real date instead of guessing. When researching, cite sources inline as [1], [2], etc.',
  'Be clear and well-structured (headings, bullet points, code blocks) without padding responses with fluff.'
].join('\n');

// per-command layers on top of BASE_SYSTEM, triggered by /createfile, /think, /text
const COMMANDS = {
  createfile: {
    label: 'Create file',
    temperature: 0.5,
    extra:
      'The user invoked /createfile: they specifically want real file(s) created (or updated) for what they ' +
      'describe below. Use write_file for every file — never just describe or paste the file as text. Keep your ' +
      'chat reply to a short, friendly summary; let the files speak for themselves.'
  },
  think: {
    label: 'Think',
    temperature: 0.4,
    extra:
      'The user invoked /think: they want careful, deliberate reasoning. First, reason through the problem step ' +
      'by step inside a <thinking>...</thinking> block — consider alternatives, check your own work, catch ' +
      'mistakes. This block is shown to the user as a separate "thinking" panel, not as your answer. After the ' +
      'closing </thinking> tag, write your final, concise answer as normal text outside the block. Always include ' +
      'both a <thinking> block and a final answer after it.'
  },
  text: {
    label: 'Creative writing',
    temperature: 0.95,
    extra:
      'The user invoked /text: they want creative writing (a story, poem, essay, lyrics, dialogue, etc). Focus ' +
      'entirely on high-quality, evocative prose or verse. Respond directly in the chat with rich formatting; do ' +
      'not create files unless they explicitly ask you to.'
  }
};

const PLAN_SYSTEM = [
  'You are the planning module of a multi-agent system. Break the user\'s task into 2 to ' + MAX_SUBAGENTS,
  'independent subagent assignments that can run in parallel and, together, fully accomplish the task. If the',
  'task is simple, a single agent is fine.',
  'Respond with ONLY compact JSON, no prose, no markdown fences, in exactly this shape:',
  '{"agents":[{"name":"short role name","instructions":"detailed, fully self-contained instructions for this agent"}]}',
  'Each subagent has the same tools as you (web_search, fetch_url, get_current_datetime, write_file) but no',
  'knowledge of the other subagents or of this conversation, so every "instructions" field must stand alone.'
].join('\n');

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the public web via DuckDuckGo. Use for current events, facts, documentation, or anything you are not certain about.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          limit: { type: 'integer', description: 'Max results to return (1-8), default 6' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description:
        'Fetch a specific public web page and return its readable text content (e.g. to read an article or docs page found via web_search).',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute http(s) URL to fetch' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_current_datetime',
      description: "Get the current real-world date/time in ISO 8601 (UTC). Use this instead of guessing today's date.",
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Create or overwrite a single file (code, HTML/CSS/JS, a document, etc.) in the user project. Call once per file with the complete final contents. This is the only way files reach the UI, the live preview and the .zip export.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative file path, e.g. index.html or src/App.jsx' },
          content: { type: 'string', description: 'The full, final contents of the file' }
        },
        required: ['path', 'content']
      }
    }
  }
];

function assertConfigured() {
  if (!API_KEY || API_KEY.includes('REPLACE_WITH_YOUR_KEY')) {
    const err = new Error(
      'NVIDIA NIM API key is not configured. Set NVIDIA_NIM_API_KEY in your .env file.'
    );
    err.status = 503;
    throw err;
  }
}

function buildMessages(history, extraSystem) {
  const messages = [{ role: 'system', content: extraSystem ? `${BASE_SYSTEM}\n\n${extraSystem}` : BASE_SYSTEM }];
  for (const turn of history || []) {
    if (turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string') {
      messages.push({ role: turn.role, content: turn.content });
    }
  }
  return messages;
}

async function executeTool(name, args) {
  try {
    if (name === 'web_search') {
      const limit = Math.min(Math.max(Number(args.limit) || 6, 1), 8);
      const results = await searchDuckDuckGo(String(args.query || ''), { limit });
      return { results };
    }
    if (name === 'fetch_url') {
      return await fetchUrlContent(String(args.url || ''));
    }
    if (name === 'get_current_datetime') {
      return { iso: new Date().toISOString() };
    }
    if (name === 'write_file') {
      const path = String(args.path || '').trim();
      const content = String(args.content ?? '');
      if (!path) return { error: 'Missing path' };
      return { ok: true, path, bytes: content.length };
    }
    return { error: `Unknown tool: ${name}` };
  } catch (err) {
    return { error: err.message || String(err) };
  }
}

// splits a stream of text chunks around <thinking>...</thinking> tags, forwarding
// reasoning text to onReasoning and everything else to onDelta — used as a fallback
// for models/deployments that don't stream a native `reasoning_content` field.
function makeThinkingSplitter(onReasoning, onDelta) {
  const OPEN = '<thinking>';
  const CLOSE = '</thinking>';
  let mode = 'content';
  let buf = '';

  function drain(final) {
    let progressed = true;
    while (progressed) {
      progressed = false;
      const tag = mode === 'content' ? OPEN : CLOSE;
      const emit = mode === 'content' ? onDelta : onReasoning;
      const idx = buf.indexOf(tag);
      if (idx !== -1) {
        if (idx) emit(buf.slice(0, idx));
        buf = buf.slice(idx + tag.length);
        mode = mode === 'content' ? 'thinking' : 'content';
        progressed = true;
      } else {
        const keep = final ? 0 : Math.min(buf.length, tag.length - 1);
        const chunk = buf.slice(0, buf.length - keep);
        if (chunk) emit(chunk);
        buf = buf.slice(buf.length - keep);
      }
    }
  }

  return {
    push(chunk) {
      buf += chunk;
      drain(false);
    },
    flush() {
      drain(true);
    }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// runs fn over items with at most `limit` in flight at once, instead of firing everything at
// the same time — keeps /agent from bursting past a rate-limited key's requests/minute cap.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// NIM trial keys often have tight rate limits, and /agent fires several requests
// close together (plan + parallel subagents), so retry transient 429s with backoff.
async function chatCompletionStream(messages, opts = {}) {
  const attempts = 3;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await chatCompletionStreamOnce(messages, opts);
    } catch (err) {
      lastErr = err;
      if (err.status !== 429 || i === attempts - 1) throw err;
      await sleep(900 * (i + 1) + Math.random() * 400);
    }
  }
  throw lastErr;
}

async function chatCompletionStreamOnce(
  messages,
  { temperature = 0.6, toolsEnabled = true, thinking = false, onDelta = () => {}, onReasoning = () => {} } = {}
) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream'
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      ...(toolsEnabled ? { tools: TOOLS, tool_choice: 'auto' } : {}),
      ...(thinking ? { chat_template_kwargs: { thinking: true } } : {}),
      temperature,
      top_p: 0.9,
      max_tokens: MAX_TOKENS,
      stream: true
    })
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    const err = new Error(`NVIDIA NIM request failed (${res.status}): ${text || res.statusText}`);
    err.status = res.status === 401 || res.status === 403 ? 502 : res.status || 502;
    throw err;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  let finishReason = null;
  const toolCallsAcc = {};
  const splitter = thinking ? makeThinkingSplitter(onReasoning, onDelta) : null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }

      const choice = json.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};

      if (delta.reasoning_content) {
        onReasoning(delta.reasoning_content);
      }

      if (delta.content) {
        content += delta.content;
        if (splitter) splitter.push(delta.content);
        else onDelta(delta.content);
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsAcc[idx]) {
            toolCallsAcc[idx] = { id: tc.id || `call_${idx}`, type: 'function', function: { name: '', arguments: '' } };
          }
          if (tc.id) toolCallsAcc[idx].id = tc.id;
          if (tc.function?.name) toolCallsAcc[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCallsAcc[idx].function.arguments += tc.function.arguments;
        }
      }

      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }

  if (splitter) splitter.flush();

  return { content, toolCalls: Object.values(toolCallsAcc), finishReason };
}

async function runAgent({ command = null, commands = null, history, toolsEnabled = true }, hooks = {}) {
  assertConfigured();
  const { onDelta = () => {}, onReasoning = () => {}, onToolStart = () => {}, onToolEnd = () => {} } = hooks;

  // accept either the legacy single `command` or a merged `commands` array (e.g. /text + /think)
  const cmdNames = (Array.isArray(commands) && commands.length ? commands : command ? [command] : []).filter(
    (c) => COMMANDS[c]
  );
  const activeCommands = cmdNames.map((c) => COMMANDS[c]);
  const extra = activeCommands.length ? activeCommands.map((c) => c.extra).join('\n\n') : null;
  // when merging modes, average their temperatures so no single mode dominates the mix
  const temperature = activeCommands.length
    ? activeCommands.reduce((sum, c) => sum + c.temperature, 0) / activeCommands.length
    : 0.6;
  const thinking = cmdNames.includes('think');

  const messages = buildMessages(history, extra);

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const { content, toolCalls, finishReason } = await chatCompletionStream(messages, {
      temperature,
      toolsEnabled,
      thinking,
      onDelta,
      onReasoning
    });

    if (finishReason !== 'tool_calls' || !toolCalls.length) {
      return content;
    }

    messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      onToolStart({ name: call.function.name, args });
      const result = await executeTool(call.function.name, args);
      onToolEnd({ name: call.function.name, args, result });
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result).slice(0, 6000)
      });
    }
  }

  return "I reached the tool-call limit for this turn — try rephrasing or breaking the request into smaller steps.";
}

// /agent — plans 2-4 focused subagents, runs them in parallel, then synthesizes one final answer.
async function runMultiAgent({ task, toolsEnabled = true, extraSystem = null }, hooks = {}) {
  assertConfigured();
  const {
    onDelta = () => {},
    onPlan = () => {},
    onAgentStart = () => {},
    onAgentDelta = () => {},
    onAgentToolStart = () => {},
    onAgentToolEnd = () => {},
    onAgentEnd = () => {}
  } = hooks;

  const planMessages = [
    { role: 'system', content: PLAN_SYSTEM },
    { role: 'user', content: task }
  ];
  const { content: planRaw } = await chatCompletionStream(planMessages, { temperature: 0.3, toolsEnabled: false });

  let plan;
  try {
    const jsonMatch = planRaw.match(/\{[\s\S]*\}/);
    plan = JSON.parse(jsonMatch ? jsonMatch[0] : planRaw);
  } catch {
    plan = null;
  }
  const agents =
    plan && Array.isArray(plan.agents) && plan.agents.length
      ? plan.agents.slice(0, MAX_SUBAGENTS).map((a, i) => ({
          name: String(a?.name || `Agent ${i + 1}`).slice(0, 60),
          instructions: String(a?.instructions || task)
        }))
      : [{ name: 'Agent', instructions: task }];

  onPlan(agents);

  const results = await mapWithConcurrency(agents, MAX_CONCURRENT_SUBAGENTS, async (agent, id) => {
      onAgentStart({ id, name: agent.name });
      let text = '';
      const subMessages = [
        {
          role: 'system',
          content:
            `${BASE_SYSTEM}\n\nYou are subagent "${agent.name}", one of several working in parallel on pieces of a larger task. Stay focused only on your own assignment below.` +
            (extraSystem ? `\n\n${extraSystem}` : '')
        },
        { role: 'user', content: agent.instructions }
      ];

      for (let step = 0; step < MAX_TOOL_STEPS; step++) {
        const { content, toolCalls, finishReason } = await chatCompletionStream(subMessages, {
          temperature: 0.5,
          toolsEnabled,
          onDelta: (t) => {
            text += t;
            onAgentDelta({ id, text: t });
          }
        });

        if (finishReason !== 'tool_calls' || !toolCalls.length) break;

        subMessages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
        for (const call of toolCalls) {
          let args = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            args = {};
          }
          onAgentToolStart({ id, name: call.function.name, args });
          const result = await executeTool(call.function.name, args);
          onAgentToolEnd({ id, name: call.function.name, args, result });
          subMessages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
        }
      }

      onAgentEnd({ id, name: agent.name, text });
      return { name: agent.name, text };
    });

  const synthUser = [
    `Original task: ${task}`,
    '',
    'Subagent results:',
    ...results.map((r) => `### ${r.name}\n${r.text || '(no output)'}`),
    '',
    'Write a single, cohesive final response to the user that synthesizes everything above — do not just',
    'concatenate the raw subagent output, and do not repeat file contents that were already created via tools.'
  ].join('\n');

  const synthMessages = [
    { role: 'system', content: extraSystem ? `${BASE_SYSTEM}\n\n${extraSystem}` : BASE_SYSTEM },
    { role: 'user', content: synthUser }
  ];
  const { content: finalText } = await chatCompletionStream(synthMessages, {
    temperature: 0.5,
    toolsEnabled: false,
    onDelta
  });

  return finalText;
}

module.exports = { runAgent, runMultiAgent, COMMANDS, MODEL };
