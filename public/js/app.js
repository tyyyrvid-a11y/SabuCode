(() => {
  const MODELS = {
    glm: { label: 'GLM', desc: 'z-ai/glm-5.2 (default)' },
    deepseek: { label: 'DeepSeek', desc: 'deepseek-ai/deepseek-v4-pro' },
    gemma: { label: 'Gemma', desc: 'google/gemma-4-31b-it' }
  };
  const MODEL_STORAGE_KEY = 'sabucode_model';

  const state = {
    history: [],
    files: new Map(), // path -> content
    sending: false,
    currentSessionId: null,
    model: (() => {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      return saved && MODELS[saved] ? saved : 'glm';
    })()
  };

  let activeAbortController = null;
  const SEND_ICON = '<svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V6.3"/><path d="M6.5 11 12 5.5 17.5 11"/></svg>';
  const STOP_ICON = '<svg class="icon stop-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" stroke="none"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>';

  const el = {
    sidebar: document.getElementById('sidebar'),
    hamburger: document.getElementById('hamburger'),
    topbarTitle: document.getElementById('topbarTitle'),
    chat: document.getElementById('chat'),
    welcome: document.getElementById('welcome'),
    messages: document.getElementById('messages'),
    composer: document.getElementById('composer'),
    commandPalette: document.getElementById('commandPalette'),
    activeCommandChip: document.getElementById('activeCommandChip'),
    promptInput: document.getElementById('promptInput'),
    sendBtn: document.getElementById('sendBtn'),
    statusDot: document.getElementById('statusDot'),
    modelName: document.getElementById('modelName'),
    toolsToggle: document.getElementById('toolsToggle'),
    soundToggle: document.getElementById('soundToggle'),
    hapticsToggle: document.getElementById('hapticsToggle'),
    newChatBtn: document.getElementById('newChatBtn'),
    sessionList: document.getElementById('sessionList'),
    sidebarTabRecentBtn: document.getElementById('sidebarTabRecentBtn'),
    sidebarTabMenuBtn: document.getElementById('sidebarTabMenuBtn'),
    sidebarTabRecent: document.getElementById('sidebarTabRecent'),
    sidebarTabMenu: document.getElementById('sidebarTabMenu'),
    filesToggleBtn: document.getElementById('filesToggleBtn'),
    fileCount: document.getElementById('fileCount'),
    filesPanel: document.getElementById('filesPanel'),
    filesList: document.getElementById('filesList'),
    closeFilesBtn: document.getElementById('closeFilesBtn'),
    downloadZipBtn: document.getElementById('downloadZipBtn'),
    tabFilesBtn: document.getElementById('tabFilesBtn'),
    tabPreviewBtn: document.getElementById('tabPreviewBtn'),
    previewFrame: document.getElementById('previewFrame'),
    previewEmpty: document.getElementById('previewEmpty'),
    previewEmptySpinner: document.getElementById('previewEmptySpinner'),
    previewEmptyText: document.getElementById('previewEmptyText'),
    previewLiveBadge: document.getElementById('previewLiveBadge'),
    refreshPreviewBtn: document.getElementById('refreshPreviewBtn'),
    openPreviewTabBtn: document.getElementById('openPreviewTabBtn'),
    thinkingSlider: document.getElementById('thinkingSlider'),
    thinkingSliderValue: document.getElementById('thinkingSliderValue'),
    toastStack: document.getElementById('toastStack'),
    app: document.getElementById('app'),
    bootLoading: document.getElementById('bootLoading'),
    authGate: document.getElementById('authGate'),
    authForm: document.getElementById('authForm'),
    authEmail: document.getElementById('authEmail'),
    authPassword: document.getElementById('authPassword'),
    authSignInBtn: document.getElementById('authSignInBtn'),
    authSignUpBtn: document.getElementById('authSignUpBtn'),
    authSignOutBtn: document.getElementById('authSignOutBtn'),
    authMsg: document.getElementById('authMsg'),
    authAccount: document.getElementById('authAccount'),
    authUserEmail: document.getElementById('authUserEmail'),
    syncStatus: document.getElementById('syncStatus'),
    syncStatusLabel: document.getElementById('syncStatusLabel')
  };

  // ---------- slash commands ----------

  const COMMANDS = [
    { cmd: 'createfile', icon: Icons.get('doc'), label: '/createfile', desc: 'Create & preview files' },

    { cmd: 'text', icon: Icons.get('pencil'), label: '/text', desc: 'Creative writing mode' },
    { cmd: 'agent', icon: Icons.get('stack'), label: '/agent', desc: 'Spawn agents for complex tasks' }
  ];
  const COMMAND_MAP = Object.fromEntries(COMMANDS.map((c) => [c.cmd, c]));
  const COMMAND_NAMES = COMMANDS.map((c) => c.cmd).join('|');
  // one or more confirmed "/cmd " tokens (each followed by a space) at the start of the
  // message, so /text /think hello merges both commands and leaves "hello" as the rest
  const ONE_COMMAND_RE = new RegExp(`/(${COMMAND_NAMES})\\b[ \\t]*`, 'i');
  const LEADING_COMMANDS_RE = new RegExp(`^(?:\\s*/(?:${COMMAND_NAMES})\\b[ \\t]*)+`, 'i');

  function extractCommands(text) {
    const trimmed = text.trim();
    const lead = LEADING_COMMANDS_RE.exec(trimmed);
    if (!lead) return { commands: [], rest: text };
    const commands = [];
    const seen = new Set();
    const re = new RegExp(ONE_COMMAND_RE.source, 'gi');
    let m;
    while ((m = re.exec(lead[0]))) {
      const cmd = m[1].toLowerCase();
      if (!seen.has(cmd)) { seen.add(cmd); commands.push(cmd); }
    }
    return { commands, rest: trimmed.slice(lead[0].length).trim() };
  }

  // back-compat single-command accessor used by message rendering
  function extractCommand(text) {
    const { commands, rest } = extractCommands(text);
    return { command: commands[0] || null, rest };
  }

  let lastChipCount = 0;

  function getActiveCommands(text) {
    if (text.trim().toLowerCase() === '/undo') return [];
    const explicit = extractCommands(text).commands;
    if (explicit.length > 0) return explicit;
    
    const reversed = state.history.slice().reverse();
    for (const msg of reversed) {
      if (msg.role === 'user') {
        if (msg.content.trim().toLowerCase() === '/undo') return [];
        const past = extractCommands(msg.content).commands;
        if (past.length > 0) return past;
      }
    }
    return [];
  }

  // only lights up once at least one command name is *confirmed* (followed by a space),
  // so it never overlaps with the palette (which shows while still typing a name)
  function updateActiveCommandChip() {
    const commands = getActiveCommands(el.promptInput.value);
    if (!commands.length) {
      el.activeCommandChip.classList.add('hidden');
      el.activeCommandChip.innerHTML = '';
      lastChipCount = 0;
      return;
    }
    const grew = commands.length > lastChipCount;
    lastChipCount = commands.length;
    const parts = commands.map((c) => {
      const meta = COMMAND_MAP[c];
      return `<span class="chip-cmd">${meta.icon} ${meta.label}</span>`;
    });
    const joined = parts.join('<span class="chip-plus">+</span>');
    el.activeCommandChip.innerHTML = `${joined} <span>${commands.length > 1 ? 'merged' : 'active'}</span>`;
    el.activeCommandChip.classList.remove('hidden');
    el.activeCommandChip.classList.toggle('multi', commands.length > 1);
    if (grew) {
      // restart the merge-pop animation on every new command added to the combo
      el.activeCommandChip.classList.remove('just-merged');
      // eslint-disable-next-line no-unused-expressions
      el.activeCommandChip.offsetWidth; // force reflow so the animation restarts
      el.activeCommandChip.classList.add('just-merged');
    }
  }

  let paletteIndex = 0;

  function hidePalette() {
    el.commandPalette.classList.add('hidden');
    el.commandPalette.innerHTML = '';
    el.commandPalette._matches = [];
    paletteIndex = 0;
  }

  function renderPalette(matches) {
    el.commandPalette._matches = matches;
    el.commandPalette.innerHTML = matches
      .map(
        (c, i) => `<div class="command-palette-item${i === paletteIndex ? ' active' : ''}" data-cmd="${c.cmd}">
          <span class="command-palette-icon">${c.icon}</span>
          <span class="command-palette-name">${c.label}</span>
          <span class="command-palette-desc">${escapeHtml(c.desc)}</span>
        </div>`
      )
      .join('');
    el.commandPalette.classList.remove('hidden');
  }

  function updatePalette() {
    const value = el.promptInput.value;
    const lead = LEADING_COMMANDS_RE.exec(value);
    const consumed = lead ? lead[0].length : 0;
    // the palette only offers commands to *merge* while the user is still typing the
    // name of the next one — i.e. what's left after already-confirmed commands is a
    // bare "/partial" with no trailing space yet
    const m = /^\/(\w*)$/.exec(value.slice(consumed));
    if (!m) { hidePalette(); return; }
    const already = lead ? extractCommands(value).commands : [];
    const matches = COMMANDS.filter((c) => c.cmd.startsWith(m[1].toLowerCase()) && !already.includes(c.cmd));
    if (!matches.length) { hidePalette(); return; }
    paletteIndex = Math.min(paletteIndex, matches.length - 1);
    renderPalette(matches);
  }

  function applyPaletteSelection(cmd) {
    const value = el.promptInput.value;
    const lead = LEADING_COMMANDS_RE.exec(value);
    const consumed = lead ? lead[0].length : 0;
    el.promptInput.value = `${value.slice(0, consumed)}/${cmd} `;
    hidePalette();
    el.promptInput.focus();
    el.promptInput.style.height = 'auto';
    el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 200) + 'px';
    updateActiveCommandChip();
  }

  el.commandPalette.addEventListener('click', (e) => {
    const item = e.target.closest('.command-palette-item');
    if (!item) return;
    applyPaletteSelection(item.dataset.cmd);
    Sound.tap(); Haptics.tap();
  });

  // ---------- utils ----------

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(message, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    el.toastStack.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }

  function playSuccess() { Sound.success(); Haptics.success(); }
  function playError(msg) {
    Sound.error();
    Haptics.error();
    toast(msg, 'error');
  }

  // ---------- sidebar / mobile ----------

  el.hamburger.addEventListener('click', () => {
    el.sidebar.classList.toggle('open');
    Sound.tap(); Haptics.tap();
  });

  document.addEventListener('click', (e) => {
    if (window.innerWidth > 860) return;
    if (el.sidebar.classList.contains('open') && !el.sidebar.contains(e.target) && !el.hamburger.contains(e.target)) {
      el.sidebar.classList.remove('open');
    }
  });

  function switchSidebarTab(tab) {
    el.sidebarTabRecentBtn.classList.toggle('active', tab === 'recent');
    el.sidebarTabMenuBtn.classList.toggle('active', tab === 'menu');
    el.sidebarTabRecent.classList.toggle('hidden', tab !== 'recent');
    el.sidebarTabMenu.classList.toggle('hidden', tab !== 'menu');
  }
  el.sidebarTabRecentBtn.addEventListener('click', () => { switchSidebarTab('recent'); Sound.tap(); Haptics.tap(); });
  el.sidebarTabMenuBtn.addEventListener('click', () => { switchSidebarTab('menu'); Sound.tap(); Haptics.tap(); });

  // ---------- toggles ----------

  el.soundToggle.addEventListener('change', () => Sound.setEnabled(el.soundToggle.checked));
  el.hapticsToggle.addEventListener('change', () => Haptics.setEnabled(el.hapticsToggle.checked));

  el.newChatBtn.addEventListener('click', () => {
    const s = Store.create();
    state.currentSessionId = s.id;
    state.history = [];
    resetFilesUI();
    renderHistory();
    renderSessions();
    el.sidebar.classList.remove('open');
    toast('New session started');
  });

  // ---------- account gate (Supabase email/password auth — required to use the app) ----------

  function showAuthMsg(text, kind) {
    el.authMsg.textContent = text;
    el.authMsg.className = `auth-msg${kind ? ` ${kind}` : ''}`;
  }

  function setAuthBusy(busy) {
    el.authSignInBtn.disabled = busy;
    el.authSignUpBtn.disabled = busy;
  }

  // swaps between the full-screen sign-in gate and the app itself; only called on
  // actual login/logout transitions, not on every auth event
  function gateApp(user) {
    el.authGate.classList.toggle('hidden', Boolean(user));
    el.app.classList.toggle('hidden', !user);
    if (user) {
      el.authUserEmail.textContent = user.email;
      showAuthMsg('', null);
      el.authForm.reset();
    }
  }

  el.authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = el.authEmail.value.trim();
    const password = el.authPassword.value;
    setAuthBusy(true);
    showAuthMsg('Signing in…', null);
    try {
      await Auth.signIn(email, password);
      toast('Signed in');
      Sound.success(); Haptics.success();
    } catch (err) {
      showAuthMsg(err.message || 'Sign in failed', 'error');
      playError(err.message || 'Sign in failed');
    } finally {
      setAuthBusy(false);
    }
  });

  el.authSignUpBtn.addEventListener('click', async () => {
    const email = el.authEmail.value.trim();
    const password = el.authPassword.value;
    if (!email || password.length < 6) {
      showAuthMsg('Enter an email and a password (6+ characters) first', 'error');
      return;
    }
    setAuthBusy(true);
    showAuthMsg('Creating account…', null);
    try {
      const data = await Auth.signUp(email, password);
      if (!data.session) {
        showAuthMsg('Check your email to confirm your account, then sign in.', 'success');
      } else {
        toast('Account created');
        Sound.success(); Haptics.success();
      }
    } catch (err) {
      showAuthMsg(err.message || 'Sign up failed', 'error');
      playError(err.message || 'Sign up failed');
    } finally {
      setAuthBusy(false);
    }
  });

  el.authSignOutBtn.addEventListener('click', async () => {
    await Auth.signOut();
    toast('Signed out');
    Sound.tap(); Haptics.tap();
  });

  // reacts to *every* login/logout that happens after startup (startup itself gates
  // synchronously below, before this listener would otherwise double-fire it)
  Auth.onChange((user) => {
    gateApp(user);
    if (user) {
      loadSessions();
      renderSessions();
      renderHistory();
    }
  });

  Store.onStatus((status) => {
    el.syncStatus.className = `sync-status ${status}`;
    const labels = { offline: 'Offline', syncing: 'Syncing…', synced: 'Synced', error: 'Sync error' };
    el.syncStatusLabel.textContent = labels[status] || status;
  });

  // ---------- sessions (localStorage; swappable for Supabase) ----------

  function loadSessions() {
    let id = Store.currentId();
    if (!id || !Store.get(id)) {
      const existing = Store.all();
      id = existing.length ? existing[0].id : Store.create().id;
      Store.setCurrent(id);
    }
    state.currentSessionId = id;
    state.history = (Store.get(id)?.messages || []).slice();
  }

  function deriveTitle(history) {
    const first = history.find((m) => m.role === 'user');
    if (!first) return 'New session';
    let t = first.content.trim().replace(/^\/(createfile|text|agent)\b\s*/i, '');
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) return 'New session';
    return t.length > 42 ? t.slice(0, 42) + '…' : t;
  }

  function persist() {
    if (!state.currentSessionId) return;
    Store.saveMessages(state.currentSessionId, state.history, deriveTitle(state.history));
    renderSessions();
  }

  function switchSession(id) {
    const s = Store.get(id);
    if (!s) return;
    state.currentSessionId = id;
    Store.setCurrent(id);
    state.history = (s.messages || []).slice();
    resetFilesUI();
    renderHistory();
    renderSessions();
    el.sidebar.classList.remove('open');
  }

  function renderSessions() {
    const sessions = Store.all();
    if (!sessions.length) {
      el.sessionList.innerHTML = '<div class="session-empty">No sessions yet</div>';
      return;
    }
    el.sessionList.innerHTML = sessions
      .map(
        (s) => `<div class="session-item${s.id === state.currentSessionId ? ' active' : ''}" data-id="${s.id}" role="button" tabindex="0">
          <span class="session-title">${escapeHtml(s.title || 'New session')}</span>
          <button class="session-del" data-del="${s.id}" aria-label="Delete session">${Icons.get('xmark')}</button>
        </div>`
      )
      .join('');
  }

  el.sessionList.addEventListener('click', (e) => {
    const del = e.target.closest('.session-del');
    if (del) {
      e.stopPropagation();
      const id = del.dataset.del;
      Store.remove(id);
      if (id === state.currentSessionId) {
        const list = Store.all();
        if (list.length) {
          switchSession(list[0].id);
        } else {
          const s = Store.create();
          state.currentSessionId = s.id;
          state.history = [];
          resetFilesUI();
          renderHistory();
        }
      }
      renderSessions();
      Sound.tap(); Haptics.tap();
      return;
    }
    const item = e.target.closest('.session-item');
    if (item && item.dataset.id !== state.currentSessionId) {
      switchSession(item.dataset.id);
      Sound.tap(); Haptics.tap();
    }
  });

  function resetFilesUI() {
    state.files.clear();
    el.fileCount.textContent = '0';
    el.filesToggleBtn.style.display = 'none';
    el.app.classList.remove('files-open');
    renderFilesList();
    renderPreview();
  }

  // ---------- textarea autosize + command palette ----------

  el.promptInput.addEventListener('input', () => {
    el.promptInput.style.height = 'auto';
    el.promptInput.style.height = Math.min(el.promptInput.scrollHeight, 200) + 'px';
    updatePalette();
    updateActiveCommandChip();
  });

  el.thinkingSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    const labels = { 0: 'Off', 25: 'Low', 50: 'Med', 75: 'High', 100: 'Max' };
    el.thinkingSliderValue.textContent = labels[val] || 'Off';
  });

  el.promptInput.addEventListener('keydown', (e) => {
    const paletteVisible = !el.commandPalette.classList.contains('hidden');
    const matches = el.commandPalette._matches || [];
    if (paletteVisible && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = (paletteIndex + 1) % matches.length; renderPalette(matches); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = (paletteIndex - 1 + matches.length) % matches.length; renderPalette(matches); return; }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); applyPaletteSelection(matches[paletteIndex].cmd); return; }
      if (e.key === 'Escape') { hidePalette(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.composer.requestSubmit();
    }
  });

  // ---------- message rendering ----------

  const FILE_BLOCK_RE = /```([a-zA-Z0-9_+-]*)\s+path=([^\s`\n]+)\n([\s\S]*?)```/g;
  const PLAIN_BLOCK_RE = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;

  function renderMessageBody(text) {
    const filesFound = [];
    const codeBlocks = [];
    const stash = (html) => {
      const token = ` CODE${codeBlocks.length} `;
      codeBlocks.push(html);
      return token;
    };

    let working = text.replace(FILE_BLOCK_RE, (match, lang, filePath, code) => {
      filesFound.push({ path: filePath, content: code });
      const chip = `<div class="file-chip">${Icons.get('doc')} ${escapeHtml(filePath)}</div>`;
      const pre = `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
      return `\n${stash(chip + pre)}\n`;
    });

    working = working.replace(PLAIN_BLOCK_RE, (match, lang, code) => {
      return `\n${stash(`<pre><code>${escapeHtml(code.trim())}</code></pre>`)}\n`;
    });

    let html = markdownToHtml(working);
    html = html.replace(/ CODE(\d+) /g, (m, idx) => codeBlocks[Number(idx)]);

    return { html, files: filesFound };
  }

  function renderUserBody(text) {
    const { commands, rest } = extractCommands(text);
    let badge = '';
    if (commands.length) {
      const chips = commands.map((c) => {
        const meta = COMMAND_MAP[c];
        return `<span>${meta.icon} ${meta.label}</span>`;
      }).join('<span class="badge-plus">+</span>');
      badge = `<div class="msg-command-badge${commands.length > 1 ? ' multi' : ''}">${chips}</div>`;
    }
    return badge + renderMessageBody(rest || text).html;
  }

  // ---------- lightweight markdown (ChatGPT/Claude-style rendering) ----------

  function inlineFormat(escapedText) {
    let t = escapedText;
    // inline code
    t = t.replace(/`([^`]+)`/g, (m, code) => `<code>${code}</code>`);
    // bold
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    // italic
    t = t.replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');
    t = t.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>');
    // strikethrough
    t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    // markdown links
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // bare urls
    t = t.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, (m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
    return t;
  }

  function markdownToHtml(src) {
    const lines = src.split('\n');
    let html = '';
    let paragraphBuf = [];
    let i = 0;

    const flushParagraph = () => {
      if (!paragraphBuf.length) return;
      html += `<p>${inlineFormat(escapeHtml(paragraphBuf.join('\n'))).replace(/\n/g, '<br>')}</p>`;
      paragraphBuf = [];
    };

    while (i < lines.length) {
      const raw = lines[i];
      const trimmed = raw.trim();

      if (/^ CODE\d+ $/.test(trimmed)) {
        flushParagraph();
        html += trimmed;
        i++;
        continue;
      }

      if (trimmed === '') {
        flushParagraph();
        i++;
        continue;
      }

      let m = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (m) {
        flushParagraph();
        const level = m[1].length;
        html += `<h${level}>${inlineFormat(escapeHtml(m[2]))}</h${level}>`;
        i++;
        continue;
      }

      if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
        flushParagraph();
        html += '<hr>';
        i++;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        flushParagraph();
        const quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        html += `<blockquote>${markdownToHtml(quoteLines.join('\n'))}</blockquote>`;
        continue;
      }

      if (/^[-*+]\s+/.test(trimmed)) {
        flushParagraph();
        const items = [];
        while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
          i++;
        }
        html += `<ul>${items.map((it) => `<li>${inlineFormat(escapeHtml(it))}</li>`).join('')}</ul>`;
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        flushParagraph();
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
          i++;
        }
        html += `<ol>${items.map((it) => `<li>${inlineFormat(escapeHtml(it))}</li>`).join('')}</ol>`;
        continue;
      }

      if (/^\|.*\|$/.test(trimmed) && lines[i + 1] && /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(lines[i + 1].trim())) {
        flushParagraph();
        const headerCells = trimmed.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        i += 2;
        const rows = [];
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
          rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
          i++;
        }
        html +=
          '<div class="md-table-wrap"><table><thead><tr>' +
          headerCells.map((c) => `<th>${inlineFormat(escapeHtml(c))}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => `<tr>${r.map((c) => `<td>${inlineFormat(escapeHtml(c))}</td>`).join('')}</tr>`).join('') +
          '</tbody></table></div>';
        continue;
      }

      paragraphBuf.push(raw);
      i++;
    }

    flushParagraph();
    return html;
  }

  function addFiles(files) {
    if (!files.length) return;
    files.forEach((f) => state.files.set(f.path, f.content));
    el.fileCount.textContent = state.files.size;
    el.filesToggleBtn.style.display = state.files.size ? 'flex' : 'none';
    renderFilesList();
    renderPreview();
    if (Preview.build(state.files)) {
      switchPanelTab('preview');
      el.app.classList.add('files-open');
    }
  }

  function renderFilesList() {
    el.filesList.innerHTML = '';
    for (const [path, content] of state.files.entries()) {
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `<span>${escapeHtml(path)}</span><span>${(content.length / 1024).toFixed(1)}kb</span>`;
      item.addEventListener('click', () => {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = path.split('/').pop();
        a.click();
        URL.revokeObjectURL(url);
      });
      el.filesList.appendChild(item);
    }
  }

  function createMessageEl(role, isError = false) {
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}${isError ? ' error' : ''}`;
    const body = document.createElement('div');
    body.className = 'msg-body';
    wrap.appendChild(body);
    el.messages.appendChild(wrap);
    el.welcome.classList.add('hidden');
    scrollToBottom();
    return body;
  }

  function scrollToBottom() {
    el.chat.scrollTop = el.chat.scrollHeight;
  }

  function renderHistory() {
    el.messages.innerHTML = '';
    if (!state.history.length) {
      el.welcome.classList.remove('hidden');
      return;
    }
    el.welcome.classList.add('hidden');
    for (const turn of state.history) {
      const body = createMessageEl(turn.role);
      body.innerHTML = turn.role === 'user' ? renderUserBody(turn.content) : renderMessageBody(turn.content).html;
    }
    scrollToBottom();
    updateActiveCommandChip();
  }

  // ---------- files panel ----------

  el.filesToggleBtn.addEventListener('click', () => {
    el.app.classList.toggle('files-open');
    Sound.tap(); Haptics.tap();
  });
  el.closeFilesBtn.addEventListener('click', () => {
    el.app.classList.remove('files-open');
    Sound.tap(); Haptics.tap();
  });

  function switchPanelTab(tab) {
    el.tabFilesBtn.classList.toggle('active', tab === 'files');
    el.tabPreviewBtn.classList.toggle('active', tab === 'preview');
    el.filesPanel.classList.toggle('view-preview', tab === 'preview');
  }

  el.tabFilesBtn.addEventListener('click', () => { switchPanelTab('files'); Sound.tap(); Haptics.tap(); });
  el.tabPreviewBtn.addEventListener('click', () => { switchPanelTab('preview'); Sound.tap(); Haptics.tap(); });

  function renderPreview(currentLiveFiles = [], currentAgentsState = []) {
    const merged = new Map(state.files);
    for (const f of currentLiveFiles) {
      if (!f.done) merged.set(f.path, f.text);
    }
    for (const a of currentAgentsState) {
      if (a.liveFiles) {
        for (const f of a.liveFiles) {
          if (!f.done) merged.set(f.path, f.text);
        }
      }
    }
    const html = Preview.build(merged);
    if (!html) {
      el.previewFrame.classList.add('hidden');
      el.previewEmpty.classList.remove('hidden');
      el.previewLiveBadge.classList.add('hidden');
      return;
    }
    el.previewEmpty.classList.add('hidden');
    el.previewFrame.classList.remove('hidden');
    el.previewFrame.srcdoc = html;
  }

  // reflects live app-generation progress in the preview panel: a spinner over the empty
  // state before any file exists yet, and a small pulsing badge over the iframe once a
  // preview is already rendering but more files are still streaming in.
  function setPreviewBuilding(active) {
    el.previewEmptySpinner.classList.toggle('hidden', !active);
    el.previewEmptyText.textContent = active
      ? 'Building your app…'
      : "Generate an HTML or React file and it'll render here live.";
    const hasFrame = !el.previewFrame.classList.contains('hidden');
    el.previewLiveBadge.classList.toggle('hidden', !active || !hasFrame);
  }

  el.refreshPreviewBtn.addEventListener('click', () => { renderPreview(); Sound.tap(); Haptics.tap(); });

  el.openPreviewTabBtn.addEventListener('click', () => {
    const html = Preview.build(state.files);
    if (!html) { toast('Nothing to preview yet', 'error'); return; }
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob), '_blank');
    Sound.tap(); Haptics.tap();
  });

  el.downloadZipBtn.addEventListener('click', async () => {
    if (!state.files.size) {
      toast('No files generated yet', 'error');
      return;
    }
    try {
      const files = [...state.files.entries()].map(([path, content]) => ({ path, content }));
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectName: 'sabucode-project', files })
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sabucode-project.zip';
      a.click();
      URL.revokeObjectURL(url);
      playSuccess();
      toast('Project downloaded');
    } catch (err) {
      playError(err.message);
    }
  });

  // ---------- chat submit ----------

  el.sendBtn.addEventListener('click', (e) => {
    if (state.sending) {
      e.preventDefault();
      if (activeAbortController) activeAbortController.abort();
    }
  });

  el.composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (state.sending) return;
    const text = el.promptInput.value.trim();
    if (!text) return;

    const modelMatch = /^\/model\s+(\S+)/i.exec(text);
    if (modelMatch) {
      const key = modelMatch[1].toLowerCase();
      const meta = MODELS[key];
      el.promptInput.value = '';
      el.promptInput.style.height = 'auto';
      updateActiveCommandChip();
      if (!meta) {
        playError(`Unknown model "${key}". Try: ${Object.keys(MODELS).join(', ')}`);
        return;
      }
      state.model = key;
      localStorage.setItem(MODEL_STORAGE_KEY, key);
      toast(`Model switched to ${meta.label} (${meta.desc})`);
      Sound.tap(); Haptics.tap();
      return;
    }

    if (text.toLowerCase() === '/undo') {
      state.history.push({ role: 'user', content: text });
      persist();
      renderHistory();
      el.promptInput.value = '';
      el.promptInput.style.height = 'auto';
      updateActiveCommandChip();
      return;
    }

    hidePalette();
    const commands = getActiveCommands(text);

    state.sending = true;
    el.sendBtn.innerHTML = STOP_ICON;
    el.sendBtn.classList.add('is-stopping');
    activeAbortController = new AbortController();
    Sound.send(); Haptics.send();

    const history = state.history;
    history.push({ role: 'user', content: text });
    persist();
    const userBody = createMessageEl('user');
    userBody.innerHTML = renderUserBody(text);

    el.promptInput.value = '';
    el.promptInput.style.height = 'auto';
    updateActiveCommandChip();

    const assistantBody = createMessageEl('assistant');
    assistantBody.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
    Sound.receiveStart();

    let assistantText = '';
    let sourcesHtml = '';
    const toolLog = []; // { name, args, status, error }
    const creating = { phase: 'idle', pending: 0, lastFile: '' }; // idle | active | done
    const reasoning = { text: '', active: false, collapsed: false, elapsed: null, started: null };
    const agentsState = []; // { id, name, status, text, tools: [], liveFiles: [] }
    const liveFiles = []; // { path, text, done } — live "typing" view of write_file as it streams in
    let hideBannerTimer = null;

    let renderPreviewTimer = null;
    const renderPreviewDebounced = () => {
      if (renderPreviewTimer) clearTimeout(renderPreviewTimer);
      renderPreviewTimer = setTimeout(() => {
        renderPreview(liveFiles, agentsState);
      }, 250);
    };

    assistantBody.addEventListener('click', (ev) => {
      if (ev.target.closest('.thinking-header')) {
        reasoning.collapsed = !reasoning.collapsed;
        renderAssistant();
      }
    });

    const renderAssistant = () => {
      assistantBody.innerHTML =
        renderThinkingPanel(reasoning) +
        renderAgentBoard(agentsState) +
        renderCreatingBanner(creating) +
        renderLiveCode(liveFiles) +
        renderToolLog(toolLog) +
        renderMessageBody(assistantText).html +
        sourcesHtml;
      assistantBody.querySelectorAll('.live-code-body').forEach((body) => {
        body.scrollTop = body.scrollHeight;
      });
      const isBuilding = creating.phase === 'active' || agentsState.some((a) => a.status === 'running');
      setPreviewBuilding(isBuilding);
    };

    try {
      let token = null;
      try {
        const client = await window.Auth.getClient();
        if (client) {
          const sessionRes = await client.auth.getSession();
          token = sessionRes?.data?.session?.access_token;
        }
      } catch (e) {}

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        signal: activeAbortController.signal,
        body: JSON.stringify({
          sessionId: state.currentSessionId,
          commands,
          history,
          tools: el.toolsToggle.checked,
          thinkingBudget: parseInt(el.thinkingSlider.value, 10),
          model: state.model
        })
      });

      if (!res.ok || !res.body) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let currentEvent = 'message';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let data;
            try { data = JSON.parse(payload); } catch { continue; }

            if (currentEvent === 'thinking') {
              reasoning.active = true;
              reasoning.collapsed = false;
              reasoning.started = reasoning.started || Date.now();
              reasoning.text += data.text;
              renderAssistant();
              scrollToBottom();
              const thinkingBody = el.chat.querySelector('.thinking-body');
              if (thinkingBody) thinkingBody.scrollTop = thinkingBody.scrollHeight;
            } else if (currentEvent === 'delta') {
              if (reasoning.active) {
                reasoning.active = false;
                reasoning.collapsed = true;
                reasoning.elapsed = reasoning.started ? Math.max(1, Math.round((Date.now() - reasoning.started) / 1000)) : null;
              }
              assistantText += data.text;
              renderAssistant();
              scrollToBottom();
            } else if (currentEvent === 'agent_plan') {
              agentsState.length = 0;
              (data.agents || []).forEach((a, id) => agentsState.push({ id, name: a.name, status: 'pending', text: '', tools: [], liveFiles: [] }));
              renderAssistant();
              scrollToBottom();
            } else if (currentEvent === 'agent_start') {
              const a = agentsState.find((x) => x.id === data.id);
              if (a) a.status = 'running';
              Sound.tap();
              renderAssistant();
            } else if (currentEvent === 'agent_delta') {
              const a = agentsState.find((x) => x.id === data.id);
              if (a) a.text += data.text;
              renderAssistant();
              scrollToBottom();
            } else if (currentEvent === 'agent_file_start') {
              const a = agentsState.find((x) => x.id === data.id);
              if (a) a.liveFiles.push({ path: data.path, text: '', done: false });
              renderAssistant();
              if (/\.(html|js|jsx|ts|tsx|css)$/i.test(data.path) && !el.app.classList.contains('files-open')) {
                switchPanelTab('preview');
                el.app.classList.add('files-open');
              }
            } else if (currentEvent === 'agent_file_delta') {
              const a = agentsState.find((x) => x.id === data.id);
              const f = a && [...a.liveFiles].reverse().find((x) => x.path === data.path && !x.done);
              if (f) f.text += data.text;
              renderAssistant();
              renderPreviewDebounced();
            } else if (currentEvent === 'agent_tool_start') {
              const a = agentsState.find((x) => x.id === data.id);
              if (a) {
                a.tools.push({ name: data.name, args: data.args, status: 'running' });
                if (data.name === 'write_file' && data.args?.path && typeof data.args?.content === 'string') {
                  const ext = data.args.path.split('.').pop() || '';
                  a.text += `\n\`\`\`${ext} path=${data.args.path}\n${data.args.content}\n\`\`\`\n`;
                  addFiles([{ path: data.args.path, content: data.args.content }]);
                  const f = [...a.liveFiles].reverse().find((x) => x.path === data.args.path && !x.done);
                  if (f) { f.text = data.args.content; f.done = true; }
                  else a.liveFiles.push({ path: data.args.path, text: data.args.content, done: true });
                }
              }
              Sound.tap();
              renderAssistant();
            } else if (currentEvent === 'agent_tool_end') {
              const a = agentsState.find((x) => x.id === data.id);
              if (a) {
                const entry = [...a.tools].reverse().find((t) => t.name === data.name && t.status === 'running');
                if (entry) { entry.status = data.result?.error ? 'error' : 'done'; entry.result = data.result; }
              }
              renderAssistant();
            } else if (currentEvent === 'agent_end') {
              const a = agentsState.find((x) => x.id === data.id);
              if (a) a.status = 'done';
              renderAssistant();
            } else if (currentEvent === 'file_start') {
              liveFiles.push({ path: data.path, text: '', done: false });
              renderAssistant();
              if (/\.(html|js|jsx|ts|tsx|css)$/i.test(data.path) && !el.app.classList.contains('files-open')) {
                switchPanelTab('preview');
                el.app.classList.add('files-open');
              }
            } else if (currentEvent === 'file_delta') {
              const f = [...liveFiles].reverse().find((x) => x.path === data.path && !x.done);
              if (f) f.text += data.text;
              renderAssistant();
              renderPreviewDebounced();
            } else if (currentEvent === 'tool_start') {
              if (data.name === 'write_file') {
                if (hideBannerTimer) { clearTimeout(hideBannerTimer); hideBannerTimer = null; }
                creating.phase = 'active';
                creating.pending += 1;
                creating.lastFile = data.args?.path || '';
                if (data.args?.path && typeof data.args?.content === 'string') {
                  const ext = data.args.path.split('.').pop() || '';
                  assistantText += `\n\`\`\`${ext} path=${data.args.path}\n${data.args.content}\n\`\`\`\n`;
                  addFiles([{ path: data.args.path, content: data.args.content }]);
                  const f = [...liveFiles].reverse().find((x) => x.path === data.args.path && !x.done);
                  if (f) { f.text = data.args.content; f.done = true; }
                  else liveFiles.push({ path: data.args.path, text: data.args.content, done: true });
                }
              } else {
                toolLog.push({ name: data.name, args: data.args, status: 'running' });
              }
              Sound.tap();
              renderAssistant();
              scrollToBottom();
            } else if (currentEvent === 'tool_end') {
              if (data.name === 'write_file') {
                creating.pending = Math.max(0, creating.pending - 1);
                if (creating.pending === 0) {
                  creating.phase = 'done';
                  renderAssistant();
                  hideBannerTimer = setTimeout(() => {
                    creating.phase = 'idle';
                    renderAssistant();
                  }, 1800);
                }
              } else {
                const entry = [...toolLog].reverse().find((t) => t.name === data.name && t.status === 'running');
                if (entry) {
                  entry.status = data.result?.error ? 'error' : 'done';
                  entry.result = data.result;
                }
              }
              renderAssistant();
            } else if (currentEvent === 'sources') {
              sourcesHtml = renderSources(data.sources);
              renderAssistant();
            } else if (currentEvent === 'warning') {
              toast(data.message, 'error');
            } else if (currentEvent === 'error') {
              throw new Error(data.message);
            }
          }
        }
      }

      if (reasoning.active) {
        reasoning.active = false;
        reasoning.collapsed = true;
        reasoning.elapsed = reasoning.started ? Math.max(1, Math.round((Date.now() - reasoning.started) / 1000)) : null;
      }

      const { files } = renderMessageBody(assistantText);
      if (files.length) addFiles(files); // fallback for models that still paste code as text
      renderAssistant();
      history.push({ role: 'assistant', content: assistantText });
      persist();
      if (files.length || creating.lastFile || agentsState.length) playSuccess(); else { Sound.tap(); }
    } catch (err) {
      if (err.name === 'AbortError') {
        history.push({ role: 'assistant', content: assistantText });
        persist();
      } else {
        if (hideBannerTimer) clearTimeout(hideBannerTimer);
        assistantBody.parentElement.classList.add('error');
        assistantBody.innerHTML = `<p class="error-line">${Icons.get('warning')} ${escapeHtml(err.message)}</p>`;
        playError(err.message);
      }
    } finally {
      state.sending = false;
      el.sendBtn.innerHTML = SEND_ICON;
      el.sendBtn.classList.remove('is-stopping');
      activeAbortController = null;
      setPreviewBuilding(false);
      scrollToBottom();
    }
  });

  function renderThinkingPanel(reasoning) {
    if (!reasoning.text && !reasoning.active) return '';
    const activeClass = reasoning.active ? ' active' : '';
    const collapsedClass = reasoning.collapsed ? ' collapsed' : '';
    const label = reasoning.active
      ? `${Icons.get('sparkles')} Thinking…`
      : `${Icons.get('sparkles')} Thought${reasoning.elapsed != null ? ` for ${reasoning.elapsed}s` : ''}`;
    return `<div class="thinking-panel${activeClass}${collapsedClass}">
      <div class="thinking-header">${label}<span class="thinking-chevron">${Icons.get('chevron')}</span></div>
      <div class="thinking-body">${escapeHtml(reasoning.text)}</div>
    </div>`;
  }

  function renderAgentBoard(agentsState) {
    if (!agentsState.length) return '';
    const cards = agentsState
      .map((a) => {
        const tools = a.tools.length
          ? `<div class="agent-tool-pills">${a.tools.map(renderToolPill).join('')}</div>`
          : '';
        const liveCode = a.liveFiles && a.liveFiles.length ? renderLiveCode(a.liveFiles) : '';
        return `<div class="agent-card">
          <div class="agent-card-header"><span class="agent-card-icon">${Icons.get('stack')}</span>${escapeHtml(a.name)}<span class="agent-status ${a.status}">${a.status}</span></div>
          ${a.text ? `<div class="agent-card-body">${escapeHtml(a.text)}</div>` : ''}
          ${liveCode}
          ${tools}
        </div>`;
      })
      .join('');
    return `<div class="agent-board"><div class="agent-plan-label">${Icons.get('stack')} ${agentsState.length} agent${agentsState.length === 1 ? '' : 's'} spawned</div>${cards}</div>`;
  }

  function renderCreatingBanner(creating) {
    if (creating.phase === 'idle') return '';
    const isDone = creating.phase === 'done';
    const label = isDone
      ? `${Icons.get('check')} App created`
      : `${Icons.get('wand')} Creating your app…`;
    const file = creating.lastFile
      ? `<span class="creating-file">${escapeHtml(creating.lastFile)}</span>`
      : '';
    return `<div class="creating-banner ${creating.phase}">
      <div class="creating-label">${label}${file}</div>
      <div class="creating-bar-track"><div class="creating-bar-fill"></div></div>
    </div>`;
  }

  // live "typing" view of write_file's content as it streams in, token by token —
  // purely a visual preview; the authoritative file is added via addFiles() once the
  // tool call is complete (see the file_start/file_delta and tool_start handlers above).
  function renderLiveCode(liveFiles) {
    if (!liveFiles.length) return '';
    return liveFiles
      .map((f) => {
        const status = f.done ? '[✓]' : '[...]';
        const cursor = f.done ? '' : '<span class="live-code-cursor">_</span>';
        return `<div class="live-code-terminal">
          <div style="color: var(--wine-bright); font-weight: bold;">${status} write_file ${escapeHtml(f.path)}</div>
          <pre style="background: transparent; border: none; padding: 0; margin-top: 4px; color: var(--grey-300);">${escapeHtml(f.text)}${cursor}</pre>
        </div>`;
      })
      .join('');
  }

  const TOOL_ICONS = {
    web_search: Icons.get('search'),
    fetch_url: Icons.get('globe'),
    get_current_datetime: Icons.get('clock'),
    write_file: Icons.get('doc')
  };

  function toolLabel(entry) {
    if (entry.name === 'web_search') return `Searching “${entry.args?.query || ''}”`;
    if (entry.name === 'fetch_url') return `Reading ${entry.args?.url || ''}`;
    if (entry.name === 'get_current_datetime') return 'Checking the date';
    if (entry.name === 'write_file') return `Writing ${entry.args?.path || ''}`;
    return entry.name;
  }

  function statusMark(status) {
    if (status === 'running') return '<span class="tool-spin"></span>';
    if (status === 'error') return `<span class="tool-mark error">${Icons.get('warning')}</span>`;
    return `<span class="tool-mark done">${Icons.get('check')}</span>`;
  }

  function renderToolPill(entry) {
    const icon = TOOL_ICONS[entry.name] || Icons.get('wrench');
    return `<div class="tool-pill ${entry.status}"><span class="tool-icon">${icon}</span><span class="tool-text">${escapeHtml(toolLabel(entry))}</span>${statusMark(entry.status)}</div>`;
  }

  function renderToolLog(toolLog) {
    if (!toolLog.length) return '';
    return toolLog.map(renderToolPill).join('');
  }

  function renderSources(sources) {
    if (!sources || !sources.length) return '';
    const chips = sources
      .map(
        (s, i) =>
          `<a class="source-chip" href="${s.url}" target="_blank" rel="noopener">[${i + 1}] ${escapeHtml(s.title)}</a>`
      )
      .join('');
    return `<div class="sources">${chips}</div>`;
  }

  // ---------- health check ----------

  async function checkHealth() {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (data.configured) {
        el.statusDot.classList.add('online');
        el.statusDot.title = 'Connected';
        el.modelName.textContent = 'Connected';
      } else {
        el.statusDot.classList.add('offline');
        el.statusDot.title = 'Setup required';
        el.modelName.textContent = 'Setup required';
        toast('Add your API key to the .env file to start chatting', 'error');
      }
    } catch {
      el.statusDot.classList.add('offline');
      el.modelName.textContent = 'Offline';
    }
  }

  // registers the app-shell cache so repeat launches (esp. as an installed PWA)
  // are instant; never blocks the app if it fails (e.g. plain http in dev)
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // init — an account is required, so nothing renders until Store.init() (which drives
  // Auth.init() under the hood) resolves the current session one way or the other
  checkHealth();
  Store.init().then((user) => {
    el.bootLoading.classList.add('hidden');
    gateApp(user);
    if (user) {
      Store.onDataChange(() => {
        if (state.currentSessionId && !Store.get(state.currentSessionId)) {
          state.currentSessionId = Store.currentId();
        }
        loadSessions();
        renderSessions();
        renderHistory();
      });
      loadSessions();
      renderSessions();
      renderHistory();
    }
  });
})();
