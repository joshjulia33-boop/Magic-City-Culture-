-- ============================================================================
-- Magic City Culture Community — Supabase (Postgres) schema
-- ============================================================================
-- Port of the Muse artifact's SQLite/Drizzle schema (collectors, comics,
-- orders) to Supabase Postgres with real accounts (Supabase Auth) and
-- row-level security.
--
-- HOW TO RUN: paste this whole file into the Supabase dashboard SQL editor
-- for the project and run it once. It is written to be safe to re-run
-- (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS throughout).
--
-- PRIVACY DESIGN (the important part)
-- -----------------------------------
-- Joshua's standing rule: a collector's collection VALUES are private by
-- default and visible only to that collector. A collector may opt in
-- (collectors.show_values_publicly = true) to show their books' *current
-- value* publicly. Price paid, purchase date, source/seller, and notes are
-- NEVER public, opted in or not. Marketplace asking prices are public by
-- design (they are the offer to everyone).
--
-- This is enforced at the data layer, not in app code:
--
--   1. Every money/purchase column lives in a separate table,
--      public.comic_values, whose RLS policies allow ONLY the owning
--      collector to read or write a row. There is no anon grant on it at
--      all, so the publishable (anon) key can never reach it.
--
--   2. public.comics contains only public-safe columns (title, issue,
--      variant, grade, signed flag, cover, status, asking price), so its
--      read policy can be wide open for the shared gallery without leaking
--      anything private.
--
--   3. The one place a value may surface publicly is the curated view
--      public.gallery_comics, which projects current_value_cents ONLY when
--      the owning collector has show_values_publicly = true (otherwise
--      NULL). The view runs with its owner's rights (standard Postgres
--      view behaviour) precisely so it can apply that conditional
--      projection; it exposes no other column from comic_values — price
--      paid, purchase date, source, and notes are not in the view at all.
--
--   4. public.collectors holds only public profile fields, but its base
--      table is still owner-read-only (it carries the auth_user_id link).
--      Public profile reads go through the public.public_profiles view,
--      which omits auth_user_id.
--
-- ACCOUNTS
-- --------
-- collectors.auth_user_id links a profile to a Supabase Auth user. It is
-- nullable so the founder profile can be seeded before Joshua's auth user
-- exists; claim it later with one update (see seed.sql / BUILD_NOTES.md):
--   update public.collectors set auth_user_id = '<joshua-auth-uid>'
--   where handle = 'joshua';
--
-- MARKET
-- ------
-- As in the original design there is no separate listings table: a listing
-- is a comic with status = 'for_sale' and asking_price_cents set. The
-- public.listings view presents active listings. Orders snapshot the price
-- at purchase time. No payments are taken anywhere in this schema.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- Keep updated_at honest on tables that have one.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- collectors — community member profiles (public fields only)
-- ----------------------------------------------------------------------------
create table if not exists public.collectors (
  id                    uuid primary key default gen_random_uuid(),
  -- Link to the Supabase Auth account that owns this profile.
  -- Nullable: the seeded founder profile predates his auth user.
  auth_user_id          uuid unique references auth.users (id) on delete set null,
  display_name          text not null,
  handle                text not null unique check (handle = lower(handle)),
  city                  text not null default '',
  bio                   text not null default '',
  avatar_color          text not null default '#FF2E88',
  is_founder            boolean not null default false,
  -- The collector's own choice: false (default) = my values are visible
  -- only to me; true = my books' current values may show in the gallery.
  show_values_publicly  boolean not null default false,
  created_at            timestamptz not null default now()
);

-- The collector profile belonging to the currently signed-in auth user
-- (NULL for anonymous visitors and for profiles not yet claimed).
-- SECURITY DEFINER so RLS policies can use it without recursion.
-- Defined after collectors exists: SQL-language functions validate their
-- body at creation time.
create or replace function public.current_collector_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.collectors where auth_user_id = auth.uid()
$$;

alter table public.collectors enable row level security;

-- Base table: you can read only your own row (public reads use the view).
drop policy if exists "collectors: read own profile" on public.collectors;
create policy "collectors: read own profile"
  on public.collectors for select
  to authenticated
  using (auth_user_id = auth.uid());

-- A signed-in user creates exactly one profile, bound to their auth user.
drop policy if exists "collectors: create own profile" on public.collectors;
create policy "collectors: create own profile"
  on public.collectors for insert
  to authenticated
  with check (auth_user_id = auth.uid());

drop policy if exists "collectors: update own profile" on public.collectors;
create policy "collectors: update own profile"
  on public.collectors for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists "collectors: delete own profile" on public.collectors;
