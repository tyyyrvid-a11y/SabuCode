// Supabase Auth wrapper. Owns the one Supabase client the whole app shares (store.js
// reuses it via Auth.getClient()) and exposes a tiny sign-up/sign-in/sign-out surface
// plus an onChange subscription so other modules can react to login/logout.
window.Auth = (() => {
  let client = null;
  let clientPromise = null;
  let user = null; // { id, email } | null
  const listeners = [];

  async function getClient() {
    if (client) return client;
    if (!clientPromise) {
      clientPromise = (async () => {
        try {
          const res = await fetch('/api/config');
          const cfg = await res.json();
          if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
          client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
          return client;
        } catch {
          return null;
        }
      })();
    }
    return clientPromise;
  }

  function toUser(sessionUser) {
    return sessionUser ? { id: sessionUser.id, email: sessionUser.email } : null;
  }

  function notify() {
    listeners.forEach((fn) => fn(user));
  }

  // resolves once the initial session (if any) has been restored; keeps listening
  // for sign-in/sign-out afterwards
  async function init() {
    const c = await getClient();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    user = toUser(data?.session?.user);
    c.auth.onAuthStateChange((_event, session) => {
      const next = toUser(session?.user);
      if (next?.id === user?.id) return; // ignore token-refresh churn, only react to actual login/logout
      user = next;
      notify();
    });
    return user;
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function currentUser() {
    return user;
  }

  async function signUp(email, password) {
    const c = await getClient();
    if (!c) throw new Error('Supabase is not configured (see .env)');
    const { data, error } = await c.auth.signUp({ email, password });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const c = await getClient();
    if (!c) throw new Error('Supabase is not configured (see .env)');
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const c = await getClient();
    if (!c) return;
    await c.auth.signOut();
  }

  return { init, getClient, onChange, currentUser, signUp, signIn, signOut };
})();
