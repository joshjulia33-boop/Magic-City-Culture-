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
-- at purchase time.
--
-- PAYMENTS (Stripe Connect, added 2026-11-26 — see add-stripe-payments.sql)
-- ------------------------------------------------------------------------
-- Members who sell can connect a Stripe STANDARD account (collectors.
-- stripe_account_id + synced enabled flags, written only by the
-- stripe-connect Edge Function with the service key). Buyers pay by card
-- through Stripe Checkout as destination charges: the money lands in the
-- seller's own Stripe account, minus Stripe's processing fee and a 5%
-- platform commission (application_fee_amount) to the site's account.
-- Orders are created ONLY by the stripe-webhook function after Stripe
-- confirms payment; trade cash top-ups ride the same rails and their
-- state lives on offers (cash_status). No Stripe secret lives in this
-- schema — keys exist only as Edge Function secrets.
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
  -- Profile photo (see add-avatar.sql): a public storage URL in the
  -- 'avatars' bucket, or NULL for the coloured-initial avatar. Public
  -- by design — it shows everywhere the member appears, so it rides
  -- public_profiles below.
  avatar_url            text,
  -- Message bubble style (see add-message-style.sql): the member's
  -- chosen chat-bubble colour (a hex string like '#ff2e88') and
  -- lettering (a front-end font key), NULL = the site defaults. Public
  -- by design — the style shows to everyone the member messages, so
  -- both ride public_profiles below, like avatar_url.
  msg_color             text,
  msg_font              text,
  is_founder            boolean not null default false,
  -- The founder's front-page pick (see add-admin.sql). Publicly read
  -- through public_profiles; changeable ONLY by the founder, on any
  -- row — enforced by the guard trigger further down.
  is_featured           boolean not null default false,
  -- The collector's own choice: false (default) = my values are visible
  -- only to me; true = my books' current values may show in the gallery.
  show_values_publicly  boolean not null default false,
  -- Who invited this member (their ?ref= link), recorded once at
  -- profile creation. Kept from supabase/referrals.sql, folded here so
  -- the public_profiles view below can expose it alongside payouts.
  referred_by           uuid references public.collectors (id) on delete set null,
  -- Stripe Connect (STANDARD) account for members who sell. The id is
  -- written only by the stripe-connect Edge Function (service key); the
  -- flags are synced from Stripe's own account state the same way. The
  -- id never leaves this owner-only table — public views project only
  -- the payouts_enabled boolean.
  stripe_account_id     text,
  stripe_charges_enabled boolean not null default false,
  stripe_payouts_enabled boolean not null default false,
  stripe_details_submitted boolean not null default false,
  created_at            timestamptz not null default now()
);

create unique index if not exists collectors_stripe_account_idx
  on public.collectors (stripe_account_id)
  where stripe_account_id is not null;

create index if not exists collectors_referred_by_idx
  on public.collectors (referred_by);

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

-- Is the signed-in collector the founder? Used by the Admin dashboard
-- policies (featured flags, reports — see add-admin.sql).
create or replace function public.is_founder_collector()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.collectors
    where id = public.current_collector_id() and is_founder
  )
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

-- The founder may UPDATE any profile row — but the guard trigger
-- below narrows that reach to the is_featured flag alone. He also
-- gets a founder-only SELECT policy: an UPDATE can only reach rows
-- the caller can see, and this table is otherwise owner-read-only.
drop policy if exists "collectors: founder reads" on public.collectors;
create policy "collectors: founder reads"
  on public.collectors for select
  to authenticated
  using (public.is_founder_collector());

drop policy if exists "collectors: founder features" on public.collectors;
create policy "collectors: founder features"
  on public.collectors for update
  to authenticated
  using (public.is_founder_collector())
  with check (public.is_founder_collector());

