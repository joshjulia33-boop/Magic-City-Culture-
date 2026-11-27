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
| `signings.js` | The Signing Radar's curated event list (conventions, CGC mail-in signings, shop signings) — static data, edited by hand; see the honesty rule in the file header. |

## Features

- **Gallery** — every book from the `gallery_comics` view: search,
  filters (cover art / signed / remarqued / graded / for sale), optional grouping by
  collector, community stats. A book's current value appears only where
  the view exposes it (the owner opted in); price paid is never public.
- **Collectors** — public profiles from `public_profiles`, each opening a
  public shelf page (books from the gallery; shelf total only when the
  collector shares values).
- **Market** — active `listings` (asking prices public). Listing a book
  happens in Add a Book / Edit a Book, in the **Sell or Trade** section:
  a "List this book in the Market" tick, the asking price, the **payment
  methods the seller accepts** (Cash, Cash App, Venmo, Zelle, PayPal,
  Other — shown on the listing for settling directly), and an
  **Open to trades** tick. Signed-in members track their buying/selling
  orders here. **Card payments run through Stripe Connect** (deploy
  step 11): a seller who has set up payouts (My Shelf) takes card
  payment at Stripe's hosted checkout — a destination charge to their
  own Stripe account, minus Stripe's fee and the site's **5% platform
  commission** — and the order is written by the payment webhook when
  the money lands, then walked through paid → shipped → received →
  completed by the two parties. Sellers without payouts (and the whole
  site, until step 11 is done) keep the original flow: BUY IT places
  the order here, the database flips the book to sold, and the members
  arrange payment and handoff between themselves.
- **Trade** — the fifth tab, under the same **Buy · Sell · Trade** idea.
  A member picks another member's listed, trade-open book, then builds
  their side of a deal: tick any number of their own books, add optional
  cash to up the deal, and a message. The offer lands in the other
  member's Trade tab, which shows both sides; they can **Accept**,
  **Decline**, or **Counter** — a counter opens the same builder
  pre-filled with the sides swapped, so both members can bundle books.
  Offers live in `offers` / `offer_items`, visible only to the two
  members in the deal (row-level security); the deal text is frozen
  once sent and only the status moves, guarded by a database trigger.
  Accepting changes no book by itself. The books settle between the
  members, and the deal's **cash top-up can be paid by card** through
  the same Stripe rails as the Market (step 11): the Trade tab shows
  a PAY BY CARD button to the member who owes the cash once the deal
  is accepted, and the payment state (`offers.cash_status`) is written
  only by the payment functions. Needs deploy step 10 below; until
  then the tab says trading is being switched on.
- **Signing Radar** — the sixth tab. A circular radar (mile rings, a
  rotating sweep, a faint OpenStreetMap backdrop) centered on the
  member's own location: browser geolocation when allowed, a typed
  city/ZIP lookup (Nominatim) as fallback, Miami, FL by default.
  Events come from the curated static list in `signings.js` —
  conventions, comic-shop signings, and CGC Signature Series mail-in
  signings (plotted at CGC's Sarasota HQ and labelled MAIL-IN; their
  date is the submission deadline). Blips plot by true bearing +
  haversine distance and sync with the distance-sorted list. The
  artist search suggests from the same artist list as the Signed-by
  box (plus names learned from books); picking or typing a name
  filters radar + list. Artists who signed the signed-in member's own
  books get a ★ everywhere, and when one is appearing within 50 miles
  (in person) a banner at the top of the view calls it out and the
  blip burns orange. No database step; no prices anywhere.
- **Admin (founder only)** — a seventh tab that exists only for the
  founder's account: community counts, new joins, latest books,
  member **reports** to resolve or dismiss, and pickers to **feature
  a book or a member** in the ⭐ FEATURED BY THE FOUNDER strip on the
  front page. Members get a small Report button on other people's
  books and profiles; only the founder can read or answer reports,
  and only he can move the featured flags — all of it enforced in the
  database (`supabase/add-admin.sql`), not just hidden in the UI.
- **Join / Sign in** — Supabase Auth (email + password). On first sign-in
  the member creates their collector profile (display name, handle, city,
  bio, avatar colour).
- **Photo identification (Add/Edit Book only)** — the top of the add/edit
  book form is a single **Find Your Book** section with two big buttons,
  **📷 Take a photo** (a file input with `capture="environment"`, so the
  phone opens its camera) and **Pick a photo** (gallery/files). It is the
  only photo-identification control on the site, and because add and edit
  share the one form, it appears in both modes and nowhere else. Taking
  or picking a photo sends it (downscaled to a 1024px JPEG) to the
  `identify-cover` Supabase Edge Function
  (`../supabase/functions/identify-cover/`), which identifies the book
  from the artwork itself: a vision pass describes the cover and notes
  the physical copy's details (slab grader/grade/cert, signed, remarque,
  cover types), then a search-grounded pass looks the artwork up on the
  web — comic databases and cover catalogues (GCD, Comic Vine, League
  of Comic Geeks, publisher catalogues, retailer variant listings, eBay
  listings) — stopping at the first strong, source-backed match and
  naming that source. That is also how **virgin covers** with no title
  on them are identified. The best match fills only fields that are
  still empty; up to two close alternates are offered as tappable
  choices under the result. No genuine match = the form stays empty
  with an honest no-match line; low-confidence matches are flagged.
  Nothing is ever auto-saved, and the photo becomes the book's cover on
  save exactly as before. There is deliberately **no on-device OCR**:
  letters read off stylised cover art are gibberish, not an
  identification, so the form never fills from them.
  Until deploy step 8 below is done, identification is simply
  unavailable (404 / 503 from the functions endpoint) and the status
  line says so — manual entry always works.
