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

## Update — Market listing details + Trade tab (2026-11-26)

Joshua's ask: "Buy sell and trade is the idea." Listing controls move
into Add a Book / Edit a Book (a **Sell or Trade** section), and a fifth
nav tab, **TRADE**, carries member-to-member trade offers.

- **Schema** (`supabase/add-market-trades.sql`, folded into
  `schema.sql`): `comics` gains `payment_methods` (comma-joined picks:
  Cash, Cash App, Venmo, Zelle, PayPal, Other), `payment_other`, and
  `open_to_trades`, all projected through `gallery_comics` and
  `listings`. New tables **`offers`** (from/to collectors, target comic,
  `cash_cents` the sender adds, message, status, `parent_offer_id` for
  counters) and **`offer_items`** (one row per book per side:
  'offered' = sender's books, 'requested' = receiver's books).
- **Security**: offers/items are visible only to the two parties (RLS).
  Item inserts require the book to belong to the correct side, so
  nobody can put someone else's books into a deal. A
  `guard_offer_update` trigger freezes the deal once sent — only the
  status may move, receiver → accepted/declined/countered, sender →
  withdrawn, and only from pending.
- **Front end**: the form's Sell or Trade section (List-in-Market tick
  synced with the Status select, price, payment-method checkboxes,
  Open-to-trades tick); Market cards and the book detail show payment
  methods, the OPEN TO TRADES badge, and a PROPOSE A TRADE button; the
  Trade tab has the deal builder (target picker, both sides' checkbox
  book lists, cash, message) plus received/sent offer inboxes with
  Accept / Decline / Counter / Withdraw. Accepted offers surface the
  target owner's accepted payment methods so members settle directly.
- **No payments, ever**: payment-method names are display text on a
  listing. No payment account is opened or needed; per Joshua's
  standing rule, that step would stop for his decision first.
- **Graceful before the SQL runs**: the three new comic fields ride the
  form's existing optional-column drop, and the Trade tab shows a
  "being switched on" note while the offers tables don't exist.

## Update — Book Search tab (2026-11-24)

A **BOOK SEARCH** nav tab (`viewSearchHtml` / `runBookSearch` in
`web/app.js`) lets any member type a series + issue ("Hulk 185",
"Amazing Spider-Man 361") and get two result groups:

- **In the community** — a live `gallery_comics` query (`ilike` on
  title, exact-issue matches preferred when an issue number was
  typed). Cards reuse the gallery card; each also gets an **ADD YOUR
  OWN COPY** button that opens the add form pre-filled from that row.
- **From the archive** — the Internet Archive advancedsearch API
  (archive.org, keyless, CORS-open — verified live). Shows publisher,
  year, creators and a description snippet, with **ADD TO MY SHELF**
  opening the add form pre-filled: title/issue from the query,
  publisher mapped onto the form's publisher list, and
  year/creators/description packed into the private Notes field (the
  schema has no year/creator columns; schema unchanged).

