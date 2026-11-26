-- ============================================================================
-- Magic City Culture — one-time update: Market listing details + trading.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql and after
-- add-extra-photos-coa.sql (whose views this file rebuilds with the new
-- columns appended). Safe to re-run.
--
-- Adds:
--   * comics.payment_methods — the payment methods the seller accepts for
--     a listing, comma-joined picks from the form ("Cash, Zelle").
--     Public by design, like the asking price: it is part of the offer
--     to everyone. It is NOT a payment account — the site takes no
--     payments; members settle between themselves.
--   * comics.payment_other — free text for the "Other" payment method.
--   * comics.open_to_trades — the book can be traded for: other members
--     may offer bundles of their own books (plus cash) for it.
--   * public.offers / public.offer_items — trade offers between two
--     members. An offer names one target book (the listed book the
--     offerer wants), the books each side puts in (offer_items, side
--     'offered' = the sender's books, 'requested' = the receiver's
--     books), and any cash the sender adds to up the deal. A counter is
--     a new offer with the roles swapped and parent_offer_id pointing
--     at the offer it answers. Only the two members in an offer can see
--     it; statuses move pending → accepted / declined / countered /
--     withdrawn, guarded by a trigger so neither side can rewrite the
--     deal itself or answer their own offer.
--
-- Both new comics columns are projected through the gallery_comics and
-- listings views so market cards can show payment methods and the
-- OPEN TO TRADES badge. Until this runs, the site still saves books
-- normally — the form drops just those fields and goes on — and the
-- Trade tab explains that trading is being switched on.
-- ============================================================================

alter table public.comics
  add column if not exists payment_methods text not null default '';

alter table public.comics
  add column if not exists payment_other text not null default '';

alter table public.comics
  add column if not exists open_to_trades boolean not null default false;

-- Views: create-or-replace only allows NEW columns at the end of the
-- list, so the three new columns go last in both (after extra_photos).
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
       cm.open_to_trades
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
       cm.open_to_trades
from public.comics cm
join public.collectors col on col.id = cm.collector_id
where cm.status = 'for_sale';

-- ----------------------------------------------------------------------------
-- offers — one member proposing a trade to another.
-- The deal itself (books, cash, message) is written once by the sender
-- and never edited; only the status moves, and only as the guard
-- trigger below allows. No payments are taken or recorded here.
-- ----------------------------------------------------------------------------
create table if not exists public.offers (
  id                uuid primary key default gen_random_uuid(),
  from_collector_id uuid not null references public.collectors (id) on delete cascade,
  to_collector_id   uuid not null references public.collectors (id) on delete cascade,
  -- The book the sender wants most — for a fresh offer, one of the
  -- receiver's listed, trade-open books; the full want-list (which
  -- always includes this book) lives in offer_items as 'requested'.
  target_comic_id   uuid not null references public.comics (id) on delete cascade,
  -- Cash the SENDER adds on top of their books, to up the deal.
  cash_cents        integer not null default 0 check (cash_cents >= 0),
  message           text not null default '',
  status            text not null default 'pending'
                    check (status in ('pending', 'accepted', 'declined', 'countered', 'withdrawn')),
  -- Set when this offer counters an earlier one (roles swapped).
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

-- ----------------------------------------------------------------------------
-- offer_items — the books in a deal, one row per book per side.
-- 'offered' rows are the sender's own books; 'requested' rows are the
-- receiver's books the sender is asking for (target book included).
-- ----------------------------------------------------------------------------
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

-- Only the two members in an offer can see it.
drop policy if exists "offers: parties read" on public.offers;
create policy "offers: parties read"
  on public.offers for select
  to authenticated
  using (
    from_collector_id = public.current_collector_id()
    or to_collector_id = public.current_collector_id()
  );

-- A member sends an offer only as themselves, to another member, for a
-- target book that member actually owns. (The site only offers listed,
-- trade-open books as fresh targets; counters answer an existing deal,
-- so ownership is the database-level rule.)
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

-- Either party may write an update, but the guard trigger below limits
-- each side to its own status moves and freezes everything else.
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

-- The sender may delete an offer outright (items cascade).
drop policy if exists "offers: sender deletes" on public.offers;
create policy "offers: sender deletes"
  on public.offers for delete
  to authenticated
  using (from_collector_id = public.current_collector_id());

-- Status moves, and only status moves:
--   receiver → accepted / declined / countered
--   sender   → withdrawn
-- and only while the offer is still pending. Everything else about the
-- offer — the books, the cash, the message, the two members — is frozen
-- the moment it is sent, so a deal can never be rewritten after the
-- other member has seen it.
create or replace function public.guard_offer_update()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'pending' then
    raise exception 'This offer has already been answered.';
  end if;
  if new.from_collector_id is distinct from old.from_collector_id
     or new.to_collector_id is distinct from old.to_collector_id
     or new.target_comic_id is distinct from old.target_comic_id
     or new.parent_offer_id is distinct from old.parent_offer_id
     or new.cash_cents is distinct from old.cash_cents
     or new.message is distinct from old.message
     or new.created_at is distinct from old.created_at then
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
  new.responded_at = now();
  return new;
end;
$$;

drop trigger if exists offers_guard_update on public.offers;
create trigger offers_guard_update
  before update on public.offers
  for each row execute function public.guard_offer_update();

-- Items are readable by the two parties of their offer…
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

-- …and writable only by the offer's sender, only while it is pending,
-- and only with books that belong to the right side: 'offered' books
-- must be the sender's own, 'requested' books must be the receiver's.
-- Nobody can put someone else's books into a deal.
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

grant select, insert, update, delete on public.offers to authenticated;
grant select, insert on public.offer_items to authenticated;
