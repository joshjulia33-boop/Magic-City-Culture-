/* Magic City Culture — HEAT MONITOR data (static file, no database step).
   The hottest comics right now, ranked by REAL SALES HEAT — copies
   actually selling and at what prices — across eBay sold listings,
   Whatnot, GoCollect / CovrPrice / Key Collector movers and comic
   news. This is public market data about comics in general; it never
   contains any member's private values.

   REFRESH (see BUILD_NOTES.md, "Heat Monitor" section): replace the
   items array and updatedAt below with fresh research, keep the exact
   field shape, verify every coverUrl returns an image before using it
   (coverUrl: null renders the site's placeholder tile), then push
   this single file. */
window.MCC_HEAT = {
  updatedAt: "2026-11-28T05:03:02Z",
  sourceNote: "Ranked from actual sales across eBay sold, Whatnot, price guides and comic news.",
  items: [
    {
      rank: 1,
      title: "Absolute Batman",
      issue: "#1 (DC, 2024)",
      note: "GoCollect's #1 most-sold comic of the past 10 days and #8 on Key Collector's Nov 25 Hot 10 — the Absolute flagship still outsells everything else.",
      priceSignal: "Top sale $670 graded 9.8, +63% at 9.8 — Key Collector Hot 10; raw NM FMV $332 — CovrPrice",
      trend: "heating",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-2463692.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=absolute+batman+%231&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 2,
      title: "Star Trek",
      issue: "#2 — Photo Cover B (IDW, 2026)",
      note: "CovrPrice's #1 book for the week ending Nov 22 — the Patrick Stewart photo cover spiked to the top of the weekly sales chart.",
      priceSignal: "High sale $20 raw NM, fair market value $16 — CovrPrice (weekly Top 10, week ending Nov 22, 2026)",
      trend: "heating",
      coverUrl: "https://media.versedb.com/uploads/issues/star-trek-2026-2-1221907/star-trek-2026-2-1185527-197yx5o-cover_md.webp",
      link: "https://www.keycollectorcomics.com/issue/star-trek-2026-1-2-1,924489/"
    },
    {
      rank: 3,
      title: "Chainkata",
      issue: "#1 — Ito Virgin Foil, Limited 444 (Image, 2026)",
      note: "CovrPrice's #2 book for the week ending Nov 22 — the 444-copy Ito virgin foil is still the chase cover of the year's biggest launch.",
      priceSignal: "High sale $195 raw NM, fair market value $164 — CovrPrice (weekly Top 10, week ending Nov 22, 2026)",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=chainkata+%231+ito+virgin+foil&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 4,
      title: "Invincible",
      issue: "#1 (Image, 2003)",
      note: "New entry: #1 on Key Collector's Nov 25 Hot 10 — the first appearance of Invincible and Omni-Man is posting the list's biggest key-issue sales.",
      priceSignal: "Top sale $9,600 graded 9.8, +20% at 9.2 — Key Collector Hot 10 (Nov 25, 2026)",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=invincible+%231+cgc&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 5,
      title: "Inanna: The Name She Lost",
      issue: "#1 — Serena Bell 1:20 variant (Vault, 2026)",
      note: "CovrPrice's #3 book for the week ending Nov 22 — the Serena Bell 1:20 incentive was a mega-hit on release and demand is still spiking its price.",
      priceSignal: "High sale $106 raw NM, fair market value $29 — CovrPrice (weekly Top 10, week ending Nov 22, 2026)",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=inanna+the+name+she+lost+%231+serena+bell&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 6,
      title: "Afterlife With Archie",
      issue: "#1 — Francesco Francavilla Cover A (Archie, 2013)",
      note: "CovrPrice's #4 book for the week ending Nov 22 — Disney+ cast its Archie, Veronica, Betty, Jughead and Sabrina for the Halloween 2027 series, and copies started moving again.",
      priceSignal: "High sale $34 raw NM, fair market value $29 — CovrPrice (weekly Top 10, week ending Nov 22, 2026)",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=afterlife+with+archie+%231+francavilla&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 7,
      title: "Chainkata",
      issue: "#1 — Daniel Warren Johnson regular cover (Image, 2026)",
      note: "CovrPrice's #5 book — Chainkata editions fill half of its newest Top 10, and the regular cover keeps selling in massive numbers after its 250K+ first print sold out.",
      priceSignal: "Graded 9.8 high sale $100, raw NM fair market value $13 — CovrPrice (weekly Top 10, week ending Nov 22, 2026)",
      trend: "heating",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-5698084.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=chainkata+%231&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 8,
      title: "Marvel Super-Heroes Secret Wars",
      issue: "#8 (Marvel, 1984)",
      note: "GoCollect's #2 most-sold book of the past 10 days and #6 on Key Collector's Nov 25 Hot 10 — first black costume / symbiote suit keeps moving.",
      priceSignal: "Newsstand CGC 9.8 top sale $2,126, +185% at 9.8 — Key Collector Hot 10",
      trend: "heating",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-7603337.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=secret+wars+%238+cgc+9.8&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 9,
      title: "Legion of Super-Heroes",
      issue: "#Ashcan — 2026 SDCC Preview (DC, 2026)",
      note: "New entry: CovrPrice's #9 book — collectors discovered Bat-Lad hidden on this wraparound preview's back cover, its first cover appearance, and copies took off.",
      priceSignal: "High sale $32 raw NM, fair market value $24 — CovrPrice (weekly Top 10, week ending Nov 22, 2026)",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=legion+of+super-heroes+ashcan+sdcc+bat-lad&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 10,
      title: "Chainkata",
      issue: "#Ashcan — Daniel Warren Johnson Retailer Preview (Image, 2026)",
      note: "CovrPrice's #8 book — the July retailer-preview ashcan that started the Chainkata frenzy is now selling at key-issue prices.",
      priceSignal: "High sale $300 raw NM+, fair market value $189 — CovrPrice (weekly Top 10, week ending Nov 22, 2026)",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=chainkata+ashcan&LH_Sold=1&LH_Complete=1"
    }
  ]
};
