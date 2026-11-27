-- ============================================================================
-- Magic City Culture — one-time update: Comments & Likes on books.
--
-- SQL Editor → paste this whole file → Run, AFTER schema.sql.
-- Safe to re-run.
--
-- Adds:
--   * public.book_likes — one row per member per liked book. The
--     (comic_id, collector_id) primary key IS the rule: a member can
--     like a book once, and unliking is deleting their own row.
--   * public.book_comments — one comment on one book by one member.
--     Comments are not editable: there is no UPDATE policy and no
--     update grant, so a posted comment can only ever be deleted.
--
-- Visibility: likes and comments are PUBLIC with the book — anyone,
-- signed in or not, can read them (like counts show on every card).
-- That is all they expose: a like is just a member id next to a book
-- id, and a comment is its text. No collection values or other
-- private data are involved, and nothing here touches comic_values.
--
-- Writes are narrowed down hard:
--   * Likes: INSERT and DELETE only as yourself (collector_id must
--     be your own collector id) — nobody can like or unlike as
--     someone else.
--   * Comments: INSERT only as yourself (author_id must be your own
--     collector id). DELETE by the comment's author OR by the
--     founder (public.is_founder_collector()), who moderates: he
--     can remove any comment, but even he cannot edit one or post
--     as someone else.
--
-- Until this runs, the site works as before: the front end treats
-- missing tables exactly like it treated missing offers /
-- friendships / reports / messages — the like buttons simply stay
-- off the cards and the book page shows no comments section.
--
-- Written against the LIVE schema: it touches no existing view and
-- no stripe_* column (the Stripe migration has never run live).
-- ============================================================================

create table if not exists public.book_likes (
  comic_id     uuid not null references public.comics (id) on delete cascade,
  collector_id uuid not null references public.collectors (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (comic_id, collector_id)
);

create index if not exists book_likes_collector_idx
  on public.book_likes (collector_id);

alter table public.book_likes enable row level security;

-- Like counts are public with the book: anyone can read them.
drop policy if exists "book_likes: public read" on public.book_likes;
create policy "book_likes: public read"
  on public.book_likes for select
  to anon, authenticated
  using (true);

-- A member likes only as themselves.
drop policy if exists "book_likes: member likes" on public.book_likes;
create policy "book_likes: member likes"
  on public.book_likes for insert
  to authenticated
  with check (collector_id = public.current_collector_id());

-- A member unlikes only their own like.
drop policy if exists "book_likes: member unlikes" on public.book_likes;
create policy "book_likes: member unlikes"
  on public.book_likes for delete
  to authenticated
  using (collector_id = public.current_collector_id());

create table if not exists public.book_comments (
  id         uuid primary key default gen_random_uuid(),
  comic_id   uuid not null references public.comics (id) on delete cascade,
  author_id  uuid not null references public.collectors (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

-- A book's thread, in order (oldest first — chat order).
create index if not exists book_comments_comic_idx
  on public.book_comments (comic_id, created_at);
create index if not exists book_comments_author_idx
  on public.book_comments (author_id);

alter table public.book_comments enable row level security;

-- Comments are public with the book: anyone can read the thread.
drop policy if exists "book_comments: public read" on public.book_comments;
create policy "book_comments: public read"
  on public.book_comments for select
  to anon, authenticated
  using (true);

-- A member comments only as themselves.
drop policy if exists "book_comments: member comments" on public.book_comments;
create policy "book_comments: member comments"
  on public.book_comments for insert
  to authenticated
  with check (author_id = public.current_collector_id());

-- The author can delete their own comment; the founder can delete
-- any comment (moderation). Nobody else can delete anything, and
-- there is deliberately no UPDATE policy: comments are not editable.
drop policy if exists "book_comments: author or founder deletes" on public.book_comments;
create policy "book_comments: author or founder deletes"
  on public.book_comments for delete
  to authenticated
  using (
    author_id = public.current_collector_id()
    or public.is_founder_collector()
  );

-- Likes: read for everyone; write (insert/delete) for members only.
grant select on public.book_likes to anon, authenticated;
grant insert, delete on public.book_likes to authenticated;

-- Comments: read for everyone; post/delete for members only. No
-- update grant for anyone — a comment can never be edited.
grant select on public.book_comments to anon, authenticated;
grant insert, delete on public.book_comments to authenticated;