create policy "collectors: delete own profile"
  on public.collectors for delete
  to authenticated
  using (auth_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- comics — one row per book on a collector's shelf.
-- PUBLIC-SAFE COLUMNS ONLY: no price paid, no value, no purchase details.
-- ----------------------------------------------------------------------------
create table if not exists public.comics (
  id                  uuid primary key default gen_random_uuid(),
  collector_id        uuid not null references public.collectors (id) on delete cascade,
  title               text not null,
  issue               text not null default '',
  publisher           text not null default '',
  variant             text not null default '',
  grade               text not null default '',
  is_signed           boolean not null default false,
  has_remark          boolean not null default false,
  -- Cover types / finishes the member tapped in the form, comma-joined
  -- ("Virgin, Foil") — a cover can be several at once. '' = none picked.
  cover_type          text not null default '',
  -- Marketplace asking price in cents, set only while status = 'for_sale'.
  -- Public by design — it is the offer to everyone. Cleared when unlisted.
  asking_price_cents  integer check (asking_price_cents is null or asking_price_cents >= 0),
  status              text not null default 'owned'
                      check (status in ('owned', 'for_sale', 'sold', 'wishlist')),
  cover_color         text not null default '#FF2E88',
  -- Public URL of the collector's own cover photo (Supabase Storage,
  -- 'covers' bucket — see the optional storage section at the bottom).
  cover_url           text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists comics_collector_idx on public.comics (collector_id);
create index if not exists comics_status_idx on public.comics (status);

drop trigger if exists comics_touch_updated_at on public.comics;
create trigger comics_touch_updated_at
  before update on public.comics
  for each row execute function public.touch_updated_at();

alter table public.comics enable row level security;

-- Everyone (including anonymous visitors) may browse every shelf: every
-- column in this table is safe to be public.
drop policy if exists "comics: public read" on public.comics;
create policy "comics: public read"
  on public.comics for select
  to anon, authenticated
  using (true);

drop policy if exists "comics: add to own shelf" on public.comics;
create policy "comics: add to own shelf"
  on public.comics for insert
  to authenticated
  with check (collector_id = public.current_collector_id());

drop policy if exists "comics: update own books" on public.comics;
create policy "comics: update own books"
  on public.comics for update
  to authenticated
  using (collector_id = public.current_collector_id())
  with check (collector_id = public.current_collector_id());

drop policy if exists "comics: remove own books" on public.comics;
create policy "comics: remove own books"
  on public.comics for delete
  to authenticated
  using (collector_id = public.current_collector_id());

-- ----------------------------------------------------------------------------
-- comic_values — OWNER-ONLY money & purchase details, one row per comic.
-- This table is the privacy wall: no anon grant, and every policy requires
-- the comic to belong to the signed-in collector.
-- ----------------------------------------------------------------------------
create table if not exists public.comic_values (
  comic_id              uuid primary key references public.comics (id) on delete cascade,
  -- NULL means "not recorded" (the founder's seeded books start NULL:
  -- prices were stripped from the public starter data on purpose).
  purchase_price_cents  integer check (purchase_price_cents is null or purchase_price_cents >= 0),
  current_value_cents   integer check (current_value_cents is null or current_value_cents >= 0),
  purchase_date         date,
  source                text not null default '',  -- seller / shop; never public
  notes                 text not null default '',  -- never public
  updated_at            timestamptz not null default now()
);

drop trigger if exists comic_values_touch_updated_at on public.comic_values;
create trigger comic_values_touch_updated_at
  before update on public.comic_values
  for each row execute function public.touch_updated_at();

alter table public.comic_values enable row level security;

drop policy if exists "comic_values: owner reads own" on public.comic_values;
create policy "comic_values: owner reads own"
  on public.comic_values for select
  to authenticated
  using (exists (
    select 1 from public.comics cm
    where cm.id = comic_values.comic_id
      and cm.collector_id = public.current_collector_id()
  ));

drop policy if exists "comic_values: owner writes own" on public.comic_values;
create policy "comic_values: owner writes own"
  on public.comic_values for insert
  to authenticated
  with check (exists (
    select 1 from public.comics cm
    where cm.id = comic_values.comic_id
      and cm.collector_id = public.current_collector_id()
  ));

drop policy if exists "comic_values: owner updates own" on public.comic_values;
create policy "comic_values: owner updates own"
  on public.comic_values for update
  to authenticated
  using (exists (
    select 1 from public.comics cm
    where cm.id = comic_values.comic_id
      and cm.collector_id = public.current_collector_id()
  ))
  with check (exists (
    select 1 from public.comics cm
    where cm.id = comic_values.comic_id
      and cm.collector_id = public.current_collector_id()
  ));

drop policy if exists "comic_values: owner deletes own" on public.comic_values;
create policy "comic_values: owner deletes own"
  on public.comic_values for delete
  to authenticated
  using (exists (
    select 1 from public.comics cm
    where cm.id = comic_values.comic_id
      and cm.collector_id = public.current_collector_id()
  ));

-- ----------------------------------------------------------------------------
-- orders — one member buying another member's for-sale comic.
-- The price is snapshotted at purchase time. No payments are taken.
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  comic_id      uuid not null references public.comics (id) on delete restrict,
  seller_id     uuid not null references public.collectors (id) on delete restrict,
  buyer_id      uuid not null references public.collectors (id) on delete restrict,
  price_cents   integer not null check (price_cents >= 0),
  status        text not null default 'placed' check (status in ('placed', 'completed')),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  check (buyer_id <> seller_id)
);

create index if not exists orders_buyer_idx on public.orders (buyer_id);
create index if not exists orders_seller_idx on public.orders (seller_id);
create index if not exists orders_comic_idx on public.orders (comic_id);

