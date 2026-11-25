-- ============================================================================
-- Magic City Culture — one-time update: the "Has a remark" (remarque) flag.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- Safe to re-run.
--
-- Adds comics.has_remark (mirrors is_signed) and projects it through the
-- gallery_comics and listings views so cards can show a REMARQUED badge and
-- the Gallery / My Shelf "Remarqued" filter chips have data to work with.
-- Until this is run, the site still saves books normally — the remark tick
-- simply has nowhere to live yet.
-- ============================================================================

alter table public.comics
  add column if not exists has_remark boolean not null default false;

-- The Darkseid book from the founding shelf was sold as remarqued — flag it
-- so the badge shows on a real book from day one.
update public.comics
   set has_remark = true
 where title ilike '%Darkseid%'
   and variant ilike '%remarqu%';

-- Views: create-or-replace only allows NEW columns at the end of the list,
-- so has_remark goes last in both.
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
       cm.has_remark
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
       cm.has_remark
from public.comics cm
join public.collectors col on col.id = cm.collector_id
where cm.status = 'for_sale';
