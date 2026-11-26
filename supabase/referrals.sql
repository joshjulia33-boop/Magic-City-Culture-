-- ============================================================================
-- Magic City Culture Community — referrals ("who invited you")
-- ============================================================================
-- Adds referral tracking:
--   * collectors.referred_by — the collector whose personal referral link
--     (https://magic-city-culture.vercel.app/?ref=<handle>) the new member
--     arrived through. Nullable; written once by the front end when the
--     member creates their profile, and only when the link's handle names
--     a real collector.
--   * public_profiles exposes referred_by so the site can show
--     "Invited by @x" on a member's public profile and count how many
--     collectors joined through a member's own link. It is a public
--     attribution, not private data — no collection values, prices, or
--     purchase details are involved, and the values-privacy design in
--     schema.sql is untouched.
--
-- HOW TO RUN: Supabase dashboard → project ekdgbjnztnfrfjrhljpz →
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- It is written to be safe to re-run.
--
-- RLS: no policy changes are needed. The existing
-- "collectors: create own profile" policy pins auth_user_id to the
-- caller and leaves the row's other fields to the member creating it,
-- so a new member may set referred_by on their own row at insert.
-- Every other policy is unchanged.
-- ============================================================================

alter table public.collectors
  add column if not exists referred_by uuid
  references public.collectors (id) on delete set null;

create index if not exists collectors_referred_by_idx
  on public.collectors (referred_by);

-- Rebuild the public profiles view with referred_by appended (Postgres
-- requires new columns to go last on CREATE OR REPLACE VIEW).
-- payouts_enabled rides at the very end: it is added by
-- add-stripe-payments.sql, whose own rebuild of this view is the final
-- word — this definition matches that final shape so re-running this
-- file on a current database stays a no-op. (On a database where the
-- Stripe update has not run yet, run add-stripe-payments.sql after
-- this file, as web/README.md orders the steps.)
create or replace view public.public_profiles as
select id, display_name, handle, city, bio, avatar_color,
       is_founder, show_values_publicly, created_at, referred_by,
       stripe_payouts_enabled as payouts_enabled
from public.collectors;

grant select on public.public_profiles to anon, authenticated;
