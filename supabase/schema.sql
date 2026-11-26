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
  is_founder            boolean not null default false,
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
       stripe_payouts_enabled as payouts_enabled
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
       col.stripe_payouts_enabled as collector_payouts_enabled
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
       col.stripe_payouts_enabled as seller_payouts_enabled
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
