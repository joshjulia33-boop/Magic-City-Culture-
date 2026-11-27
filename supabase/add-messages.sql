-- ============================================================================
-- Magic City Culture — one-time update: Direct Messages.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- Safe to re-run.
--
-- Adds:
--   * public.messages — a private chat message from one member to
--     another. A conversation is simply every row between the same
--     pair of members, oldest first; read_at marks when the member it
--     was sent TO opened the thread (NULL = unread).
--
-- Privacy: a message is visible ONLY to the two members in it (RLS
-- below, keyed on public.current_collector_id()). There is no public
-- or founder read path — not even Joshua can read a conversation he
-- is not part of — and message content never appears anywhere else on
-- the site. No values or private data are involved.
--
-- Writes are narrowed down hard:
--   * INSERT only as yourself (sender_id must be your own collector
--     id), and a new message always starts unread (read_at must be
--     NULL), so nobody can spoof a sender or pre-mark a message read.
--   * UPDATE is open only to the member the message was sent TO, and
--     the guard trigger below limits that update to read_at alone —
--     the sender, the recipient, the body, and the send date are
--     frozen the moment a message is sent.
--   * There is NO delete policy and no delete grant: messages persist.
--
-- Until this runs, the site works as before: the front end treats a
-- missing table exactly like it treated missing offers / friendships
-- / reports — the MESSAGES tab shows a short "being switched on"
-- note and the MESSAGE buttons stay out of the way.
--
-- Written against the LIVE schema: it touches no existing view and no
-- stripe_* column (the Stripe migration has never run live).
-- ============================================================================

create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.collectors (id) on delete cascade,
  recipient_id uuid not null references public.collectors (id) on delete cascade,
  body         text not null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  check (sender_id <> recipient_id)
);

-- Inbox: everything sent TO a member, newest first (drives the
-- conversation list and the unread count).
create index if not exists messages_recipient_idx
  on public.messages (recipient_id, created_at desc);
-- Sending history: everything a member sent, by who they sent it to.
create index if not exists messages_sender_idx
  on public.messages (sender_id, created_at desc);
-- Thread lookup: one direction of a conversation, in order.
create index if not exists messages_conversation_idx
  on public.messages (sender_id, recipient_id, created_at);

alter table public.messages enable row level security;

-- Only the two members in a message can ever see it.
drop policy if exists "messages: parties read" on public.messages;
create policy "messages: parties read"
  on public.messages for select
  to authenticated
  using (
    sender_id = public.current_collector_id()
    or recipient_id = public.current_collector_id()
  );

-- A member sends only as themselves, and the message starts unread.
drop policy if exists "messages: member sends" on public.messages;
create policy "messages: member sends"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = public.current_collector_id()
    and read_at is null
  );

-- Only the member a message was sent TO may update it at all; the
-- guard trigger below narrows that update to read_at alone.
drop policy if exists "messages: recipient marks read" on public.messages;
create policy "messages: recipient marks read"
  on public.messages for update
  to authenticated
  using (recipient_id = public.current_collector_id())
  with check (recipient_id = public.current_collector_id());

-- Marking read is the only update there is: who sent it, who it went
-- to, what it says, and when it was sent are frozen at send time.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
as $$
begin
  -- Server-side writers (Edge Functions with the service key) have no
  -- auth user; nothing here restricts them.
  if auth.uid() is null then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.sender_id is distinct from old.sender_id
     or new.recipient_id is distinct from old.recipient_id
     or new.body is distinct from old.body
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the read state of a message can change.';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_guard_update on public.messages;
create trigger messages_guard_update
  before update on public.messages
  for each row execute function public.guard_message_update();

-- Deliberately NO delete grant: messages persist.
grant select, insert, update on public.messages to authenticated;
