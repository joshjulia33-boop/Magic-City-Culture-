-- ============================================================================
-- Magic City Culture — one-time update: cover types.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql (and after
-- add-has-remark.sql, whose views this file rebuilds with cover_type
-- appended). Safe to re-run.
--
-- Adds comics.cover_type — one comma-joined string of the types a member
-- tapped in the add/edit form ("Virgin, Foil"), since a cover can be
-- several at once — and projects it through the gallery_comics and
-- listings views so cards can show cover-type badges and the detail
-- view gets its "Cover" line. Until this is run, the site still saves
-- books normally — the cover-type picks simply have nowhere to live yet.
-- ============================================================================

alter table public.comics
  add column if not exists cover_type text not null default '';

-- Backfill from the variant wording collectors already typed, so real
-- books carry their types from day one (mirrors the Darkseid remarque
-- flag in add-has-remark.sql).
update public.comics cm
   set cover_type = trim(both ', ' from
        (case when cm.variant ilike '%metal%'       then 'Metal, '       else '' end) ||
        (case when cm.variant ilike '%leather%'     then 'Leather, '     else '' end) ||
        (case when cm.variant ilike '%holog%'       then 'Holographic, ' else '' end) ||
        (case when cm.variant ilike '%foil%'        then 'Foil, '        else '' end) ||
        (case when cm.variant ilike '%virgin%'      then 'Virgin, '      else '' end) ||
        (case when cm.variant ilike '%sketch%'      then 'Sketch, '      else '' end))
 where cm.cover_type = ''
   and cm.variant ~* 'metal|leather|holog|foil|virgin|sketch';

-- Views: create-or-replace only allows NEW columns at the end of the list,
-- so cover_type goes last in both.
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
