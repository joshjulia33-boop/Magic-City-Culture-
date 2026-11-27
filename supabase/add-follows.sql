-- ============================================================================
-- Magic City Culture — one-time update: Follow a Collector.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- Safe to re-run.
--
-- Adds:
--   * public.follows — one row per follow: follower_id follows
--     followee_id. The (follower_id, followee_id) primary key IS the
--     rule: a member can follow a collector once, and unfollowing is
--     deleting their own row. A check keeps anyone from following
--     themselves.
--
-- Following is deliberately LIGHTER than friendship: one tap, no
-- request, no accept step, nothing pending — and it is a separate
-- system. A follow is not a friendship, grants no access to
-- anything, and the two never share state.
--
-- Visibility: follows are PUBLIC — anyone, signed in or not, can
-- read them, because follower and following counts show on every
-- collector card and profile page. That is all a follow exposes:
-- two member ids and a date. No collection values or other private
-- data are involved, and nothing here touches comic_values.
--
-- Writes are narrowed down hard:
--   * INSERT and DELETE only as yourself in the follower role
--     (follower_id must be your own collector id) — nobody can
--     follow or unfollow as someone else.
--   * There is no UPDATE policy and no update grant: a follow row
--     never changes; it is created or deleted, nothing between.
--
-- Until this runs, the site works as before: the front end treats a
-- missing table exactly like it treated missing friendships /
-- messages / likes — the follow buttons and counts stay off the
-- cards and profiles, and My Shelf shows a short "being switched
-- on" note in place of the Following panel.
--
-- Written against the LIVE schema: it touches no existing view and
-- no stripe_* column (the Stripe migration has never run live).
-- ============================================================================

create table if not exists public.follows (
  follower_id uuid not null references public.collectors (id) on delete cascade,
  followee_id uuid not null references public.collectors (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

-- Who follows a member (their follower count, and "who follows me").
create index if not exists follows_followee_idx
  on public.follows (followee_id);
-- Who a member follows (their following list and count).
create index if not exists follows_follower_idx
  on public.follows (follower_id);

alter table public.follows enable row level security;

-- Follower counts are public: anyone can read follows.
drop policy if exists "follows: public read" on public.follows;
create policy "follows: public read"
  on public.follows for select
  to anon, authenticated
  using (true);

-- A member follows only as themselves.
drop policy if exists "follows: member follows" on public.follows;
create policy "follows: member follows"
  on public.follows for insert
  to authenticated
  with check (follower_id = public.current_collector_id());

-- A member unfollows only their own follows.
drop policy if exists "follows: member unfollows" on public.follows;
create policy "follows: member unfollows"
  on public.follows for delete
  to authenticated
  using (follower_id = public.current_collector_id());

-- Follows: read for everyone; write (insert/delete) for members
-- only, and only in the follower role. No update grant for anyone.
grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;
