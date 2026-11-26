-- ============================================================================
-- Magic City Culture — one-time update: Friends.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- Safe to re-run.
--
-- Adds:
--   * public.friendships — a friend request (and, once accepted, the
--     friendship) between two members. One row per pair and direction:
--     requester sends, addressee answers. status moves pending →
--     accepted; declining a request, cancelling your own request, and
--     removing a friend are all the same thing here — the row is
--     deleted, by either member in it.
--
-- Privacy: a friendship is visible ONLY to the two members in it (RLS
-- below, keyed on public.current_collector_id()). There is no public
-- friend list and no friend count for other people — the site can only
-- ever show you your own friendships, and the button state between you
-- and one other member. No values or private data are involved.
--
-- Until this runs, the site works as before: the friends sections and
-- buttons simply stay out of the way (the front end treats a missing
-- table exactly like the Trade tab did before add-market-trades.sql).
-- ============================================================================

create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.collectors (id) on delete cascade,
  addressee_id uuid not null references public.collectors (id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

create index if not exists friendships_requester_idx
  on public.friendships (requester_id);
create index if not exists friendships_addressee_idx
  on public.friendships (addressee_id);

alter table public.friendships enable row level security;

-- Only the two members in a friendship can see it.
drop policy if exists "friendships: parties read" on public.friendships;
create policy "friendships: parties read"
  on public.friendships for select
  to authenticated
  using (
    requester_id = public.current_collector_id()
    or addressee_id = public.current_collector_id()
  );

-- A member sends a request only as themselves, and it starts pending.
drop policy if exists "friendships: member requests" on public.friendships;
create policy "friendships: member requests"
  on public.friendships for insert
  to authenticated
  with check (
    requester_id = public.current_collector_id()
    and status = 'pending'
  );

-- Only the member the request was sent TO can update it, and only
-- while it is still pending. The guard trigger below narrows that
-- further: the update may change the status to 'accepted' and nothing
-- else — the two members and the request date are frozen.
drop policy if exists "friendships: addressee accepts" on public.friendships;
create policy "friendships: addressee accepts"
  on public.friendships for update
  to authenticated
  using (
    addressee_id = public.current_collector_id()
    and status = 'pending'
  )
  with check (addressee_id = public.current_collector_id());

-- Either member in the row may delete it: that one delete is how a
-- request is declined, how a sender cancels their own request, and
-- how a friend is removed.
drop policy if exists "friendships: parties delete" on public.friendships;
create policy "friendships: parties delete"
  on public.friendships for delete
  to authenticated
  using (
    requester_id = public.current_collector_id()
    or addressee_id = public.current_collector_id()
  );

-- Accepting is the only update there is: pending → accepted, with the
-- two members and the created date frozen, so nobody can rewrite who
-- a friendship is between (or quietly re-pend an accepted friend).
create or replace function public.guard_friendship_update()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'pending' then
    raise exception 'This friendship has already been answered.';
  end if;
  if new.status <> 'accepted'
     or new.requester_id is distinct from old.requester_id
     or new.addressee_id is distinct from old.addressee_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Accepting a friend request can only change its status.';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_guard_update on public.friendships;
create trigger friendships_guard_update
  before update on public.friendships
  for each row execute function public.guard_friendship_update();

grant select, insert, update, delete on public.friendships to authenticated;
