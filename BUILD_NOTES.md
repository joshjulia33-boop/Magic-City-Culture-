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

## Update — Friends (2026-11-26)

Joshua's ask: "Add the ability for everyone to add others as friends."

- **Schema** (`supabase/add-friends.sql`, folded into `schema.sql`): one
  table, **`friendships`** (requester_id, addressee_id, status
  pending → accepted, unique pair per direction, no self-friending).
  Declining a request, cancelling your own, and removing a friend are
  all the same delete, allowed for either member in the row. A
  `guard_friendship_update` trigger makes accepting the only possible
  update — status only, parties and date frozen.
- **Privacy**: RLS shows a friendship ONLY to its two members. There is
  deliberately no public friend list and no public friend count; the
  site can only ever display your own friendships and the button state
  between you and one other member (your own count shows on your own
  card/profile/shelf). No values or private data involved.
- **Front end**: friend controls on every collector card (Collectors
  tab) and on profile pages — ADD FRIEND / REQUEST SENT + CANCEL /
  RESPOND + ACCEPT + DECLINE / FRIENDS ✓ + REMOVE — and a **Friends**
  panel on My Shelf (incoming requests, sent requests, friends list
  with count and REMOVE), sitting between the payouts and invite
  panels. No new tab.
- **Graceful before the SQL runs**: exactly like the Trade tab before
  its migration — if the friendships table doesn't exist yet, the
  buttons stay hidden and the shelf panel says friends are being
  switched on. Nothing else changes.
- **Verified locally**: PGlite (real Postgres) — schema + migration
  apply and re-run cleanly, **26/26 checks** (request → accept visible
  to both parties, bystander sees 0, no sending as someone else, no
  accepting your own request, no self-friend, duplicates rejected,
  parties can't be rewritten, decline/cancel/remove deletes work for
  both sides, anon locked out). Headless Chrome at 390px with
  simulated data — **18/18 checks**: all four button states on cards,
  profile-page respond state, the full shelf panel, the
  pre-migration degradation, no overflow, no JS errors.
- **Remaining step**: run `supabase/add-friends.sql` in the Supabase
  SQL Editor (handled separately). Until then the live site behaves
  exactly as before.

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

## Update — Signing Radar (2026-11-26)

