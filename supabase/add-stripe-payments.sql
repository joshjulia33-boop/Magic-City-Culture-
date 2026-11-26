-- ============================================================================
-- Magic City Culture — one-time update: Stripe Connect card payments.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql and after
-- add-market-trades.sql. Safe to re-run.
--
-- Joshua approved Stripe Connect (2026-11-26) with a 5% platform
-- commission, collected by the Edge Functions as Stripe's
-- application_fee_amount on destination charges. This migration is the
-- database half; the money itself is moved only by Stripe, driven by
-- the stripe-connect / stripe-checkout / stripe-webhook Edge Functions
-- (see ../supabase/functions/). No Stripe key or account id that could
-- charge anyone lives in this schema.
--
-- Adds / changes:
--   * collectors.stripe_account_id — the member's Stripe STANDARD
--     connected account id (acct_…). Written only by the stripe-connect
--     function (service key). It stays on the owner-only base table:
--     public_profiles does NOT project it. The three flag columns say
--     whether Stripe has finished with the account; they are synced by
--     the function from Stripe's own account state, never typed by a
--     member, and the public views project ONLY the boolean
--     payouts_enabled (a "this seller takes cards" badge) — never the
--     account id.
--   * orders grows from the original off-site order book into the
--     payment order book: platform_fee_cents (the site's 5%, snapshotted
--     at purchase), the Stripe checkout session / payment intent ids,
--     shipped/received timestamps, and a status ladder
--     paid → shipped → received → completed (legacy off-site orders keep
--     their 'placed' → 'completed' path). Orders are now created ONLY
--     by the webhook (service key) after Stripe confirms payment: the
--     old "orders: buyer places" insert policy is dropped, so no client
--     can mint an unpaid order. A guard trigger limits signed-in parties
--     to their own status moves and freezes everything else; the
--     service key (auth.uid() IS NULL) is how payment state is written.
--   * mark_comic_sold_on_order now also closes the listing fully
--     (clears open_to_trades and the payment-method text) when an order
--     lands, so a sold book never lingers as trade-open.
--   * offers gains the trade cash top-up state: cash_status
--     ('not_required' → 'pending' when a cash deal is accepted →
--     'paid' when the webhook confirms the card payment) plus the
--     Stripe ids of that payment. The offer guard trigger is extended:
--     parties can never touch the cash fields, accepting a cash deal
--     flips cash_status to 'pending', and the service key may record
--     ONLY the cash fields on an offer.
--
-- Until this runs, the site behaves exactly as before: the front end
-- reads the new fields defensively (missing = not set up / not due),
-- and card checkout stays off because the Stripe functions have no
-- keys yet anyway (see web/README.md step 11).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- collectors — Stripe Connect state (owner-only base table, as before)
-- ----------------------------------------------------------------------------
alter table public.collectors
  add column if not exists stripe_account_id text;

alter table public.collectors
  add column if not exists stripe_charges_enabled boolean not null default false;

alter table public.collectors
  add column if not exists stripe_payouts_enabled boolean not null default false;

alter table public.collectors
  add column if not exists stripe_details_submitted boolean not null default false;

create unique index if not exists collectors_stripe_account_idx
  on public.collectors (stripe_account_id)
  where stripe_account_id is not null;

-- ----------------------------------------------------------------------------
-- Views: project ONLY the "takes card payments" boolean — never the
-- Stripe account id. New columns go last (create-or-replace rule).
-- ----------------------------------------------------------------------------
create or replace view public.public_profiles as
select id, display_name, handle, city, bio, avatar_color,
       is_founder, show_values_publicly, created_at,
       referred_by,
       stripe_payouts_enabled as payouts_enabled
from public.collectors;

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
-- orders — the payment order book
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists platform_fee_cents integer not null default 0
  check (platform_fee_cents >= 0);

alter table public.orders
  add column if not exists stripe_checkout_session_id text;

alter table public.orders
  add column if not exists stripe_payment_intent_id text;

alter table public.orders
  add column if not exists shipped_at timestamptz;

alter table public.orders
  add column if not exists received_at timestamptz;

create unique index if not exists orders_stripe_session_idx
  on public.orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

-- Widen the status ladder (the old constraint only knew placed/completed).
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('placed', 'paid', 'shipped', 'received', 'completed', 'cancelled'));

-- Orders are born in the Stripe webhook now, not in the browser: no
-- signed-in member may insert one (the service key bypasses RLS).
drop policy if exists "orders: buyer places" on public.orders;

-- Parties may update an order, but the guard trigger below limits each
-- side to its own status moves and freezes everything else.
drop policy if exists "orders: seller updates" on public.orders;
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

-- A landing order closes the listing completely: sold, off the market,
-- no longer trade-open, payment text cleared. (Runs for webhook-created
-- orders exactly as it did for browser-placed ones.)
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

-- ----------------------------------------------------------------------------
-- offers — trade cash top-up payment state
-- ----------------------------------------------------------------------------
alter table public.offers
  add column if not exists cash_status text not null default 'not_required'
  check (cash_status in ('not_required', 'pending', 'paid'));

alter table public.offers
  add column if not exists cash_checkout_session_id text;

alter table public.offers
  add column if not exists cash_payment_intent_id text;

-- The offer guard, extended for the cash fields. Same rules as before
-- for the deal itself; additionally:
--   * the service key (auth.uid() IS NULL) may change ONLY the three
--     cash fields — that is how the checkout function records a started
--     payment and the webhook records a landed one;
--   * a party may never change the cash fields directly;
--   * accepting a deal with cash on it flips cash_status to 'pending'.
-- This replacement deliberately comes BEFORE the backfill below: the
-- old guard rejected every update to an already-answered offer, so the
-- backfill could never run under it. Under the new guard the SQL
-- editor's own session (no auth user) takes the server path, which may
-- touch the cash fields and nothing else.
create or replace function public.guard_offer_update()
returns trigger
language plpgsql
as $$
begin
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
  if new.status = 'accepted' and old.cash_cents > 0 then
    new.cash_status = 'pending';
  end if;
  new.responded_at = now();
  return new;
end;
$$;

-- Deals accepted before this update, with cash on them, owe that cash.
-- (Runs under the NEW guard above — see the note there.)
update public.offers
   set cash_status = 'pending'
 where cash_cents > 0 and status = 'accepted' and cash_status = 'not_required';

-- Orders: clients keep read + guarded update; the insert grant stays
-- (RLS has no insert policy any more, so it cannot be used) — revoke it
-- anyway so the intent is unmistakable.
revoke insert on public.orders from authenticated;
grant select, update on public.orders to authenticated;
