-- CYJ-7: first schema — Google OAuth users and opaque server-side sessions.
-- Applied by stage 9b via `supabase db push --remote=<ref> --password --yes`.
-- Never hand-edit after apply (CLAUDE.md); future changes via `supabase db diff`.

create extension if not exists citext;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  email citext unique not null,
  display_name text,
  avatar_url text,
  auth_provider text not null,
  password_hash text, -- null for OAuth users (AC #2)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- SHA-256 hex of the cookie token; the raw token never touches the DB.
  token_hash text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index sessions_expires_at_idx on public.sessions (expires_at);

-- RLS enabled with NO policies: only the service role (the auth Edge
-- Function) can read or write; anon/authenticated clients get nothing.
alter table public.users enable row level security;
alter table public.sessions enable row level security;