**Owner's design**: a radar-looking graph with a GPS backdrop for
every member, centered on that member's own location; a search bar
for signature artists (auto-suggesting from the site's artist list);
dots for signings with their miles-away; and alerts when an artist
who signed the member's own books is appearing near them. Scope was
then widened beyond conventions: CGC Signature Series signings,
CBCS signings, comic-shop signings, and artist-announced appearances.

**Data** — new static file `web/signings.js`, NO database step:
`window.MCC_SIGNINGS = { dataUpdated, events: [...] }`, each event
`{ id, name, type, venue, city, state, lat, lng, startDate, endDate,
url, artists, artistsNote, source }` with `type` one of
`convention | mail-in signing | shop signing`. **Honesty rule** (in
the file header): an artist is listed only when a published guest
list/announcement actually found names them; unannounced shows carry
`artists: []` + "Guest list to be announced". 16 events seeded
(2026-11-26 research): 9 conventions (Florida Supercon — Dan Mora +
Ariel Diaz from the official guest list; MegaCon Orlando — Frank
Miller from his official guest page; Tampa Bay Comic Con, ECCC,
WonderCon, C2E2, SDCC, Dragon Con, NYCC — guests TBA), 4 CGC
Signature Series mail-in private signings from cgccomics.com
(Absolute Wonder Woman team — due Jan 15 2027; Bob Budiansky and
Keith Williams — due Feb 26 2027; Lucio Parrillo & Carla Cohen —
due Apr 16 2027), and 3 shop signings (Greg Land in Memphis,
Sanford Greene in Cary NC, Fleecs & Forstner at Third Eye MD).
CBCS was researched: it publishes no public signing calendar, so no
CBCS events are seeded. Mail-ins plot CGC's Lakewood Ranch /
Sarasota HQ coordinates and their dates are the submission
deadlines; the UI labels them "MAIL-IN — distance is to CGC HQ".

**Front end** — sixth nav tab RADAR (nav grid reworked: rows of two
on phones, three from 560px, six from 1024px; labels still measured
into their boxes). The scope is a circle of mile rings (range =
nice-rounded farthest shown event, quarter rings labelled), a
rotating conic sweep, and a faint OpenStreetMap tile backdrop
centered on the member (zoom matched to the range; a street-grid
layer sits underneath so failed tiles still read as a map). Blips
plot by true bearing + haversine distance, pulse, and sync with the
distance-sorted list both ways (selected state shared). Location:
geolocation once per session when allowed → typed city/ZIP via
Nominatim → Miami, FL default; kept in page state like other view
state. Artist search reuses the Signed-by suggestion machinery
(`signerMatches` over artists.js + learned `signed_by` names),
filters radar + list live, and marks the member's own shelf signers
with ★ "SIGNED YOUR BOOKS". **Alerts**: for a signed-in member, an
in-person signing within 50 miles featuring one of their shelf
signers puts a banner at the top of the view ("⚠ [Artist] — who
signed N of your books — is signing ~X miles away at [Event] on
[date]") and turns that blip orange. Mail-ins never alert (their
distance is to CGC HQ, not a trip). Signed-out visitors get the
full radar + list with no personal alerts. No prices or values
anywhere in the feature; Add/Edit forms untouched; nothing
Stripe-related touched.

**Verification** — headless Chrome at 390px against a stubbed
Supabase client (this Chromium build blocks loopback navigations,
so the harness serves the origin from disk via Fetch interception;
the WebGL domain-policy file/switch pair is required to launch it).
Signed-in test member (shelf signed by Dan Mora ×2, Frank Miller
×1): **all checks pass** — 6 tabs fit their boxes; sweep + 4
labelled rings; 16 blips (1 hot, 4 mail-in); alert banner fires for
Dan Mora (Supercon, ~4.3 mi) and not for Frank Miller (MegaCon,
~205 mi); distances sane (Miami Beach < 15 mi, Orlando ≈ 205 mi,
CGC HQ ≈ 179 mi labelled mail-in); list sorted by distance;
suggestions come from artists.js with the ★ marker; picking Dan
Mora filters to 1 blip/1 card, SHOW ALL restores 16; blip↔card
selection syncs; geolocation override centers on "your location";
geocoding "Orlando" re-centers (MegaCon ~<1 mi, Supercon ~204 mi);
no horizontal overflow; no JS exceptions. Signed-out run: radar +
16 events render from the Miami default, no alerts, no shelf
markers, no exceptions.

## Update — Heat Monitor (2026-11-26)

**Owner's design**: a "🔥 HEAT MONITOR — HOTTEST COMICS RIGHT NOW"
carousel on everyone's pages — the Top 10 hottest comics on the open
market, cycling automatically, refreshed on a regular cadence. It
shows PUBLIC market data about comics in general (sold prices and
sales velocity). It never shows any member's private values, paid
prices, or shelf totals — the values-privacy rule is untouched.

**Data** — new static file `web/heat.js`, NO database step:

```js
window.MCC_HEAT = {
  updatedAt: "<ISO 8601 timestamp of this edition>",
  sourceNote: "Ranked from actual sales across eBay sold, Whatnot, price guides and comic news.",
  items: [
    { rank, title, issue, note, priceSignal, trend, coverUrl, link } // exactly 10, ranks 1–10
  ]
};
```

Field rules:
- `rank`: 1–10, unique. Rank 1 renders the "#1 HOTTEST" badge.
- `title`: series title only (e.g. "Absolute Batman"). `issue`:
  issue number plus the variant/edition descriptor and publisher/year
  (e.g. "#25 — Clay Mann & Nick Dragotta Foil, Cover L (DC, 2026)").
- `note`: one line on WHY it is hot, grounded in the research
  (sales counts, % moves, news driving demand) — no hype without a
  sales fact behind it.
- `priceSignal`: a recent SOLD-price signal — a range or typical
  sold price / fair market value — **with the source named in the
  string** (e.g. "High sale $195 raw NM, FMV $164 — CovrPrice").
  Asking prices never count; only completed sales.
- `trend`: exactly one of `up` | `heating` | `cooling`.
- `coverUrl`: a cover image URL or `null`. **Image rules**: only
  stable, long-term cover-archive URLs (League of Comic Geeks S3,
  VerseDB media, Wikimedia, publisher CDNs). **Verify every URL
  returns HTTP 200 with an image content-type (curl -sI) before
  including it.** Never hotlink an expiring or signed URL, never an
  eBay/Whatnot listing photo. The URL must show the exact edition
  the entry names; if no exact verifiable cover exists, use `null`
  — the site renders its placeholder tile. (Edition 1: 8 verified
  covers, 2 nulls — Chainkata #1 Ito Virgin Foil and Challenges of
  Doom: Doctor Strange #1 Momoko Momo-Tone.)
- `link`: a source page for the book's market — its eBay SOLD
  search (`LH_Sold=1&LH_Complete=1`) or the guide page the price
  signal came from. Tapping a cover opens it in a new tab.

**Ranking rules**: rank by REAL SALES HEAT, not hype — copies
actually selling (velocity/volume) and the prices they actually
sold at, blended across every reachable outlet: eBay sold
listings, GoCollect's sales-volume index and biggest movers,
CovrPrice weekly Top 10s, Key Collector, Whatnot heat, and comic
news (adaptation announcements etc.) only where the news is moving
real sales. A book with buzz but no sales does not make the list.

**REFRESH PROCEDURE** (mechanical): 1) Research a fresh Top 10
under the ranking rules above. 2) Rewrite `web/heat.js` — replace
the whole `items` array and set `updatedAt` to the current ISO
timestamp; keep the exact field shape and the `sourceNote`. 3)
Verify every new `coverUrl` per the image rules (or `null`).
4) Push the single file `web/heat.js` to GitHub main (the site
redeploys from the push). No other file changes, no database step.

