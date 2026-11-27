-- ============================================================================
-- Magic City Culture — one-time update: Polls.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- Safe to re-run.
--
-- Adds:
--   * public.polls        — a community poll question. Only the founder
--                           creates polls (the Admin dashboard checks
--                           is_founder, and RLS below enforces it).
--                           is_active marks the poll currently open for
--                           voting; the Gallery shows the newest ACTIVE
--                           poll.
--   * public.poll_options — the choices for a poll. Each option is a
--                           text label and/or a link to a comic (the
--                           founder can put one of his own books up as
--                           a choice; the cover shows in the poll).
--   * public.poll_votes   — one row per member per poll
--                           (PK (poll_id, collector_id)), so changing
--                           your vote is an UPDATE of your own row.
--
-- Privacy: polls, options and votes are PUBLIC community data (SELECT
-- for everyone, signed in or not) — vote counts are part of the fun
-- and no values or private data are involved. A trigger keeps a
-- vote's option inside its own poll.
--
-- Until this runs, the site works as before: the POLLS panel and the
-- Admin poll tools simply stay hidden (the front end treats missing
-- tables as "not ready").
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

-- A vote's option must belong to the vote's poll.
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

-- Everyone can read polls, options and votes (public community data).
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

-- Only the founder creates polls, and only as himself.
drop policy if exists "polls: founder creates" on public.polls;
create policy "polls: founder creates"
  on public.polls for insert
  to authenticated
  with check (
    public.is_founder_collector()
    and created_by = public.current_collector_id()
  );

-- Only the founder opens/closes (or edits) polls.
drop policy if exists "polls: founder updates" on public.polls;
create policy "polls: founder updates"
  on public.polls for update
  to authenticated
  using (public.is_founder_collector())
  with check (public.is_founder_collector());

-- Only the founder adds options, and only to a poll.
drop policy if exists "poll_options: founder creates" on public.poll_options;
create policy "poll_options: founder creates"
  on public.poll_options for insert
  to authenticated
  with check (public.is_founder_collector());

-- Members vote only as themselves: insert, change (update), or
-- withdraw (delete) their own single vote row.
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
