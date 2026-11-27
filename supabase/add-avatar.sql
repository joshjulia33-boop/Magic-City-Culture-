-- ============================================================================
-- Magic City Culture — one-time update: profile picture upload.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- Safe to re-run.
--
-- Adds:
--   * collectors.avatar_url — the member's profile photo (a public
--     storage URL, or NULL for the coloured-initial avatar). It is a
--     public field by design: the photo shows everywhere the member
--     appears, so it rides public_profiles below. No collection
--     values or other private data are involved.
--   * A public-read 'avatars' storage bucket, mirroring the 'covers'
--     bucket's pattern exactly: uploads must live under a folder
--     named with the uploader's collector id —
--     avatars/<collector_id>/<file> — which the storage policies
--     below enforce. A member can only write inside their own
--     folder; anyone can read (the photos are public on profiles).
--   * guard_collector_featured recreated with avatar_url in its
--     frozen-column list: the founder featuring/unfeaturing another
--     member still cannot change anything else about that member,
--     avatar included. A member editing their OWN profile is not
--     touched by that guard (it only fires cross-member), so setting
--     your own photo keeps working through the normal owner policy.
--
-- Written against the LIVE schema: public_profiles is recreated from
-- its current live definition (id, display_name, handle, city, bio,
-- avatar_color, is_founder, show_values_publicly, created_at,
-- referred_by, is_featured) with avatar_url appended — no stripe_*
-- column is referenced anywhere (the Stripe migration has never run
-- live, so the live collectors table has none).
--
-- Until this runs, the site works as before: the front end treats a
-- missing avatar_url column / avatars bucket exactly like it treated
-- the other one-time updates — the Edit Profile photo section stays
-- hidden and every avatar stays the coloured initial.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The column
-- ----------------------------------------------------------------------------
alter table public.collectors
  add column if not exists avatar_url text;

-- ----------------------------------------------------------------------------
-- Founder-feature guard: same function as add-admin.sql (written
-- against the live schema), with avatar_url frozen cross-member.
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
-- Public profiles: current live definition + avatar_url appended.
-- ----------------------------------------------------------------------------
create or replace view public.public_profiles as
select id, display_name, handle, city, bio, avatar_color,
       is_founder, show_values_publicly, created_at,
       referred_by,
       is_featured,
       avatar_url
from public.collectors;

grant select on public.public_profiles to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Avatar photo storage: a public-read 'avatars' bucket. Uploads must
-- live under a folder named with the uploader's collector id:
-- avatars/<collector_id>/<file>, enforced by the policies below —
-- the same pattern the 'covers' bucket uses.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars: upload own folder" on storage.objects;
create policy "avatars: upload own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_collector_id()::text
  );

drop policy if exists "avatars: manage own folder" on storage.objects;
create policy "avatars: manage own folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_collector_id()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_collector_id()::text
  );

drop policy if exists "avatars: delete own files" on storage.objects;
create policy "avatars: delete own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = public.current_collector_id()::text
  );