-- Only the founder may move is_featured, on any row; and a founder
-- updating somebody else's profile may change nothing else.
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
       or new.stripe_account_id is distinct from old.stripe_account_id
       or new.stripe_charges_enabled is distinct from old.stripe_charges_enabled
       or new.stripe_payouts_enabled is distinct from old.stripe_payouts_enabled
       or new.stripe_details_submitted is distinct from old.stripe_details_submitted
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
  -- Name of the artist who signed the copy, free text typed into the
  -- "Signed by (artist name)" box under the Signed tick. NULL/'' = none.
  signed_by           text,
  -- The "COA" tick in the form's signature section (Signed → Signed by
  -- → COA): the copy comes with a Certificate of Authenticity.
  has_coa             boolean not null default false,
  has_remark          boolean not null default false,
  -- Cover types / finishes the member tapped in the form, comma-joined
  -- ("Virgin, Foil") — a cover can be several at once. '' = none picked.
  cover_type          text not null default '',
  -- Marketplace asking price in cents, set only while status = 'for_sale'.
  -- Public by design — it is the offer to everyone. Cleared when unlisted.
  asking_price_cents  integer check (asking_price_cents is null or asking_price_cents >= 0),
  -- Payment methods the seller accepts for a listing, comma-joined picks
  -- from the form ("Cash, Zelle"). Public by design, like the asking
  -- price — display text for settling off-site; card payment itself runs
  -- through Stripe Connect (see the collectors Stripe columns).
  payment_methods     text not null default '',
  -- Free text for the "Other" payment method.
  payment_other       text not null default '',
  -- The book can be traded for: other members may offer bundles of
  -- their own books (plus cash) for it in the Trade tab.
  open_to_trades      boolean not null default false,
  -- The founder's front-page pick (see add-admin.sql). Public by
  -- design like the rest of this table; changeable ONLY by the
  -- founder, on any row — enforced by the guard trigger further down.
  is_featured         boolean not null default false,
  -- The ONE book the member calls their grail (see add-grail.sql).
  -- Public by design like the rest of this table; the partial unique
  -- index below guarantees at most one grail per member.
  is_grail            boolean not null default false,
  status              text not null default 'owned'
                      check (status in ('owned', 'for_sale', 'sold', 'wishlist')),
  cover_color         text not null default '#FF2E88',
  -- Public URL of the collector's own cover photo (Supabase Storage,
  -- 'covers' bucket — see the optional storage section at the bottom).
  cover_url           text,
  -- Up to FOUR extra photos of the actual book (back cover, corner or
  -- page close-ups, the certificate photo) as a JSON array of Storage
  -- URLs in the same 'covers' bucket. Cover + 4 extras = 5 photos max.
  extra_photos        jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(extra_photos) = 'array'
                             and jsonb_array_length(extra_photos) <= 4),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists comics_collector_idx on public.comics (collector_id);
create index if not exists comics_status_idx on public.comics (status);
-- At most ONE grail per member, enforced by the database itself.
create unique index if not exists comics_one_grail_per_collector
  on public.comics (collector_id)
  where is_grail;

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

-- The founder may UPDATE any book row — but the guard trigger below
-- narrows that reach to the is_featured flag alone.
drop policy if exists "comics: founder features" on public.comics;
create policy "comics: founder features"
  on public.comics for update
  to authenticated
  using (public.is_founder_collector())
  with check (public.is_founder_collector());

-- Only the founder may move is_featured, on any row; and a founder
-- updating a book that is not theirs may change nothing else.
-- (updated_at is deliberately not compared: the touch trigger
-- maintains it.)
create or replace function public.guard_comic_featured()
returns trigger
language plpgsql
as $$
begin
  -- Server-side writers (Edge Functions with the service key, and the
  -- security-definer sold-marker behind them) have no auth user.
  if auth.uid() is null then
    return new;
  end if;
  if new.is_featured is distinct from old.is_featured
     and not public.is_founder_collector() then
    raise exception 'Only the founder can feature a book.';
  end if;
  if public.is_founder_collector()
     and old.collector_id is distinct from public.current_collector_id()
     and (new.collector_id is distinct from old.collector_id
       or new.title is distinct from old.title
       or new.issue is distinct from old.issue
       or new.publisher is distinct from old.publisher
       or new.variant is distinct from old.variant
       or new.grade is distinct from old.grade
       or new.is_signed is distinct from old.is_signed
       or new.signed_by is distinct from old.signed_by
       or new.has_coa is distinct from old.has_coa
       or new.has_remark is distinct from old.has_remark
       or new.cover_type is distinct from old.cover_type
       or new.asking_price_cents is distinct from old.asking_price_cents
       or new.payment_methods is distinct from old.payment_methods
       or new.payment_other is distinct from old.payment_other
       or new.open_to_trades is distinct from old.open_to_trades
       or new.is_grail is distinct from old.is_grail
       or new.status is distinct from old.status
       or new.cover_color is distinct from old.cover_color
       or new.cover_url is distinct from old.cover_url
       or new.extra_photos is distinct from old.extra_photos
       or new.created_at is distinct from old.created_at) then
    raise exception 'The founder can only feature or unfeature another member''s book.';
  end if;
  return new;
end;
$$;