**Front end** — the same component (`heatCarouselHtml()` /
`wireHeat()` in app.js) renders at the top of the GALLERY view
(under the hero) and on every collector PROFILE page (above their
books grid). It auto-cycles every 4 seconds by toggling DOM classes
in place — never a full render, so it cannot steal the gallery
search box's focus — and pauses on hover/touch. Prev/next arrows
and dots jump manually (delegated `heat-prev` / `heat-next` /
`heat-goto` actions). Each slide: rank flame badge, cover (or
placeholder tile), title + issue, why-hot line, sold-price signal,
trend chip. Degradation: if `heat.js` fails to load or has no
items, the section is omitted entirely; a null or failed cover
quietly leaves the placeholder tile (the img removes itself on
error). index.html loads `heat.js` after `signings.js`.

**Verification** — headless Chrome at 390px against a stubbed
Supabase client (origin served from disk via Fetch interception,
same harness as Friends/Radar): **21/21 checks pass** — section on
the gallery AND on a collector profile; 10 slides + 10 dots;
header, "Updated" label from `updatedAt`, and sourceNote render;
slide 1 active with the "#1 HOTTEST" badge; the 8 verified covers
load and the 2 null-cover entries (ranks 2 and 8) show placeholder
tiles; every slide links out in a new tab and tapping the active
cover opens its source link; the carousel auto-cycles at ~4s;
next/prev arrows and dots jump correctly; a `cooling` trend chip
renders; no horizontal overflow (scrollWidth = 390); no JS errors.
Degradation run with `heat.js` returning 404: no heat section, the
gallery renders normally, no JS errors.

## Update — Hot Up & Coming (2026-11-27)

**What it is:** "🚀 HOT UP & COMING — COMICS TO WATCH" — a second
Top 10 carousel in the same visual style as the Heat Monitor,
rendered DIRECTLY UNDER the Heat Monitor on the GALLERY view and on
every collector PROFILE page. Like the Heat Monitor and the Signing
Radar it is visible to EVERYONE, signed in or not — no sign-in gate
on viewing. It is informational only: no prices, no buying or
selling, no member data, and it is unaffected by the market-closed
switch. Only the owner controls the content (it is a static file in
the repo, like `heat.js`); members cannot change it.

**Data:** `web/upcoming.js` (loaded by `index.html` right after
`heat.js`) sets:

```js
window.MCC_UPCOMING = {
  updatedAt: "<ISO timestamp>",
  sourceNote: "<one line on where the dates/details came from>",
  items: [
    { rank, title, issue, publisher, releaseDate, dateLabel,
      whyHot, coverUrl, link } // x10, ordered by heat (rank)
  ]
};
```

