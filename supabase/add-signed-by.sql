-- ============================================================================
-- Magic City Culture — one-time update: whose signature it is.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql (and after
-- add-cover-type.sql, whose views this file rebuilds with signed_by
-- appended). Safe to re-run.
--
-- Adds comics.signed_by — the free-text name of the artist who signed the
-- copy, typed into the "Signed by (artist name)" box under the Signed tick
-- in the add/edit form — and projects it through the gallery_comics and
-- listings views so the book detail view can show its "Signed by" line.
-- Until this is run, the site still saves books normally — the name
-- simply has nowhere to live yet.
-- ============================================================================

alter table public.comics
  add column if not exists signed_by text;

-- Views: create-or-replace only allows NEW columns at the end of the list,
-- so signed_by goes last in both.
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
       cm.signed_by
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
       cm.signed_by
from public.comics cm
join public.collectors col on col.id = cm.collector_id
where cm.status = 'for_sale';
