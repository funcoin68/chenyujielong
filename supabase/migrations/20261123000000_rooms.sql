-- CYJ-17: rooms table — the first real game-state entity.
-- Applied by stage 9b via `supabase db push --remote=<ref> --password --yes`.
-- Never hand-edit after apply (CLAUDE.md); future changes via `supabase db diff`.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  -- Join code for the waiting room; server-generated, unique across all rooms.
  code text unique not null,
  owner_id uuid not null references public.users (id),
  name text,
  -- Settings chosen in the S3 form, constrained to what the client can send.
  rule text not null default 'strict' check (rule in ('strict', 'homophone')),
  turn_seconds int not null default 30 check (turn_seconds > 0),
  max_players int not null default 4 check (max_players >= 2 and max_players <= 6),
  win_condition text not null default 'rounds'
    check (win_condition in ('rounds', 'elimination')),
  dictionary text not null default 'common' check (dictionary in ('common', 'full')),
  status text not null default 'waiting'
    check (status in ('waiting', 'in_progress', 'closed')),
  created_at timestamptz not null default now()
);

-- AC #3: at most ONE active room per owner, enforced by the database itself
-- so concurrent create attempts cannot produce two active rooms (the
-- application-level "check then insert" would be racy). The room-authority
-- Edge Function treats a 409 from this index as "return the winner's room".
create unique index rooms_one_active_per_owner
  on public.rooms (owner_id)
  where status <> 'closed';

-- RLS enabled with NO policies: only the service role (the room-authority
-- Edge Function) can read or write — same pattern as users/sessions above,
-- so no client can bypass the function with a direct PostgREST write.
alter table public.rooms enable row level security;