drop trigger if exists comics_guard_featured on public.comics;
create trigger comics_guard_featured
  before update on public.comics
  for each row execute function public.guard_comic_featured();

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
-- orders — one member buying another member's for-sale comic, paid by
-- card through Stripe Checkout (destination charge to the seller's
-- connected account, 5% platform commission). The price and the fee are
-- snapshotted at purchase time. Orders are created ONLY by the
-- stripe-webhook Edge Function (service key) after Stripe confirms
-- payment — no client insert policy exists, so nobody can mint an
-- unpaid order. (Rows with status 'placed' predate card payments: the
-- old off-site flow, kept completable by the seller.)
-- Status ladder: paid → shipped → received → completed, moved only by
-- the party whose leg it is, enforced by guard_order_update below.
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  comic_id      uuid not null references public.comics (id) on delete restrict,
  seller_id     uuid not null references public.collectors (id) on delete restrict,
  buyer_id      uuid not null references public.collectors (id) on delete restrict,
  price_cents   integer not null check (price_cents >= 0),
  -- The site's 5% commission, snapshotted (Stripe collects it as the
  -- application fee; Stripe's own processing fee is separate and comes
  -- out of the seller's side inside Stripe).
  platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0),
  stripe_checkout_session_id text,
  stripe_payment_intent_id   text,
  status        text not null default 'placed'
                check (status in ('placed', 'paid', 'shipped', 'received', 'completed', 'cancelled')),
  created_at    timestamptz not null default now(),
  shipped_at    timestamptz,
  received_at   timestamptz,
  completed_at  timestamptz,
  check (buyer_id <> seller_id)
);

create index if not exists orders_buyer_idx on public.orders (buyer_id);
create index if not exists orders_seller_idx on public.orders (seller_id);
create index if not exists orders_comic_idx on public.orders (comic_id);
create unique index if not exists orders_stripe_session_idx
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

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

-- Parties may update an order, but the guard trigger below limits each
-- side to its own status moves and freezes everything else. There is
-- deliberately NO insert policy: orders are born in the webhook.
drop policy if exists "orders: parties update status" on public.orders;
create policy "orders: parties update status"
  on public.orders for update
  to authenticated
  using (
    buyer_id = public.current_collector_id()
    or seller_id = public.current_collector_id()
  )
  with check (
    buyer_id = public.current_collector_id()
    or seller_id = public.current_collector_id()
  );

create or replace function public.guard_order_update()
returns trigger
language plpgsql
as $$
begin
  -- Server-side writers (Edge Functions with the service key) have no
  -- auth user; payment state is theirs to write.
  if auth.uid() is null then
    return new;
  end if;
  if new.comic_id is distinct from old.comic_id
     or new.seller_id is distinct from old.seller_id
     or new.buyer_id is distinct from old.buyer_id
     or new.price_cents is distinct from old.price_cents
     or new.platform_fee_cents is distinct from old.platform_fee_cents
     or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
     or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the status of an order can change.';
  end if;
  if public.current_collector_id() = old.seller_id then
    if old.status = 'paid' and new.status = 'shipped' then
      new.shipped_at = now();
    elsif old.status = 'placed' and new.status = 'completed' then
      -- Legacy off-site orders (placed before card payments existed).
      new.completed_at = now();
    elsif old.status = 'received' and new.status = 'completed' then
      new.completed_at = now();
    else
      raise exception 'The seller can only mark a paid order shipped, or a received order complete.';
    end if;
  elsif public.current_collector_id() = old.buyer_id then
    if old.status = 'shipped' and new.status = 'received' then
      new.received_at = now();
    else
      raise exception 'The buyer can only mark a shipped order received.';
    end if;
  else
    raise exception 'This order is not yours to update.';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard_update on public.orders;
create trigger orders_guard_update
  before update on public.orders
  for each row execute function public.guard_order_update();

-- When an order lands, the book leaves the market completely: status
-- 'sold' on the seller's shelf (the site's ownership model — the order
-- row is the transfer record), asking price cleared, no longer
-- trade-open, payment text cleared.
-- SECURITY DEFINER because the buyer may not update the seller's comic.
create or replace function public.mark_comic_sold_on_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comics
     set status = 'sold',
         asking_price_cents = null,
         open_to_trades = false,
         payment_methods = '',
         payment_other = ''
   where id = new.comic_id;
  return new;
end;
$$;

drop trigger if exists orders_mark_comic_sold on public.orders;
create trigger orders_mark_comic_sold
  after insert on public.orders
  for each row execute function public.mark_comic_sold_on_order();

