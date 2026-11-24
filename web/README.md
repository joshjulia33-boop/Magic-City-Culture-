# Magic City Culture Community — static front end

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

Cover photos for the founder's 31 verified-cover books are not in this
repo (the GitHub connection moves text only); those books show colour
tiles until the images are uploaded to the `covers` bucket.
