-- ============================================================================
-- Magic City Culture — one-time update: founder Admin dashboard.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- Safe to re-run.
--
-- Adds:
--   * comics.is_featured / collectors.is_featured — the founder's front
--     page picks. Publicly readable (they ride the existing public
--     views), but the flag itself can only ever be changed by the
--     founder — on ANY row, including the founder's own. That rule is
--     enforced twice: the "founder features" update policies below are
--     the only way to reach another member's row at all, and the guard
--     triggers reject an is_featured change from anyone who is not the
--     founder, plus reject any OTHER field change riding along on a
--     founder update of somebody else's row (the founder's reach into
--     other members' rows is exactly one boolean wide).
--   * public.reports — a member's report about a book or another
--     member. Any signed-in member can file one as themselves; only
--     the founder can read or answer them (RLS below, keyed on
--     public.is_founder_collector()). No deletes for anyone. A guard
--     trigger freezes everything except status / resolved_at.
--
-- The dashboard itself shows counts and activity only — never any
-- member's private values (comic_values is untouched, as everywhere).
--
-- Until this runs, the site works as before: the front end treats the
-- missing columns/table exactly like it treated missing offers /
-- friendships — no featured strip, no ADMIN tab content beyond quiet
-- empty states, no Report buttons.
-- ============================================================================

-- Is the signed-in collector the founder? SECURITY DEFINER so RLS
-- policies can use it without recursion (same pattern as
-- public.current_collector_id()).
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

-- ----------------------------------------------------------------------------
-- Featured flags
-- ----------------------------------------------------------------------------
alter table public.comics
  add column if not exists is_featured boolean not null default false;
alter table public.collectors
  add column if not exists is_featured boolean not null default false;

-- The founder may UPDATE any book / profile row — but the guard
-- triggers below narrow that reach to the is_featured flag alone.
-- Owner policies are unchanged and keep working alongside these.
-- The collectors table also needs the founder SELECT policy: an
-- UPDATE can only reach rows the caller can see, and collectors is
-- otherwise owner-read-only (public reads go through the view). The
-- policy is founder-only, like everything else in this file.
drop policy if exists "collectors: founder reads" on public.collectors;
create policy "collectors: founder reads"
  on public.collectors for select
  to authenticated
  using (public.is_founder_collector());

drop policy if exists "comics: founder features" on public.comics;
create policy "comics: founder features"
  on public.comics for update
  to authenticated
  using (public.is_founder_collector())
  with check (public.is_founder_collector());

drop policy if exists "collectors: founder features" on public.collectors;
create policy "collectors: founder features"
  on public.collectors for update
  to authenticated
  using (public.is_founder_collector())
  with check (public.is_founder_collector());

-- Only the founder may move is_featured, on any row. And when the
-- founder updates a book that is not theirs, ONLY is_featured may
-- change — every other column is frozen for that path. (updated_at is
-- deliberately not compared: the touch trigger maintains it.)
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

-- Same pair of rules for profiles: is_featured moves only for the
-- founder, and a founder updating somebody else's profile may change
-- nothing else. (Stripe columns included in the freeze — those belong
-- to the member and the Stripe functions, never to a client update of
-- another member's row.)
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
-- reports — a member flags a book or another member for the founder.
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

-- Only the founder can ever read a report.
drop policy if exists "reports: founder reads" on public.reports;
create policy "reports: founder reads"
  on public.reports for select
  to authenticated
  using (public.is_founder_collector());

-- Any signed-in member may file a report — as themselves, starting open.
drop policy if exists "reports: member reports" on public.reports;
create policy "reports: member reports"
  on public.reports for insert
  to authenticated
  with check (
    reporter_id = public.current_collector_id()
    and status = 'open'
  );

-- Only the founder can answer one. There is deliberately NO delete
-- policy: a report is closed by its status, never erased.
drop policy if exists "reports: founder updates" on public.reports;
create policy "reports: founder updates"
  on public.reports for update
  to authenticated
  using (public.is_founder_collector())
  with check (public.is_founder_collector());

-- Answering a report may move only its status and resolved_at; who
-- reported what, about whom, and when, are frozen at filing time.
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

grant select, insert, update on public.reports to authenticated;

-- ----------------------------------------------------------------------------
-- Project is_featured through the public views (appended last, so the
-- existing columns keep their order — CREATE OR REPLACE VIEW requires
-- that). Full definitions copied from schema.sql plus the new column.
-- ----------------------------------------------------------------------------
create or replace view public.public_profiles as
select id, display_name, handle, city, bio, avatar_color,
       is_founder, show_values_publicly, created_at,
       referred_by,
       stripe_payouts_enabled as payouts_enabled,
       is_featured
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
       col.stripe_payouts_enabled as collector_payouts_enabled,
       cm.is_featured
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
       col.stripe_payouts_enabled as seller_payouts_enabled,
       cm.is_featured
from public.comics cm
join public.collectors col on col.id = cm.collector_id
where cm.status = 'for_sale';
