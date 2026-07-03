-- SabuCode: chat session storage
--
-- Mirrors the shape the app already keeps in localStorage (see public/js/store.js),
-- so a session round-trips as { id, title, messages, createdAt, updatedAt, order }.
-- Each row belongs to one Supabase Auth user (email+password, see public/js/auth.js) —
-- signed-out usage stays local-only and never touches this table.
--
-- Run this once in the Supabase SQL editor (or `supabase db push`) against your project:
--   https://biylqtvypavkehumtuks.supabase.co

create table if not exists public.sessions (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'New session',
  messages    jsonb not null default '[]'::jsonb,
  "order"     bigint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- keep session list ordering queries fast
create index if not exists sessions_user_order_idx on public.sessions (user_id, "order" desc);

-- auto-bump updated_at on every write, so the client never has to set it itself
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
  before update on public.sessions
  for each row
  execute function public.set_updated_at();

-- Row Level Security
--
-- Each signed-in user can only ever see/write their own rows. There is no anon
-- access at all — a browser that hasn't signed in just doesn't talk to this table
-- (store.js falls back to localStorage-only in that case).
alter table public.sessions enable row level security;

drop policy if exists "users can read own sessions" on public.sessions;
create policy "users can read own sessions"
  on public.sessions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users can insert own sessions" on public.sessions;
create policy "users can insert own sessions"
  on public.sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can update own sessions" on public.sessions;
create policy "users can update own sessions"
  on public.sessions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users can delete own sessions" on public.sessions;
create policy "users can delete own sessions"
  on public.sessions for delete
  to authenticated
  using (auth.uid() = user_id);