- `releaseDate` is the ISO date (`YYYY-MM-DD`); `dateLabel` is the
  human line shown in the slide's date chip, e.g.
  `"Releases Dec 10, 2026"`. If only a Final Order Cutoff date is
  known, use it for both and label it `"FOC Nov 30, 2026"` — never
  present an FOC date as a release date.
- `whyHot` is ONE line grounded in the source: a first appearance,
  the writer/artist team, an adaptation tie-in, a variant program,
  a sequel to a hot book.
- `link` is the source article/solicitation for that entry; tapping
  a slide (cover included) opens it in a new tab.

**Sourcing rules (same discipline as the Heat Monitor):**

- Every date comes from a REAL source found during the refresh:
  publisher solicitations/announcements (DC, Marvel, Image, Dark
  Horse, BOOM!, IDW), Previews / Diamond / Penguin Random House
  listings, League of Comic Geeks, Key Collector, comic news.
  NEVER invent a date, a first appearance, or a cover.
- `coverUrl` must be the EXACT edition named, from a stable source,
  and must be verified before use: `curl` it and require HTTP 200
  plus an image content-type (visually confirm the book when the
  URL is derived from a pattern, e.g. PRH's UPC-based cover CDN).
  If no cover verifies, use `coverUrl: null` — the slide renders
  the placeholder tile. Hotlink-protected hosts (HTTP 403 to curl)
  do not count as verified.

**Front-end:** `upcomingCarouselHtml()` / `wireUpcoming()` /
`upcStep()` / `showUpcomingSlide()` in `web/app.js`, styled by the
`.upc*` block in `web/styles.css` (pink accent so it reads as its
own panel; the release date sits in a filled blue chip). It mirrors
the Heat Monitor's mechanics exactly — auto-cycle ~4s, pause on
hover/touch, arrows + dots, slide classes updated in place — but
runs on its OWN state (`upcIndex` / `upcTimer` / `upcPaused`), so
the two carousels on one page cycle independently and neither
steals focus. Degradation: missing/empty `upcoming.js` → the
section is omitted entirely; a null or failed cover image →
placeholder tile; the page never breaks.

**Refresh procedure** (the 8-hour refresh job maintains this
alongside `heat.js`): research a fresh Top 10 of upcoming books
most likely to be hot (new #1s, key first appearances, event
launches, notable variants), rewrite the `items` array and
`updatedAt` in `web/upcoming.js` keeping the exact field shape,
verify every cover per the rules above, and push the single file.

**Verification (2026-11-27)** — headless Chrome at 390px against a
stubbed Supabase client (same harness family as Heat/Market):
**60/60 checks pass** across three runs. Signed-in: both carousels
on the gallery with Upcoming directly under Heat (adjacent
sibling), 10 slides + 10 dots, title/"Updated"/sourceNote render,
slide 1 active with the "#1 MOST WANTED" badge, date chip and
why-hot line correct, slide 1 links to its DC source, all 10
verified covers load as real images, both carousels auto-cycle
independently at ~4s, Upcoming arrows/dots work and Heat's arrows
still work alongside, both carousels again on a collector profile,
Market and Trade still show the closed panel, no horizontal
overflow, no JS errors. Signed-out run: both carousels render and
cycle on the gallery with no sign-in. Degradation run with
`upcoming.js` returning 404: no Upcoming section, Heat and the
gallery render normally, no JS errors.

## Update — Market closed switch (2026-11-27)

The owner ordered all buying and selling disabled site-wide until he
says otherwise. It is a single front-end switch — no database change,
no data change, nothing about Stripe (which stays on hold, untouched).

**The switch:** `window.MCC_MARKET_OPEN` in `web/config.js`.

```js
window.MCC_MARKET_OPEN = false; // closed
window.MCC_MARKET_OPEN = true;  // open
```

`web/app.js` reads it once as `MARKET_OPEN` (`!== false`, so the site
only closes when the flag is explicitly false). **To reopen the
Market, flip that one line to `true` and push `web/config.js`** —
every surface below comes back exactly as it was, because nothing
was deleted and no stored data was touched.

**While closed, the flag hides:**

- **Market tab** — listings, prices and the orders sections are
  replaced by one closed panel: "🛑 THE MARKET IS CLOSED — Buying
  and selling are paused for now. Browsing the Gallery still works —
  check back soon." (`marketClosedHtml()` in app.js.)
- **Trade tab** — same closed panel for every visitor; no deal
  builder, no offer cards, no offer actions. Existing offers stay in
  the database, unsurfaced.
- **Book detail modal** — no Asking price, no Payment methods line,
  no Open to trades line, no BUY IT / PROPOSE A TRADE buttons.
- **Cards everywhere** (Gallery, profiles, My Shelf) — no FOR SALE
  price badge, no OPEN TO TRADES badge, no FOR SALE / LISTED price
  line; the Gallery hero loses its "N for sale" stat.
- **Filter chips** — the "For sale" chip is gone from the Gallery
  and from My Shelf (a stale `for_sale` filter value is ignored
  while closed).
- **Add / Edit Book form** — the whole "Sell or trade — the Market"
  section is not rendered, and its form wiring is skipped. A save
  while closed preserves the book's stored `asking_price_cents`,
  `payment_methods`, `payment_other` and `open_to_trades` verbatim
  (read from the existing row), so closing the Market can never
  rewrite a listing's data; new books save as normal owned books.
- **My Shelf payouts panel** — the "SELLING PAYOUTS — STRIPE" panel
  is not rendered while closed (its call site is gated on
  `MARKET_OPEN`; the Stripe code itself stays in place, on hold).
- **Action handlers** — `confirmBuy()` and `proposeTrade()` refuse
  with a "Market is closed" notice even if invoked directly.

**Untouched:** stored `status` / prices on every book, the offers and
orders tables, the My Shelf values panel and private numbers, the
Stripe build itself (payments were never switched on), Friends,
Signing Radar, Heat Monitor, and photo ID.

Verified in headless Chrome at 390px with stubbed data in both
states: closed shows no price anywhere in the DOM on Market, Trade,
Gallery, profile, shelf or detail views and no Sell or Trade section
in the form; open restores today's behavior in full. No horizontal
overflow and no JS errors in either state.

## Update — Grade is a 1.0–10.0 selection in Add/Edit Book (2026-11-27)

Owner's order: the Grade field in the Add a Book / Edit Book form is a
dropdown running the full standard CGC numeric scale. `GRADES` in
web/app.js is now `["", "1.0", "1.5", "1.8", "2.0", "2.5", "3.0", "3.5",
"4.0", "4.5", "5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5",
"9.0", "9.2", "9.4", "9.6", "9.8", "9.9", "10.0"]` and the grade is
stored as the plain number ("9.8"). The blank first option is labelled
"Raw / no grade" and saves as an empty grade, exactly as before.
It replaces the old mixed list ("Raw — Near Mint", "CGC 9.8", "CBCS
9.6", …). Nothing already saved changes: the form still appends any
saved grade that isn't on the scale (e.g. a legacy "CGC 9.6") as an
extra selected option, and the photo-ID path still adds an off-scale
grade as an option rather than dropping it — so editing an older book
never loses or silently rewrites its grade; it only changes if the
member picks a new one. One companion line: `isGraded()` now also
recognises a plain numeric grade, so books graded with the new scale
still count under the Graded filters (older "CGC x" values still
match as before). Verified in headless Chrome at 390px with stubbed
data (18/18): option list exact and in order, 9.8 saves as "9.8",
a 9.4 book opens with 9.4 selected, a legacy "CGC 9.6" book opens
with its grade preserved as an extra option, search prefill 9.6 and
photo-ID grades land selected, no overflow, no JS errors, and the
Market-closed form (no Sell or Trade section) is unchanged.

## Update — Graded tick + grade number input in Add/Edit Book (2026-11-27)

Owner's follow-up order, superseding the dropdown above: grade entry
is now two-part. A **Graded** checkbox (same `.check` styling as
Signed / Has a remark, sitting right where the Grade field was) plus
a **grade number input** (`type="number"`, min 1, max 10, step 0.1,
placeholder "9.8") with a datalist (`GRADE_STEPS` in web/app.js) of
the standard CGC steps 1.0, 1.5, 1.8, …, 9.9, 10.0 — type the number
or pick a suggested one. There is no database change: graded is
derived from the grade itself, ticked ⇔ a grade is set.

Behaviour: the number box is hidden and disabled until Graded is
ticked (ticking it also focuses the box); unticked saves an empty
grade (raw), exactly as before. Ticked demands a number from 1.0 to
10.0 — an empty or out-of-range value stops the save with the notice
"Enter a grade from 1.0 to 10.0, or untick Graded" and nothing is
written. The stored value is the plain number normalised to one
decimal ("9.8", "10.0"). The form carries `novalidate` so this check
— not the browser's native bubble — is what guards the range (the
title and asking-price checks already worked the same thrown-error
way). A helper `gradeNumberOf()` pulls the number out of any stored
grade: an edit of a plain "9.4" book or a legacy "CGC 9.6" / "CBCS
9.8" book opens with Graded ticked and just the number showing, and
saving stores the plain number; a value with no number ("Raw —
Fine") opens unticked. Every prefill path goes through the same
helper — search picks via the form's prefill, and photo ID / slab
identification (`applyAiIdentification`) ticks Graded, shows the
box, and puts the stripped number in — so no identified grade is
ever dropped. `isGraded()` and the Graded filters are unchanged and
keep working off the stored grade. Market stays closed (no Sell or
Trade section rendered); values/privacy and Stripe untouched.
Verified in headless Chrome at 390px with stubbed data (41/41):
unticked saves an empty grade, ticking shows/enables/focuses the
box, 9.8 and 10.0 save as "9.8"/"10.0", empty / 11 / 0.5 are blocked
with the notice and no write, edit states for plain, legacy and raw
books all correct, unticking a graded book saves it raw, search
prefill and photo-ID "CGC 9.8" both land ticked with the bare
number, datalist exact, no overflow, no JS errors.

## Update — Admin dashboard, founder only (2026-11-27)

Joshua's pick from the common-features list: an Admin dashboard — one
private page where only he sees member counts, new joins, reported
posts, and can feature a book or a member on the front page. His rule
behind it: everyone can see the site, only he controls everything.

- **Schema** (`supabase/add-admin.sql`, folded into `schema.sql`):
  `comics.is_featured` + `collectors.is_featured` (the founder's
  front-page picks, projected through `gallery_comics`, `listings`,
  and `public_profiles`), a helper `public.is_founder_collector()`,
  and one new table, **`reports`** (reporter, target book/member,
  reason, status open → resolved/dismissed, resolved_at). Featuring
  is enforced twice: "founder features" UPDATE policies are the only
  path to another member's row (collectors also gets a founder-only
  SELECT policy — an UPDATE can only reach rows the caller can see),
  and `guard_comic_featured` / `guard_collector_featured` triggers
  reject any is_featured change from a non-founder on ANY row and
  freeze every other column when the founder touches someone else's
  row — his reach into a member's data is exactly one boolean wide.
  Reports: any signed-in member inserts as themselves; SELECT and
  UPDATE are founder-only; there is no DELETE grant or policy at all,
  and `guard_report_update` freezes everything except status /
  resolved_at. The dashboard shows counts and activity only — no
  member's private values are involved anywhere.
- **Front end**: a seventh nav tab, **ADMIN**, that app.js adds to
  the nav only when the signed-in profile `is_founder` (removed for
  everyone else; wide screens give his nav a 7-column row). The view:
  OVERVIEW counts (members, books, signed, cover art, joins and books
  added in the last 7 days), REPORTS with MARK RESOLVED / DISMISS,
  FEATURED lists with UNFEATURE, FEATURE A BOOK (search across every
  shelf) and FEATURE A MEMBER pickers, NEW JOINS (latest 10), LATEST
  BOOKS (latest 10 community-wide). `render()` bounces a non-founder
  who somehow lands on the admin view back to the gallery. On the
  Gallery, a **⭐ FEATURED BY THE FOUNDER** strip sits under the hero
  (above the carousels) rendering featured books and members with the
  normal gallery / collector cards; it renders nothing when nothing
  is featured. Report entry points: a REPORT THIS BOOK button in the
  book detail and REPORT THIS MEMBER on profile pages — signed-in
  members only, never on your own book/profile — opening a short
  reason prompt that files into `reports` and confirms "Reported —
  the founder will see it."
- **Graceful before the SQL runs**: if the reports table / featured
  columns don't exist yet, Report buttons stay hidden, the reports
  section reads as switching on, and featuring answers with a notice
  — the rest of the site is untouched. Market stays closed; Stripe
  untouched.
- **Verified locally**: PGlite (real Postgres) — schema + migration
  apply cleanly and idempotently, **31/31 checks** (founder features
  another member's book and the member; non-founder cannot move
  is_featured anywhere, including their own book; founder cannot edit
  another member's fields through the featured path; member files a
  report, cannot read or answer any; founder reads, resolves, cannot
  rewrite or delete; anon locked out of reports but sees the flags in
  the public views). Headless Chrome at 390px with stubbed data —
  **29/29 checks** across founder / member / signed-out sessions:
  tab present only for the founder, all sections render, featuring a
  book puts it in the Gallery strip, resolving empties the reports
  list, a member's report files with the right reporter/target, a
  direct admin-view attempt by member or visitor lands on the
  gallery, no overflow, no JS errors.
- **Remaining step**: run `supabase/add-admin.sql` in the Supabase
  SQL Editor (handled separately). Until then the live site behaves
  exactly as before.

## Update — Direct Messages (2026-11-27)

Joshua's next pick from the common-features list: direct messages —
member-to-member private chat for everyone, so deals can be talked
out before offers get sent. (The Market stays closed; messaging works
regardless and touches no listing/price logic.)

- **Schema** (`supabase/add-messages.sql`, folded into `schema.sql`):
  one new table, **`messages`** (sender_id, recipient_id, body,
  created_at, read_at — NULL = unread; sender ≠ recipient check;
  indexes for the recipient inbox, the sender history, and thread
  lookup). Privacy is enforced in the database: the SELECT policy
  shows a row only to its two members — **the founder gets no special
  read access to other people's messages**, and there is no public
  path at all. INSERT is only as yourself and a new message must
  start unread (no spoofed senders, no pre-marked reads). UPDATE is
  open only to the member the message was sent TO, and
  `guard_message_update` freezes everything except `read_at` — body,
  sender, recipient, and send date can never be rewritten. There is
  no DELETE policy and no delete grant: messages persist. The
  migration is written against the LIVE schema: it touches no
  existing view and no `stripe_*` column (the Stripe migration has
  never run live — its columns exist only in this repo's schema.sql).
- **Front end**: a **MESSAGES** tab in the nav, present in the HTML
  but `hidden` until a member is signed in (visitors see no tab, and
  `render()` bounces a signed-out messages view back to the gallery).
  An unread-count badge rides on the tab. The wide-screen nav row
  widens for it (`has-messages`: 7 columns; the founder's nav with
  ADMIN too: 8). The view is an **inbox** — one row per conversation
  (avatar, name/@handle, last-message preview, time, unread pill),
  newest first — plus a **NEW MESSAGE** picker listing every other
  member, and a **thread view**: bubbles oldest → newest (mine in
  pink on the right, theirs on the left, with time and a "Read" mark
  on mine once seen), a send box, and a note that only the two
  members can read the chat. Opening a thread marks its incoming
  messages read (one UPDATE … `read_at is null`, optimistically
  applied so the badge clears at once). A **✉ MESSAGE** button on
  every collector card and profile page (never your own, never for
  visitors) jumps straight into that thread. While the Messages view
  is open a 15-second timer quietly reloads my rows — following the
  site's timer care: the interval is cleared and re-armed on every
  render so it never stacks, it skips hidden tabs, it re-renders only
  when something actually changed, and never over a draft being
  typed (the draft lives in state on every keystroke; the header
  badge still updates). Sending re-renders, scrolls to the newest
  message, and refocuses the box.
- **Graceful before the SQL runs**: if the messages table doesn't
  exist yet, the tab shows "Messages are being switched on" and the
  MESSAGE buttons stay hidden — the rest of the site is untouched.
  Market stays closed; Stripe untouched; no values anywhere.
- **Verified locally**: PGlite (real Postgres) — schema + migration
  apply cleanly and idempotently, **24/24 checks** (both parties read
  a conversation; a third member reads none of it; the FOUNDER cannot
  read a conversation he isn't in; spoofed sender and pre-marked-read
  inserts rejected; self-messages rejected; the sender cannot mark
  their own message read; only the recipient can, and only `read_at`
  moves — body/sender edits die on the guard trigger; no deletes; anon
  locked out entirely). Headless Chrome with stubbed Supabase —
  **75/75 checks** across member sessions at **360px, 390px and
  412px**, a founder session, and a signed-out session: tab visible
  only signed-in with the correct unread badge, inbox lists the
  conversation with preview + unread pill, opening a thread clears
  the badge via the mark-read PATCH, sending POSTs as the right
  sender and renders the bubble, the picker and the collector-card
  and profile MESSAGE buttons all land in the right thread, no
  MESSAGE button on your own card or anywhere signed-out, the
  founder's inbox shows only his own conversations, and at every
  width: nav labels fit their boxes, no horizontal overflow, no
  overlapping elements, no JS errors.
- **Remaining step**: run `supabase/add-messages.sql` in the Supabase
  SQL Editor (handled separately). Until then the live site behaves
  exactly as before.

## Update — Comments & Likes on books (2026-11-27)

Every book can now be liked, and every book's page carries a comment
thread — the community layer the comparison pass recommended third.

- **Database** (`supabase/add-comments.sql`, also folded into
  schema.sql): `public.book_likes` (comic_id + collector_id, the
  pair as primary key — a duplicate like is impossible; unliking
  deletes your own row) and `public.book_comments` (id, comic_id,
  author_id, body, created_at; blank bodies rejected by a check).
  Both are **public reads** (`to anon, authenticated`): like counts
  and threads are part of the book's public page and expose nothing
  private — no values are involved anywhere. Writes are narrowed
  hard: likes INSERT/DELETE only as yourself; comments INSERT only
  as yourself; comment DELETE by the author **or the founder**
  (`public.is_founder_collector()` — moderation). There is no
  UPDATE policy and no update grant on comments: a posted comment
  can never be edited, by anyone. The migration is written against
  the LIVE schema: it touches no existing view and no `stripe_*`
  column.
- **Front end**: a compact ♥ pill (heart + live count, filled pink
  when yours) in every book card — Gallery, profiles, the featured
  strip, My Shelf, and Market listings — and in the book page's meta
  column, where the card behind and the page always agree (toggling
  in the modal re-renders both). Signed-in members like/unlike;
  signed-out visitors see the count and tapping opens the join flow;
  a signed-in member without a profile gets the profile form. The
  book page gains a **COMMENTS (n)** section under the detail grid:
  rows of avatar + name/@handle + time + text, **oldest first**
  (chat order, matching Messages), a post box for members, a
  sign-in note instead for visitors. Delete rides on your own
  comments and on every comment for the founder, behind the site's
  usual confirm modal, and returns you to the book page. Likes load
  with the public data (one `book_likes` read); a book's thread
  loads when its page opens and re-renders the modal only if that
  book is still open.
- **Graceful before the SQL runs**: if either table is missing, the
  like buttons stay off the cards and the book page shows no like
  row or comments section — the rest of the site is untouched.
  Market stays closed; Stripe untouched; no values anywhere.
- **Verified locally**: PGlite (real Postgres) — schema + migration
  apply cleanly and idempotently, **25/25 checks** (like/unlike only
  as self; duplicate like dies on the PK; comment only as self;
  blank comment rejected; author deletes own; another member cannot
  delete; founder deletes any; NOBODY can edit a comment, founder
  included; anon reads both tables but writes neither; deleting a
  book cascades its likes and comments). Headless Chrome with
  stubbed Supabase — **94/94 checks** across member sessions at
  **360px, 390px and 412px**, a founder session, and signed-out
  sessions at 390px and 360px: card count starts at the stubbed 2,
  like → 3 filled, unlike → 2; detail-page like keeps the card
  behind in agreement; the thread renders, a posted comment appears
  with the header count growing, own-comment delete works through
  the confirm, the founder sees DELETE on every comment and removes
  another member's, signed-out visitors read the thread with the
  sign-in note and get the join flow from the like button (nothing
  written); plus **12/12** on a degraded run with both tables
  missing (no buttons, no section, no errors). At every width: no
  horizontal overflow, the modal fits inside the viewport, no JS
  errors.
- **Remaining step**: run `supabase/add-comments.sql` in the Supabase
  SQL Editor (handled separately). Until then the live site behaves
  exactly as before.
