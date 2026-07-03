// Session persistence. An account (see auth.js / supabase/schema.sql) is required —
// the local cache is namespaced per signed-in user id, so switching accounts on the
// same browser never leaks one user's sessions into another's view. localStorage is
// the synchronous source of truth the UI reads from (so the public API below stays
// sync, unchanged for app.js); Supabase is mirrored to in the background.
window.Store = (() => {
  const LEGACY_KEY = 'sabucode.sessions.v1'; // pre-auth, unscoped — migrated in on first login

  let cloudReady = false; // true once we have a client AND a signed-in user
  let activeUserId = null; // null = signed out, Store reads/writes are no-ops
  let status = 'offline'; // offline | syncing | synced | error
  const statusListeners = [];

  function setStatus(s) {
    status = s;
    statusListeners.forEach((fn) => fn(s));
  }

  function onStatus(fn) {
    statusListeners.push(fn);
    fn(status);
  }

  function getStatus() {
    return status;
  }

  function keyFor(userId) {
    return `sabucode.sessions.v1:${userId}`;
  }

  function read(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function write(data) {
    if (!activeUserId) return;
    try {
      localStorage.setItem(keyFor(activeUserId), JSON.stringify(data));
    } catch {
      /* quota / private mode — persistence just becomes a no-op */
    }
  }

  // one-time carry-over of sessions created before accounts existed
  function migrateLegacyOnce(userId) {
    const key = keyFor(userId);
    if (localStorage.getItem(key)) return; // already has its own data, nothing to migrate
    const legacy = read(LEGACY_KEY);
    if (legacy && Array.isArray(legacy.sessions) && legacy.sessions.length) {
      try { localStorage.setItem(key, JSON.stringify(legacy)); } catch { /* ignore */ }
    }
  }

  function ensure() {
    if (!activeUserId) return { sessions: [], currentId: null, seq: 0 };
    const d = read(keyFor(activeUserId));
    if (!d || !Array.isArray(d.sessions)) return { sessions: [], currentId: null, seq: 0 };
    if (typeof d.seq !== 'number') d.seq = d.sessions.length;
    return d;
  }

  function uid() {
    return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function toRow(s, userId) {
    return {
      id: s.id,
      title: s.title,
      messages: s.messages,
      order: s.order,
      created_at: new Date(s.createdAt).toISOString(),
      user_id: userId
    };
  }

  function fromRow(r) {
    return {
      id: r.id,
      title: r.title,
      messages: r.messages || [],
      order: r.order,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime()
    };
  }

  // fire-and-forget: cloud sync never blocks or breaks the local (instant) experience
  async function cloudUpsert(session) {
    if (!cloudReady || !activeUserId) return;
    const client = await window.Auth.getClient();
    setStatus('syncing');
    const { error } = await client.from('sessions').upsert(toRow(session, activeUserId));
    if (error) { console.warn('Supabase session sync failed:', error.message); setStatus('error'); return; }
    setStatus('synced');
  }

  async function cloudDelete(id) {
    if (!cloudReady || !activeUserId) return;
    const client = await window.Auth.getClient();
    setStatus('syncing');
    const { error } = await client.from('sessions').delete().eq('id', id).eq('user_id', activeUserId);
    if (error) { console.warn('Supabase session delete failed:', error.message); setStatus('error'); return; }
    setStatus('synced');
  }

  // runs on login/logout: switches the local namespace to this user, pulls their cloud
  // sessions in (newer updatedAt wins per session id), pushes anything local the cloud
  // doesn't have yet, and toggles cloudReady.
  async function syncForUser(user) {
    if (!user) { activeUserId = null; cloudReady = false; setStatus('offline'); return; }

    activeUserId = user.id;
    migrateLegacyOnce(user.id);

    const client = await window.Auth.getClient();
    if (!client) { cloudReady = false; setStatus('offline'); return; }

    cloudReady = true;
    setStatus('syncing');
    const { data, error } = await client.from('sessions').select('*').eq('user_id', user.id);
    if (error) { console.warn('Supabase session fetch failed:', error.message); setStatus('error'); return; }

    const d = ensure();
    const byId = new Map(d.sessions.map((s) => [s.id, s]));
    let maxSeq = d.seq || 0;
    for (const row of data || []) {
      const remote = fromRow(row);
      const local = byId.get(remote.id);
      if (!local || remote.updatedAt > local.updatedAt) byId.set(remote.id, remote);
      maxSeq = Math.max(maxSeq, remote.order || 0);
    }
    d.sessions = Array.from(byId.values());
    d.seq = maxSeq;
    write(d);

    // adopt any local-only sessions (created while signed out, pre-auth, or offline) into this account
    const remoteIds = new Set((data || []).map((r) => r.id));
    for (const s of d.sessions) if (!remoteIds.has(s.id)) cloudUpsert(s);

    setStatus('synced');
  }

  // call once at startup, before the first loadSessions(). Resolves to the signed-in
  // user (or null) once the initial session check + first sync round-trip settles.
  async function init() {
    const user = await window.Auth.init();
    window.Auth.onChange((u) => syncForUser(u));
    await syncForUser(user);
    return user;
  }

  // monotonic ordering — clock ties (same-ms creation) can't scramble the list
  function all() {
    return ensure().sessions.slice().sort((a, b) => (b.order || 0) - (a.order || 0));
  }

  function get(id) {
    return ensure().sessions.find((s) => s.id === id) || null;
  }

  function currentId() {
    return ensure().currentId;
  }

  function setCurrent(id) {
    const d = ensure();
    d.currentId = id;
    write(d);
  }

  function create() {
    const d = ensure();
    const now = Date.now();
    d.seq = (d.seq || 0) + 1;
    const session = { id: uid(), title: 'New session', messages: [], createdAt: now, updatedAt: now, order: d.seq };
    d.sessions.push(session);
    d.currentId = session.id;
    write(d);
    cloudUpsert(session);
    return session;
  }

  function saveMessages(id, messages, title) {
    const d = ensure();
    const s = d.sessions.find((x) => x.id === id);
    if (!s) return;
    s.messages = messages;
    if (title) s.title = title;
    s.updatedAt = Date.now();
    d.seq = (d.seq || 0) + 1;
    s.order = d.seq;
    write(d);
    cloudUpsert(s);
  }

  function remove(id) {
    const d = ensure();
    d.sessions = d.sessions.filter((s) => s.id !== id);
    if (d.currentId === id) {
      const next = d.sessions.slice().sort((a, b) => (b.order || 0) - (a.order || 0))[0];
      d.currentId = next ? next.id : null;
    }
    write(d);
    cloudDelete(id);
  }

  return { init, all, get, currentId, setCurrent, create, saveMessages, remove, onStatus, getStatus };
})();