**Data-source verdict (checked live 2026-11-24):** no keyless source
returns solid issue-level data. The Grand Comics Database has the
deep data, but its API has no search endpoint and sends no CORS
headers, so a static site cannot use it. The Internet Archive works
from the browser but catalogues collected editions and classics far
better than single issues — many famous issues (e.g. Incredible Hulk
#185) are simply not in it, and the UI says so rather than faking
results. **Upgrade path:** Metron (metron.cloud) is a proper
issue-level API with credits, but it requires a free account's
credentials (HTTP 401 without), which a public static page cannot
hold — it would need a small server proxy or per-member keys.

## Update — Stripe Connect card payments (2026-11-26)

Joshua approved real payments: **Stripe Connect, standard accounts,
5% platform commission** (his earlier "stop and bring me the options"
rule was honoured — he picked Stripe and set the commission). This
supersedes the "No payments, ever" note in the Market & Trade section
above. Full runbook: `web/README.md` step 11.

**Architecture** (all money moves inside Stripe; the site holds no
secret key anywhere):

- `supabase/add-stripe-payments.sql` — the database half (also folded
  into `schema.sql`). Collectors gain `stripe_account_id` + three
  synced flag columns on the owner-only base table; the public views
  project ONLY the `payouts_enabled` boolean, never the account id.
  `orders` becomes the payment order book (fee/Stripe-id columns,
  status ladder paid → shipped → received → completed, legacy
  'placed' orders still completable): the old client insert policy is
  dropped — orders are created ONLY by the webhook — and a guard
  trigger gives each party exactly its own status moves. The sold
  trigger now also clears `open_to_trades`/payment text. `offers`
  gains `cash_status` (+ Stripe ids): accepting a cash deal flips it
  to 'pending' inside the guard trigger; the guard's new service-key
  path (auth.uid() IS NULL) may write ONLY the cash fields.
- Four Edge Functions (`supabase/functions/stripe-*/index.ts`),
  single-file, fetch-only, same pattern as `identify-cover`:
  `stripe-config` (is payments on? + the publishable key),
  `stripe-connect` (create standard account + hosted onboarding link;
  status sync), `stripe-checkout` (destination-charge Checkout
  sessions for listing buys and trade cash top-ups, 5%
  application_fee_amount), `stripe-webhook` (signature-verified; the
  ONLY writer of payment state: creates 'paid' orders idempotently by
  checkout session, marks trade cash paid, syncs account flags on
  account.updated; a paid-but-unfulfillable purchase is logged loudly
  for a human refund rather than silently dropped).
- Front end: My Shelf gains a **Selling payouts** panel (set up /
  finish / ready states); the Sell or Trade form section prompts
  sellers without payouts; BUY branches three ways — card checkout
  when payments are on and the seller is ready, a plain explanation
  when the seller isn't, and the original off-site order flow while
  payments are off entirely (so the site works unchanged until the
  keys land); orders show the ladder with per-role buttons and the
  seller sees the 5% fee line; accepted trade offers show the cash
  state and a PAY BY CARD button for the member who owes it; Stripe
  return URLs (`?payment=…`, `?stripe=…`) land on notices + a status
  sync. No sixth tab; five-tab phone fit re-verified.

**Commission**: 5% of the price, `Math.round` to the cent, taken by
Stripe as the application fee on the destination charge; Stripe's own
processing fee comes out of the seller's side. Configurable via the
`PLATFORM_FEE_PERCENT` function secret (default 5).

**Ownership decision**: a paid book follows the site's existing model
— the `mark_comic_sold_on_order` trigger flips it to status 'sold' on
the seller's shelf and closes the listing; the order row (buyer,
seller, price, fee) is the transfer record. No ownership rewrite was
invented.

**Verified locally** (no live keys exist yet): PGlite (real Postgres)
test of the true upgrade path — folded schema reverted to the
pre-stripe state, legacy order + accepted cash offer created under the
old rules, migration applied twice — **34/34 checks**: backfill,
view hygiene (no account id anywhere public, values still hidden),
client order inserts blocked, webhook-style order creation + full
listing close-out, duplicate-session rejection, the whole status
ladder with per-party guard errors, legacy completion, cash
accept → pending → server-only paid, server barred from everything
else. Node unit tests of the real function files — **19/19**:
signature verification (valid / tampered / wrong secret / stale /
rotation), fee math, Stripe form encoding. Headless Chrome at 390px
— **22/22**: tabs, market modals for ready/not-ready sellers, order
buttons + fee line, trade cash button/paid line, all three payout
panel states, no overflow, no JS errors. (The older trade UI suite
shows 31/32: its one failure is a pre-existing assertion flaw —
`innerText` applies the `.label` uppercase transform, so a
mixed-case string can never match; the DOM text itself is verified
correct.)

**Two bugs the tests caught and fixed before shipping**: (1) the
migration's cash backfill originally ran under the OLD offer guard,
which rejects every update to an answered offer — the guard
replacement now deliberately precedes the backfill; (2) nothing else
— the guards' direct `auth.uid()` calls are fine on real Supabase
(the API roles can execute it; the local stub needed the same grant
Supabase ships).

**Remaining steps** (need Joshua's Stripe account / the dashboard —
see README step 11 for the click-by-click version): activate the
platform Stripe account + enable Connect (standard accounts); run
`add-stripe-payments.sql` in the SQL editor; deploy the four
functions (`stripe-webhook` with Verify JWT **off**); set the secrets
`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`;
create the Stripe webhook endpoint for the three events. Until then
the live site behaves exactly as before.
