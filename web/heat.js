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
  updatedAt: "2026-11-27T05:02:50Z",
  sourceNote: "Ranked from actual sales across eBay sold, Whatnot, price guides and comic news.",
  items: [
    {
      rank: 1,
      title: "Absolute Batman",
      issue: "#1 (DC, 2024)",
      note: "GoCollect's #1 most-sold comic of the past 10 days and a Key Collector Hot 10 staple — the Absolute flagship outsells everything else on the market.",
      priceSignal: "Top sale $670 graded 9.8, +63% at 9.8 — Key Collector Hot 10; raw NM FMV $332 — CovrPrice",
      trend: "heating",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-2463692.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=absolute+batman+%231&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 2,
      title: "Chainkata",
      issue: "#1 — Ito Virgin Foil, Limited 444 (Image, 2026)",
      note: "CovrPrice's #2 book on its newest Top 10 — the 444-copy Ito virgin foil is still the chase cover of the year's biggest launch.",
      priceSignal: "High sale $195 raw NM, fair market value $164 — CovrPrice (newest weekly Top 10, Nov 24, 2026)",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=chainkata+%231+ito+virgin+foil&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 3,
      title: "Star Trek",
      issue: "#2 — Photo Cover B (IDW, 2026)",
      note: "CovrPrice's #1 book on its newest Top 10 — the Patrick Stewart photo cover spiked to the top of the weekly sales chart.",
      priceSignal: "High sale $20 raw NM, fair market value $16 — CovrPrice (newest weekly Top 10, Nov 24, 2026)",
      trend: "heating",
      coverUrl: "https://media.versedb.com/uploads/issues/star-trek-2026-2-1221907/star-trek-2026-2-1185527-197yx5o-cover_md.webp",
      link: "https://www.keycollectorcomics.com/issue/star-trek-2026-1-2-1,924489/"
    },
    {
      rank: 4,
      title: "Darkhawk",
      issue: "#1 (Marvel, 1991)",
      note: "GoCollect's #1 biggest mover (+982 spots, updated Nov 27) after Marvel trademark / live-action Darkhawk news — 9.8s were $100–$150 earlier this year.",
      priceSignal: "CGC 9.8 sold $295 on Nov 17 and $310+ on Nov 11, 2026 — GoCollect / eBay sold",
      trend: "up",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-4240988.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=darkhawk+%231+cgc+9.8&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 5,
      title: "Chainkata",
      issue: "#1 — Daniel Warren Johnson regular cover (Image, 2026)",
      note: "CovrPrice's #5 book — five Chainkata editions fill its newest Top 10, and the regular cover keeps selling in massive numbers after the 250,000-copy first printing sold out.",
      priceSignal: "Graded 9.8 high sale $100, raw NM fair market value $13 — CovrPrice (newest weekly Top 10, Nov 24, 2026)",
      trend: "heating",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-5698084.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=chainkata+%231&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 6,
      title: "Marvel Super-Heroes Secret Wars",
      issue: "#8 (Marvel, 1984)",
      note: "GoCollect's #2 most-sold book of the past 10 days — first black costume / symbiote suit, and the newsstand 9.8 is surging on Key Collector's Hot 10.",
      priceSignal: "Newsstand CGC 9.8 top sale $2,126, +185% at 9.8 — Key Collector Hot 10",
      trend: "heating",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-7603337.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=secret+wars+%238+cgc+9.8&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 7,
      title: "Inanna: The Name She Lost",
      issue: "#1 — Serena Bell 1:20 variant (Vault, 2026)",
      note: "New entry: CovrPrice's #3 book of the week — the Serena Bell 1:20 incentive was a mega-hit on release and demand is still spiking its aftermarket price.",
      priceSignal: "High sale $106 raw NM, fair market value $29 — CovrPrice (newest weekly Top 10, Nov 24, 2026)",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=inanna+the+name+she+lost+%231+serena+bell&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 8,
      title: "Legion of Super-Heroes",
      issue: "#Ashcan — 2026 SDCC Preview (DC, 2026)",
      note: "New entry: copies sold jumped +475% after collectors spotted Bat-Lad's first cover appearance hidden on the wraparound back cover — on two straight CovrPrice Top 10s.",
      priceSignal: "High sale $40 raw NM+, fair market value $22 — CovrPrice (week ending Nov 22, 2026)",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=legion+of+super-heroes+ashcan+sdcc+2026&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 9,
      title: "Afterlife with Archie",
      issue: "#1 — Francesco Francavilla Cover A (Archie, 2013)",
      note: "CovrPrice's #4 book this week — Disney+ series casting news (series set for Halloween 2027) keeps pulling this 2013 horror key up the chart.",
      priceSignal: "High sale $34 raw NM, fair market value $29 — CovrPrice (newest weekly Top 10, Nov 24, 2026)",
      trend: "up",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-2992097.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=afterlife+with+archie+%231&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 10,
      title: "The Uncanny X-Men",
      issue: "#121 — Newsstand (Marvel, 1979)",
      note: "New entry: first full Alpha Flight appearance is surging on Ryan Reynolds Alpha Flight talk — Key Collector's Hot 10 shows its biggest grade gain at +72%.",
      priceSignal: "Top sale $775 graded 9.8, +72% at 9.6 — Key Collector Hot 10; raw VF FMV $84 — CovrPrice",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=uncanny+x-men+%23121+alpha+flight&LH_Sold=1&LH_Complete=1"
    }
  ]
};