alter table public.orders enable row level security;

-- Only the two parties to an order can see it.
drop policy if exists "orders: parties read" on public.orders;
create policy "orders: parties read"
  on public.orders for select
  to authenticated
  using (
    buyer_id = public.current_collector_id()
    or seller_id = public.current_collector_id()
  );

-- A buyer places an order only for a book that is actually listed for sale
-- by the named seller, at exactly the listed asking price (the snapshot).
drop policy if exists "orders: buyer places" on public.orders;
create policy "orders: buyer places"
  on public.orders for insert
  to authenticated
  with check (
    buyer_id = public.current_collector_id()
    and exists (
      select 1 from public.comics cm
      where cm.id = orders.comic_id
        and cm.collector_id = orders.seller_id
        and cm.status = 'for_sale'
        and cm.asking_price_cents = orders.price_cents
    )
  );

-- The seller manages the order after placement (marks it complete).
drop policy if exists "orders: seller updates" on public.orders;
create policy "orders: seller updates"
  on public.orders for update
  to authenticated
  using (seller_id = public.current_collector_id())
  with check (seller_id = public.current_collector_id());

-- When an order is placed, the book leaves the market: it stays on the
-- seller's shelf with status 'sold' (same behaviour as the original app).
-- SECURITY DEFINER because the buyer may not update the seller's comic.
create or replace function public.mark_comic_sold_on_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comics
     set status = 'sold', asking_price_cents = null
   where id = new.comic_id;
  return new;
end;
$$;

drop trigger if exists orders_mark_comic_sold on public.orders;
create trigger orders_mark_comic_sold
  after insert on public.orders
  for each row execute function public.mark_comic_sold_on_order();

-- ----------------------------------------------------------------------------
-- Public views (curated projections — the only public read paths that touch
-- collectors and comic_values)
-- ----------------------------------------------------------------------------

-- Public profiles: every profile field except the auth link.
create or replace view public.public_profiles as
select id, display_name, handle, city, bio, avatar_color,
       is_founder, show_values_publicly, created_at
from public.collectors;

-- The shared gallery: every book with its owner's public identity, plus
-- current value ONLY where the owner opted in (otherwise NULL). Price
-- paid, purchase date, source, and notes are not projected at all.
create or replace view public.gallery_comics as
select cm.id,
       cm.collector_id,
       col.display_name as collector_name,
       col.handle       as collector_handle,
       col.is_founder   as collector_is_founder,
       cm.title, cm.issue, cm.publisher, cm.variant, cm.grade,
       cm.is_signed, cm.status, cm.asking_price_cents,
       cm.cover_color, cm.cover_url, cm.created_at,
       case when col.show_values_publicly then cv.current_value_cents end
         as current_value_cents,
       cm.has_remark,
       cm.cover_type
from public.comics cm
join public.collectors col on col.id = cm.collector_id
left join public.comic_values cv on cv.comic_id = cm.id;

-- Active marketplace listings (asking price is public by design).
create or replace view public.listings as
select cm.id as comic_id,
       cm.title, cm.issue, cm.publisher, cm.variant, cm.grade,
       cm.is_signed, cm.cover_color, cm.cover_url,
       cm.asking_price_cents,
       cm.collector_id as seller_id,
       col.display_name as seller_name,
       col.handle       as seller_handle,
       cm.updated_at    as listed_at,
       cm.has_remark,
       cm.cover_type
from public.comics cm
join public.collectors col on col.id = cm.collector_id
where cm.status = 'for_sale';

-- ----------------------------------------------------------------------------
-- Grants (RLS above still decides which rows each role can actually reach)
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on public.collectors to authenticated;
grant insert, update, delete on public.collectors to authenticated;

grant select on public.comics to anon, authenticated;
grant insert, update, delete on public.comics to authenticated;

-- comic_values: authenticated role only, and RLS narrows that to the owner.
-- Deliberately NO grant to anon.
revoke all on public.comic_values from anon;
grant select, insert, update, delete on public.comic_values to authenticated;

grant select, insert, update on public.orders to authenticated;

grant select on public.public_profiles to anon, authenticated;
grant select on public.gallery_comics to anon, authenticated;
grant select on public.listings to anon, authenticated;

-- ============================================================================
-- OPTIONAL: cover photo storage.
-- Creates a public-read 'covers' bucket. Uploads must live under a folder
-- named with the uploader's collector id: covers/<collector_id>/<file>,
-- which the policies below enforce. Safe to skip if covers stay as
-- colour tiles for now.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

drop policy if exists "covers: public read" on storage.objects;
create policy "covers: public read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'covers');

drop policy if exists "covers: upload own folder" on storage.objects;
create policy "covers: upload own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = public.current_collector_id()::text
  );

drop policy if exists "covers: manage own folder" on storage.objects;
create policy "covers: manage own folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = public.current_collector_id()::text
  )
  with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = public.current_collector_id()::text
  );

drop policy if exists "covers: delete own files" on storage.objects;
create policy "covers: delete own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = public.current_collector_id()::text
  );
