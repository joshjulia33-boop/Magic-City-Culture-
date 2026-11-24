# Magic City Culture Community — Supabase port: build notes

## What was created

In `~/workspace/magic-city-culture-web/`:

| File | What it is |
|---|---|
| `supabase/schema.sql` | Full Postgres DDL for the Supabase project: tables, RLS policies, views, grants, triggers, and an optional cover-photo storage section. Safe to re-run. |
| `supabase/seed.sql` | Founder profile + the founding shelf (101 books), generated from the actual starter data in the GitHub repo (`server/src/collection-import.ts`). Safe to re-run (deterministic ids, `ON CONFLICT DO NOTHING`). |
| `BUILD_NOTES.md` | This file. |

Project: `https://ekdgbjnztnfrfjrhljpz.supabase.co` — publishable key
`sb_publishable_lWl2ecnz0W47JGCiSLEomg_P-q2NQt3` (designed to be public; it
belongs in the front-end config). No secret key was requested or used.

## Design (mirrors the Muse artifact's SQLite schema)

- **`collectors`** — profiles: display name, handle, city, bio, avatar colour,
  `is_founder`, `show_values_publicly`, plus `auth_user_id` (nullable) linking
  the profile to a Supabase Auth user. The founder row is seeded with
  `auth_user_id = NULL` so it exists before Joshua's auth account does.
- **`comics`** — the shelf. Listings are not a separate table (same as the
  original): a listing is a comic with `status = 'for_sale'` and
  `asking_price_cents` set. `cover_blob_key` became `cover_url` (Supabase
  Storage public URL).
- **`comic_values`** — new table split out of the original `comics` (see
  privacy design below): price paid, current value, purchase date, source,
  notes — one row per comic.
- **`orders`** — buyer/seller/price snapshot, `placed` → `completed`, exactly
  as the original. A trigger marks the comic `sold` and clears its asking
  price when an order is placed. No payments anywhere.
- **Views** — `public_profiles` (profile fields, no auth link),
  `gallery_comics` (the shared gallery), `listings` (active market listings).

## Privacy design (values private by default — enforced in the database)

1. All money/purchase columns live in **`comic_values`**, which has **no grant
   to the `anon` role at all** and RLS policies that only let the owning
   collector read/write a row. The publishable key physically cannot reach
   another collector's values.
2. **`comics` contains only public-safe columns**, so the gallery can be
   world-readable without leaking anything.
3. The single public path to a value is **`gallery_comics`**, which projects
   `current_value_cents` **only when the owner set
   `show_values_publicly = true`** (otherwise NULL). Price paid, purchase
   date, source, and notes are not in the view at all — they stay private
   even for collectors who opt in, matching the original app's rule.
4. `collectors` base table is owner-read-only (it holds the auth link);
   public profile reads go through `public_profiles`.
5. Orders are visible only to their buyer and seller; an order can only be
   placed for a book actually listed for sale, at exactly its asking price.

## Verification (done locally, before anything touches Supabase)

Both SQL files were executed against a real Postgres (PGlite) with stub
`auth`/`storage` schemas standing in for Supabase's, and exercised as
different users. All checks passed:

- Seed counts: **1 collector, 101 comics, 101 comic_values** — matches the
  starter data's 101 books exactly.
- Gallery exposes **0** values by default; after opt-in it exposed exactly
  the one test value set, and only the *current value* (never price paid).
- A second collector read **0** rows from `comic_values`, could not edit the
  founder's books, and saw **0** orders. Anonymous access to `comic_values`
  is a hard permission-denied (no grant), and the owner read all 101 of his
  own rows.
- Market flow: listing appears publicly at its asking price → buyer orders at
  that price → comic flips to `sold`, price cleared, listing disappears →
  seller marks the order completed. A bogus order at the wrong price was
  rejected by policy.

Local-test caveats: the `create extension pgcrypto` line was skipped locally
(PGlite doesn't bundle it; Supabase does, and `gen_random_uuid()` is core
Postgres 13+ anyway), and `auth.uid()` / storage were stubs — the real
Supabase versions behave the same for these uses, but the first live run
should still be eyeballed in the dashboard.

## Remaining steps (in order)

1. **Run the SQL** — this needs Joshua (or a guided session with him):
   Supabase dashboard → project `ekdgbjnztnfrfjrhljpz` → **SQL Editor** →
   paste `supabase/schema.sql` → Run; then paste `supabase/seed.sql` → Run.
   The publishable key cannot run DDL, and no secret key should be shared
   for this — the SQL editor is the way. Verify with the count query at the
   bottom of `seed.sql` (expect 1 / 101 / 101).
   - Housekeeping while in Settings: if the project's secret key was ever
     pasted anywhere, reset it under **Settings → API Keys** (it is not
     needed by this build at all).
2. **Claim the founder profile** — after Joshua creates his Supabase Auth
   account (sign-up in the new front end, or Authentication → Users in the
   dashboard), run:
   `update public.collectors set auth_user_id = '<his auth.users id>' where handle = 'joshua';`
   Until then his shelf is publicly browsable but only he-after-claiming can
   edit it or see its values.
3. **Build the front end** (next work item): a static site on Vercel talking
   to Supabase with supabase-js — config is just the project URL + the
   publishable key above. Features to port from the artifact's client:
   profiles/join, my shelf (private values), community gallery, public
   profiles, Market tab with order tracking. Also set the site's URL under
   Supabase **Authentication → URL Configuration** so email links land right.
4. **Covers**: 31 of the 101 books have verified cover art on the Muse
   surfaces; those image files are not in GitHub (text-only connection), so
   covers start as colour tiles on the new site until the images are
   uploaded to the `covers` bucket (schema.sql already creates it with
   owner-folder upload policies).
5. **Payments**: deliberately out of scope — the market takes no payment,
   same as the current community site. Per Joshua's standing instruction,
   when the site reaches the point of opening payment accounts for
   member-to-member buying, he gets the account options first, before
   anything is opened.

## Update — cover photo scan in the add/edit form (2026-11-24)

The add/edit comic form (`web/app.js`, Tesseract.js loaded in
`web/index.html`) now scans a chosen cover photo **on-device in the
browser** — no API key, no server, the photo never leaves the member's
phone for scanning (it still uploads to the `covers` bucket on save,
exactly as before). As soon as a photo is picked, OCR runs on the whole
image (downscaled to 1600px wide), with a second pass over the top third
— where slab labels sit — if no grade was found. Heuristics in
`scanFindGrade` / `scanFindIssue` / `scanFindTitle` pull out:

- **Grader + grade**: CGC / CBCS / PGX, with the grade number
  (`9.4`, `9.8`, `10.0`, …) printed closest to the grader's name; sets
  the Grade select (adding the option if the exact combo isn't listed).
- **Issue**: `#361`, `No. 361`, `Issue 361`, or a lone number on the
  title's line / corner box; stored in the site's `#361` format.
  Barcode/cert digit runs can never land in the field.
- **Title**: the line set in the biggest type (OCR word heights), with
  publisher/grader boilerplate, dates, prices and digit runs excluded,
  then title-cased.

Only empty fields are filled — anything the member already typed is
kept — and a summary line ("Scanned: Amazing Spider-Man #361 — CGC 9.4
— check it over, fix anything off, then save.") asks them to confirm.
Nothing auto-saves. Honest limit: slab labels are clean print and read
well; stylised raw-cover lettering can misread, which is why the member
always confirms before saving.
