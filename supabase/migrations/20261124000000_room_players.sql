-- CYJ-24: room_players — who is in a room. The host row is inserted with the
-- room (create path); the future join flow appends rows here.
-- Applied by stage 9b via `supabase db push --remote=<ref> --password --yes`.
-- Never hand-edit after apply (CLAUDE.md); future changes via `supabase db diff`.

create table public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.users (id),
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (room_id, user_id)
);

-- The host is exactly one per room — the future join flow must never be able
-- to promote a second host.
create unique index room_players_one_host_per_room
  on public.room_players (room_id)
  where is_host;

create index room_players_user_idx on public.room_players (user_id);

-- Backfill: every existing room's owner is its host player.
insert into public.room_players (room_id, user_id, is_host)
  select id, owner_id, true from public.rooms;

-- RLS enabled with NO policies: only the service role (the room-authority
-- Edge Function) can read or write — same isolation as rooms/users/sessions.
alter table public.room_players enable row level security;
