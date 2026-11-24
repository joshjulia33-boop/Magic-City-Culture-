# Magic City Culture

A community site for comic collectors, Miami style — neon pink and blue, palm trees, sunset skyline.

Collectors join, build their own shelf, and browse a shared gallery. Each collector's
values are **private by default** — only the owner sees what their books are worth —
and anyone can choose to make their own values public from their shelf. Price paid,
purchase dates, sources, and notes never go public.

The **Market** tab lets members list books for sale at a public asking price and buy
from each other; orders are tracked for buyer and seller. No payment is taken in the
app — buyer and seller arrange payment and handoff themselves.

## Layout

- `client/` — the web front end (React + TypeScript)
- `server/` — the back end and its actions (shelves, profiles, gallery, market orders)
- `drizzle/` — database migrations

## Notes

- The starter collection data in `server/src/collection-import.ts` has all prices
  stripped to zero on purpose — the owner's real values live only in the running app.
- Cover images and the logo are image files and are not in this repository; the app
  shows styled tiles where no cover file is present.
