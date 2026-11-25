# Magic City Culture presents The Collector's Hub — static front end

A dependency-light static site (plain HTML/CSS/JS + supabase-js from CDN)
for the Magic City Culture collector community, backed by the Supabase
project described in `../supabase/schema.sql`. It runs from any static
host — no build step, no server of its own.

## Files

| File | What it is |
|---|---|
| `index.html` | Page shell: header/nav, hero logo (inline SVG neon sunset + skyline + palms), mount points. |
| `styles.css` | The neon-night theme (deep indigo, neon pink `#FF2E88`, electric blue `#00D4FF`, Archivo type) ported from the original app. |
| `config.js` | Supabase project URL + **publishable** key. That key is public by design; all privacy is enforced by row-level security in the database. There is no secret key in this site, ever. |
| `app.js` | All views and actions (see below). |

## Features

- **Gallery** — every book from the `gallery_comics` view: search,
  filters (cover art / signed / graded / for sale), optional grouping by
  collector, community stats. A book's current value appears only where
  the view exposes it (the owner opted in); price paid is never public.
- **Collectors** — public profiles from `public_profiles`, each opening a
  public shelf page (books from the gallery; shelf total only when the
  collector shares values).
- **Market** — active `listings` (asking prices public). Signed-in members
  place orders (insert into `orders`; the database checks the book is
  really listed, by that seller, at that price, and flips it to sold) and
  track their buying/selling orders; sellers mark orders complete. **No
  payment is taken anywhere** — members arrange payment and handoff
  between themselves.
- **Join / Sign in** — Supabase Auth (email + password). On first sign-in
  the member creates their collector profile (display name, handle, city,
  bio, avatar colour).
- **My Shelf** — the member's own books and their private numbers from
  `comic_values` (owner-only in the database): totals paid / current
  value, add & edit books (including cover photo upload to the `covers`
  storage bucket), list a book for sale or unlist it, and the
  **show values publicly** toggle (off by default).
- **Referrals** — every member gets a personal invite link,
  `<site>/?ref=<handle>`, shown on My Shelf in a single **Invite a
  Collector** panel — one invite with two options under it: (1) share
  the link, with a copy-link button, a "send referral email" button (it
  opens the member's own mail app with a pre-written invite — the site
  has no mail server and never sends email itself); and (2) a
  copy-the-message option for friends who have Muse
  (see below). The panel also shows how many collectors joined through
  the member's link.
  A visitor arriving with `?ref=<handle>` has it remembered; the Join
  view and the profile form say "Invited by @handle" when that handle is
  a real collector, and creating the profile records `referred_by` on
  the new collector (a member's public profile then shows "Invited by
  @x" too). No rewards or points — just credit. Recording referrals
  needs the one-time SQL in step 4 below; without it, sign-ups still
  work and invites simply aren't recorded yet.
- **Ask-your-Muse helpers** — there is no Muse-to-Muse account link,
  so the site hands people a ready-made message to paste to their own
  Muse instead (copy-text only, no backend). That message lives inside
  the one **Invite a Collector** panel on My Shelf, as its second
  option: the Claude-user invite text (the member's referral link + an
  instruction telling the friend's Muse to join through that exact
  link, create their profile, and shelve their first books), so the
  inviter still gets credit. Separately, My Shelf has an "Add books
  with your Muse" panel (about adding books, not inviting): an
  instruction a member gives their Muse to open the site signed in as
  them and add a list of books (title, issue, variant, signed/graded,
  cover photo each) to their shelf.

## Deploy (remaining steps)

1. Host this `web/` folder anywhere static. On Vercel: import the GitHub
   repo, set the project root/output to `web/` (it is plain static files —
   no build command), or drag the folder into a new Vercel project.
2. In the Supabase dashboard → **Authentication → URL Configuration**, set
   the Site URL to the deployed address and add it to the redirect
   allow-list, so confirmation/password emails land on the real site.
   (If email confirmation is left on, new members must click the email
   link before their first sign-in.)
3. Founder claim (one-time, Joshua only): after Joshua signs up here,
   link his seeded profile to his auth account in the SQL editor:
   `update public.collectors set auth_user_id = '<his auth.users id>' where handle = 'joshua';`
   Until then his shelf is publicly browsable but nobody can edit it or
   see its values. There is deliberately no in-app way to claim it.
4. Referrals (one-time): in the same SQL editor, run
   `../supabase/referrals.sql` (after `schema.sql`). It adds the
   nullable `collectors.referred_by` column and exposes it on the
   `public_profiles` view, so invites can be recorded and counted.
   Safe to re-run.

Cover photos for the founder's 31 verified-cover books are not in this
repo (the GitHub connection moves text only); those books show colour
tiles until the images are uploaded to the `covers` bucket.
