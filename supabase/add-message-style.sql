-- ============================================================================
-- Magic City Culture — one-time update: custom message bubble styles.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- Safe to re-run.
--
-- Adds:
--   * collectors.msg_color — the member's chosen chat-bubble colour, a
--     hex string like '#ff2e88', or NULL for the site defaults (your own
--     bubbles Neon Pink, the other member's Electric Blue).
--   * collectors.msg_font — the member's chosen bubble lettering, one
--     of the front end's fixed font keys ('site', 'comic', 'marker',
--     'hand', 'type', 'serif', 'heavy'), or NULL for the site default.
--   Both are public fields by design: a member's bubble style shows to
--   everyone they message, so both ride public_profiles below — the
--   same treatment as avatar_url. No message content, no collection
--   values and no other private data are involved, and the messages
--   table and its row-level security are untouched.
--   * guard_collector_featured recreated with msg_color / msg_font in
--     its frozen-column list: the founder featuring/unfeaturing another
--     member still cannot change anything else about that member,
--     bubble style included. A member editing their OWN profile is not
--     touched by that guard (it only fires cross-member), so setting
--     your own style keeps working through the normal owner policy —
--     no new policy is needed.
--
-- Written against the LIVE schema: public_profiles is recreated from
-- its current live definition (id, display_name, handle, city, bio,
-- avatar_color, is_founder, show_values_publicly, created_at,
-- referred_by, is_featured, avatar_url) with msg_color and msg_font
-- appended — no stripe_* column is referenced anywhere (the Stripe
-- migration has never run live, so the live collectors table has
-- none).
--
-- Until this runs, the site works as before: the front end treats
-- missing msg_color / msg_font fields exactly like it treated the
-- other one-time updates — the Edit Profile "Message style" section
-- stays hidden and every bubble wears the site defaults.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The columns
-- ----------------------------------------------------------------------------
alter table public.collectors
  add column if not exists msg_color text;

alter table public.collectors
  add column if not exists msg_font text;

-- ----------------------------------------------------------------------------
-- Founder-feature guard: same function as add-avatar.sql (written
-- against the live schema), with msg_color / msg_font frozen
-- cross-member.
-- ----------------------------------------------------------------------------
create or replace function public.guard_collector_featured()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.is_featured is distinct from old.is_featured
     and not public.is_founder_collector() then
    raise exception 'Only the founder can feature a member.';
  end if;
  if public.is_founder_collector()
     and old.auth_user_id is distinct from auth.uid()
     and (new.auth_user_id is distinct from old.auth_user_id
       or new.display_name is distinct from old.display_name
       or new.handle is distinct from old.handle
       or new.city is distinct from old.city
       or new.bio is distinct from old.bio
       or new.avatar_color is distinct from old.avatar_color
       or new.avatar_url is distinct from old.avatar_url
       or new.msg_color is distinct from old.msg_color
       or new.msg_font is distinct from old.msg_font
       or new.is_founder is distinct from old.is_founder
       or new.show_values_publicly is distinct from old.show_values_publicly
       or new.referred_by is distinct from old.referred_by
       or new.created_at is distinct from old.created_at) then
    raise exception 'The founder can only feature or unfeature another member.';
  end if;
  return new;
end;
$$;

drop trigger if exists collectors_guard_featured on public.collectors;
create trigger collectors_guard_featured
  before update on public.collectors
  for each row execute function public.guard_collector_featured();

-- ----------------------------------------------------------------------------
-- Public profiles: current live definition + msg_color / msg_font
-- appended.
-- ----------------------------------------------------------------------------
create or replace view public.public_profiles as
select id, display_name, handle, city, bio, avatar_color,
       is_founder, show_values_publicly, created_at,
       referred_by,
       is_featured,
       avatar_url,
       msg_color,
       msg_font
from public.collectors;

grant select on public.public_profiles to anon, authenticated;
