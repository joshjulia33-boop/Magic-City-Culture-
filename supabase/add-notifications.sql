-- ============================================================================
-- Magic City Culture — one-time update: Notifications center.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- Safe to re-run.
--
-- Adds:
--   * public.collectors.notifications_seen_at — the moment the member
--     last pressed "Mark all seen" in the NOTIFICATIONS panel on My
--     Shelf. The panel itself is built client-side from data the site
--     already loads (likes and comments on my books, new followers,
--     pending friend requests, unread messages, offers received,
--     want-list matches); this column is the only new storage — the
--     "seen" watermark that separates new events from old ones.
--
-- Privacy: this is the member's OWN private field. It is deliberately
-- NOT projected into public_profiles (unlike avatar_url / msg_color,
-- which are public by design). The front end reads it from the
-- member's own collectors row — the own-profile load RLS already
-- allows — and writes it with the existing "collectors: update own
-- profile" policy. No new policies, no view changes.
--
-- Until this runs, the site works as before: the NOTIFICATIONS panel
-- simply stays hidden (the front end checks the key exists on the
-- member's own profile row, like avatarReady / msgStyleReady).
-- ============================================================================

alter table public.collectors
  add column if not exists notifications_seen_at timestamptz;