-- ----------------------------------------------------------------------------
-- offers / offer_items — trade offers between two members (Trade tab).
-- An offer names one target book (the listed, trade-open book the sender
-- wants), the books each side puts in (offer_items: 'offered' = the
-- sender's books, 'requested' = the receiver's books, target included),
-- and any cash the sender adds to up the deal. A counter is a new offer
-- with the roles swapped and parent_offer_id pointing at the offer it
-- answers. The deal is written once and frozen; only the status moves
-- (pending → accepted / declined / countered / withdrawn), guarded by a
-- trigger so neither side can rewrite a deal or answer their own offer.
-- The books themselves still change hands between the members; the CASH
-- on a deal, once the offer is accepted, can be paid by card through
-- Stripe (see the cash_status columns on offers below, written only by
-- the guard trigger and the payment functions).
-- ----------------------------------------------------------------------------
create table if not exists public.offers (
  id                uuid primary key default gen_random_uuid(),
  from_collector_id uuid not null references public.collectors (id) on delete cascade,
  to_collector_id   uuid not null references public.collectors (id) on delete cascade,
  target_comic_id   uuid not null references public.comics (id) on delete cascade,
  cash_cents        integer not null default 0 check (cash_cents >= 0),
  -- Trade cash top-up payment state: 'not_required' (no cash, or the
  -- deal isn't accepted yet) → 'pending' (accepted with cash — the
  -- sender owes it) → 'paid' (the stripe-webhook function confirmed the
  -- card payment). Written by the guard trigger (on accept) and by the
  -- payment functions (service key) only — never by a member directly.
  cash_status       text not null default 'not_required'
                    check (cash_status in ('not_required', 'pending', 'paid')),
  cash_checkout_session_id text,
  cash_payment_intent_id   text,
  message           text not null default '',
  status            text not null default 'pending'
                    check (status in ('pending', 'accepted', 'declined', 'countered', 'withdrawn')),
  parent_offer_id   uuid references public.offers (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  responded_at      timestamptz,
  check (from_collector_id <> to_collector_id)
);

create index if not exists offers_from_idx on public.offers (from_collector_id);
create index if not exists offers_to_idx on public.offers (to_collector_id);
create index if not exists offers_parent_idx on public.offers (parent_offer_id);

drop trigger if exists offers_touch_updated_at on public.offers;
create trigger offers_touch_updated_at
  before update on public.offers
  for each row execute function public.touch_updated_at();

create table if not exists public.offer_items (
  id         uuid primary key default gen_random_uuid(),
  offer_id   uuid not null references public.offers (id) on delete cascade,
  comic_id   uuid not null references public.comics (id) on delete cascade,
  side       text not null check (side in ('offered', 'requested')),
  created_at timestamptz not null default now(),
  unique (offer_id, comic_id)
);

create index if not exists offer_items_offer_idx on public.offer_items (offer_id);

alter table public.offers enable row level security;
alter table public.offer_items enable row level security;

drop policy if exists "offers: parties read" on public.offers;
create policy "offers: parties read"
  on public.offers for select
  to authenticated
  using (
    from_collector_id = public.current_collector_id()
    or to_collector_id = public.current_collector_id()
  );

drop policy if exists "offers: member sends" on public.offers;
create policy "offers: member sends"
  on public.offers for insert
  to authenticated
  with check (
    from_collector_id = public.current_collector_id()
    and exists (
      select 1 from public.comics cm
      where cm.id = offers.target_comic_id
        and cm.collector_id = offers.to_collector_id
    )
  );

drop policy if exists "offers: parties update status" on public.offers;
create policy "offers: parties update status"
  on public.offers for update
  to authenticated
  using (
    from_collector_id = public.current_collector_id()
    or to_collector_id = public.current_collector_id()
  )
  with check (
    from_collector_id = public.current_collector_id()
    or to_collector_id = public.current_collector_id()
  );

drop policy if exists "offers: sender deletes" on public.offers;
create policy "offers: sender deletes"
  on public.offers for delete
  to authenticated
  using (from_collector_id = public.current_collector_id());

create or replace function public.guard_offer_update()
returns trigger
language plpgsql
as $$
begin
  -- Server-side writers (Stripe checkout/webhook functions, service
  -- key, no auth user) may change ONLY the three cash-payment fields —
  -- that is how a started / landed cash payment is recorded.
  if auth.uid() is null then
    if new.status is distinct from old.status
       or new.from_collector_id is distinct from old.from_collector_id
       or new.to_collector_id is distinct from old.to_collector_id
       or new.target_comic_id is distinct from old.target_comic_id
       or new.parent_offer_id is distinct from old.parent_offer_id
       or new.cash_cents is distinct from old.cash_cents
       or new.message is distinct from old.message
       or new.created_at is distinct from old.created_at then
      raise exception 'Server updates to an offer may only record its cash payment.';
    end if;
    return new;
  end if;
  if old.status <> 'pending' then
    raise exception 'This offer has already been answered.';
  end if;
  if new.from_collector_id is distinct from old.from_collector_id
     or new.to_collector_id is distinct from old.to_collector_id
     or new.target_comic_id is distinct from old.target_comic_id
     or new.parent_offer_id is distinct from old.parent_offer_id
     or new.cash_cents is distinct from old.cash_cents
     or new.message is distinct from old.message
     or new.created_at is distinct from old.created_at
     or new.cash_status is distinct from old.cash_status
     or new.cash_checkout_session_id is distinct from old.cash_checkout_session_id
     or new.cash_payment_intent_id is distinct from old.cash_payment_intent_id then
    raise exception 'Only the status of an offer can change.';
  end if;
  if public.current_collector_id() = old.to_collector_id then
    if new.status not in ('accepted', 'declined', 'countered') then
      raise exception 'The member answering an offer can only accept, decline, or counter it.';
    end if;
  elsif public.current_collector_id() = old.from_collector_id then
    if new.status <> 'withdrawn' then
      raise exception 'The member who sent an offer can only withdraw it.';
    end if;
  else
    raise exception 'This offer is not yours to answer.';
  end if;
  -- Accepting a deal with cash on it starts the cash's card payment.
  if new.status = 'accepted' and old.cash_cents > 0 then
    new.cash_status = 'pending';
  end if;
  new.responded_at = now();
  return new;
end;
$$;

drop trigger if exists offers_guard_update on public.offers;
create trigger offers_guard_update
  before update on public.offers
  for each row execute function public.guard_offer_update();

drop policy if exists "offer_items: parties read" on public.offer_items;
create policy "offer_items: parties read"
  on public.offer_items for select
  to authenticated
  using (exists (
    select 1 from public.offers o
    where o.id = offer_items.offer_id
      and (o.from_collector_id = public.current_collector_id()
           or o.to_collector_id = public.current_collector_id())
  ));

drop policy if exists "offer_items: sender adds own deal" on public.offer_items;
create policy "offer_items: sender adds own deal"
  on public.offer_items for insert
  to authenticated
  with check (exists (
    select 1 from public.offers o
    join public.comics cm on cm.id = offer_items.comic_id
    where o.id = offer_items.offer_id
      and o.from_collector_id = public.current_collector_id()
      and o.status = 'pending'
      and (
        (offer_items.side = 'offered' and cm.collector_id = o.from_collector_id)
        or (offer_items.side = 'requested' and cm.collector_id = o.to_collector_id)
      )
  ));

-- ----------------------------------------------------------------------------
-- friendships — friend requests and friendships between two members
-- (see add-friends.sql). One row per pair and direction: requester
-- sends, addressee answers; status moves pending → accepted. Decline,
-- cancel, and remove-a-friend are all the same delete, by either
-- member in the row. A friendship is visible ONLY to its two members
-- — there is no public friend list or count.
-- ----------------------------------------------------------------------------
create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.collectors (id) on delete cascade,
  addressee_id uuid not null references public.collectors (id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create index if not exists friendships_requester_idx
  on public.friendships (requester_id);
create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id);

alter table public.friendships enable row level security;

drop policy if exists "friendships: parties read" on public.friendships;
create policy "friendships: parties read"
  on public.friendships for select
  to authenticated
  using (
    requester_id = public.current_collector_id()
    or addressee_id = public.current_collector_id()
  );

drop policy if exists "friendships: member requests" on public.friendships;
create policy "friendships: member requests"
  on public.friendships for insert
  to authenticated
  with check (
    requester_id = public.current_collector_id()
    and status = 'pending'
  );

-- Only the member the request was sent TO can update it, and only
-- while it is still pending; the guard trigger narrows that to the
-- accept itself.
drop policy if exists "friendships: addressee accepts" on public.friendships;
create policy "friendships: addressee accepts"
  on public.friendships for update
  to authenticated
  using (
    addressee_id = public.current_collector_id()
    and status = 'pending'
  )
  with check (addressee_id = public.current_collector_id());

drop policy if exists "friendships: parties delete" on public.friendships;
create policy "friendships: parties delete"
  on public.friendships for delete
  to authenticated
  using (
    requester_id = public.current_collector_id()
    or addressee_id = public.current_collector_id()
  );

-- Accepting is the only update there is: pending → accepted, with the
-- two members and the created date frozen.
create or replace function public.guard_friendship_update()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'pending' then
    raise exception 'This friendship has already been answered.';
  end if;
  if new.status <> 'accepted'
     or new.requester_id is distinct from old.requester_id
     or new.addressee_id is distinct from old.addressee_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Accepting a friend request can only change its status.';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_guard_update on public.friendships;
create trigger friendships_guard_update
  before update on public.friendships
  for each row execute function public.guard_friendship_update();

-- ----------------------------------------------------------------------------
-- reports — a member flags a book or another member for the founder
-- (see add-admin.sql). Any signed-in member can file one as
-- themselves; only the founder can read or answer them. No deletes
-- for anyone: a report closes by its status, never by erasure.
-- ----------------------------------------------------------------------------
create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.collectors (id) on delete cascade,
  target_type text not null check (target_type in ('book', 'member')),
  target_id   uuid not null,
  reason      text not null default '',
  status      text not null default 'open'
              check (status in ('open', 'resolved', 'dismissed')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists reports_open_idx
  on public.reports (status, created_at desc);

alter table public.reports enable row level security;

drop policy if exists "reports: founder reads" on public.reports;
create policy "reports: founder reads"
  on public.reports for select
  to authenticated
  using (public.is_founder_collector());

drop policy if exists "reports: member reports" on public.reports;
create policy "reports: member reports"
  on public.reports for insert
  to authenticated
  with check (
    reporter_id = public.current_collector_id()
    and status = 'open'
  );

drop policy if exists "reports: founder updates" on public.reports;
create policy "reports: founder updates"
  on public.reports for update
  to authenticated
  using (public.is_founder_collector())
  with check (public.is_founder_collector());

-- Answering a report may move only its status and resolved_at.
create or replace function public.guard_report_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.reporter_id is distinct from old.reporter_id
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the status of a report can change.';
  end if;
  return new;
end;
$$;

drop trigger if exists reports_guard_update on public.reports;
create trigger reports_guard_update
  before update on public.reports
  for each row execute function public.guard_report_update();

-- ----------------------------------------------------------------------------
-- messages — direct messages between two members (see
-- add-messages.sql). A conversation is every row between the same
-- pair, oldest first; read_at marks when the recipient opened the
-- thread (NULL = unread). A message is visible ONLY to its two
-- members — there is no public or founder read path. Inserts are
-- only as yourself and always start unread; the only update anyone
-- can make is the recipient marking read_at (guard trigger below);
-- there is no delete policy or grant: messages persist.
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.collectors (id) on delete cascade,
  recipient_id uuid not null references public.collectors (id) on delete cascade,
  body         text not null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check (sender_id <> recipient_id)
);

create index if not exists messages_recipient_idx
  on public.messages (recipient_id, created_at desc);
create index if not exists messages_sender_idx
  on public.messages (sender_id, created_at desc);
create index if not exists messages_conversation_idx
  on public.messages (sender_id, recipient_id, created_at);

alter table public.messages enable row level security;

drop policy if exists "messages: parties read" on public.messages;
create policy "messages: parties read"
  on public.messages for select
  to authenticated
  using (
    sender_id = public.current_collector_id()
    or recipient_id = public.current_collector_id()
  );

drop policy if exists "messages: member sends" on public.messages;
create policy "messages: member sends"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = public.current_collector_id()
    and read_at is null
  );

