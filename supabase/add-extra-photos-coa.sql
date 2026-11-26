-- ============================================================================
-- Magic City Culture — one-time update: extra book photos + COA flag.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql and after
-- add-signed-by.sql (whose views this file rebuilds with the two new
-- columns appended). Safe to re-run.
--
-- Adds:
--   * comics.extra_photos — a JSON array of Supabase Storage URLs for
--     up to FOUR extra photos of the actual book (back cover, corner or
--     page close-ups, a photo of the certificate). The main cover stays
--     in comics.cover_url, so a book holds 5 photos in total.
--   * comics.has_coa — the "COA — comes with a Certificate of
--     Authenticity" tick in the signature section of the add/edit form
--     (Signed → Signed by → COA, since a COA certifies the signature).
--
-- Both are projected through the gallery_comics and listings views so
-- the book detail view can show every photo plus its "Certificate of
-- Authenticity" line, marketplace listings can show the extra photos,
-- and cards can carry the COA badge. Until this is run, the site still
-- saves books normally — the extra photos and the tick simply have
-- nowhere to live yet (the form drops just those fields and goes on).
-- ============================================================================

alter table public.comics
  add column if not exists extra_photos jsonb not null default '[]'::jsonb;

alter table public.comics
  add column if not exists has_coa boolean not null default false;

-- At most 4 extras: cover + 4 = the 5-photo cap the form promises.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comics_extra_photos_max4'
  ) then
    alter table public.comics
      add constraint comics_extra_photos_max4
      check (jsonb_typeof(extra_photos) = 'array'
             and jsonb_array_length(extra_photos) <= 4);
  end if;
end;
$$;

-- Views: create-or-replace only allows NEW columns at the end of the
-- list, so has_coa and extra_photos go last in both (after signed_by).
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
       cm.extra_photos
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
       cm.extra_photos
from public.comics cm
join public.collectors col on col.id = cm.collector_id
where cm.status = 'for_sale';
