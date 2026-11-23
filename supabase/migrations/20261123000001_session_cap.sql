-- CYJ-21: cap sessions at 3 per user, evicting the oldest on each new sign-in.
-- Applied by stage 9b via `supabase db push --remote=<ref> --password --yes`.
-- Never hand-edit after apply (CLAUDE.md); future changes via `supabase db diff`.

-- Enforced by the database, not the Edge Function: an AFTER INSERT trigger
-- serializes per user with pg_advisory_xact_lock so two concurrent sign-ins
-- cannot each protect only their own row and leave 4 behind (an application
-- "check then delete" would be racy — same reasoning as CYJ-17's
-- rooms_one_active_per_owner index).
create or replace function public.enforce_session_cap()
returns trigger
language plpgsql
as $$
begin
  -- Serialize the eviction per user; READ COMMITTED takes the DELETE's
  -- statement snapshot after the lock is granted, so it sees rows committed
  -- by any earlier serialized transaction (including one that just inserted
  -- a competing session).
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  -- The brand-new session always survives; of the remaining rows keep only
  -- the 2 most recent by created_at (id desc breaks ties — now() is
  -- transaction-start time, so concurrent inserts can share a microsecond).
  delete from public.sessions s
   where s.user_id = new.user_id
     and s.id <> new.id
     and s.id not in (
       select id from public.sessions
        where user_id = new.user_id and id <> new.id
        order by created_at desc, id desc
        limit 2
     );

  return new;
end;
$$;

create trigger sessions_enforce_cap
  after insert on public.sessions
  for each row execute function public.enforce_session_cap();

-- No retroactive cleanup: the trigger fires only on INSERT, so existing
-- sessions for users who never sign in again are untouched (AC #5).