drop policy if exists "messages: recipient marks read" on public.messages;
create policy "messages: recipient marks read"
  on public.messages for update
  to authenticated
  using (recipient_id = public.current_collector_id())
  with check (recipient_id = public.current_collector_id());

-- Marking read is the only update there is: sender, recipient, body,
-- and send date are frozen at send time.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the read state of a message can change.';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_guard_update on public.messages;
create trigger messages_guard_update
  before update on public.messages
  for each row execute function public.guard_message_update();

-- ----------------------------------------------------------------------------
-- book_likes / book_comments — likes and comments on books (see
-- add-comments.sql). Both are PUBLIC with the book: anyone, signed
-- in or not, can read like counts and comment threads; they expose
-- nothing private (no values are involved). A like is one row per
-- member per book — the (comic_id, collector_id) primary key makes
-- a duplicate like impossible, and unliking deletes your own row.
-- Likes insert/delete only as yourself. Comments insert only as
-- yourself and are never editable (no update policy or grant);
-- deletion is by the comment's author or by the founder, who
-- moderates any comment.
-- ----------------------------------------------------------------------------
create table if not exists public.book_likes (
  comic_id     uuid not null references public.comics (id) on delete cascade,
  collector_id uuid not null references public.collectors (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (comic_id, collector_id)
);

create index if not exists book_likes_collector_idx
  on public.book_likes (collector_id);

alter table public.book_likes enable row level security;

drop policy if exists "book_likes: public read" on public.book_likes;
create policy "book_likes: public read"
  on public.book_likes for select
  to anon, authenticated
  using (true);

drop policy if exists "book_likes: member likes" on public.book_likes;
create policy "book_likes: member likes"
  on public.book_likes for insert
  to authenticated
  with check (collector_id = public.current_collector_id());

drop policy if exists "book_likes: member unlikes" on public.book_likes;
create policy "book_likes: member unlikes"
  on public.book_likes for delete
  to authenticated
  using (collector_id = public.current_collector_id());

create table if not exists public.book_comments (
  id         uuid primary key default gen_random_uuid(),
  comic_id   uuid not null references public.comics (id) on delete cascade,
  author_id  uuid not null references public.collectors (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists book_comments_comic_idx
  on public.book_comments (comic_id, created_at);
create index if not exists book_comments_author_idx
  on public.book_comments (author_id);

alter table public.book_comments enable row level security;

drop policy if exists "book_comments: public read" on public.book_comments;
create policy "book_comments: public read"
  on public.book_comments for select
  to anon, authenticated
  using (true);

drop policy if exists "book_comments: member comments" on public.book_comments;
create policy "book_comments: member comments"
  on public.book_comments for insert
  to authenticated
  with check (author_id = public.current_collector_id());

drop policy if exists "book_comments: author or founder deletes" on public.book_comments;
create policy "book_comments: author or founder deletes"
  on public.book_comments for delete
  to authenticated
  using (
    author_id = public.current_collector_id()
    or public.is_founder_collector()
  );

-- ----------------------------------------------------------------------------
-- follows — following a collector (see add-follows.sql). One tap,
-- no request/accept: deliberately LIGHTER than friendship, and a
-- separate system that shares no state with it. A follow is one row
-- per (follower, followee) pair — the primary key makes a duplicate
-- follow impossible, unfollowing deletes your own row, and a check
-- keeps anyone from following themselves. Follows are PUBLIC reads
-- (follower/following counts show on every card and profile) and
-- expose nothing private — no values are involved. Writes are only
-- ever as yourself in the follower role, and a follow row is never
-- updated: there is no update policy or grant.
-- ----------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.collectors (id) on delete cascade,
  followee_id uuid not null references public.collectors (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx
  on public.follows (followee_id);
create index if not exists follows_follower_idx
  on public.follows (follower_id);

alter table public.follows enable row level security;

drop policy if exists "follows: public read" on public.follows;
create policy "follows: public read"
  on public.follows for select
  to anon, authenticated
  using (true);

drop policy if exists "follows: member follows" on public.follows;
create policy "follows: member follows"
  on public.follows for insert
  to authenticated
  with check (follower_id = public.current_collector_id());

drop policy if exists "follows: member unfollows" on public.follows;
create policy "follows: member unfollows"
  on public.follows for delete
  to authenticated
  using (follower_id = public.current_collector_id());

-- ----------------------------------------------------------------------------
-- Public views (curated projections — the only public read paths that touch
-- collectors and comic_values)
-- ----------------------------------------------------------------------------

-- Public profiles: every profile field except the auth link and the
-- Stripe account id. payouts_enabled is a boolean badge ("this seller
-- takes card payments") — the account id itself is never projected.
create or replace view public.public_profiles as
select id, display_name, handle, city, bio, avatar_color,
       is_founder, show_values_publicly, created_at,
       referred_by,
       stripe_payouts_enabled as payouts_enabled,
       is_featured,
       avatar_url,
       msg_color,
       msg_font
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
       cm.cover_type,
       cm.signed_by,
       cm.has_coa,
       cm.extra_photos,
       cm.payment_methods,
       cm.payment_other,
       cm.open_to_trades,
       col.stripe_payouts_enabled as collector_payouts_enabled,
       cm.is_featured,
       cm.is_grail
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
       cm.cover_type,
       cm.signed_by,
       cm.has_coa,
       cm.extra_photos,
       cm.payment_methods,
       cm.payment_other,
       cm.open_to_trades,
       col.stripe_payouts_enabled as seller_payouts_enabled,
       cm.is_featured,
       cm.is_grail
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

grant select, update on public.orders to authenticated;

grant select, insert, update, delete on public.offers to authenticated;
grant select, insert on public.offer_items to authenticated;

grant select, insert, update, delete on public.friendships to authenticated;

grant select, insert, update on public.reports to authenticated;

-- messages: select/insert/update only — deliberately no delete grant.
grant select, insert, update on public.messages to authenticated;

-- likes & comments: public read (anon included); members write.
-- Comments get no update grant — they can never be edited.
grant select on public.book_likes to anon, authenticated;
grant insert, delete on public.book_likes to authenticated;
grant select on public.book_comments to anon, authenticated;
grant insert, delete on public.book_comments to authenticated;

-- follows: public read (anon included); members write as themselves.
-- No update grant — a follow is created or deleted, never changed.
grant select on public.follows to anon, authenticated;
grant insert, delete on public.follows to authenticated;

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

-- ============================================================================
-- OPTIONAL: profile photo storage (see add-avatar.sql).
-- A public-read 'avatars' bucket, mirroring 'covers': uploads must
-- live under a folder named with the uploader's collector id:
-- avatars/<collector_id>/<file>, enforced by the policies below.
-- ============================================================================
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

-- ============================================================================
-- Polls (queue #2, feature 6 — mirrors add-polls.sql; keep the two in sync)
-- ============================================================================

create table if not exists public.polls (
  id         uuid primary key default gen_random_uuid(),
  question   text not null check (btrim(question) <> ''),
  created_by uuid not null references public.collectors (id) on delete cascade,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.polls (id) on delete cascade,
  label    text not null default '',
  comic_id uuid references public.comics (id) on delete set null,
  sort     int not null default 0,
  check (btrim(label) <> '' or comic_id is not null)
);

create index if not exists poll_options_poll_idx
  on public.poll_options (poll_id, sort);

create table if not exists public.poll_votes (
  poll_id      uuid not null references public.polls (id) on delete cascade,
  option_id    uuid not null references public.poll_options (id) on delete cascade,
  collector_id uuid not null references public.collectors (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (poll_id, collector_id)
);

create index if not exists poll_votes_option_idx
  on public.poll_votes (option_id);

create or replace function public.guard_poll_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.poll_options o
    where o.id = new.option_id and o.poll_id = new.poll_id
  ) then
    raise exception 'poll vote option does not belong to the poll';
  end if;
  return new;
end;
$$;

drop trigger if exists poll_votes_guard on public.poll_votes;
create trigger poll_votes_guard
  before insert or update on public.poll_votes
  for each row execute function public.guard_poll_vote();

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

drop policy if exists "polls: public read" on public.polls;
create policy "polls: public read"
  on public.polls for select
  to anon, authenticated
  using (true);

drop policy if exists "poll_options: public read" on public.poll_options;
create policy "poll_options: public read"
  on public.poll_options for select
  to anon, authenticated
  using (true);

drop policy if exists "poll_votes: public read" on public.poll_votes;
create policy "poll_votes: public read"
  on public.poll_votes for select
  to anon, authenticated
  using (true);

drop policy if exists "polls: founder creates" on public.polls;
create policy "polls: founder creates"
  on public.polls for insert
  to authenticated
  with check (
    public.is_founder_collector()
    and created_by = public.current_collector_id()
  );

drop policy if exists "polls: founder updates" on public.polls;
create policy "polls: founder updates"
  on public.polls for update
  to authenticated
  using (public.is_founder_collector())
  with check (public.is_founder_collector());

drop policy if exists "poll_options: founder creates" on public.poll_options;
create policy "poll_options: founder creates"
  on public.poll_options for insert
  to authenticated
  with check (public.is_founder_collector());

drop policy if exists "poll_votes: member inserts own" on public.poll_votes;
create policy "poll_votes: member inserts own"
  on public.poll_votes for insert
  to authenticated
  with check (collector_id = public.current_collector_id());

drop policy if exists "poll_votes: member updates own" on public.poll_votes;
create policy "poll_votes: member updates own"
  on public.poll_votes for update
  to authenticated
  using (collector_id = public.current_collector_id())
  with check (collector_id = public.current_collector_id());

drop policy if exists "poll_votes: member deletes own" on public.poll_votes;
create policy "poll_votes: member deletes own"
  on public.poll_votes for delete
  to authenticated
  using (collector_id = public.current_collector_id());

grant select on public.polls to anon;
grant select on public.poll_options to anon;
grant select on public.poll_votes to anon;
grant select, insert, update on public.polls to authenticated;
grant select, insert on public.poll_options to authenticated;
grant select, insert, update, delete on public.poll_votes to authenticated;