- **Book photos & COA** — a book holds up to **5 photos**: the cover
  (uploaded exactly as before, and still the photo the identification
  flow works from) plus up to 4 extra pictures of the actual book —
  back cover, corner/page close-ups, the certificate — added in the
  add/edit form's **More photos of this book** section (take a photo or
  pick photos, remove any of them; the form shows the running count,
  "N of 5"). Extras live in the same `covers` storage bucket and are
  referenced from `comics.extra_photos` (a JSON URL array). The book
  detail view shows all the photos, cover first, as a tappable gallery;
  marketplace listings show the extras too, so buyers can judge
  condition. Gallery and shelf grid tiles still use the main cover
  only. The form's signature section (Signed → Signed by → **COA**)
  ends with a "COA — comes with a Certificate of Authenticity" tick,
  stored as `comics.has_coa`; it shows as a gold **COA** badge on cards
  (same style as SIGNED / REMARQUED) and a "Certificate of
  Authenticity: Yes/No" line in the detail view. A photo of the
  certificate itself is simply one of the book's extra photos — there
  is no separate COA uploader. Needs deploy step 9 below; until then
  books save normally and the extras/COA just don't persist yet.
- **My Shelf** — the member's own books and their private numbers from
  `comic_values` (owner-only in the database): totals paid / current
  value, add & edit books (including cover photo upload to the `covers`
  storage bucket), list a book for sale or unlist it, and the
  **show values publicly** toggle (off by default). The book grid has
  the same search and filter chips as the Gallery (all books / with
  cover art / signed / remarqued / graded / for sale), applied to the member's own
  books only, in the same newest-first order. The shelf also carries
  the **Selling payouts** panel: a one-time "Set up payouts with
  Stripe" onboarding (Stripe-hosted; the member's own standard Stripe
  account), its finish/check-status states, and a link to the member's
  Stripe dashboard once payouts are ready. Members who never sell
  never need it.
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
  inviter still gets credit.

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
5. Remark flag (one-time): in the same SQL editor, run
   `../supabase/add-has-remark.sql` (after `schema.sql`). It adds
   `comics.has_remark` and projects it through the gallery/listings
   views, enabling the "Has a remark" tick in the add/edit form
   (right next to Signed), the REMARQUED badge, and the Remarqued
   filter chips. Until it is run, books still save normally — the
   tick just doesn't persist yet. The add/edit form no longer has a
   Current value box: stored values and the shelf totals are
   untouched, and saving a book keeps whatever value it already had.
6. Cover types (one-time): in the same SQL editor, run
   `../supabase/add-cover-type.sql` (after `schema.sql` and
   `add-has-remark.sql`). It adds `comics.cover_type` (a comma-joined
   string — a cover can be several types at once) and projects it
   through the gallery/listings views, enabling the "Cover type — tap
   all that fit" chips in the add/edit form (under Signed / Has a
   remark), the cover-type badges on cards, and the "Cover" line in
   the detail view. It also backfills types from the variant wording
   already on the books (metal, foil, virgin, …). Until it is run,
   books still save normally — the picks just don't persist yet.
   The add/edit form no longer has a cover colour picker either: a
   new book's placeholder tile just gets a colour from the site
   palette automatically, and existing books keep the colour they
   already have.

7. Signed-by name (one-time): in the same SQL editor, run
   `../supabase/add-signed-by.sql` (after `schema.sql` and
   `add-cover-type.sql`). It adds the nullable `comics.signed_by`
   column and projects it through the gallery/listings views,
   enabling the "Signed by (artist name)" box under the Signed tick
   in the add/edit form and the "Signed by" line in the book detail
   view. The box autocompletes from `artists.js` — a researched
   roster of 367 artists (cover and variant-cover artists especially),
   merged with every distinct signed-by name already saved on the
   site's books; free typing always works. Until the SQL is run,
   books still save normally — the name just doesn't persist yet.
