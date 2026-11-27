-- ============================================================================
-- Magic City Culture — one-time update: the Wall of Grails.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- Safe to re-run.
--
-- Adds:
--   * comics.is_grail — the ONE book a member calls their grail.
--     Public-safe like the rest of the comics table (it names no
--     value, price or purchase detail), so it rides the public views
--     below and the Wall of Grails on the Gallery can render from
--     gallery_comics exactly like the rest of the gallery.
--   * A PARTIAL UNIQUE INDEX on comics(collector_id) WHERE is_grail:
--     the database itself guarantees at most ONE grail per member.
--     Setting a new grail therefore has to clear the old one first
--     (the front end does exactly that, in that order).
--   * guard_comic_featured recreated with is_grail in its
--     frozen-column list: the founder featuring/unfeaturing another
--     member's book still cannot change anything else about that
--     book, grail flag included. A member setting their OWN grail is
--     not touched by that guard (it only fires cross-member), so it
--     keeps working through the normal owner update policy — no new
--     policy is needed, and RLS is otherwise unchanged.
--
-- Written against the LIVE schema: gallery_comics and listings are
-- recreated from their current live definitions (the add-admin.sql
-- definitions) with is_grail appended — no stripe_* column and no
-- payouts_enabled field is referenced anywhere (the Stripe migration
-- has never run live, so the live views have neither).
--
-- Until this runs, the site works as before: the front end treats a
-- missing is_grail field exactly like the other one-time updates —
-- no Grail button, no 🏆 GRAIL badge, no Wall of Grails panel.
--
-- Verify afterwards with:
--   select count(*) from public.comics where is_grail;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The column + the one-grail-per-member guarantee
-- ----------------------------------------------------------------------------
alter table public.comics
  add column if not exists is_grail boolean not null default false;

create unique index if not exists comics_one_grail_per_collector
  on public.comics (collector_id)
  where is_grail;

-- ----------------------------------------------------------------------------
-- Founder-feature guard: same function as add-admin.sql (written
-- against the live schema), with is_grail frozen cross-member.
-- ----------------------------------------------------------------------------
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
-- Project is_grail through the public views (appended last, so the
-- existing columns keep their order — CREATE OR REPLACE VIEW requires
-- that). Full definitions copied from the current live views
-- (add-admin.sql) plus the new column.
-- ----------------------------------------------------------------------------
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
       cm.is_featured,
       cm.is_grail
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
       cm.is_featured,
       cm.is_grail
from public.comics cm
join public.collectors col on col.id = cm.collector_id
where cm.status = 'for_sale';

grant select on public.gallery_comics to anon, authenticated;
grant select on public.listings to anon, authenticated;
