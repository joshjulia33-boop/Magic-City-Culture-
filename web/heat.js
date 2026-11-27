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
  updatedAt: "2026-11-27T04:46:28Z",
  sourceNote: "Ranked from actual sales across eBay sold, Whatnot, price guides and comic news.",
  items: [
    {
      rank: 1,
      title: "Absolute Batman",
      issue: "#1 (DC, 2024)",
      note: "GoCollect's #1 most-sold comic of the past 10 days — the Absolute flagship keeps outselling everything else on the market.",
      priceSignal: "Raw NM fair market value $332, high sale $350 — CovrPrice (week ending Nov 22, 2026)",
      trend: "heating",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-2463692.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=absolute+batman+%231&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 2,
      title: "Chainkata",
      issue: "#1 — Ito Virgin Foil, Limited 444 (Image, 2026)",
      note: "CovrPrice's #2 book of the week — the 444-copy Ito virgin foil is the chase cover of the year's biggest launch.",
      priceSignal: "High sale $195 raw NM, fair market value $164 — CovrPrice (week ending Nov 22, 2026)",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=chainkata+%231+ito+virgin+foil&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 3,
      title: "Darkhawk",
      issue: "#1 (Marvel, 1991)",
      note: "GoCollect's #1 biggest mover (+982 spots) after Marvel trademark / live-action Darkhawk news — 9.8s were $100–$150 earlier this year.",
      priceSignal: "CGC 9.8 sold $295–$310+ in mid-November 2026 — eBay sold via GoCollect",
      trend: "up",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-4240988.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=darkhawk+%231+cgc+9.8&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 4,
      title: "Star Trek",
      issue: "#2 — Photo Cover B (IDW, 2026)",
      note: "CovrPrice's #1 book of the week — the Patrick Stewart photo cover is the one every Trek collector is hunting.",
      priceSignal: "High sale $20 raw NM, fair market value $16 — CovrPrice (week ending Nov 22, 2026)",
      trend: "heating",
      coverUrl: "https://media.versedb.com/uploads/issues/star-trek-2026-2-1221907/star-trek-2026-2-1185527-197yx5o-cover_md.webp",
      link: "https://www.keycollectorcomics.com/issue/star-trek-2026-1-2-1,924489/"
    },
    {
      rank: 5,
      title: "Chainkata",
      issue: "#1 — Daniel Warren Johnson regular cover (Image, 2026)",
      note: "Sold in massive numbers — Image rushed the 250,000-copy first printing back to press after it sold out at the distributor.",
      priceSignal: "Raw NM fair market value $13; graded 9.8 high sale $100 — CovrPrice (week ending Nov 22, 2026)",
      trend: "heating",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-5698084.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=chainkata+%231&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 6,
      title: "Marvel Super-Heroes Secret Wars",
      issue: "#8 (Marvel, 1984)",
      note: "GoCollect's #2 most-sold book of the past 10 days — first black costume / symbiote suit, a key that never stays cold for long.",
      priceSignal: "CGC 9.8 sales from $600 (eBay, Nov 12, 2026) to $1,952 (Heritage newsstand, Nov 3, 2026)",
      trend: "heating",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-7603337.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=secret+wars+%238+cgc+9.8&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 7,
      title: "Absolute Batman",
      issue: "#25 — Clay Mann & Nick Dragotta Foil, Cover L (DC, 2026)",
      note: "The milestone-issue foil moved over a thousand copies in its peak week; volume is easing off that peak but still heavy.",
      priceSignal: "1,227 copies sold in its peak week (+316%); raw fair market value $71 then, $40 now — CovrPrice",
      trend: "cooling",
      coverUrl: "https://media.versedb.com/uploads/issues/absolute-batman-2024-25-1216745/absolute-batman-2024-25-1182560-o6cewr-cover_md.webp",
      link: "https://www.ebay.com/sch/i.html?_nkw=absolute+batman+%2325+foil&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 8,
      title: "Challenges of Doom: Doctor Strange",
      issue: "#1 — Peach Momoko Momo-Tone variant (Marvel, 2026)",
      note: "Misprint heat: Emperor Doom #1 art was printed inside this book and copies were recalled — weekly sales jumped +301%.",
      priceSignal: "High sale $20 raw NM+, fair market value $23 — CovrPrice",
      trend: "up",
      coverUrl: null,
      link: "https://www.ebay.com/sch/i.html?_nkw=challenges+of+doom+doctor+strange+%231+momoko&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 9,
      title: "Afterlife with Archie",
      issue: "#1 — Francesco Francavilla Cover A (Archie, 2013)",
      note: "Disney+ series casting news (series set for Halloween 2027) pulled this 2013 horror key back onto the charts.",
      priceSignal: "High sale $34 raw NM, fair market value $29 — CovrPrice (week ending Nov 22, 2026)",
      trend: "up",
      coverUrl: "https://s3.amazonaws.com/comicgeeks/comics/covers/medium-2992097.jpg",
      link: "https://www.ebay.com/sch/i.html?_nkw=afterlife+with+archie+%231&LH_Sold=1&LH_Complete=1"
    },
    {
      rank: 10,
      title: "Criminal",
      issue: "#1 (Marvel/Icon, 2006)",
      note: "Amazon's Criminal series trailer plus the announced facsimile reprints doubled this Brubaker/Phillips key's weekly sales.",
      priceSignal: "High sale $33 raw FN, fair market value $17 — CovrPrice",
      trend: "up",
      coverUrl: "https://upload.wikimedia.org/wikipedia/en/4/45/Criminal_1.png",
      link: "https://www.ebay.com/sch/i.html?_nkw=criminal+%231+brubaker&LH_Sold=1&LH_Complete=1"
    }
  ]
};