8. AI photo identification (one-time): deploy the `identify-cover`
   Supabase Edge Function so the AI pass of photo identification —
   above all matching **virgin covers** from their artwork — can run.
   The static front end cannot hold an AI key, which is why this lives
   in a function:
   1. Get a free Gemini API key from Google AI Studio
      (aistudio.google.com → "Get API key").
   2. Supabase dashboard → project `ekdgbjnztnfrfjrhljpz` →
      **Edge Functions** → create a function named `identify-cover`
      with the contents of `../supabase/functions/identify-cover/index.ts`
      and deploy it (or `supabase functions deploy identify-cover`).
   3. **Edge Functions → Secrets**: add `GEMINI_API_KEY` = that key.
      (Optional: `GEMINI_MODEL` overrides the default
      `gemini-2.5-flash`.)
   Nothing else changes: the form already calls the function and
   degrades honestly until it exists — books save, and only the
   identification itself waits on this step.
   **Troubleshooting:** if every photo comes back "couldn't be read",
   open the function's **Logs** in the dashboard — the function logs
   the exact Gemini error (HTTP status + provider message) for each
   failed call. The usual causes are a `GEMINI_API_KEY` secret that
   isn't a valid AI Studio key, the Generative Language API not being
   enabled for the key's project, or an exhausted free-tier quota.
   Re-paste this file's contents and redeploy after fixing the secret.
9. Extra photos & COA (one-time): in the same SQL editor, run
   `../supabase/add-extra-photos-coa.sql` (after `schema.sql` and
   `add-signed-by.sql`). It adds `comics.extra_photos` (a JSON array
   of up to 4 extra photo URLs — cover + 4 = the book's 5-photo cap)
   and `comics.has_coa`, and projects both through the
   gallery/listings views, enabling the **More photos of this book**
   section in the add/edit form, the photo gallery in the book detail
   view, the extra photos on marketplace listings, the gold **COA**
   badge, and the "Certificate of Authenticity" line in the detail
   view. Until it is run, books still save normally — the extra
   photos and the COA tick just don't persist yet.
10. Market details & trading (one-time): in the same SQL editor, run
    `../supabase/add-market-trades.sql` (after `schema.sql` and
    `add-extra-photos-coa.sql`). It adds `comics.payment_methods`,
    `comics.payment_other` and `comics.open_to_trades`, projects all
    three through the gallery/listings views, and creates the `offers`
    and `offer_items` tables (with their row-level security and the
    status-guard trigger), enabling the **Sell or Trade** section in
    the add/edit form, payment methods and the OPEN TO TRADES badge on
    listings, and the **Trade** tab. Until it is run, books still save
    normally — the market fields just don't persist yet — and the
    Trade tab explains that trading is being switched on.
11. Card payments — Stripe Connect (one-time, Joshua approved
    2026-11-26, with a **5% platform commission**). Until every part of
    this step is done the site simply keeps its arrange-between-
    yourselves behaviour — the front end asks the `stripe-config`
    function whether payments are on and degrades gracefully while
    they are not.
    1. **Stripe account**: open the platform's Stripe account
       (stripe.com) and activate it (business details + bank for the
       commission payouts). In **Settings → Connect**, enable Connect
       with **standard** accounts and card payments / transfers.
    2. **Database**: in the SQL editor, run
       `../supabase/add-stripe-payments.sql` (after step 10). It adds
       the collectors Stripe columns, widens `orders` into the payment
       order book (orders are then created only by the webhook),
       projects the payouts boolean through the public views, and adds
       the trade cash state to `offers`.
    3. **Functions**: deploy four Edge Functions from
       `../supabase/functions/` — `stripe-config`, `stripe-connect`,
       `stripe-checkout`, and `stripe-webhook` — the same way
       `identify-cover` was deployed (step 8). **`stripe-webhook` must
       be deployed with "Verify JWT" turned OFF** (Stripe sends no
       Supabase token; its signature is the authentication). The other
       three keep JWT verification on.
    4. **Secrets** (Edge Functions → Secrets, shared by all four):
       `STRIPE_SECRET_KEY` (the platform account's secret key,
       `sk_live_…`), `STRIPE_PUBLISHABLE_KEY` (`pk_live_…`), and —
       after the next sub-step — `STRIPE_WEBHOOK_SECRET`.
       Optional: `SITE_URL` (default
       `https://magic-city-culture.vercel.app`),
       `PLATFORM_FEE_PERCENT` (default `5`).
    5. **Webhook**: in the Stripe dashboard → Developers → Webhooks,
       add the endpoint
       `https://ekdgbjnztnfrfjrhljpz.supabase.co/functions/v1/stripe-webhook`
       listening for `checkout.session.completed`,
       `checkout.session.async_payment_succeeded`, and
       `account.updated`; copy its signing secret (`whsec_…`) into the
       `STRIPE_WEBHOOK_SECRET` function secret.
    6. **Check**: reload the site signed in as a seller — My Shelf's
       "Selling payouts" panel offers the Stripe setup; after
       onboarding, a second member sees PAY BY CARD on the listing,
       and the paid order appears under YOUR ORDERS in the Market.

Cover photos for the founder's 31 verified-cover books are not in this
repo (the GitHub connection moves text only); those books show colour
tiles until the images are uploaded to the `covers` bucket.
